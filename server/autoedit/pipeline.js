// Orquestador de la auto-edición: de un vídeo hablado → 5 versiones editadas (o varios shorts de un vídeo largo).
// Cada versión se entrega en cuanto termina (aparece en la revisión), sin esperar a las demás.
import { mkdirSync, writeFileSync, readFileSync, existsSync, linkSync, copyFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, DIRS, DATA, uid, now, row } from "../db.js";
import { run, makeThumb } from "../media.js";
import { onGpu } from "../gpu.js";
import { NeedLogin, askClaude, claudeReady } from "./brain.js";
import { analyzeAudio, keepSegments } from "./analysis.js";
import { VARIANTS, decideCuts, makePlan, renderInputFor, pickShorts, validatePlan } from "./plan.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PY = join(HERE, "py");
const ROOT = join(DATA, "autoedit");
const SFX_DIR = join(ROOT, "_sfx");
const RVM_MODEL = process.env.RVM_MODEL || join(process.env.USERPROFILE || "", ".claude", "skills", "editar-reels-claude", "models", "rvm_resnet50_fp32.torchscript");
mkdirSync(ROOT, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS autoedit_jobs (
    id TEXT PRIMARY KEY, media_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
    step TEXT, progress REAL DEFAULT 0, error TEXT, options TEXT, plan TEXT, brain TEXT, summary TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS autoedit_items (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, idx INTEGER NOT NULL, label TEXT NOT NULL, layout TEXT NOT NULL,
    status TEXT NOT NULL, step TEXT, progress REAL DEFAULT 0, export_id TEXT, error TEXT, qa TEXT,
    review TEXT NOT NULL DEFAULT 'pending', notes TEXT, post TEXT, short TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`);
// Si el programa se cerró a mitad de un trabajo, se retoma (las pasadas ya hechas no se repiten)
db.prepare("UPDATE autoedit_jobs SET status = 'queued' WHERE status = 'running'").run();
db.prepare("UPDATE autoedit_items SET status = 'queued' WHERE status NOT IN ('done','error','queued')").run();

const setJob = (id, f) => {
  const k = Object.keys(f);
  db.prepare(`UPDATE autoedit_jobs SET ${k.map((x) => x + " = ?").join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...k.map((x) => (f[x] !== null && typeof f[x] === "object" ? JSON.stringify(f[x]) : f[x])), now(), id);
};
const setItem = (id, f) => {
  const k = Object.keys(f);
  db.prepare(`UPDATE autoedit_items SET ${k.map((x) => x + " = ?").join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...k.map((x) => (f[x] !== null && typeof f[x] === "object" ? JSON.stringify(f[x]) : f[x])), now(), id);
};

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const py = (script, args, opts) => run("python", [join(PY, script), ...args], opts);
const link = (from, to) => { if (existsSync(to)) return; try { linkSync(from, to); } catch { copyFileSync(from, to); } };

/* ---------- Crear trabajos ---------- */

export function createJob(mediaId, { kind = "variants", shorts = 3, variants = VARIANTS.map((v) => v.key), vocab = "", allowRules = false, name } = {}) {
  const m = db.prepare("SELECT * FROM media WHERE id = ?").get(mediaId);
  if (!m) throw Object.assign(new Error("No encuentro ese vídeo en la biblioteca."), { status: 404 });
  if (m.kind !== "video") throw Object.assign(new Error("Elige un vídeo (no un audio ni una imagen)."), { status: 400 });
  const id = uid();
  const opts = { shorts: Math.min(8, Math.max(1, shorts | 0)), variants: variants.filter((k) => VARIANTS.some((v) => v.key === k)), vocab: String(vocab).slice(0, 400), allowRules: !!allowRules };
  if (kind === "variants" && !opts.variants.length) throw Object.assign(new Error("Elige al menos una versión."), { status: 400 });
  db.prepare(`INSERT INTO autoedit_jobs (id, media_id, kind, name, status, step, options, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', 'En cola', ?, ?, ?)`).run(id, m.id, kind, String(name || m.name).slice(0, 120), JSON.stringify(opts), now(), now());
  kick();
  return id;
}

/* ---------- Cola (un trabajo a la vez: el render usa todo el ordenador) ---------- */

let busy = false;
export function kick() {
  if (busy) return;
  const next = db.prepare("SELECT id FROM autoedit_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get();
  if (!next) {
    // ¿Alguna versión pendiente de rehacer en un trabajo terminado?
    const redo = db.prepare("SELECT job_id FROM autoedit_items WHERE status = 'queued' LIMIT 1").get();
    if (!redo) return;
    setJob(redo.job_id, { status: "queued" });
    return kick();
  }
  busy = true;
  runJob(next.id)
    .catch((e) => {
      console.error("[autoedit]", e);
      setJob(next.id, e instanceof NeedLogin ? { status: "needs_login", error: e.message, step: "Falta iniciar sesión en Claude" } : { status: "error", error: String(e.message || e).slice(0, 800) });
    })
    .finally(() => { busy = false; setTimeout(kick, 500); });
}

/* ---------- Pasadas comunes ---------- */

async function prepareSource(job, work) {
  const m = db.prepare("SELECT * FROM media WHERE id = ?").get(job.media_id);
  if (!m) throw new Error("El vídeo original se ha borrado de la biblioteca.");
  if (!existsSync(join(work, "info.json"))) {
    setJob(job.id, { step: "Preparando el vídeo", progress: 0.03 });
    await py("prepare.py", ["--src", join(DIRS.media, m.file), "--work", work, "--res", "1080"]);
  }
  if (!existsSync(join(work, "words-raw.json"))) {
    setJob(job.id, { step: "Escuchando la voz (Whisper)", progress: 0.08 });
    const opts = job.options || {};
    await onGpu(() => py("whisper_words.py", ["--audio", join(work, "audio16k.wav"), "--out", join(work, "words-raw.json"), "--lang", "es", ...(opts.vocab ? ["--vocab", opts.vocab] : [])]));
  }
  return readJson(join(work, "info.json"));
}

/** Corta pausas y tomas falsas dentro de los tramos [t0, t1] (todo el vídeo si no se dan) → cut.mp4 + words.json */
async function cutTake(job, work, rawWords, { ranges = null, useClaude } = {}) {
  if (existsSync(join(work, "words.json")) && existsSync(join(work, "cut.mp4"))) return readJson(join(work, "words.json"));
  setJob(job.id, { step: "Decidiendo los cortes", progress: 0.16 });
  const info = readJson(join(work, "info.json"));
  let words = rawWords;
  if (ranges) {
    // Short: solo las palabras de sus tramos
    const keepIdx = new Set();
    for (const [a, b] of ranges) for (let i = a; i <= b; i++) keepIdx.add(i);
    words = rawWords.filter((_, i) => keepIdx.has(i));
  }
  const cuts = await decideCuts(words, { vocab: job.options?.vocab, useClaude });
  const { energy } = await analyzeAudio(join(work, "audio48k.wav"));
  // Los cortes de Claude son índices de `words`; para un short, además se corta entre tramos
  let segs = keepSegments(words, cuts.drop, energy, info.duration);
  if (ranges) {
    const bounds = ranges.map(([a, b]) => [rawWords[a].start - 0.3, rawWords[b].end + 0.4]);
    segs = segs.map(([s, e]) => {
      const bnd = bounds.find(([bs, be]) => s < be && bs < e);
      return bnd ? [Math.max(s, bnd[0]), Math.min(e, bnd[1])] : null;
    }).filter(Boolean);
  }
  writeFileSync(join(work, "keep.json"), JSON.stringify({ segments: segs, fixes: cuts.fixes }, null, 1));
  setJob(job.id, { step: "Cortando silencios y tomas falsas", progress: 0.2, summary: cuts.summary, brain: cuts.brain });
  await py("cut.py", ["--work", work, "--keep", join(work, "keep.json"), "--enc", "cpu"]);
  return readJson(join(work, "words.json"));
}

async function ensureMatte(job, work) {
  const out = join(work, "matte.mp4");
  if (existsSync(out)) return out;
  if (!existsSync(RVM_MODEL)) { console.warn("[autoedit] no está el modelo de recorte; sin texto detrás de la cabeza"); return null; }
  setJob(job.id, { step: "Recortando a la persona (texto detrás de la cabeza)", progress: 0.3 });
  try {
    await onGpu(() => py("matte.py", ["--src", join(work, "cut.mp4"), "--out", out, "--model", RVM_MODEL]));
    return out;
  } catch (e) {
    console.warn("[autoedit] recorte falló:", e.message.slice(-300));
    return null;
  }
}

async function ensureSfx() {
  if (existsSync(join(SFX_DIR, "whoosh.wav"))) return;
  mkdirSync(SFX_DIR, { recursive: true });
  await run("node", [join(HERE, "audio", "synthflow_render.cjs"), "sfx", SFX_DIR]);
}

async function ensureMusic(work, genre, duration) {
  if (genre === "none") return null;
  const out = join(work, `musica-${genre}.wav`);
  if (!existsSync(out)) await run("node", [join(HERE, "audio", "synthflow_render.cjs"), "music", genre, String(Math.ceil(duration + 2)), out]);
  return out;
}

const SFX_FILES = {
  hit: { file: "impact.wav", db: -16 }, whoosh: { file: "whoosh.wav", db: -21 }, pop: { file: "uiclick.wav", db: -24, max: 0.25 },
  click: { file: "uiclick.wav", db: -22, max: 0.3 }, riser: { file: "riser.wav", db: -24 }, sparkle: { file: "glitch.wav", db: -28, max: 0.4 },
  typing: { file: "uiclick.wav", db: -30, max: 0.08 },
};

/** Revisión automática: Claude mira fotogramas clave con la lista de la skill. */
async function autoReview(item, finalMp4, input, dir) {
  if (!(await claudeReady())) return { checked: false, ok: null, issues: [], note: "Sin revisión automática (Claude sin sesión)." };
  const times = new Set([0.5, Math.max(0.5, input.duration - 1)]);
  for (const g of input.graphics) times.add(+(g.start + 0.7).toFixed(2));
  for (const z of input.zooms) times.add(+Math.min(input.duration - 0.2, z.t + z.dur).toFixed(2));
  const list = [...times].filter((t) => t < input.duration).sort((a, b) => a - b).slice(0, 12);
  const frames = [];
  for (const [k, t] of list.entries()) {
    const f = join(dir, `qa-${String(k).padStart(2, "0")}.jpg`);
    await run("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", finalMp4, "-frames:v", "1", "-vf", "scale=-2:720", f]).catch(() => {});
    if (existsSync(f)) frames.push({ f, t });
  }
  try {
    const r = await askClaude(`Eres el revisor de calidad de un reel editado (${input.width}×${input.height}, versión «${item.label}»). Mira cada fotograma (el nombre lleva el orden; segundos: ${frames.map((x) => x.t).join(", ")}) y revisa:
- ¿Algún gráfico o texto tapa la cara o la barbilla?
- ¿Algo se sale de la zona segura de Instagram (arriba 11 %, abajo 20 %, derecha 7 %) o está cortado por los bordes?
- ¿Hay faltas de ortografía o palabras mal escritas en pantalla?
- ¿Más de una idea a la vez? ¿El subtítulo repite lo que dice un gráfico?
- ¿Algo se ve roto, vacío o feo?
Responde SOLO con JSON: {"ok": true|false, "score": 1-10, "issues": [{"t": segundo, "problem": "...", "fix": "..."}], "summary": "una frase"}`,
      { images: frames.map((x) => x.f), dir, timeoutMs: 6 * 60e3 });
    return { checked: true, ok: !!r.ok, score: r.score ?? null, issues: Array.isArray(r.issues) ? r.issues.slice(0, 12) : [], note: String(r.summary || "") };
  } catch (e) {
    if (e instanceof NeedLogin) return { checked: false, ok: null, issues: [], note: e.message };
    return { checked: false, ok: null, issues: [], note: "No se pudo hacer la revisión automática: " + e.message.slice(0, 200) };
  }
}

/** Render + sonido + revisión + registro de una versión. */
async function produceItem(job, item, { work, words, plan, matte, info, variant, titleBase }) {
  const dir = join(ROOT, job.id, "items", item.id);
  mkdirSync(dir, { recursive: true });
  const duration = readJson(join(work, "words.json")).duration;
  const { renderVariant } = await import("./render/index.js");
  setItem(item.id, { status: "rendering", step: "Montando gráficos y subtítulos", progress: 0.02 });
  const input = renderInputFor(variant, plan, words, {
    workDir: join(dir, "render"), duration,
    base: { video: join(work, "cut.mp4"), matte: variant.layout === "reference" ? matte : null, srcWidth: info.srcWidth, srcHeight: info.srcHeight },
  });
  writeFileSync(join(dir, "render-input.json"), JSON.stringify(input, null, 1));
  const out = await renderVariant(input, (f, label) => setItem(item.id, { progress: Math.min(0.8, 0.02 + f * 0.78), step: label || "Renderizando" }));

  // Sonido
  setItem(item.id, { status: "mixing", step: "Mezclando voz, efectos y música (−14 LUFS)", progress: 0.82 });
  await ensureSfx();
  const sfx = (out.sfx || []).map((e) => {
    const s = SFX_FILES[e.kind] || SFX_FILES.pop;
    return { file: join(SFX_DIR, s.file), t: Math.max(0, +e.t.toFixed(3)), db: s.db, ...(s.max ? { max: s.max } : {}) };
  });
  if (!sfx.some((e) => e.t < 0.1)) sfx.unshift({ file: join(SFX_DIR, "impact.wav"), t: 0, db: -18 });
  const mixDir = join(dir, "mix");
  mkdirSync(mixDir, { recursive: true });
  link(join(work, "words.json"), join(mixDir, "words.json"));
  link(join(work, "audio48k.wav"), join(mixDir, "audio48k.wav"));
  writeFileSync(join(mixDir, "sfx.json"), JSON.stringify(sfx, null, 1));
  const music = await ensureMusic(join(ROOT, job.id), variant.music, duration);
  const finalMp4 = join(dir, "final.mp4");
  await py("mix.py", ["--work", mixDir, "--sfx", join(mixDir, "sfx.json"), ...(music ? ["--music", music] : []), "--video", out.video, "--out", finalMp4]);

  // Revisión automática
  setItem(item.id, { status: "qa", step: "Revisión automática de fallos", progress: 0.92 });
  const qa = await autoReview(item, finalMp4, input, dir);

  // Registro en «Vídeos exportados»
  const expId = item.export_id || uid();
  const fileName = `${expId}.mp4`;
  copyFileSync(finalMp4, join(DIRS.exports, fileName));
  const thumb = await makeThumb(join(DIRS.exports, fileName), `export-${expId}.jpg`, Math.min(1.2, duration / 2)).catch(() => null);
  const name = `${titleBase} · ${item.label}`.slice(0, 120);
  db.prepare("DELETE FROM exports WHERE id = ?").run(expId);
  db.prepare(`INSERT INTO exports (id, project_id, name, file, thumb, status, progress, duration, width, height, size, created_at)
    VALUES (?, NULL, ?, ?, ?, 'done', 1, ?, ?, ?, ?, ?)`).run(expId, name, fileName, thumb, duration, variant.width, variant.height, statSync(join(DIRS.exports, fileName)).size, now());
  setItem(item.id, {
    status: "done", step: "Lista para revisar", progress: 1, export_id: expId, qa, error: null,
    post: { caption: plan.post.caption, youtubeTitle: plan.post.youtubeTitle, hook: plan.hook },
  });
}

/* ---------- Trabajo completo ---------- */

async function runJob(id) {
  const job = row(db.prepare("SELECT * FROM autoedit_jobs WHERE id = ?").get(id));
  const opts = job.options || {};
  setJob(id, { status: "running", error: null });
  const base = join(ROOT, id);
  const src = join(base, "fuente");
  mkdirSync(src, { recursive: true });

  const loggedIn = await claudeReady();
  if (!loggedIn && !opts.allowRules) throw new NeedLogin();
  const useClaude = loggedIn;

  const info = await prepareSource(job, src);
  const raw = readJson(join(src, "words-raw.json")).words;
  if (raw.length < 5) throw new Error("No se oye casi nada de voz en el vídeo: la auto-edición necesita a alguien hablando.");

  if (job.kind === "shorts") return runShorts(job, { src, raw, info, useClaude });

  // 5 versiones del mismo vídeo
  const words = await cutTake(job, src, raw, { useClaude });
  let plan = job.plan;
  if (!plan) {
    setJob(id, { step: "Claude está planificando la edición", progress: 0.26 });
    plan = await makePlan(words.words.map((w) => ({ ...w, p: 1 })), { vocab: opts.vocab, useClaude });
    setJob(id, { plan, brain: plan.brain });
  }
  const variants = VARIANTS.filter((v) => opts.variants.includes(v.key));
  const matte = variants.some((v) => v.layout === "reference") && (plan.behind?.length ?? 0) > 0 ? await ensureMatte(job, src) : null;

  // Una fila por versión (si no existen ya)
  variants.forEach((v, k) => {
    if (!db.prepare("SELECT id FROM autoedit_items WHERE job_id = ? AND layout = ?").get(id, v.layout)) {
      db.prepare(`INSERT INTO autoedit_items (id, job_id, idx, label, layout, status, step, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', 'En cola', ?, ?)`)
        .run(uid(), id, k, v.label, v.layout, now(), now());
    }
  });
  const items = db.prepare("SELECT * FROM autoedit_items WHERE job_id = ? ORDER BY idx").all(id).map(row);
  const wordsTl = words.words;
  let done = 0;
  for (const it of items) {
    if (it.status === "done" || it.status === "error") { done++; continue; }
    const v = VARIANTS.find((x) => x.layout === it.layout);
    // Si el usuario pidió cambios en esta versión, se usa su plan propio
    const itemPlan = it.notes && it.post?.plan ? it.post.plan : plan;
    setJob(id, { step: `Editando versión ${done + 1} de ${items.length}: ${it.label}`, progress: 0.35 + 0.65 * (done / items.length) });
    try {
      await produceItem(job, it, { work: src, words: wordsTl, plan: itemPlan, matte, info, variant: v, titleBase: plan.topic || job.name });
    } catch (e) {
      console.error("[autoedit] versión", it.label, e);
      setItem(it.id, { status: "error", error: String(e.message || e).slice(0, 800) });
    }
    done++;
  }
  setJob(id, { status: "done", step: "Terminado", progress: 1 });
}

async function runShorts(job, { src, raw, info, useClaude }) {
  const id = job.id;
  let picks = job.plan?.shorts;
  if (!picks) {
    setJob(id, { step: "Claude está eligiendo los mejores momentos", progress: 0.2 });
    picks = await pickShorts(raw, { count: job.options.shorts, vocab: job.options.vocab, useClaude });
    setJob(id, { plan: { shorts: picks } });
  }
  picks.forEach((s, k) => {
    if (!db.prepare("SELECT id FROM autoedit_items WHERE job_id = ? AND idx = ?").get(id, k)) {
      db.prepare(`INSERT INTO autoedit_items (id, job_id, idx, label, layout, status, step, short, created_at, updated_at) VALUES (?, ?, ?, ?, 'reference', 'queued', 'En cola', ?, ?, ?)`)
        .run(uid(), id, k, `Short ${k + 1}: ${s.title}`, JSON.stringify(s), now(), now());
    }
  });
  const items = db.prepare("SELECT * FROM autoedit_items WHERE job_id = ? ORDER BY idx").all(id).map(row);
  const variant = VARIANTS.find((v) => v.layout === "reference");
  let done = 0;
  for (const it of items) {
    if (it.status === "done" || it.status === "error") { done++; continue; }
    setJob(id, { step: `Short ${done + 1} de ${items.length}: ${it.short.title}`, progress: 0.25 + 0.75 * (done / items.length) });
    try {
      const work = join(ROOT, id, "shorts", String(it.idx));
      mkdirSync(work, { recursive: true });
      for (const f of ["vertical.mp4", "audio48k.wav", "info.json"]) link(join(src, f), join(work, f));
      writeFileSync(join(work, "words-raw.json"), JSON.stringify({ words: raw }));
      setItem(it.id, { status: "rendering", step: "Cortando el short", progress: 0.02 });
      const words = await cutTake(job, work, raw, { ranges: it.short.ranges, useClaude });
      let plan = it.post?.plan;
      if (!plan) {
        setItem(it.id, { step: "Planificando la edición", progress: 0.05 });
        plan = await makePlan(words.words.map((w) => ({ ...w, p: 1 })), { vocab: job.options.vocab, useClaude, isShort: true });
        setItem(it.id, { post: { plan } });
      }
      const matte = plan.behind?.length ? await ensureMatte(job, work) : null;
      await produceItem(job, it, { work, words: words.words, plan, matte, info, variant, titleBase: it.short.title });
    } catch (e) {
      if (e instanceof NeedLogin) throw e;
      console.error("[autoedit] short", it.label, e);
      setItem(it.id, { status: "error", error: String(e.message || e).slice(0, 800) });
    }
    done++;
  }
  setJob(id, { status: "done", step: "Terminado", progress: 1 });
}

/* ---------- Pedir cambios en una versión ---------- */

export async function requestChanges(itemId, notes) {
  const it = row(db.prepare("SELECT * FROM autoedit_items WHERE id = ?").get(itemId));
  if (!it) throw Object.assign(new Error("No encuentro esa versión."), { status: 404 });
  const job = row(db.prepare("SELECT * FROM autoedit_jobs WHERE id = ?").get(it.job_id));
  const base = it.post?.plan || job.plan;
  if (!base?.phrases) throw Object.assign(new Error("Esta versión todavía no tiene plan."), { status: 400 });
  const work = job.kind === "shorts" ? join(ROOT, job.id, "shorts", String(it.idx)) : join(ROOT, job.id, "fuente");
  const words = readJson(join(work, "words.json")).words;
  const qaIssues = it.qa?.issues?.length ? `\nLa revisión automática encontró: ${JSON.stringify(it.qa.issues)}` : "";
  const r = await askClaude(`Eres el editor de este reel. Este es el plan de edición actual (índices de palabra):
${JSON.stringify(base)}

Palabras del vídeo (índice, segundo, palabra):
${words.map((w, i) => `${i}\t${w.start.toFixed(2)}\t${w.w}`).join("\n")}

El cliente pide estos cambios para la versión «${it.label}»: «${String(notes).slice(0, 1500)}»${qaIssues}
Aplica los cambios como reglas para todo el vídeo (no solo en un momento). Devuelve el plan COMPLETO corregido, con el mismo formato JSON y nada más.`);
  const plan = validatePlan(r, words);
  if (!plan) throw new Error("Claude no devolvió un plan válido. Prueba a explicar el cambio de otra forma.");
  setItem(it.id, { notes: String(notes).slice(0, 1500), post: { ...(it.post || {}), plan }, status: "queued", step: "En cola para rehacer", progress: 0, review: "pending", error: null });
  kick();
}

export function jobView(id) {
  const j = row(db.prepare("SELECT * FROM autoedit_jobs WHERE id = ?").get(id));
  if (!j) return null;
  const media = db.prepare("SELECT id, name, thumb, duration FROM media WHERE id = ?").get(j.media_id);
  const items = db.prepare("SELECT * FROM autoedit_items WHERE job_id = ? ORDER BY idx").all(id).map(row).map((it) => {
    const e = it.export_id ? db.prepare("SELECT id, name, file, thumb, duration, width, height, size FROM exports WHERE id = ?").get(it.export_id) : null;
    const { plan, ...post } = it.post || {};
    void plan;
    return { ...it, post, video: e ? { ...e, url: `/files/exports/${e.file}`, thumbUrl: e.thumb ? `/files/thumbs/${e.thumb}` : null } : null };
  });
  const { plan, ...rest } = j;
  return {
    ...rest, plan: plan ? { topic: plan.topic, hook: plan.hook, post: plan.post, shorts: plan.shorts } : null,
    media: media ? { ...media, thumbUrl: media.thumb ? `/files/thumbs/${media.thumb}` : null } : null, items,
  };
}

export function listJobs() {
  return db.prepare("SELECT id FROM autoedit_jobs ORDER BY created_at DESC LIMIT 50").all().map((r) => jobView(r.id));
}

export function setReview(itemId, review) {
  if (!["pending", "approved", "rejected"].includes(review)) throw Object.assign(new Error("Estado no válido."), { status: 400 });
  setItem(itemId, { review });
}

export function retryJob(id) {
  setJob(id, { status: "queued", error: null, step: "En cola" });
  db.prepare("UPDATE autoedit_items SET status = 'queued', error = NULL WHERE job_id = ? AND status = 'error'").run(id);
  kick();
}

export function allowRulesAndRetry(id) {
  const j = row(db.prepare("SELECT * FROM autoedit_jobs WHERE id = ?").get(id));
  if (!j) return;
  setJob(id, { options: { ...(j.options || {}), allowRules: true } });
  retryJob(id);
}

export function deleteJob(id) {
  db.prepare("DELETE FROM autoedit_items WHERE job_id = ?").run(id);
  db.prepare("DELETE FROM autoedit_jobs WHERE id = ?").run(id);
}

export { VARIANTS };
