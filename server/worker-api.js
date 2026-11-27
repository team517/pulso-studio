// Modo servidor: lo que usa el PC que edita para recoger trabajo y devolver los vídeos.
// Todas estas rutas piden la cabecera x-worker-token (STUDIO_WORKER_TOKEN).
import multer from "multer";
import { join, basename } from "node:path";
import { existsSync, renameSync, rmSync, statSync, readdirSync } from "node:fs";
import { db, DIRS, now, row, getSetting, setSetting } from "./db.js";
import { randomBytes, randomInt } from "node:crypto";
import { IS_SERVER, BASE, getSecret } from "./config.js";
import { isWorker } from "./auth.js";
import { setJob, setItem } from "./autoedit/pipeline.js";
import { STYLE_DIR } from "./style.js";
import { nextPresetTask } from "./presets.js";
import { nextIdeasTask } from "./ideas.js";

const STALE_MIN = 15; // si el PC no da señales en 15 min, el trabajo vuelve a la cola

/** Estado del PC para la interfaz. */
export function workerStatus() {
  const w = getSetting("worker:status", null);
  const online = !!w && Date.now() - w.at < 120e3;
  return { online, claude: online && !!w.claude, lastSeen: w?.at ?? null, busy: online ? w.busy || null : null, name: w?.name || null };
}

// Copia de seguridad en tu PC: tablas y carpetas que se copian (y se devuelven si el servidor empieza de cero)
const BACKUP_TABLES = ["folders", "media", "projects", "exports", "posts", "post_insights", "post_insights_state", "style_assets", "style_presets", "autoedit_jobs", "autoedit_items", "ideas_creators", "ideas", "settings"];
const CONTENT_TABLES = ["media", "projects", "exports", "posts", "style_assets", "style_presets", "autoedit_jobs", "ideas_creators", "ideas"];
const SKIP_SETTING = /^(auth:|worker:|server:id$)/;
const fileDirs = () => ({ media: DIRS.media, thumbs: DIRS.thumbs, exports: DIRS.exports, style: STYLE_DIR });
const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

export function registerWorkerRoutes(app, wrap) {
  if (!IS_SERVER) return;
  const guard = (req, res, next) => (isWorker(req) ? next() : res.status(401).json({ error: "Token del PC incorrecto." }));
  const up = multer({ dest: DIRS.tmp, limits: { fileSize: 8 * 1024 ** 3 } });

  const publicBase = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}${BASE}`).replace(/\/+$/, "");
  const workerToken = () => {
    let token = getSetting("worker:token", "");
    if (!token) { token = randomBytes(32).toString("base64url"); setSetting("worker:token", token); }
    return token;
  };

  // «Conectar mi PC» (con tu sesión): el archivo de configuración para el editor del PC (no cambia la clave)
  app.post("/api/pc/pair", wrap((req, res) => {
    if (req.body?.renew) setSetting("worker:token", "");
    res.json({ server: publicBase(req), token: workerToken() });
  }));

  // Conectar el PC con un clic: el editor pide un código, abre esta web y tú pulsas «Conectar»
  const pairs = new Map(); // código → { name, at, token }
  const prune = () => { for (const [k, v] of pairs) if (Date.now() - v.at > 20 * 60e3) pairs.delete(k); };
  const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  app.post("/api/worker/pair/start", wrap((req, res) => {
    prune();
    if (pairs.size >= 10) return res.status(429).json({ error: "Demasiadas peticiones. Espera unos minutos." });
    let code = "";
    for (let i = 0; i < 8; i++) code += ABC[randomInt(ABC.length)];
    code = code.slice(0, 4) + "-" + code.slice(4);
    pairs.set(code, { name: String(req.body?.name || "Tu PC").slice(0, 60), at: Date.now(), token: null });
    res.json({ code, url: `${publicBase(req)}/conectar-pc?code=${code}` });
  }));
  app.get("/api/worker/pair/:code", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const p = pairs.get(code);
    if (!p) return res.status(404).json({ error: "El código ha caducado." });
    if (!p.token) return res.json({ status: "pending" });
    pairs.delete(code);
    res.json({ status: "approved", token: p.token, server: publicBase(req) });
  });
  app.get("/api/pc/pending", (req, res) => {
    prune();
    res.json([...pairs].filter(([, v]) => !v.token).map(([code, v]) => ({ code, name: v.name, at: v.at })));
  });
  app.post("/api/pc/approve", wrap((req, res) => {
    const code = String(req.body?.code || "").toUpperCase().trim();
    const p = pairs.get(code);
    if (!p) return res.status(404).json({ error: "Ese código ya no vale. Cierra y vuelve a abrir el editor en tu PC." });
    p.token = workerToken();
    res.json({ ok: true, name: p.name });
  }));

  app.post("/api/worker/hello", guard, wrap((req, res) => {
    const b = req.body || {};
    const cur = getSetting("worker:status", {}) || {};
    // El aviso de vida llega por separado: si solo trae «sigo aquí», se conserva lo que estaba haciendo
    const keep = b.beat && cur.at && Date.now() - cur.at < 10 * 60e3;
    setSetting("worker:status", {
      at: Date.now(), name: String(b.name || cur.name || "").slice(0, 60) || null,
      claude: "claude" in b ? !!b.claude : !!cur.claude,
      busy: "busy" in b ? b.busy || null : keep ? cur.busy || null : null,
      version: b.version || cur.version || null,
    });
    res.json({ ok: true, server: getSetting("server:id", null) });
  }));

  // Siguiente encargo: mirar referencias > transcribir > editar
  const claimedTx = new Map();
  app.get("/api/worker/next", guard, wrap((req, res) => {
    const ask = getSetting("worker:analyzeReq", 0), done = getSetting("worker:analyzeDone", 0);
    if (ask > done) {
      setSetting("worker:analyzeDone", ask);
      return res.json({ type: "analyze" });
    }
    const preset = nextPresetTask();
    if (preset) return res.json(preset);
    const ideas = nextIdeasTask();
    if (ideas) return res.json(ideas);
    for (const m of db.prepare("SELECT * FROM media WHERE transcript_status = 'running' ORDER BY created_at").all()) {
      if (Date.now() - (claimedTx.get(m.id) || 0) < STALE_MIN * 60e3) continue;
      claimedTx.set(m.id, Date.now());
      return res.json({ type: "transcribe", media: row(m) });
    }
    const stale = new Date(Date.now() - STALE_MIN * 60e3).toISOString();
    let j = db.prepare("SELECT * FROM autoedit_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get()
      || db.prepare("SELECT * FROM autoedit_jobs WHERE status = 'running' AND updated_at < ? ORDER BY created_at LIMIT 1").get(stale);
    if (!j) {
      // ¿Alguna versión pendiente de rehacer en un trabajo ya terminado?
      const redo = db.prepare("SELECT job_id FROM autoedit_items WHERE status = 'queued' LIMIT 1").get();
      if (redo) j = db.prepare("SELECT * FROM autoedit_jobs WHERE id = ?").get(redo.job_id);
    }
    if (!j) return res.json({ type: null });
    setJob(j.id, { status: "running", step: "Tu PC lo ha recogido", error: null });
    const media = db.prepare("SELECT * FROM media WHERE id = ?").get(j.media_id);
    res.json({
      type: "job",
      job: row(db.prepare("SELECT * FROM autoedit_jobs WHERE id = ?").get(j.id)),
      items: db.prepare("SELECT * FROM autoedit_items WHERE job_id = ? ORDER BY idx").all(j.id).map(row),
      media: media ? row(media) : null,
    });
  }));

  app.get("/api/worker/backup", guard, wrap((req, res) => {
    const tables = {};
    for (const t of BACKUP_TABLES) if (hasTable(t)) {
      let rows = db.prepare(`SELECT * FROM ${t}`).all();
      if (t === "settings") rows = rows.filter((r) => !SKIP_SETTING.test(r.key));
      tables[t] = rows;
    }
    const files = [];
    for (const [dir, path] of Object.entries(fileDirs())) {
      if (!existsSync(path)) continue;
      for (const d of readdirSync(path, { withFileTypes: true })) {
        if (!d.isFile() || d.name.endsWith(".part")) continue;
        files.push({ dir, name: d.name, size: statSync(join(path, d.name)).size });
      }
    }
    const empty = !CONTENT_TABLES.some((t) => hasTable(t) && db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get());
    // También tu cuenta y las claves, para devolverlas si el servidor se borra (se guardan solo en tu PC)
    const auth = { owner: getSetting("auth:owner", null), token: getSetting("worker:token", ""), secret: getSecret() };
    res.json({ server: getSetting("server:id", null), empty, tables, files, auth });
  }));
  app.get("/api/worker/backup/file/:dir/:name", guard, (req, res) => {
    const base = fileDirs()[req.params.dir];
    const f = base && join(base, basename(req.params.name));
    if (!f || !existsSync(f)) return res.status(404).json({ error: "No está ese archivo." });
    res.sendFile(f);
  });

  // Tu PC devuelve la copia: se suma a lo que haya (no borra ni pisa nada; los ajustes, solo si faltan)
  app.post("/api/worker/restore", guard, wrap((req, res) => {
    const tables = req.body?.tables || {};
    let n = 0;
    db.exec("BEGIN");
    try {
      for (const t of BACKUP_TABLES) {
        if (!hasTable(t) || !Array.isArray(tables[t])) continue;
        const cols = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
        for (const r of tables[t]) {
          if (t === "settings" && SKIP_SETTING.test(String(r.key))) continue;
          // Si ya lo volviste a subir tú (mismo nombre), no se duplica
          if (t === "style_assets" && db.prepare("SELECT 1 FROM style_assets WHERE kind = ? AND name = ? AND id != ?").get(r.kind, r.name, r.id)) continue;
          if (t === "media" && db.prepare("SELECT 1 FROM media WHERE name = ? AND size IS ? AND id != ?").get(r.name, r.size ?? null, r.id)) continue;
          const keys = Object.keys(r).filter((k) => cols.has(k) && !(t === "post_insights" && k === "id"));
          if (!keys.length) continue;
          // Tu estilo vuelve salvo que ya hayas montado otro en el servidor nuevo
          const cur = t === "settings" && r.key === "style:default" ? getSetting("style:default", null) : null;
          const verb = t === "settings" && r.key === "style:default" && !cur?.aiNotes && !cur?.activePreset ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
          n += db.prepare(`${verb} INTO ${t} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => r[k] ?? null)).changes;
        }
      }
      db.exec("COMMIT");
    } catch (e) { db.exec("ROLLBACK"); throw e; }
    console.log(`[copia] Tu PC ha devuelto ${n} filas`);
    res.json({ ok: true, rows: n });
  }));
  app.post("/api/worker/restore/file", guard, up.single("file"), wrap((req, res) => {
    const base = fileDirs()[req.body?.dir];
    if (!base || !req.file) { if (req.file) rmSync(req.file.path, { force: true }); return res.status(400).json({ error: "Falta el archivo." }); }
    const to = join(base, basename(String(req.body.name || req.file.originalname)));
    if (existsSync(to)) rmSync(req.file.path, { force: true });
    else renameSync(req.file.path, to);
    res.json({ ok: true });
  }));

  app.get("/api/worker/media/:id/file", guard, (req, res) => {
    const m = db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.id);
    if (!m || !existsSync(join(DIRS.media, m.file))) return res.status(404).json({ error: "No está el vídeo." });
    res.sendFile(join(DIRS.media, m.file));
  });

  app.get("/api/worker/style", guard, wrap((req, res) => {
    res.json({ style: getSetting("style:default", {}), auto: getSetting("autoedit:auto", {}), assets: db.prepare("SELECT * FROM style_assets").all() });
  }));
  app.get("/api/worker/style/file/:file", guard, (req, res) => {
    const f = join(STYLE_DIR, basename(req.params.file));
    if (!existsSync(f)) return res.status(404).json({ error: "No está ese archivo." });
    res.sendFile(f);
  });

  app.post("/api/worker/style/analysis", guard, wrap((req, res) => {
    const cur = getSetting("style:default", {});
    const b = req.body || {};
    setSetting("style:default", { ...cur, ...(b.aiNotes ? { aiNotes: String(b.aiNotes).slice(0, 900) } : {}), ...(b.aiSuggested ? { aiSuggested: b.aiSuggested } : {}) });
    res.json({ ok: true });
  }));

  app.post("/api/worker/media/:id/transcript", guard, wrap((req, res) => {
    const { status, transcript } = req.body || {};
    db.prepare("UPDATE media SET transcript = ?, transcript_status = ? WHERE id = ?")
      .run(transcript ? JSON.stringify(transcript) : null, String(status || "error").slice(0, 400), req.params.id);
    claimedTx.delete(req.params.id);
    res.json({ ok: true });
  }));

  // Estado del trabajo que lleva el PC (pasos, progreso, plan, versiones)
  app.post("/api/worker/jobs/:id/state", guard, wrap((req, res) => {
    const cur = db.prepare("SELECT * FROM autoedit_jobs WHERE id = ?").get(req.params.id);
    if (!cur) return res.json({ gone: true }); // lo borraste en el panel
    const j = req.body?.job || {};
    const f = {};
    for (const k of ["status", "step", "progress", "error", "plan", "brain", "summary"]) if (k in j) f[k] = j[k];
    if (Object.keys(f).length) setJob(cur.id, f);
    for (const it of req.body?.items || []) {
      const have = row(db.prepare("SELECT * FROM autoedit_items WHERE id = ?").get(it.id));
      if (!have) {
        db.prepare(`INSERT INTO autoedit_items (id, job_id, idx, label, layout, status, step, progress, error, qa, post, short, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(it.id, cur.id, it.idx, it.label, it.layout, it.status, it.step ?? null, it.progress ?? 0, it.error ?? null,
          it.qa ? JSON.stringify(it.qa) : null, it.post ? JSON.stringify(it.post) : null, it.short ? JSON.stringify(it.short) : null, now(), now());
        continue;
      }
      // Si mientras tanto pediste otro cambio en el panel, ese encargo no se pisa
      const post = { ...(it.post || {}) };
      if (have.post?.changeRequest && have.post.changeRequest !== it.handledChange) post.changeRequest = have.post.changeRequest;
      else delete post.changeRequest;
      const keepQueued = !!post.changeRequest && have.status === "queued";
      setItem(it.id, {
        idx: it.idx, label: it.label, layout: it.layout,
        status: keepQueued ? "queued" : it.status, step: keepQueued ? have.step : it.step ?? null, progress: keepQueued ? 0 : it.progress ?? 0,
        error: it.error ?? null, qa: it.qa ?? null, post, short: it.short ?? null,
      });
    }
    res.json({ ok: true });
  }));

  // Vídeo terminado de una versión → «Vídeos exportados» y la tarjeta de revisión
  app.post("/api/worker/items/:id/video", guard, up.fields([{ name: "video", maxCount: 1 }, { name: "thumb", maxCount: 1 }]), wrap((req, res) => {
    const it = db.prepare("SELECT * FROM autoedit_items WHERE id = ?").get(req.params.id);
    const v = req.files?.video?.[0], t = req.files?.thumb?.[0];
    const drop = () => { for (const f of [v, t]) if (f) rmSync(f.path, { force: true }); };
    if (!it || !v) { drop(); return res.status(it ? 400 : 404).json({ error: it ? "Falta el vídeo." : "Esa versión ya no existe." }); }
    const expId = String(req.body.exportId || "").replace(/[^\w-]/g, "") || it.export_id;
    if (!expId) { drop(); return res.status(400).json({ error: "Falta el id." }); }
    const file = `${expId}.mp4`;
    renameSync(v.path, join(DIRS.exports, file));
    let thumb = null;
    if (t) { thumb = `export-${expId}.jpg`; renameSync(t.path, join(DIRS.thumbs, thumb)); }
    db.prepare("DELETE FROM exports WHERE id = ?").run(expId);
    db.prepare(`INSERT INTO exports (id, project_id, name, file, thumb, status, progress, duration, width, height, size, created_at)
      VALUES (?, NULL, ?, ?, ?, 'done', 1, ?, ?, ?, ?, ?)`).run(expId, String(req.body.name || "Vídeo editado").slice(0, 120), file, thumb,
      Number(req.body.duration) || null, Number(req.body.width) || null, Number(req.body.height) || null, statSync(join(DIRS.exports, file)).size, now());
    setItem(it.id, { export_id: expId });
    res.json({ ok: true });
  }));
}
