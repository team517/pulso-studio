// Motor de render de Pulso Studio: de la toma cortada + el plan de edición a un MP4 con motion graphics.
//   renderVariant(input, onProgress) → { video, sfx }   (contrato en server/autoedit/CONTRACT.md)
// Etapas: [1] capa «detrás» con alfa (HyperFrames, solo si hay palabras detrás y mate)
//         [1b] base = toma + capa detrás + (toma × mate)  (ffmpeg, x264)
//         [2] composición final: base dentro de #zoom + gráficos + subtítulos (HyperFrames → MP4)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { layoutGeometry, applyStyleGeometry } from "./layouts.js";
import { resolveStyle, setStyle } from "./style.js";
import { planGraphics, buildBehindProject, buildFinalProject } from "./project.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAYOUT_SIZE = { reference: [1080, 1920], headline: [1080, 1920], minimal: [1080, 1920], horizontal: [1920, 1080], framed: [1080, 1350] };
const DEFAULT_THEME = { accent: "#2F8BFF", accent2: "#6E58F1", gold: "#F2C84B", bg: "#070B1A", red: "#FF4D5E" };

// Ruta del CLI de HyperFrames (dependencia del proyecto)
function hyperframesBin() {
  let d = HERE;
  for (let i = 0; i < 8; i++) {
    const p = path.join(d, "node_modules", "hyperframes", "bin", "hyperframes.mjs");
    if (fs.existsSync(p)) return p;
    d = path.dirname(d);
  }
  throw new Error("No encuentro hyperframes en node_modules (npm i -D hyperframes@0.9.56)");
}

function hfEnv() {
  return { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", HF_CLI_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", NO_COLOR: "1" };
}

// Lanza el CLI de HyperFrames y va pasando el progreso (líneas «@hf-progress {...}»)
function runHf(args, cwd, onPct) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hyperframesBin(), ...args], { cwd, env: hfEnv(), windowsHide: true });
    let tail = "", buf = "";
    const onData = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-8000);
      buf += s;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("@hf-progress")) {
          try { const j = JSON.parse(line.slice(12)); if (onPct && typeof j.pct === "number") onPct(j.pct / 100, j.code); } catch {}
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(tail) : reject(new Error(`hyperframes ${args[0]} falló (código ${code}):\n${tail.slice(-3000)}`))));
  });
}

function ffmpeg(args) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error("ffmpeg falló: " + (r.stderr || "").slice(-2000));
}

export function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,pix_fmt,codec_name:format=duration", "-of", "json", file], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error("ffprobe falló: " + r.stderr);
  const j = JSON.parse(r.stdout), s = j.streams[0] || {};
  const [n, d] = String(s.r_frame_rate || "30/1").split("/").map(Number);
  return { width: s.width, height: s.height, fps: n / (d || 1), pix: s.pix_fmt, codec: s.codec_name, duration: Number(j.format?.duration || 0) };
}

// alto/ancho de una imagen (logo); 1 si no se puede leer
function imageAspect(file) {
  if (!file || !fs.existsSync(file)) return 1;
  try {
    const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8", windowsHide: true });
    const [w, h] = r.stdout.trim().split(",").map(Number);
    return w > 0 && h > 0 ? h / w : 1;
  } catch { return 1; }
}

function workers() {
  // ~1 Chrome por cada 2 núcleos, máx. 6 (cada uno ~300-500 MB a 1080p)
  const cores = os.cpus().length, memGb = os.totalmem() / 2 ** 30;
  return Math.max(1, Math.min(6, Math.floor(cores / 2), Math.floor((memGb - 4) / 1.2)));
}

function normalize(input) {
  const [w, h] = LAYOUT_SIZE[input.layout] || LAYOUT_SIZE.reference;
  const layout = LAYOUT_SIZE[input.layout] ? input.layout : "reference";
  const theme = { ...DEFAULT_THEME, ...(input.theme || {}) };
  const duration = Number(input.duration) || probe(input.base.video).duration;
  return {
    ...input, layout, width: input.width || w, height: input.height || h, fps: 30, duration, theme,
    base: { srcWidth: 1080, srcHeight: 1920, matte: null, ...input.base },
    captions: input.captions || [], graphics: input.graphics || [], zooms: input.zooms || [],
  };
}

/**
 * @param {import("../CONTRACT.md").RenderInput} rawInput
 * @param {(fraction:number, label:string)=>void} [onProgress]
 * @returns {Promise<{video:string, sfx:{t:number, kind:string}[]}>}
 */
export async function renderVariant(rawInput, onProgress = () => {}) {
  const input = normalize(rawInput);
  const work = path.resolve(input.workDir);
  fs.mkdirSync(work, { recursive: true });
  // Estilo del usuario: se resuelve justo antes de cada etapa que genera HTML (síncrona), y se suelta al acabar.
  const logoAspect = imageAspect(input.style?.logo?.file);
  const styled = (fn) => {
    const { style, theme } = resolveStyle(input);
    setStyle(style);
    try {
      const inp = { ...input, theme };
      let g = layoutGeometry(input.layout, input.width, input.height, style.motion.zoomMax ?? undefined);
      if (style.user) g = applyStyleGeometry(g, style.caption.position, style.logo ? { ...style.logo, aspect: logoAspect } : null,
        { yPct: style.caption.yPct, letterbox: style.fx.letterbox });
      return fn(inp, g);
    } finally { setStyle(null); }
  };
  const geo = styled((_, g) => g);
  const hasMatte = !!(input.base.matte && fs.existsSync(input.base.matte));
  const plan = planGraphics(input, geo, hasMatte);
  const report = (f, label) => { try { onProgress(Math.max(0, Math.min(1, f)), label); } catch {} };
  const nW = String(workers());
  const timings = {};

  // [1] + [1b] capa detrás y base compuesta
  let baseVideo = input.base.video;
  const twoStage = hasMatte && plan.behind.length > 0;
  let p0 = 0.02;
  if (twoStage) {
    const t = Date.now();
    report(0.02, "Preparando el texto detrás de la cabeza");
    const bdir = path.join(work, "hf-behind");
    fs.rmSync(bdir, { recursive: true, force: true });
    const { t0, t1 } = styled((inp) => buildBehindProject(inp, plan.behind, bdir));
    const mov = path.join(work, "behind.mov");
    // pocos fotogramas: menos Chromes arrancan antes (cada uno cuesta ~2-3 s)
    const bW = String(Math.max(1, Math.min(Number(nW), Math.ceil(((t1 - t0) * 30) / 45))));
    await runHf(["render", ".", "-o", mov, "--format", "mov", "--fps", "30", "--workers", bW], bdir,
      (p) => report(0.02 + p * 0.2, "Texto detrás de la cabeza"));
    report(0.23, "Componiendo la base con el recorte");
    const composed = path.join(work, "base-composed.mp4");
    const sw = input.base.srcWidth, sh = input.base.srcHeight;
    const fc = `[0:v]fps=30,scale=${sw}:${sh},format=rgba,split[pl][pl2];[2:v]setpts=PTS-STARTPTS+${t0.toFixed(3)}/TB,format=rgba[bh];`
      + `[pl][bh]overlay=format=auto:eof_action=pass[pb];[1:v]fps=30,scale=${sw}:${sh},format=gray[m];`
      + `[pl2][m]alphamerge[fg];[pb][fg]overlay=format=auto:shortest=1,format=yuv420p[out]`;
    ffmpeg(["-i", input.base.video, "-i", input.base.matte, "-i", mov, "-filter_complex", fc, "-map", "[out]", "-t", input.duration.toFixed(3),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", composed]);
    fs.rmSync(mov, { force: true }); // ProRes 4444 intermedio: ya no hace falta
    baseVideo = composed;
    timings.behind = (Date.now() - t) / 1000;
    p0 = 0.28;
  }

  // [2] composición final
  const t2 = Date.now();
  report(p0, "Generando gráficos y subtítulos");
  const fdir = path.join(work, "hf");
  fs.rmSync(fdir, { recursive: true, force: true });
  const { sfx } = styled((inp, g) => buildFinalProject(inp, g, plan, baseVideo, fdir, twoStage));
  const raw = path.join(work, "render-raw.mp4");
  await runHf(["render", ".", "-o", raw, "--fps", "30", "--quality", "standard", "--crf", "18", "--workers", nW], fdir,
    (p) => report(p0 + p * (0.97 - p0), "Renderizando la versión"));
  timings.final = (Date.now() - t2) / 1000;

  // salida: H.264 yuv420p al tamaño y 30 fps exactos (si HyperFrames ya lo da, solo se renombra)
  const video = path.join(work, "video.mp4");
  const pr = probe(raw);
  if (pr.codec === "h264" && pr.pix === "yuv420p" && pr.width === input.width && pr.height === input.height && Math.abs(pr.fps - 30) < 0.01) {
    fs.rmSync(video, { force: true });
    fs.renameSync(raw, video);
  } else {
    report(0.97, "Ajustando el formato");
    ffmpeg(["-i", raw, "-vf", `scale=${input.width}:${input.height},fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-an", "-movflags", "+faststart", video]);
    fs.rmSync(raw, { force: true });
  }
  report(1, "Listo");
  return { video, sfx, timings };
}

export default renderVariant;
