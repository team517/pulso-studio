// Estilos guardados: cada uno nace de unos vídeos de referencia que Claude estudia fotograma a fotograma
// (subtítulos, tipografía, colores, zooms, look). Se guardan con sus vídeos y se aplican con un clic.
import multer from "multer";
import { join, extname, basename } from "node:path";
import { existsSync, rmSync, renameSync, mkdirSync } from "node:fs";
import { db, DATA, uid, now, row, getSetting, setSetting } from "./db.js";
import { IS_SERVER } from "./config.js";
import { isWorker } from "./auth.js";
import { STYLE_DIR, DEFAULT_STYLE } from "./style.js";

db.exec(`
  CREATE TABLE IF NOT EXISTS style_presets (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, step TEXT, error TEXT,
    assets TEXT NOT NULL, style TEXT, analysis TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`);

const VID_EXT = [".mp4", ".mov", ".m4v", ".webm"];
const IMG_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const getPreset = (id) => db.prepare("SELECT * FROM style_presets WHERE id = ?").get(id);
const setPreset = (id, f) => {
  const k = Object.keys(f);
  db.prepare(`UPDATE style_presets SET ${k.map((x) => x + " = ?").join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...k.map((x) => (f[x] !== null && typeof f[x] === "object" ? JSON.stringify(f[x]) : f[x])), now(), id);
};
const assetsOf = (p) => parse(p.assets, []).map((id) => db.prepare("SELECT * FROM style_assets WHERE id = ?").get(id)).filter(Boolean);

function presetOut(p) {
  const a = assetsOf(p);
  const style = parse(p.style, null);
  const font = (id) => { const f = id ? db.prepare("SELECT family, name FROM style_assets WHERE id = ?").get(id) : null; return f ? f.family || f.name : null; };
  return {
    id: p.id, name: p.name, status: p.status, step: p.step, error: p.error, created_at: p.created_at, updated_at: p.updated_at,
    active: getSetting("style:default", {}).activePreset === p.id,
    videos: a.map((x) => ({ id: x.id, name: x.name, url: `/files/style/${x.file}`, video: VID_EXT.includes(extname(x.file).toLowerCase()) })),
    style, analysis: parse(p.analysis, null),
    fonts: style ? { caption: font(style.fonts?.caption), keyword: font(style.fonts?.keyword) } : null,
  };
}

/** Aplica un estilo guardado: pasa a ser el estilo de todas las ediciones (se conservan logo e instrucciones). */
export function applyPreset(id) {
  const p = getPreset(id);
  if (!p) throw Object.assign(new Error("No encuentro ese estilo."), { status: 404 });
  const ps = parse(p.style, null);
  if (!ps) throw Object.assign(new Error("Este estilo todavía se está analizando."), { status: 409 });
  const cur = getSetting("style:default", {});
  const analysis = parse(p.analysis, {});
  setSetting("style:default", {
    ...cur,
    fonts: { ...DEFAULT_STYLE.fonts, ...(ps.fonts || {}) },
    colors: { ...DEFAULT_STYLE.colors, ...(cur.colors || {}), ...(ps.colors || {}) },
    caption: { ...DEFAULT_STYLE.caption, ...ps.caption },
    cards: ps.cards || cur.cards || DEFAULT_STYLE.cards,
    motion: { ...DEFAULT_STYLE.motion, ...ps.motion },
    look: ps.look || null,
    grade: ps.grade || "neutral",
    graphics: ps.graphics || cur.graphics || "few",
    music: ps.music || cur.music || "auto",
    rhythm: ps.rhythm || null,
    aiNotes: analysis.summary || "",
    rules: ps.rules || [],
    aiSuggested: null,
    activePreset: p.id,
  });
}

export function registerPresetRoutes(app, wrap) {
  const up = multer({
    storage: multer.diskStorage({ destination: STYLE_DIR, filename: (req, file, cb) => cb(null, uid() + (extname(file.originalname) || "").toLowerCase()) }),
    limits: { fileSize: 4 * 1024 ** 3 },
  });

  app.get("/api/presets", wrap((req, res) => {
    res.json(db.prepare("SELECT * FROM style_presets ORDER BY created_at DESC").all().map(presetOut));
  }));

  // Nuevo estilo: vídeos subidos ahora (files) y/o referencias que ya tenías (assetIds)
  app.post("/api/presets", up.array("files", 10), wrap((req, res) => {
    const ids = [];
    for (const f of req.files || []) {
      const ext = extname(f.filename).toLowerCase();
      if (![...VID_EXT, ...IMG_EXT].includes(ext)) { rmSync(join(STYLE_DIR, f.filename), { force: true }); continue; }
      const id = f.filename.replace(/\.[^.]+$/, "");
      const name = Buffer.from(f.originalname, "latin1").toString("utf8");
      db.prepare("INSERT INTO style_assets (id, kind, name, file, family, created_at) VALUES (?, 'preset', ?, ?, NULL, ?)").run(id, name, f.filename, now());
      ids.push(id);
    }
    let extra = req.body?.assetIds;
    if (typeof extra === "string") extra = parse(extra, extra.split(","));
    for (const id of Array.isArray(extra) ? extra : []) if (db.prepare("SELECT id FROM style_assets WHERE id = ?").get(id)) ids.push(String(id));
    if (!ids.length) throw Object.assign(new Error("Sube al menos un vídeo de referencia."), { status: 400 });
    const id = uid();
    const name = String(req.body?.name || "").trim().slice(0, 40) || "Estilo nuevo";
    db.prepare("INSERT INTO style_presets (id, name, status, step, assets, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?, ?)")
      .run(id, name, IS_SERVER ? "Esperando a tu PC (Claude)" : "En cola", JSON.stringify([...new Set(ids)]), now(), now());
    if (!IS_SERVER) setTimeout(() => runLocal(id), 200);
    res.json(presetOut(getPreset(id)));
  }));

  app.post("/api/presets/:id/use", wrap((req, res) => { applyPreset(req.params.id); res.json({ ok: true }); }));

  app.post("/api/presets/:id/analyze", wrap((req, res) => {
    if (!getPreset(req.params.id)) throw Object.assign(new Error("No encuentro ese estilo."), { status: 404 });
    setPreset(req.params.id, { status: "queued", step: IS_SERVER ? "Esperando a tu PC (Claude)" : "En cola", error: null });
    if (!IS_SERVER) setTimeout(() => runLocal(req.params.id), 200);
    res.json(presetOut(getPreset(req.params.id)));
  }));

  app.put("/api/presets/:id", wrap((req, res) => {
    const p = getPreset(req.params.id);
    if (!p) throw Object.assign(new Error("No encuentro ese estilo."), { status: 404 });
    if (req.body?.name) setPreset(p.id, { name: String(req.body.name).trim().slice(0, 40) });
    res.json(presetOut(getPreset(p.id)));
  }));

  app.delete("/api/presets/:id", wrap((req, res) => {
    const p = getPreset(req.params.id);
    if (p) {
      // Se borran sus vídeos propios (no las referencias generales ni las fuentes que use otro estilo)
      for (const a of assetsOf(p)) if (a.kind === "preset") { rmSync(join(STYLE_DIR, a.file), { force: true }); db.prepare("DELETE FROM style_assets WHERE id = ?").run(a.id); }
      db.prepare("DELETE FROM style_presets WHERE id = ?").run(p.id);
      const cur = getSetting("style:default", {});
      if (cur.activePreset === p.id) setSetting("style:default", { ...cur, activePreset: null });
    }
    res.json({ ok: true });
  }));

  if (!IS_SERVER) return;

  /* ---------- El PC (Claude) analiza ---------- */
  const guard = (req, res, next) => (isWorker(req) ? next() : res.status(401).json({ error: "Token del PC incorrecto." }));
  const fontUp = multer({ dest: join(DATA, "tmp") });

  app.post("/api/worker/presets/:id/font", guard, fontUp.single("file"), wrap((req, res) => {
    const f = req.file;
    if (!f) throw Object.assign(new Error("Falta la fuente."), { status: 400 });
    const ext = extname(String(req.body.filename || f.originalname || ".ttf")).toLowerCase() || ".ttf";
    const id = uid();
    mkdirSync(STYLE_DIR, { recursive: true });
    renameSync(f.path, join(STYLE_DIR, id + ext));
    db.prepare("INSERT INTO style_assets (id, kind, name, file, family, created_at) VALUES (?, 'font', ?, ?, ?, ?)")
      .run(id, basename(String(req.body.filename || f.originalname || id + ext)), id + ext, String(req.body.family || "Fuente").slice(0, 80), now());
    res.json({ id });
  }));

  app.post("/api/worker/presets/:id/state", guard, wrap((req, res) => {
    const p = getPreset(req.params.id);
    if (!p) return res.json({ gone: true });
    const b = req.body || {};
    const f = {};
    for (const k of ["status", "step", "error"]) if (k in b) f[k] = b[k];
    if (b.style) f.style = b.style;
    if (b.analysis) f.analysis = b.analysis;
    if (b.name && p.name === "Estilo nuevo") f.name = String(b.name).slice(0, 40);
    setPreset(p.id, f);
    // Si era el estilo en uso, se actualiza con el análisis nuevo
    if (b.status === "ready" && getSetting("style:default", {}).activePreset === p.id) applyPreset(p.id);
    res.json({ ok: true });
  }));
}

/** Siguiente estilo por analizar (para el PC). */
export function nextPresetTask() {
  if (!IS_SERVER) return null;
  const stale = new Date(Date.now() - 20 * 60e3).toISOString();
  const p = db.prepare("SELECT * FROM style_presets WHERE status = 'queued' ORDER BY created_at LIMIT 1").get()
    || db.prepare("SELECT * FROM style_presets WHERE status = 'analyzing' AND updated_at < ? ORDER BY created_at LIMIT 1").get(stale);
  if (!p) return null;
  setPreset(p.id, { status: "analyzing", step: "Tu PC lo ha recogido", error: null });
  return { type: "preset", preset: { id: p.id, name: p.name }, assets: assetsOf(p) };
}

/* ---------- En local (sin servidor): se analiza aquí mismo ---------- */

let localBusy = false;
async function runLocal(id) {
  if (localBusy) return setTimeout(() => runLocal(id), 5000);
  localBusy = true;
  try {
    const p = getPreset(id);
    if (!p) return;
    setPreset(id, { status: "analyzing", step: "Claude está estudiando los vídeos fotograma a fotograma", error: null });
    const { analyzePresetFiles, downloadGoogleFont } = await import("./preset-analyze.js");
    const files = assetsOf(p).map((a) => join(STYLE_DIR, a.file)).filter(existsSync);
    const r = await analyzePresetFiles(files, join(DATA, "tmp", "preset-" + id));
    const fonts = {};
    for (const role of ["caption", "keyword"]) {
      const want = r.fontsWanted[role];
      if (!want) continue;
      setPreset(id, { step: `Descargando la tipografía (${want.families[0]})` });
      const got = await downloadGoogleFont(want.families, want.weight, join(DATA, "tmp", "fonts"));
      if (!got) continue;
      const fid = uid();
      const ext = extname(got.file) || ".ttf";
      renameSync(got.file, join(STYLE_DIR, fid + ext));
      db.prepare("INSERT INTO style_assets (id, kind, name, file, family, created_at) VALUES (?, 'font', ?, ?, ?, ?)").run(fid, `${got.family} ${got.weight}${ext}`, fid + ext, got.family, now());
      fonts[role] = fid;
      if (role === "caption") r.style.caption.weight = got.weight;
    }
    r.style.fonts = { caption: fonts.caption || null, keyword: fonts.keyword || (r.style.caption.keywordFont === "same" ? fonts.caption || null : null), title: fonts.caption || null };
    setPreset(id, { status: "ready", step: "Listo", style: r.style, analysis: { summary: r.summary, fonts: r.fontsWanted, frames: r.frames, raw: r.raw }, ...(p.name === "Estilo nuevo" ? { name: r.name } : {}) });
    if (getSetting("style:default", {}).activePreset === id) applyPreset(id);
  } catch (e) {
    console.error("[estilos]", e);
    setPreset(id, { status: "error", step: null, error: String(e.message || e).slice(0, 500) });
  } finally { localBusy = false; }
}
void row;
