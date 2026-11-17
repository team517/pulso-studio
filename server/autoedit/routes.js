// Rutas de la auto-edición.
import { createJob, jobView, listJobs, editedLibrary, requestChanges, setReview, retryJob, allowRulesAndRetry, deleteJob, VARIANTS, kick, itemElements, removeElements } from "./pipeline.js";
import { aiProvider, resetClaudeCheck } from "./brain.js";
import { IS_SERVER } from "../config.js";
import { PERSISTENT } from "../db.js";
const dataPersistent = () => (IS_SERVER ? PERSISTENT : true);
import { workerStatus } from "../worker-api.js";

export function registerAutoeditRoutes(app, wrap) {
  app.get("/api/autoedit/info", wrap(async (req, res) => {
    // En el servidor, quien edita es tu PC: «Claude listo» = PC conectado y con Claude
    const worker = IS_SERVER ? workerStatus() : null;
    const provider = IS_SERVER ? (worker.claude ? "claude" : null) : await aiProvider();
    res.json({ claude: !!provider, provider, worker, storage: dataPersistent(), variants: VARIANTS.map((v) => ({ key: v.key, label: v.label, layout: v.layout, width: v.width, height: v.height })) });
  }));
  app.get("/api/autoedit/jobs", wrap((req, res) => res.json(listJobs())));
  // Volver a comprobar ya la sesión de Claude (tras iniciar sesión)
  app.post("/api/autoedit/recheck", wrap(async (req, res) => {
    if (IS_SERVER) { const w = workerStatus(); return res.json({ provider: w.claude ? "claude" : null }); }
    resetClaudeCheck(); res.json({ provider: await aiProvider() });
  }));
  app.get("/api/autoedit/library", wrap((req, res) => res.json(editedLibrary())));
  app.post("/api/autoedit/jobs", wrap((req, res) => {
    const id = createJob(String(req.body.mediaId || ""), req.body || {});
    res.json(jobView(id));
  }));
  app.get("/api/autoedit/jobs/:id", wrap((req, res) => {
    const j = jobView(req.params.id);
    if (!j) throw Object.assign(new Error("No encontrado"), { status: 404 });
    res.json(j);
  }));
  app.post("/api/autoedit/jobs/:id/retry", wrap((req, res) => { retryJob(req.params.id); res.json(jobView(req.params.id)); }));
  app.post("/api/autoedit/jobs/:id/use-rules", wrap((req, res) => { allowRulesAndRetry(req.params.id); res.json(jobView(req.params.id)); }));
  app.delete("/api/autoedit/jobs/:id", wrap((req, res) => { deleteJob(req.params.id); res.json({ ok: true }); }));
  app.post("/api/autoedit/items/:id/review", wrap((req, res) => { setReview(req.params.id, String(req.body.review)); res.json({ ok: true }); }));
  app.get("/api/autoedit/items/:id/elements", wrap((req, res) => res.json(itemElements(req.params.id))));
  app.post("/api/autoedit/items/:id/remove", wrap(async (req, res) => {
    removeElements(req.params.id, req.body?.keys || [], String(req.body?.notes || ""));
    res.json({ ok: true });
  }));
  app.post("/api/autoedit/items/:id/changes", wrap(async (req, res) => {
    await requestChanges(req.params.id, String(req.body.notes || ""));
    res.json({ ok: true });
  }));
  // Retomar trabajos que quedaron a medias al arrancar
  setTimeout(kick, 3000);
}
