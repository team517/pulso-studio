// Modo servidor: lo que usa el PC que edita para recoger trabajo y devolver los vídeos.
// Todas estas rutas piden la cabecera x-worker-token (STUDIO_WORKER_TOKEN).
import multer from "multer";
import { join, basename } from "node:path";
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { db, DIRS, now, row, getSetting, setSetting } from "./db.js";
import { randomBytes } from "node:crypto";
import { IS_SERVER, BASE } from "./config.js";
import { isWorker } from "./auth.js";
import { setJob, setItem } from "./autoedit/pipeline.js";
import { STYLE_DIR } from "./style.js";

const STALE_MIN = 15; // si el PC no da señales en 15 min, el trabajo vuelve a la cola

/** Estado del PC para la interfaz. */
export function workerStatus() {
  const w = getSetting("worker:status", null);
  const online = !!w && Date.now() - w.at < 90e3;
  return { online, claude: online && !!w.claude, lastSeen: w?.at ?? null, busy: online ? w.busy || null : null };
}

export function registerWorkerRoutes(app, wrap) {
  if (!IS_SERVER) return;
  const guard = (req, res, next) => (isWorker(req) ? next() : res.status(401).json({ error: "Token del PC incorrecto." }));
  const up = multer({ dest: DIRS.tmp, limits: { fileSize: 8 * 1024 ** 3 } });

  // «Conectar mi PC» (con la sesión de admin): da el archivo de configuración para el editor del PC
  app.post("/api/pc/pair", wrap((req, res) => {
    let token = getSetting("worker:token", "");
    if (!token || req.body?.renew) { token = randomBytes(32).toString("base64url"); setSetting("worker:token", token); }
    const server = (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}${BASE}`).replace(/\/+$/, "");
    res.json({ server, token });
  }));

  app.post("/api/worker/hello", guard, wrap((req, res) => {
    setSetting("worker:status", { at: Date.now(), claude: !!req.body?.claude, busy: req.body?.busy || null, version: req.body?.version || null });
    res.json({ ok: true });
  }));

  // Siguiente encargo: mirar referencias > transcribir > editar
  const claimedTx = new Map();
  app.get("/api/worker/next", guard, wrap((req, res) => {
    const ask = getSetting("worker:analyzeReq", 0), done = getSetting("worker:analyzeDone", 0);
    if (ask > done) {
      setSetting("worker:analyzeDone", ask);
      return res.json({ type: "analyze" });
    }
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
