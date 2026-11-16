// Tu PC como «editor» del Pulso Studio que está en el panel (EasyPanel).
// Recoge los vídeos por editar, los edita aquí (tarjeta gráfica + Whisper + Claude) y sube el resultado.
//   npm run worker
// Configuración: data/worker.json → { "server": "https://…/studio", "token": "…" }
//   (o las variables STUDIO_SERVER y STUDIO_WORKER_TOKEN)
process.env.STUDIO_MODE = "worker";

const { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, createWriteStream, openAsBlob, rmSync, readdirSync, renameSync, linkSync, copyFileSync } = await import("node:fs");
const childProcess = await import("node:child_process");
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

const { hostname } = await import("node:os");
const PC_NAME = (process.env.COMPUTERNAME || hostname() || "Tu PC").slice(0, 60);
const log = (...a) => console.log(new Date().toLocaleTimeString("es-ES"), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function saveCfg() {
  cfg = { server: SERVER, token: TOKEN };
  mkdirSync(DATA, { recursive: true });
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2) + "\n");
}

/** Abre la web en el navegador de este PC. */
function openBrowser(url) {
  if (process.env.STUDIO_NO_BROWSER) return;
  const { spawn } = childProcess;
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch { /* se ve el enlace en la ventana */ }
}

/** Conectar el PC: pide un código al panel, abre la web y espera a que pulses «Conectar». */
let pairing = null, opened = false;
function pair() {
  if (pairing) return pairing;
  pairing = (async () => {
    for (;;) {
      let start;
      try {
        const r = await fetch(`${SERVER}/api/worker/pair/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: PC_NAME }), signal: AbortSignal.timeout(20e3) });
        start = await r.json();
        if (!r.ok) throw new Error(start?.error || r.status);
      } catch (e) { log("No llego al panel para conectar el PC:", e.message, "· reintento en 30 s"); await sleep(30e3); continue; }
      console.log(`\n  Conectar este PC (${PC_NAME}) con Pulso Studio`);
      console.log(`  Se ha abierto la web: pulsa «Conectar este PC». Código: ${start.code}`);
      console.log(`  Si no se abre, entra en: ${start.url}\n`);
      if (!opened) { openBrowser(start.url); opened = true; }
      else console.log("  (También puedes conectarlo desde el aviso que sale arriba en la web.)");
      const until = Date.now() + 18 * 60e3;
      while (Date.now() < until) {
        await sleep(3000);
        try {
          const r = await fetch(`${SERVER}/api/worker/pair/${start.code}`, { signal: AbortSignal.timeout(15e3) });
          if (r.status === 404) break; // caducado: se pide otro
          const d = await r.json();
          if (d.status === "approved" && d.token) {
            TOKEN = d.token;
            saveCfg();
            beat?.postMessage({ token: TOKEN, now: true });
            log("✓ PC conectado. No hará falta volver a hacerlo.");
            return;
          }
        } catch { /* sin red: se sigue esperando */ }
      }
      log("El código caducó: pido otro.");
    }
  })().finally(() => { pairing = null; });
  return pairing;
}

class Unauthorized extends Error {}

/** Servidor recién borrado: le devuelve tu cuenta y las claves desde la copia (sin que tengas que hacer nada). */
async function claim() {
  let have = null;
  try { have = JSON.parse(readFileSync(join(DATA, "copia-servidor", "copia.json"), "utf8")); } catch { return false; }
  const a = have?.auth;
  if (!a?.owner || !(a.token || TOKEN)) return false;
  try {
    const r = await fetch(`${SERVER}/api/worker/claim`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ owner: a.owner, token: a.token || TOKEN, secret: a.secret }), signal: AbortSignal.timeout(20e3),
    });
    if (!r.ok) return false;
    TOKEN = a.token || TOKEN;
    saveCfg();
    try { beat.postMessage({ token: TOKEN, now: true }); } catch { /* aún no hay hilo */ }
    log("✓ El panel había empezado de cero: le he devuelto tu cuenta y la conexión de este PC.");
    return true;
  } catch { return false; }
}
/** Volver a conectar: primero se intenta sin ti (copia); si no, con un clic en la web. */
const reconnect = async () => { if (!(await claim())) await pair(); };

// ¿Vale la clave que tenemos? Si no, se conecta con un clic en la web
async function tokenWorks() {
  if (!TOKEN) return false;
  try {
    const r = await fetch(`${SERVER}/api/worker/hello`, { method: "POST", headers: { "x-worker-token": TOKEN, "content-type": "application/json" }, body: JSON.stringify({ name: PC_NAME }) });
    return r.status !== 401;
  } catch { return true; } // sin red: se reintenta luego
}

// Aviso de vida en un hilo aparte (sigue aunque el PC esté renderizando)
const { Worker: Thread } = await import("node:worker_threads");
const beat = new Thread(new URL("./heartbeat.js", import.meta.url), { workerData: { server: SERVER, token: TOKEN, name: PC_NAME } });
beat.unref();
beat.on("message", (m) => { if (m.status === 401 && !pairing) log("El panel ya no reconoce este PC: hay que conectarlo otra vez."); });
beat.on("error", (e) => log("Aviso de vida:", e.message));

if (!(await tokenWorks())) await reconnect();


async function call(method, path, body, { raw = false, timeout = 60e3 } = {}) {
  const isForm = body instanceof FormData;
  const r = await fetch(SERVER + path, {
    method,
    headers: { "x-worker-token": TOKEN, ...(body && !isForm ? { "content-type": "application/json" } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (r.status === 401 && path.startsWith("/api/worker/")) throw new Unauthorized("El panel ya no reconoce este PC");
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
  renameSync(tmp, to);
}

/* ---------- Señal de vida ---------- */

let busy = null;
async function hello() {
  try {
    const claude = (await aiProvider()) === "claude";
    beat.postMessage({ busy, claude });
    await call("POST", "/api/worker/hello", { claude, busy, name: PC_NAME, version: 2 });
  } catch (e) { if (!(e instanceof Unauthorized)) log("Sin conexión con el panel:", e.message); }
}
const setBusy = (b) => { busy = b; beat.postMessage({ busy: b }); };

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
  for (const a of s.assets.filter((x) => x.kind !== "preset")) { // los vídeos de los estilos guardados solo hacen falta al analizarlos
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
  setBusy(`Editando «${job.name}»`);
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
  setBusy(`Transcribiendo «${media.name}»`);
  log(busy);
  await ensureMedia(media);
  await transcribeNow(media.id);
  const m = db.prepare("SELECT transcript, transcript_status FROM media WHERE id = ?").get(media.id);
  await call("POST", `/api/worker/media/${media.id}/transcript`, { status: m.transcript_status, transcript: m.transcript ? JSON.parse(m.transcript) : null });
}

async function doAnalyze() {
  setBusy("Claude está mirando tus referencias");
  log(busy);
  await syncStyle();
  const r = await lookAtReferences();
  const s = getSetting("style:default", {});
  if (r.seen) await call("POST", "/api/worker/style/analysis", { aiNotes: r.aiNotes, aiSuggested: s.aiSuggested || null });
}

async function doPreset({ preset, assets }) {
  setBusy(`Claude está estudiando el estilo «${preset.name}»`);
  log(busy);
  const state = (b) => call("POST", `/api/worker/presets/${preset.id}/state`, b).catch((e) => log("Sin conexión con el panel:", e.message));
  try {
    mkdirSync(STYLE_DIR, { recursive: true });
    await state({ step: "Descargando los vídeos en tu PC" });
    const files = [];
    for (const a of assets) {
      const f = join(STYLE_DIR, a.file);
      if (!existsSync(f)) await download(`/api/worker/style/file/${encodeURIComponent(a.file)}`, f);
      files.push(f);
    }
    await state({ step: "Claude está estudiando los vídeos fotograma a fotograma" });
    const { analyzePresetFiles, downloadGoogleFont } = await import("./preset-analyze.js");
    const r = await analyzePresetFiles(files, join(DATA, "tmp", "preset-" + preset.id));
    const fonts = {};
    for (const role of ["caption", "keyword"]) {
      const want = r.fontsWanted[role];
      if (!want) continue;
      await state({ step: `Descargando la tipografía (${want.families[0]})` });
      const got = await downloadGoogleFont(want.families, want.weight, join(DATA, "tmp", "fonts"));
      if (!got) { log(`No encontré ${want.families.join(" / ")} en Google Fonts`); continue; }
      const fd = new FormData();
      fd.append("family", got.family);
      fd.append("filename", `${got.family} ${got.weight}${got.file.slice(got.file.lastIndexOf("."))}`);
      fd.append("file", await openAsBlob(got.file), basename(got.file));
      const up = await call("POST", `/api/worker/presets/${preset.id}/font`, fd);
      fonts[role] = up.id;
      if (role === "caption") r.style.caption.weight = got.weight;
    }
    r.style.fonts = { caption: fonts.caption || null, keyword: fonts.keyword || (r.style.caption.keywordFont === "same" ? fonts.caption || null : null), title: fonts.caption || null };
    await state({ status: "ready", step: "Listo", name: r.name, style: r.style, analysis: { summary: r.summary, fonts: r.fontsWanted, frames: r.frames, raw: r.raw } });
    log(`Estilo «${r.name}» listo`);
  } catch (e) {
    log("No se pudo analizar el estilo:", e.message);
    await state({ status: "error", step: null, error: String(e.message || e).slice(0, 500) });
  }
}

/* ---------- Copia de todo en tu PC (y se devuelve sola si el panel empieza de cero) ---------- */

const BK = join(DATA, "copia-servidor");
const BK_META = join(BK, "copia.json");
const LOCAL_DIRS = { media: DIRS.media, thumbs: DIRS.thumbs, exports: DIRS.exports, style: STYLE_DIR };
const readBackup = () => { try { return JSON.parse(readFileSync(BK_META, "utf8")); } catch { return null; } };
const writeBackup = (b) => { mkdirSync(BK, { recursive: true }); writeFileSync(BK_META + ".tmp", JSON.stringify(b)); renameSync(BK_META + ".tmp", BK_META); };
const sizeOf = (f) => { try { return statSync(f).size; } catch { return -1; } };

/** Pone un archivo en la copia: si este PC ya lo tiene (lo editó o lo descargó), sin volver a bajarlo. */
async function keepFile(dir, name, size) {
  const to = join(BK, dir, name);
  if (sizeOf(to) === size) return false;
  mkdirSync(join(BK, dir), { recursive: true });
  const here = join(LOCAL_DIRS[dir], name);
  if (sizeOf(here) === size) {
    rmSync(to, { force: true });
    try { linkSync(here, to); } catch { copyFileSync(here, to); }
    return true;
  }
  await download(`/api/worker/backup/file/${dir}/${encodeURIComponent(name)}`, to);
  return true;
}

/** La primera vez: lo que ya hay en este PC (tu vídeo, tus referencias y tus estilos) entra en la copia. */
function seedFromThisPC() {
  if (existsSync(BK_META)) return;
  const pick = (t, where = "") => { try { return db.prepare(`SELECT * FROM ${t} ${where}`).all(); } catch { return []; } };
  const tables = {
    folders: pick("folders"),
    media: pick("media").map((m) => ({ ...m, transcript_status: m.transcript_status === "running" ? null : m.transcript_status })),
    style_assets: pick("style_assets"),
    style_presets: pick("style_presets", "WHERE status = 'ready'"),
    settings: pick("settings", "WHERE key IN ('style:default', 'autoedit:auto')"),
  };
  const files = [];
  for (const m of tables.media) files.push(["media", m.file], ...(m.thumb ? [["thumbs", m.thumb]] : []));
  for (const a of tables.style_assets) files.push(["style", a.file]);
  let n = 0;
  for (const [dir, name] of files) {
    const here = join(LOCAL_DIRS[dir], name);
    if (!existsSync(here)) continue;
    mkdirSync(join(BK, dir), { recursive: true });
    try { linkSync(here, join(BK, dir, name)); } catch { try { copyFileSync(here, join(BK, dir, name)); } catch { continue; } }
    n++;
  }
  writeBackup({ server: { id: "este-pc" }, at: now(), tables });
  log(`Copia inicial con lo que ya había en este PC (${n} archivos)`);
}

/** Devuelve la copia al panel: filas que falten y archivos que no tenga. */
async function restoreTo(b, have) {
  log("El panel ha empezado de cero: le devuelvo tu copia (vídeos, referencias, estilos, ajustes)…");
  const r = await call("POST", "/api/worker/restore", { tables: have.tables }, { timeout: 10 * 60e3 });
  const there = new Set(b.files.map((f) => `${f.dir}/${f.name}`));
  let n = 0;
  for (const dir of ["style", "thumbs", "media", "exports"]) {
    const path = join(BK, dir);
    if (!existsSync(path)) continue;
    for (const name of readdirSync(path)) {
      if (there.has(`${dir}/${name}`) || name.endsWith(".part")) continue;
      const fd = new FormData();
      fd.append("dir", dir);
      fd.append("name", name);
      fd.append("file", await openAsBlob(join(path, name)), name);
      await call("POST", "/api/worker/restore/file", fd, { timeout: 2 * 60 * 60e3 });
      n++;
    }
  }
  log(`✓ Copia devuelta: ${r.rows} datos y ${n} archivos`);
}

let backingUp = null;
function backupCycle() {
  if (backingUp) return backingUp;
  backingUp = (async () => {
    const b = await call("GET", "/api/worker/backup", null, { timeout: 5 * 60e3 });
    const have = readBackup();
    // Base de datos nueva en el panel (se borró al implementar): se le devuelve todo lo que tenías
    if (have && b.server?.id && have.server?.id !== b.server.id) {
      await restoreTo(b, have);
      const again = await call("GET", "/api/worker/backup", null, { timeout: 5 * 60e3 });
      Object.assign(b, again);
    }
    if (b.empty) return; // nada que copiar (y la copia anterior no se toca)
    let n = 0;
    for (const f of b.files) { try { if (await keepFile(f.dir, f.name, f.size)) n++; } catch (e) { log(`No se pudo copiar ${f.name}:`, e.message); } }
    // Lo que borraste en el panel sale también de la copia
    const there = new Set(b.files.map((f) => `${f.dir}/${f.name}`));
    for (const dir of Object.keys(LOCAL_DIRS)) {
      const path = join(BK, dir);
      if (existsSync(path)) for (const name of readdirSync(path)) if (!there.has(`${dir}/${name}`)) rmSync(join(path, name), { force: true });
    }
    writeBackup({ server: b.server, at: now(), tables: b.tables, auth: b.auth || have?.auth || null });
    if (n) log(`Copia de seguridad al día en este PC (${n} archivos nuevos)`);
  })().catch((e) => { if (e instanceof Unauthorized) throw e; log("No se pudo hacer la copia:", e.message); }).finally(() => { backingUp = null; });
  return backingUp;
}

/* ---------- Bucle ---------- */

log(`Pulso Studio · ${PC_NAME} edita para ${SERVER}`);
seedFromThisPC();
await hello();
setInterval(hello, 60e3);
let lastBackup = 0;
for (;;) {
  let task = null;
  try {
    if (Date.now() - lastBackup > 3 * 60e3) { lastBackup = Date.now(); await backupCycle(); }
    task = await call("GET", "/api/worker/next");
  } catch (e) {
    if (e instanceof Unauthorized) { log("El panel ya no reconoce este PC: lo conecto otra vez."); await reconnect(); lastBackup = 0; continue; }
    log("Sin conexión con el panel:", e.message);
    await sleep(20e3);
    continue;
  }
  if (!task?.type) { await sleep(8000); continue; }
  try {
    if (task.type === "job") await doJob(task);
    else if (task.type === "transcribe") await doTranscribe(task);
    else if (task.type === "analyze") await doAnalyze();
    else if (task.type === "preset") await doPreset(task);
  } catch (e) {
    if (e instanceof Unauthorized) { await reconnect(); continue; }
    log("Fallo:", e.message);
    if (task.type === "job") await call("POST", `/api/worker/jobs/${task.job.id}/state`, { job: { status: "error", error: String(e.message).slice(0, 800) }, items: [] }).catch(() => {});
    if (task.type === "transcribe") await call("POST", `/api/worker/media/${task.media.id}/transcript`, { status: "error: " + e.message.slice(0, 300) }).catch(() => {});
  } finally {
    setBusy(null);
    hello();
    lastBackup = 0; // copia en cuanto termina cada encargo
  }
}
