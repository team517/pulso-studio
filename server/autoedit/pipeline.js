// Orquestador de la auto-edición: de un vídeo hablado → 5 versiones editadas (o varios shorts de un vídeo largo).
// Cada versión se entrega en cuanto termina (aparece en la revisión), sin esperar a las demás.
import { mkdirSync, writeFileSync, readFileSync, existsSync, linkSync, copyFileSync, statSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, DIRS, DATA, uid, now, row } from "../db.js";
import { run, makeThumb } from "../media.js";
import { python } from "../python.js";
import { onGpu } from "../gpu.js";
import { NeedLogin, askClaude, claudeReady, canSeeImages } from "./brain.js";
import { ffStderr } from "./analysis.js";
import { analyzeAudio, keepSegments } from "./analysis.js";
void claudeReady;
import { VARIANTS, decideCuts, makePlan, renderInputFor, pickShorts, validatePlan } from "./plan.js";
import { toRenderStyle, styleNotesForAI, getStyle } from "../style.js";
import { MODE, IS_SERVER } from "../config.js";

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
if (MODE === "local") {
  db.prepare("UPDATE autoedit_jobs SET status = 'queued' WHERE status = 'running'").run();
  db.prepare("UPDATE autoedit_items SET status = 'queued' WHERE status NOT IN ('done','error','queued')").run();
}

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
const py = (script, args, opts) => run(python().cmd, [join(PY, script), ...args], { env: python().env, ...opts });
const link = (from, to) => { if (existsSync(to)) return; try { linkSync(from, to); } catch { copyFileSync(from, to); } };

/* ---------- Crear trabajos ---------- */

export function createJob(mediaId, { kind = "variants", shorts = 3, variants = VARIANTS.map((v) => v.key), vocab = "", allowRules = false, name } = {}) {
  const m = db.prepare("SELECT * FROM media WHERE id = ?").get(mediaId);
  if (!m) throw Object.assign(new Error("No encuentro ese vídeo en la biblioteca."), { status: 404 });
  if (m.kind !== "video") throw Object.assign(new Error("Elige un vídeo (no un audio ni una imagen)."), { status: 400 });
  const id = uid();
  const opts = { shorts: shorts === "auto" || shorts === 0 ? "auto" : Math.min(25, Math.max(1, shorts | 0)), variants: variants.filter((k) => VARIANTS.some((v) => v.key === k)), vocab: String(vocab).slice(0, 400), allowRules: !!allowRules };
  if (kind === "variants" && !opts.variants.length) throw Object.assign(new Error("Elige al menos una versión."), { status: 400 });
  db.prepare(`INSERT INTO autoedit_jobs (id, media_id, kind, name, status, step, options, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'queued', 'En cola', ?, ?, ?)`).run(id, m.id, kind, String(name || m.name).slice(0, 120), JSON.stringify(opts), now(), now());
  kick();
  return id;
}

/* ---------- Cola (un trabajo a la vez: el render usa todo el ordenador) ---------- */

let busy = false;
export function kick() {
  // En el servidor no se edita (lo recoge el PC); en el PC, el que manda es worker.js
  if (MODE !== "local") return;
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
    const whisper = () => onGpu(() => py("whisper_words.py", ["--audio", join(work, "audio16k.wav"), "--out", join(work, "words-raw.json"), "--lang", "es", ...(opts.vocab ? ["--vocab", opts.vocab] : [])]));
    // Whisper a veces se cae al arrancar en la tarjeta gráfica (fallo de memoria de Windows): un reintento lo arregla
    await whisper().catch(async (e) => { console.warn("[autoedit] Whisper falló, reintento:", String(e.message).slice(-200)); await new Promise((r) => setTimeout(r, 4000)); return whisper(); });
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

/* ---------- Que cada short parezca distinto: composición, plano y color ---------- */

export const FRAMINGS = { wide: { zoom: 1, label: "plano abierto" }, medium: { zoom: 1.12, label: "plano medio" }, close: { zoom: 1.25, label: "primer plano" } };
export const GRADES = {
  neutral: { label: "color natural", vf: "" },
  warm: { label: "cálido", vf: "colorbalance=rs=0.05:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03,eq=saturation=1.06" },
  cool: { label: "frío", vf: "colorbalance=rs=-0.04:gs=0:bs=0.05:rm=-0.02:bm=0.03,eq=saturation=1.03" },
  punchy: { label: "contrastado", vf: "eq=contrast=1.1:saturation=1.16:gamma=0.98" },
  soft: { label: "suave", vf: "eq=contrast=0.94:saturation=0.94:brightness=0.015" },
  // Cine: sombras hacia el verde azulado, piel cálida, contraste suave y algo menos de saturación
  cinematic: { label: "cine", vf: "colorbalance=rs=-0.04:gs=0.0:bs=0.05:rh=0.05:gh=0.01:bh=-0.04,eq=contrast=1.06:saturation=0.9:gamma=0.97" },
};
const SHORT_LAYOUTS = ["reference", "headline", "minimal", "framed"];
const FRAMING_KEYS = ["wide", "medium", "close"];
const GRADE_KEYS = ["neutral", "warm", "cool", "punchy", "soft"];
const MUSICS = ["synthwave", "lofi"];

/** Combinación de aspecto para el short número k (rota para que dos seguidos no se parezcan). */
export function lookFor(k) {
  return {
    layout: SHORT_LAYOUTS[k % SHORT_LAYOUTS.length],
    framing: FRAMING_KEYS[(k + Math.floor(k / SHORT_LAYOUTS.length)) % FRAMING_KEYS.length],
    grade: GRADE_KEYS[(k * 2) % GRADE_KEYS.length],
    music: MUSICS[Math.floor(k / 2) % MUSICS.length],
  };
}

/** base.mp4 = cut.mp4 con el plano (zoom digital centrado en la cara) y el color de este short. */
async function buildBase(work, look) {
  const out = join(work, "base.mp4");
  // Si cambia el plano o el color (otro estilo), se rehace
  const sig = join(work, "base.json"), want = JSON.stringify({ framing: look.framing, grade: look.grade });
  if (existsSync(out) && existsSync(sig) && readFileSync(sig, "utf8") === want) return out;
  rmSync(out, { force: true });
  writeFileSync(sig, want);
  const z = FRAMINGS[look.framing]?.zoom ?? 1;
  const vf = [];
  // Recorte hacia arriba (la cara suele estar en el tercio superior), luego vuelta a 1080×1920
  if (z > 1) vf.push(`crop=iw/${z}:ih/${z}:(iw-iw/${z})/2:(ih-ih/${z})*0.28`, "scale=1080:1920:flags=lanczos");
  if (GRADES[look.grade]?.vf) vf.push(GRADES[look.grade].vf);
  if (!vf.length) { link(join(work, "cut.mp4"), out); return out; }
  await run("ffmpeg", ["-v", "error", "-y", "-i", join(work, "cut.mp4"), "-vf", vf.join(","), "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p", "-c:a", "copy", out]);
  return out;
}

async function ensureMatte(job, work) {
  const out = join(work, "matte.mp4");
  if (existsSync(out)) return out;
  if (!existsSync(RVM_MODEL)) { console.warn("[autoedit] no está el modelo de recorte; sin texto detrás de la cabeza"); return null; }
  setJob(job.id, { step: "Recortando a la persona (texto detrás de la cabeza)", progress: 0.3 });
  const src = existsSync(join(work, "base.mp4")) ? join(work, "base.mp4") : join(work, "cut.mp4");
  try {
    await onGpu(() => py("matte.py", ["--src", src, "--out", out, "--model", RVM_MODEL]));
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
/** Revisión medida (sin mirar imágenes): fotogramas negros, imagen congelada, volumen, pico y duración. */
async function measuredReview(finalMp4, input) {
  const issues = [];
  const err = await ffStderr(["-hide_banner", "-i", finalMp4, "-vf", "blackdetect=d=0.25:pix_th=0.06,freezedetect=n=0.002:d=1.2", "-af", "ebur128=peak=true", "-f", "null", "-"]);
  for (const m of err.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) {
    const a = Number(m[1]), b = Number(m[2]);
    const inScene = input.graphics.some((g) => g.type === "scene" && a >= g.start - 0.3 && b <= g.end + 0.3);
    if (!inScene) issues.push({ t: a, problem: `Pantalla negra de ${(b - a).toFixed(1)} s`, fix: "Revisar el corte o el gráfico en ese momento" });
  }
  for (const m of err.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)) {
    const a = Number(m[1]), d = Number(m[2]);
    const inScene = input.graphics.some((g) => g.type === "scene" && a >= g.start - 0.3 && a + d <= g.end + 0.5);
    if (!inScene) issues.push({ t: a, problem: `La imagen se queda congelada ${d.toFixed(1)} s`, fix: "Puede faltar vídeo en ese tramo" });
  }
  const lufs = Number((err.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  const peak = Number((err.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  if (Number.isFinite(lufs) && Math.abs(lufs + 14) > 1) issues.push({ problem: `Volumen ${lufs} LUFS (debería ser −14)` });
  if (Number.isFinite(peak) && peak > -0.9) issues.push({ problem: `Pico de audio ${peak} dB (demasiado alto, puede sonar saturado)` });
  const dur = Number((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", finalMp4]).catch(() => "0")).trim());
  if (Math.abs(dur - input.duration) > 0.5) issues.push({ problem: `Dura ${dur.toFixed(1)} s y debería durar ${input.duration.toFixed(1)} s` });
  return { issues, lufs: Number.isFinite(lufs) ? lufs : null, peak: Number.isFinite(peak) ? peak : null };
}

async function autoReview(item, finalMp4, input, dir) {
  const measured = await measuredReview(finalMp4, input).catch(() => ({ issues: [], lufs: null, peak: null }));
  const audio = measured.lufs != null ? `Audio: ${measured.lufs} LUFS, pico ${measured.peak} dB.` : "";
  if (!(await canSeeImages())) {
    return { checked: true, ok: measured.issues.length === 0, issues: measured.issues, note: `Revisión medida (sin mirar la imagen: el cerebro actual no ve fotogramas). ${audio}`.trim() };
  }
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
    const issues = [...measured.issues, ...(Array.isArray(r.issues) ? r.issues.slice(0, 12) : [])];
    return { checked: true, ok: !!r.ok && measured.issues.length === 0, score: r.score ?? null, issues, note: `${String(r.summary || "")} ${audio}`.trim() };
  } catch (e) {
    if (e instanceof NeedLogin) return { checked: false, ok: null, issues: [], note: e.message };
    return { checked: false, ok: null, issues: [], note: "No se pudo hacer la revisión automática: " + e.message.slice(0, 200) };
  }
}

/** Render + sonido + revisión + registro de una versión. */
async function produceItem(job, item, { work, words, plan, matte, info, variant, titleBase, look = null }) {
  const dir = join(ROOT, job.id, "items", item.id);
  mkdirSync(dir, { recursive: true });
  const duration = readJson(join(work, "words.json")).duration;
  const { renderVariant } = await import("./render/index.js");
  setItem(item.id, { status: "rendering", step: "Montando gráficos y subtítulos", progress: 0.02 });
  const input = renderInputFor(variant, plan, words, {
    workDir: join(dir, "render"), duration,
    base: { video: existsSync(join(work, "base.mp4")) ? join(work, "base.mp4") : join(work, "cut.mp4"), matte: variant.layout === "reference" ? matte : null, srcWidth: info.srcWidth, srcHeight: info.srcHeight },
    style: toRenderStyle(),
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
  const styleMusic = getStyle().music;
  const music = await ensureMusic(join(ROOT, job.id), styleMusic && styleMusic !== "auto" ? styleMusic : (look?.music || variant.music), duration);
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

export async function runJob(id) {
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
    plan = await makePlan(words.words.map((w) => ({ ...w, p: 1 })), { vocab: opts.vocab, useClaude, styleNotes: styleNotesForAI() });
    setJob(id, { plan, brain: plan.brain });
  }
  const variants = VARIANTS.filter((v) => opts.variants.includes(v.key));
  // Color del estilo (p. ej. cine) también en las versiones
  const grade = getStyle().grade;
  if (grade && grade !== "neutral") await buildBase(src, { framing: "wide", grade });
  else rmSync(join(src, "base.mp4"), { force: true });
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
    const dur = raw[raw.length - 1].end;
    // «Automático»: uno por cada ~50 s de vídeo, entre 3 y 20
    const count = job.options.shorts === "auto" ? Math.min(20, Math.max(3, Math.round(dur / 50))) : job.options.shorts;
    setJob(id, { step: `Claude está eligiendo los ${count} mejores momentos`, progress: 0.2 });
    picks = await pickShorts(raw, { count, vocab: job.options.vocab, useClaude });
    picks = picks.map((s, k) => ({ ...s, look: lookFor(k) }));
    setJob(id, { plan: { shorts: picks } });
  }
  picks.forEach((s, k) => {
    if (!db.prepare("SELECT id FROM autoedit_items WHERE job_id = ? AND idx = ?").get(id, k)) {
      db.prepare(`INSERT INTO autoedit_items (id, job_id, idx, label, layout, status, step, short, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', 'En cola', ?, ?, ?)`)
        .run(uid(), id, k, `Short ${k + 1}: ${s.title}`, (s.look || lookFor(k)).layout, JSON.stringify(s), now(), now());
    }
  });
  const items = db.prepare("SELECT * FROM autoedit_items WHERE job_id = ? ORDER BY idx").all(id).map(row);
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
      const look = { ...(it.short.look || lookFor(it.idx)) };
      // Con un estilo calcado, el color es el del estilo (el plano sigue variando para que no parezcan iguales)
      const sg = getStyle().grade;
      if (sg && sg !== "neutral") look.grade = sg;
      const variant = VARIANTS.find((v) => v.layout === look.layout) || VARIANTS[0];
      let plan = it.post?.plan;
      if (!plan) {
        setItem(it.id, { step: "Planificando la edición", progress: 0.05 });
        plan = await makePlan(words.words.map((w) => ({ ...w, p: 1 })), { vocab: job.options.vocab, useClaude, isShort: true, styleNotes: styleNotesForAI(), angle: it.short.angle, hook: it.short.hook });
        setItem(it.id, { post: { plan } });
      }
      setItem(it.id, { step: `Plano y color: ${FRAMINGS[look.framing]?.label}, ${GRADES[look.grade]?.label}`, progress: 0.06 });
      await buildBase(work, look);
      const matte = plan.behind?.length && variant.layout === "reference" ? await ensureMatte(job, work) : null;
      await produceItem(job, it, { work, words: words.words, plan, matte, info, variant, titleBase: it.short.title, look });
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
  if (IS_SERVER) {
    // Claude está en el PC: se le deja el encargo y lo rehace cuando lo recoja
    setItem(it.id, { notes: String(notes).slice(0, 1500), post: { ...(it.post || {}), changeRequest: String(notes).slice(0, 1500) }, status: "queued", step: "En cola para rehacer en tu PC", progress: 0, review: "pending", error: null });
    if (!["queued", "running"].includes(job.status)) setJob(job.id, { status: "queued", step: "En cola", error: null });
    return;
  }
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

export { setJob, setItem };

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

/** Todos los vídeos editados (para la pantalla «Editados», por meses). */
export function editedLibrary() {
  const rows = db.prepare(`SELECT i.*, j.name AS job_name, j.plan AS job_plan, j.kind AS job_kind, j.media_id AS job_media
    FROM autoedit_items i JOIN autoedit_jobs j ON j.id = i.job_id WHERE i.status = 'done' AND i.export_id IS NOT NULL ORDER BY i.updated_at DESC`).all();
  return rows.map((r) => {
    const it = row(r);
    const e = db.prepare("SELECT id, name, file, thumb, duration, width, height, size, created_at FROM exports WHERE id = ?").get(it.export_id);
    if (!e) return null;
    let topic = null;
    try { topic = JSON.parse(r.job_plan || "null")?.topic ?? null; } catch { /* sin plan */ }
    const posts = db.prepare("SELECT id, status, scheduled_at, platforms FROM posts WHERE export_id = ? ORDER BY scheduled_at").all(e.id).map(row);
    const { plan, ...post } = it.post || {};
    void plan;
    return {
      id: it.id, jobId: it.job_id, label: it.label, layout: it.layout, review: it.review, qa: it.qa, post, short: it.short,
      topic: topic || r.job_name, kind: r.job_kind, createdAt: e.created_at,
      video: { ...e, url: `/files/exports/${e.file}`, thumbUrl: e.thumb ? `/files/thumbs/${e.thumb}` : null },
      posts,
    };
  }).filter(Boolean);
}

export function listJobs() {
  return db.prepare("SELECT id FROM autoedit_jobs ORDER BY created_at DESC LIMIT 50").all().map((r) => jobView(r.id));
}

export function setReview(itemId, review) {
  if (!["pending", "approved", "rejected"].includes(review)) throw Object.assign(new Error("Estado no válido."), { status: 400 });
  setItem(itemId, { review });
}

export function retryJob(id) {
  setJob(id, { status: "queued", error: null, step: "En cola", progress: 0 });
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
