// ffprobe / miniaturas / transcripción con Whisper.
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { db, DIRS } from "./db.js";
import { onGpu } from "./gpu.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Ejecuta un proceso y devuelve stdout (rechaza con stderr si falla). */
export function run(cmd, args, { onStdout, onStderr, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, cwd });
    const out = [], err = [];
    p.stdout.on("data", (d) => { out.push(d); onStdout?.(String(d)); });
    p.stderr.on("data", (d) => { err.push(d); onStderr?.(String(d)); });
    p.on("error", reject);
    p.on("close", (code) => {
      const so = Buffer.concat(out).toString("utf8");
      const se = Buffer.concat(err).toString("utf8");
      code === 0 ? resolve(so) : reject(new Error(se.slice(-1500) || "exit " + code));
    });
  });
}

export async function probe(file) {
  const out = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const j = JSON.parse(out);
  const v = j.streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = j.streams.find((s) => s.codec_type === "audio");
  let width = v?.width ?? null, height = v?.height ?? null;
  // Vídeos de móvil giradas 90°: se intercambian ancho y alto
  const rot = Number(v?.side_data_list?.find((s) => s.rotation != null)?.rotation ?? v?.tags?.rotate ?? 0);
  if (Math.abs(rot) % 180 === 90) [width, height] = [height, width];
  return {
    duration: Number(j.format?.duration ?? v?.duration ?? a?.duration ?? 0) || 0,
    width, height,
    hasVideo: !!v,
    hasAudio: !!a,
  };
}

export async function makeThumb(file, outName, at = 0.5) {
  const out = join(DIRS.thumbs, outName);
  await run("ffmpeg", ["-y", "-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", out]);
  return outName;
}

/* ---------- Transcripción (Whisper en la GPU) ---------- */

// De uno en uno: dos modelos a la vez no caben en la memoria de la GPU (cola compartida en gpu.js)
const queued = new Set();

// Si el servidor se cerró a mitad de una transcripción, se deja lista para repetirla
db.prepare("UPDATE media SET transcript_status = NULL WHERE transcript_status = 'running'").run();

export function transcribe(mediaId, language = "es") {
  if (queued.has(mediaId)) return;
  const m = db.prepare("SELECT * FROM media WHERE id = ?").get(mediaId);
  if (!m) return;
  queued.add(mediaId);
  db.prepare("UPDATE media SET transcript_status = 'running' WHERE id = ?").run(mediaId);
  const file = join(DIRS.media, m.file);
  onGpu(() => run("python", [join(HERE, "transcribe.py"), file, language]))
    .then((out) => {
      const line = out.trim().split("\n").pop();
      const words = JSON.parse(line);
      db.prepare("UPDATE media SET transcript = ?, transcript_status = 'done' WHERE id = ?").run(JSON.stringify(words), mediaId);
    })
    .catch((e) => {
      console.error("[whisper]", e.message);
      db.prepare("UPDATE media SET transcript_status = ? WHERE id = ?").run("error: " + e.message.slice(-300), mediaId);
    })
    .finally(() => queued.delete(mediaId));
}
