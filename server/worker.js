// Tu PC como «editor» del Pulso Studio que está en el panel (EasyPanel).
// Recoge los vídeos por editar, los edita aquí (tarjeta gráfica + Whisper + Claude) y sube el resultado.
//   npm run worker
// Configuración: data/worker.json → { "server": "https://…/studio", "token": "…" }
//   (o las variables STUDIO_SERVER y STUDIO_WORKER_TOKEN)
process.env.STUDIO_MODE = "worker";

const { readFileSync, existsSync, mkdirSync, statSync, createWriteStream, openAsBlob, rmSync } = await import("node:fs");
const { join, basename } = await import("node:path");
const { Readable } = await import("node:stream");
const { pipeline: pump } = await import("node:stream/promises");
const { db, DIRS, DATA, row, now, getSetting, setSetting } = await import("./db.js");
const { STYLE_DIR, lookAtReferences } = await import("./style.js");
const { runJob, requestChanges, setJob } = await import("./autoedit/pipeline.js");
const { NeedLogin, aiProvider, resetClaudeCheck } = await import("./autoedit/brain.js");
const { transcribeNow } = await import("./media.js");

const cfgFile = join(DATA, "worker.json");
const DEFAULT_SERVER = "https://backend-onepulso-chipsfinder.25kofp.easypanel.host";
let cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : {};
const SERVER = String(process.env.STUDIO_SERVER || cfg.server || DEFAULT_SERVER).replace(/\/+$/, "");
let TOKEN = process.env.STUDIO_WORKER_TOKEN || cfg.token || "";

/** Pregunta por la consola (la contraseña no se ve al escribirla). */
async function ask(question, hidden = false) {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); else if (s === "\r\n" || s === "\n") process.stdout.write(s); };
  const answer = await new Promise((r) => rl.question(question, r));
  rl.close();
  if (hidden) process.stdout.write("\n");
  return answer.trim();
}

/** Primera vez (o clave que ya no vale): entras con tu cuenta de admin y el PC se conecta solo. */
async function pair() {
  console.log(`\nConectar este PC con Pulso Studio (${SERVER})`);
  console.log("Entra con tu cuenta de administrador de ChipsFinder.\n");
  for (;;) {
    const email = await ask("Correo: ");
    const password = await ask("Contraseña: ", true);
    const r = await fetch(`${SERVER}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await r.json().catch(() => null);
    if (!r.ok) { console.log(`✗ ${data?.error || "No se pudo entrar"}\n`); continue; }
    const cookie = String(r.headers.get("set-cookie") || "").split(";")[0];
    const p = await fetch(`${SERVER}/api/pc/pair`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ renew: true }) });
    const pd = await p.json().catch(() => null);
    if (!p.ok || !pd?.token) { console.log(`✗ ${pd?.error || "No se pudo conectar el PC"}\n`); continue; }
    TOKEN = pd.token;
    cfg = { server: SERVER, token: TOKEN };
    mkdirSync(DATA, { recursive: true });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
    console.log("✓ PC conectado. No hará falta volver a hacerlo.\n");
    return;
  }
}

// ¿Vale la clave que tenemos? Si no, se conecta con tu cuenta
async function tokenWorks() {
  if (!TOKEN) return false;
  try {
    const r = await fetch(`${SERVER}/api/worker/hello`, { method: "POST", headers: { "x-worker-token": TOKEN, "content-type": "application/json" }, body: "{}" });
    return r.status !== 401;
  } catch { return true; } // sin red: se reintenta luego
}
if (!(await tokenWorks())) await pair();

const log = (...a) => console.log(new Date().toLocaleTimeString("es-ES"), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, { raw = false, timeout = 60e3 } = {}) {
  const isForm = body instanceof FormData;
  const r = await fetch(SERVER + path, {
    method,
    headers: { "x-worker-token": TOKEN, ...(body && !isForm ? { "content-type": "application/json" } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (raw) { if (!r.ok) throw new Error(`${path}: ${r.status}`); return r; }
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(`${path}: ${data?.error || r.status}`);
  return data;
}

async function download(path, to) {
  const r = await call("GET", path, null, { raw: true, timeout: 60 * 60e3 });
  const tmp = to + ".part";
  await pump(Readable.fromWeb(r.body), createWriteStream(tmp));
  const { renameSync } = await import("node:fs");
  renameSync(tmp, to);
}

/* ---------- Señal de vida ---------- */

let busy = null;
async function hello() {
  try {
    const claude = (await aiProvider()) === "claude";
    await call("POST", "/api/worker/hello", { claude, busy, version: 1 });
  } catch (e) { log("Sin conexión con el panel:", e.message); }
}

/* ---------- Copias locales de lo que hay en el servidor ---------- */

async function ensureMedia(m) {
  const file = join(DIRS.media, m.file);
  if (!existsSync(file) || statSync(file).size !== m.size) {
    log(`Descargando «${m.name}»…`);
    await download(`/api/worker/media/${m.id}/file`, file);
  }
  const cols = ["id", "name", "kind", "file", "duration", "width", "height", "has_audio", "size", "thumb", "created_at"];
  db.prepare(`INSERT OR REPLACE INTO media (${cols.join(", ")}, transcript, transcript_status) VALUES (${cols.map(() => "?").join(", ")}, ?, ?)`)
    .run(...cols.map((c) => m[c] ?? null), m.transcript ? JSON.stringify(m.transcript) : null, m.transcript_status === "running" ? null : m.transcript_status ?? null);
}

async function syncStyle() {
  const s = await call("GET", "/api/worker/style");
  setSetting("style:default", s.style || {});
  setSetting("autoedit:auto", s.auto || {});
  mkdirSync(STYLE_DIR, { recursive: true });
  const ids = new Set();
  for (const a of s.assets) {
    ids.add(a.id);
    const f = join(STYLE_DIR, a.file);
    if (!existsSync(f)) await download(`/api/worker/style/file/${encodeURIComponent(a.file)}`, f);
    db.prepare("INSERT OR REPLACE INTO style_assets (id, kind, name, file, family, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(a.id, a.kind, a.name, a.file, a.family, a.created_at);
  }
  for (const a of db.prepare("SELECT * FROM style_assets").all()) {
    if (!ids.has(a.id)) { db.prepare("DELETE FROM style_assets WHERE id = ?").run(a.id); rmSync(join(STYLE_DIR, a.file), { force: true }); }
  }
}

const J = (v) => (v == null ? null : JSON.stringify(v));

function mirrorJob(job, items) {
  db.prepare(`INSERT OR REPLACE INTO autoedit_jobs (id, media_id, kind, name, status, step, progress, error, options, plan, brain, summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL, ?, ?, ?, ?, ?, ?)`)
    .run(job.id, job.media_id, job.kind, job.name, job.step, job.progress || 0, J(job.options), J(job.plan), job.brain, job.summary, job.created_at, now());
  for (const it of items) {
    const local = row(db.prepare("SELECT * FROM autoedit_items WHERE id = ?").get(it.id));
    // El vídeo ya hecho en este PC se conserva (el servidor manda en estado, notas y revisión)
    const exportId = local?.export_id || it.export_id || null;
    const post = { ...(it.post || {}) };
    delete post.changeRequest;
    db.prepare(`INSERT OR REPLACE INTO autoedit_items (id, job_id, idx, label, layout, status, step, progress, export_id, error, qa, review, notes, post, short, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(it.id, job.id, it.idx, it.label, it.layout, it.status, it.step, it.progress || 0, exportId, it.error, J(it.qa), it.review || "pending", it.notes, J(post), J(it.short), it.created_at, now());
  }
}

/* ---------- Subir resultados ---------- */

const uploaded = getSetting("worker:uploaded", {});
const handled = {}; // itemId → texto del cambio ya aplicado

async function uploadItem(it) {
  const e = db.prepare("SELECT * FROM exports WHERE id = ?").get(it.export_id);
  if (!e) return false;
  const file = join(DIRS.exports, e.file);
  if (!existsSync(file)) return false;
  const stamp = `${e.id}:${statSync(file).mtimeMs}`;
  if (uploaded[it.id] === stamp) return true;
  log(`Subiendo «${it.label}» al panel…`);
  const fd = new FormData();
  fd.append("exportId", e.id);
  fd.append("name", e.name);
  fd.append("duration", String(e.duration ?? ""));
  fd.append("width", String(e.width ?? ""));
  fd.append("height", String(e.height ?? ""));
  fd.append("video", await openAsBlob(file, { type: "video/mp4" }), e.file);
  if (e.thumb && existsSync(join(DIRS.thumbs, e.thumb))) fd.append("thumb", await openAsBlob(join(DIRS.thumbs, e.thumb), { type: "image/jpeg" }), e.thumb);
  await call("POST", `/api/worker/items/${it.id}/video`, fd, { timeout: 60 * 60e3 });
  uploaded[it.id] = stamp;
  setSetting("worker:uploaded", uploaded);
  return true;
}

let pushing = null;
async function pushState(jobId) {
  if (pushing) return pushing;
  pushing = (async () => {
    const job = row(db.prepare("SELECT * FROM autoedit_jobs WHERE id = ?").get(jobId));
    if (!job) return {};
    const items = [];
    for (const it of db.prepare("SELECT * FROM autoedit_items WHERE job_id = ? ORDER BY idx").all(jobId).map(row)) {
      let status = it.status, step = it.step;
      if (it.status === "done" && it.export_id) {
        // «Lista» en el panel solo cuando el vídeo ya está subido
        const ok = await uploadItem(it).catch((e) => { log("No se pudo subir:", e.message); return false; });
        if (!ok) { status = "qa"; step = "Subiendo el vídeo al panel"; }
      }
      items.push({ id: it.id, idx: it.idx, label: it.label, layout: it.layout, status, step, progress: it.progress, error: it.error, qa: it.qa, post: it.post, short: it.short, handledChange: handled[it.id] });
    }
    return call("POST", `/api/worker/jobs/${jobId}/state`, {
      job: { status: job.status, step: job.step, progress: job.progress, error: job.error, plan: job.plan, brain: job.brain, summary: job.summary },
      items,
    });
  })().finally(() => { pushing = null; });
  return pushing;
}

/* ---------- Encargos ---------- */

async function doJob({ job, items, media }) {
  if (!media) throw new Error("El vídeo original ya no está en el panel.");
  busy = `Editando «${job.name}»`;
  log(busy);
  await ensureMedia(media);
  await syncStyle();
  mirrorJob(job, items);

  // Cambios pedidos desde el panel: Claude rehace el plan de esa versión
  for (const it of items.filter((x) => x.post?.changeRequest)) {
    try {
      await requestChanges(it.id, it.post.changeRequest);
      handled[it.id] = it.post.changeRequest;
    } catch (e) {
      log("No se pudo aplicar el cambio:", e.message);
      db.prepare("UPDATE autoedit_items SET status = 'error', error = ? WHERE id = ?").run("No se pudo aplicar el cambio: " + e.message.slice(0, 300), it.id);
      handled[it.id] = it.post.changeRequest;
    }
  }

  let gone = false;
  const timer = setInterval(() => pushState(job.id).then((r) => { if (r?.gone) gone = true; }).catch((e) => log("Sin conexión con el panel:", e.message)), 4000);
  try {
    await runJob(job.id);
  } catch (e) {
    log("El trabajo se paró:", e.message);
    setJob(job.id, e instanceof NeedLogin ? { status: "needs_login", error: e.message, step: "Falta iniciar sesión en Claude" } : { status: "error", error: String(e.message || e).slice(0, 800) });
    if (e instanceof NeedLogin) resetClaudeCheck();
  } finally {
    clearInterval(timer);
  }
  if (!gone) {
    // Último aviso con todo subido (se reintenta si falla la red)
    for (let i = 0; i < 5; i++) {
      try { await pushing; await pushState(job.id); break; } catch (e) { log("Reintentando subir el estado:", e.message); await sleep(10e3); }
    }
  }
  log(`Terminado «${job.name}»`);
}

async function doTranscribe({ media }) {
  busy = `Transcribiendo «${media.name}»`;
  log(busy);
  await ensureMedia(media);
  await transcribeNow(media.id);
  const m = db.prepare("SELECT transcript, transcript_status FROM media WHERE id = ?").get(media.id);
  await call("POST", `/api/worker/media/${media.id}/transcript`, { status: m.transcript_status, transcript: m.transcript ? JSON.parse(m.transcript) : null });
}

async function doAnalyze() {
  busy = "Claude está mirando tus referencias";
  log(busy);
  await syncStyle();
  const r = await lookAtReferences();
  const s = getSetting("style:default", {});
  if (r.seen) await call("POST", "/api/worker/style/analysis", { aiNotes: r.aiNotes, aiSuggested: s.aiSuggested || null });
}

/* ---------- Bucle ---------- */

log(`Pulso Studio · tu PC edita para ${SERVER}`);
await hello();
setInterval(hello, 30e3);
for (;;) {
  let task = null;
  try {
    task = await call("GET", "/api/worker/next");
  } catch (e) {
    log("Sin conexión con el panel:", e.message);
    await sleep(20e3);
    continue;
  }
  if (!task?.type) { await sleep(8000); continue; }
  try {
    if (task.type === "job") await doJob(task);
    else if (task.type === "transcribe") await doTranscribe(task);
    else if (task.type === "analyze") await doAnalyze();
  } catch (e) {
    log("Fallo:", e.message);
    if (task.type === "job") await call("POST", `/api/worker/jobs/${task.job.id}/state`, { job: { status: "error", error: String(e.message).slice(0, 800) }, items: [] }).catch(() => {});
    if (task.type === "transcribe") await call("POST", `/api/worker/media/${task.media.id}/transcript`, { status: "error: " + e.message.slice(0, 300) }).catch(() => {});
  } finally {
    busy = null;
    hello();
  }
}
