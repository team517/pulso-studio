// Rutas de la auto-edición.
import { createJob, jobView, listJobs, requestChanges, setReview, retryJob, allowRulesAndRetry, deleteJob, VARIANTS, kick } from "./pipeline.js";
import { aiProvider } from "./brain.js";

export function registerAutoeditRoutes(app, wrap) {
  app.get("/api/autoedit/info", wrap(async (req, res) => {
    const provider = await aiProvider();
    res.json({ claude: !!provider, provider, variants: VARIANTS.map((v) => ({ key: v.key, label: v.label, layout: v.layout, width: v.width, height: v.height })) });
  }));
  app.get("/api/autoedit/jobs", wrap((req, res) => res.json(listJobs())));
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
  app.post("/api/autoedit/items/:id/changes", wrap(async (req, res) => {
    await requestChanges(req.params.id, String(req.body.notes || ""));
    res.json({ ok: true });
  }));
  // Retomar trabajos que quedaron a medias al arrancar
  setTimeout(kick, 3000);
}
