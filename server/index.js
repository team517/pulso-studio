// Servidor local de Pulso Studio: biblioteca, proyectos, exportación y publicaciones programadas.
import express from "express";
import multer from "multer";
import { join, extname } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { db, DIRS, uid, now, row, getSetting, setSetting } from "./db.js";
import { probe, makeThumb, transcribe } from "./media.js";
import { createExport } from "./render.js";
import { PORT, PLATFORMS, status as platformStatus, configure, disconnect, authUrl, handleCallback, publicUrl, checkInstagram, getConf } from "./platforms.js";
import { startScheduler, runPost } from "./scheduler.js";
import { registerAutoeditRoutes } from "./autoedit/routes.js";
import { createJob } from "./autoedit/pipeline.js";
import { registerStyleRoutes, getAutoSettings } from "./style.js";
import { registerInsightsRoutes, startInsightsPoller } from "./insights.js";

const app = express();
app.use(express.json({ limit: "20mb" }));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.message || String(e) });
});
const notFound = () => Object.assign(new Error("No encontrado"), { status: 404 });

// Archivos (con soporte de rangos para poder saltar dentro del vídeo)
app.use("/files/media", express.static(DIRS.media, { maxAge: "1y", immutable: true }));
app.use("/files/thumbs", express.static(DIRS.thumbs, { maxAge: "1h" }));
app.use("/files/exports", express.static(DIRS.exports));

/* ---------- Biblioteca ---------- */

const upload = multer({
  storage: multer.diskStorage({
    destination: DIRS.media,
    filename: (req, file, cb) => cb(null, uid() + (extname(file.originalname) || "").toLowerCase()),
  }),
});

const mediaOut = (m) => {
  const r = row(m);
  return { ...r, has_audio: !!r.has_audio, url: `/files/media/${r.file}`, thumbUrl: r.thumb ? `/files/thumbs/${r.thumb}` : null, transcript: r.transcript ?? null };
};

app.get("/api/media", wrap((req, res) => {
  res.json(db.prepare("SELECT * FROM media ORDER BY created_at DESC").all().map(mediaOut));
}));

app.post("/api/media", upload.array("files", 50), wrap(async (req, res) => {
  const out = [];
  for (const f of req.files || []) {
    const id = f.filename.replace(/\.[^.]+$/, "");
    const path = join(DIRS.media, f.filename);
    let info;
    try { info = await probe(path); } catch { rmSync(path, { force: true }); continue; }
    const isImage = /^image\//.test(f.mimetype) || [".jpg", ".jpeg", ".png", ".webp"].includes(extname(f.filename));
    const kind = isImage ? "image" : info.hasVideo ? "video" : info.hasAudio ? "audio" : null;
    if (!kind) { rmSync(path, { force: true }); continue; }
    const thumb = kind === "audio" ? null : await makeThumb(path, `${id}.jpg`, kind === "video" ? Math.min(1, info.duration / 3) : 0).catch(() => null);
    db.prepare(`INSERT INTO media (id, name, kind, file, duration, width, height, has_audio, size, thumb, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, Buffer.from(f.originalname, "latin1").toString("utf8"), kind, f.filename,
      kind === "image" ? 5 : info.duration, info.width, info.height, info.hasAudio ? 1 : 0, f.size, thumb, now());
    const saved = mediaOut(db.prepare("SELECT * FROM media WHERE id = ?").get(id));
    // Subido desde la Biblioteca o Auto-edición (?auto=1): empieza la auto-edición sola
    if (req.query.auto === "1" && kind === "video" && info.hasAudio && info.duration >= 5) {
      const auto = getAutoSettings();
      if (auto.enabled) {
        try {
          saved.autoeditJob = createJob(id, { kind: info.duration > 150 ? "shorts" : "variants", variants: auto.variants, shorts: auto.shorts || "auto" });
        } catch (e) { console.warn("[autoedit] no se pudo empezar sola:", e.message); }
      }
    }
    out.push(saved);
  }
  res.json(out);
}));

app.get("/api/media/:id", wrap((req, res) => {
  const m = db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.id);
  if (!m) throw notFound();
  res.json(mediaOut(m));
}));

app.patch("/api/media/:id", wrap((req, res) => {
  if (req.body.name) db.prepare("UPDATE media SET name = ? WHERE id = ?").run(String(req.body.name).slice(0, 200), req.params.id);
  res.json(mediaOut(db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.id)));
}));

app.delete("/api/media/:id", wrap((req, res) => {
  const m = db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.id);
  if (!m) throw notFound();
  rmSync(join(DIRS.media, m.file), { force: true });
  if (m.thumb) rmSync(join(DIRS.thumbs, m.thumb), { force: true });
  db.prepare("DELETE FROM media WHERE id = ?").run(m.id);
  res.json({ ok: true });
}));

app.post("/api/media/:id/transcribe", wrap((req, res) => {
  const m = db.prepare("SELECT * FROM media WHERE id = ?").get(req.params.id);
  if (!m) throw notFound();
  if (m.kind === "image") throw Object.assign(new Error("Una imagen no tiene voz."), { status: 400 });
  transcribe(m.id, req.body?.language || "es");
  res.json({ ok: true });
}));

/* ---------- Proyectos ---------- */

const FORMATS = { "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350], "16:9": [1920, 1080] };

const projectOut = (p) => {
  const r = row(p);
  return { ...r, thumbUrl: r.thumb ? `/files/thumbs/${r.thumb}` : null };
};

app.get("/api/projects", wrap((req, res) => {
  res.json(db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all().map(projectOut));
}));

app.post("/api/projects", wrap((req, res) => {
  const format = FORMATS[req.body.format] ? req.body.format : "9:16";
  const [width, height] = FORMATS[format];
  const id = uid();
  const data = { format, width, height, fps: 30, background: "#000000", clips: [], texts: [], captions: { enabled: false, items: [], style: {} }, music: null };
  db.prepare("INSERT INTO projects (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, String(req.body.name || "Proyecto sin título").slice(0, 120), JSON.stringify(data), now(), now());
  res.json(projectOut(db.prepare("SELECT * FROM projects WHERE id = ?").get(id)));
}));

app.get("/api/projects/:id", wrap((req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!p) throw notFound();
  res.json(projectOut(p));
}));

app.put("/api/projects/:id", wrap((req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!p) throw notFound();
  const name = req.body.name != null ? String(req.body.name).slice(0, 120) : p.name;
  const data = req.body.data ? JSON.stringify(req.body.data) : p.data;
  // Miniatura del proyecto = la del primer clip
  const first = req.body.data?.clips?.[0]?.mediaId;
  const thumb = first ? db.prepare("SELECT thumb FROM media WHERE id = ?").get(first)?.thumb ?? p.thumb : null;
  db.prepare("UPDATE projects SET name = ?, data = ?, thumb = ?, updated_at = ? WHERE id = ?").run(name, data, thumb, now(), p.id);
  res.json(projectOut(db.prepare("SELECT * FROM projects WHERE id = ?").get(p.id)));
}));

app.post("/api/projects/:id/duplicate", wrap((req, res) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!p) throw notFound();
  const id = uid();
  db.prepare("INSERT INTO projects (id, name, data, thumb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, p.name + " (copia)", p.data, p.thumb, now(), now());
  res.json(projectOut(db.prepare("SELECT * FROM projects WHERE id = ?").get(id)));
}));

app.delete("/api/projects/:id", wrap((req, res) => {
  db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
}));

/* ---------- Exportaciones ---------- */

const exportOut = (e) => ({ ...e, url: e.file ? `/files/exports/${e.file}` : null, thumbUrl: e.thumb ? `/files/thumbs/${e.thumb}` : null });

app.post("/api/projects/:id/export", wrap((req, res) => {
  const p = row(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id));
  if (!p) throw notFound();
  const data = req.body.data || p.data;
  if (!data.clips?.length) throw Object.assign(new Error("Añade al menos un clip antes de exportar."), { status: 400 });
  const id = createExport(p.id, String(req.body.name || p.name).slice(0, 120), data);
  res.json(exportOut(db.prepare("SELECT * FROM exports WHERE id = ?").get(id)));
}));

app.get("/api/exports", wrap((req, res) => {
  res.json(db.prepare("SELECT * FROM exports ORDER BY created_at DESC").all().map(exportOut));
}));

app.get("/api/exports/:id", wrap((req, res) => {
  const e = db.prepare("SELECT * FROM exports WHERE id = ?").get(req.params.id);
  if (!e) throw notFound();
  res.json(exportOut(e));
}));

app.patch("/api/exports/:id", wrap((req, res) => {
  if (req.body.name) db.prepare("UPDATE exports SET name = ? WHERE id = ?").run(String(req.body.name).slice(0, 120), req.params.id);
  res.json(exportOut(db.prepare("SELECT * FROM exports WHERE id = ?").get(req.params.id)));
}));

app.delete("/api/exports/:id", wrap((req, res) => {
  const e = db.prepare("SELECT * FROM exports WHERE id = ?").get(req.params.id);
  if (!e) throw notFound();
  const used = db.prepare("SELECT COUNT(*) AS n FROM posts WHERE export_id = ? AND status IN ('scheduled','publishing')").get(e.id).n;
  if (used) throw Object.assign(new Error("Este vídeo tiene publicaciones programadas. Bórralas antes."), { status: 409 });
  if (e.file) rmSync(join(DIRS.exports, e.file), { force: true });
  if (e.thumb) rmSync(join(DIRS.thumbs, e.thumb), { force: true });
  db.prepare("DELETE FROM exports WHERE id = ?").run(e.id);
  res.json({ ok: true });
}));

/* ---------- Publicaciones ---------- */

const postOut = (p) => {
  const r = row(p);
  const e = r.export_id ? db.prepare("SELECT id, name, file, thumb, duration FROM exports WHERE id = ?").get(r.export_id) : null;
  return { ...r, video: e ? { ...e, url: e.file ? `/files/exports/${e.file}` : null, thumbUrl: e.thumb ? `/files/thumbs/${e.thumb}` : null } : null };
};

function cleanPost(b) {
  const platforms = (Array.isArray(b.platforms) ? b.platforms : []).filter((p) => PLATFORMS.includes(p));
  if (!platforms.length) throw Object.assign(new Error("Elige al menos una red."), { status: 400 });
  if (!b.export_id) throw Object.assign(new Error("Elige el vídeo."), { status: 400 });
  const when = new Date(b.scheduled_at);
  if (Number.isNaN(when.getTime())) throw Object.assign(new Error("Fecha no válida."), { status: 400 });
  return {
    export_id: String(b.export_id), title: String(b.title || "").slice(0, 100), caption: String(b.caption || "").slice(0, 2200),
    platforms: JSON.stringify(platforms), options: JSON.stringify(b.options || {}), scheduled_at: when.toISOString(),
  };
}

app.get("/api/posts", wrap((req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)).toISOString() : "0000";
  const to = req.query.to ? new Date(String(req.query.to)).toISOString() : "9999";
  res.json(db.prepare("SELECT * FROM posts WHERE scheduled_at >= ? AND scheduled_at < ? ORDER BY scheduled_at").all(from, to).map(postOut));
}));

app.post("/api/posts", wrap((req, res) => {
  const p = cleanPost(req.body);
  const id = uid();
  db.prepare(`INSERT INTO posts (id, export_id, title, caption, platforms, options, scheduled_at, status, results, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', '{}', ?, ?)`).run(id, p.export_id, p.title, p.caption, p.platforms, p.options, p.scheduled_at, now(), now());
  res.json(postOut(db.prepare("SELECT * FROM posts WHERE id = ?").get(id)));
}));

app.put("/api/posts/:id", wrap((req, res) => {
  const cur = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!cur) throw notFound();
  if (cur.status === "publishing") throw Object.assign(new Error("Se está publicando ahora mismo."), { status: 409 });
  const p = cleanPost(req.body);
  // Si se cambia algo de una publicación que falló, vuelve a quedar programada (solo reintenta las redes que fallaron)
  const status = cur.status === "published" ? "published" : "scheduled";
  db.prepare("UPDATE posts SET export_id = ?, title = ?, caption = ?, platforms = ?, options = ?, scheduled_at = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(p.export_id, p.title, p.caption, p.platforms, p.options, p.scheduled_at, status, now(), cur.id);
  res.json(postOut(db.prepare("SELECT * FROM posts WHERE id = ?").get(cur.id)));
}));

app.delete("/api/posts/:id", wrap((req, res) => {
  db.prepare("DELETE FROM posts WHERE id = ? AND status <> 'publishing'").run(req.params.id);
  res.json({ ok: true });
}));

app.post("/api/posts/:id/publish-now", wrap(async (req, res) => {
  const cur = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!cur) throw notFound();
  runPost(cur.id).catch((e) => console.error(e));
  res.json({ ok: true });
}));

/* ---------- Conexiones con las redes ---------- */

app.get("/api/platforms", wrap((req, res) => {
  res.json({ platforms: platformStatus(), publicUrl: getSetting("public_url", ""), localUrl: `http://localhost:${PORT}` });
}));

app.put("/api/platforms/public-url", wrap((req, res) => {
  setSetting("public_url", String(req.body.publicUrl || "").trim());
  res.json({ ok: true });
}));

app.put("/api/platforms/:p", wrap(async (req, res) => {
  if (!PLATFORMS.includes(req.params.p)) throw notFound();
  await configure(req.params.p, req.body || {});
  res.json(platformStatus().find((x) => x.id === req.params.p));
}));

app.get("/api/platforms/instagram/check", wrap(async (req, res) => {
  res.json(await checkInstagram());
}));

app.get("/api/platforms/instagram/pages", wrap((req, res) => {
  res.json(getConf("instagram").pages ?? []);
}));

app.post("/api/platforms/:p/disconnect", wrap((req, res) => {
  disconnect(req.params.p);
  res.json({ ok: true });
}));

const oauthStates = new Map();
app.get("/api/auth/:p/start", wrap((req, res) => {
  const state = randomBytes(16).toString("hex");
  const front = /^https?:\/\/[^/]+$/.test(String(req.query.front || "")) ? String(req.query.front) : "";
  oauthStates.set(state, { p: req.params.p, front, back: String(req.query.back || "/conexiones"), at: Date.now() });
  res.redirect(authUrl(req.params.p, state));
}));

app.get("/api/auth/:p/callback", async (req, res) => {
  const st = oauthStates.get(String(req.query.state || ""));
  oauthStates.delete(String(req.query.state || ""));
  const back = (st?.back || "/conexiones").replace(/^(?!\/)/, "/");
  const front = st?.front || "";
  if (!st || st.p !== req.params.p) return res.redirect(`${front}${back}?error=${encodeURIComponent("La conexión caducó, inténtalo otra vez.")}`);
  if (req.query.error) return res.redirect(`${front}${back}?error=${encodeURIComponent(String(req.query.error_description || req.query.error))}`);
  try {
    await handleCallback(req.params.p, String(req.query.code));
    res.redirect(`${front}${back}?ok=${req.params.p}`);
  } catch (e) {
    res.redirect(`${front}${back}?error=${encodeURIComponent(e.message)}`);
  }
});

/* ---------- Auto-edición (5 versiones / shorts) ---------- */

registerAutoeditRoutes(app, wrap);

/* ---------- Estilo de edición ---------- */

registerStyleRoutes(app, wrap);

/* ---------- Resultados (visitas de cada publicación) ---------- */

registerInsightsRoutes(app);

/* ---------- Web (versión compilada) ---------- */

const dist = join(process.cwd(), "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|files).*/, (req, res) => res.sendFile(join(dist, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Pulso Studio · servidor en http://localhost:${PORT} · redes: ${publicUrl()}`);
  startScheduler();
  startInsightsPoller();
});
