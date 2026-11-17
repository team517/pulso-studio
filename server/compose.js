// Juntar dos vídeos en uno: arriba y abajo (reel 9:16) o lado a lado (horizontal 16:9).
// El resultado entra en la Biblioteca como un vídeo más (y, si se pide, se auto-edita solo).
import { spawn } from "node:child_process";
import { join } from "node:path";
import { statSync } from "node:fs";
import { db, DIRS, uid, now } from "./db.js";

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", "-y", ...args], { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { if (err.length < 20000) err += d; });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg: " + err.slice(-600)))));
  });
}

/** Cuánto se habla en un vídeo (0-1): parte del tiempo que no es silencio. */
async function speechShare(file, dur) {
  const err = await new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-t", String(Math.min(dur, 120)), "-i", file, "-vn", "-af", "silencedetect=n=-35dB:d=0.4", "-f", "null", "-"], { windowsHide: true });
    let e = ""; p.stderr.on("data", (d) => { e += d; }); p.on("close", () => resolve(e)); p.on("error", () => resolve(""));
  });
  if (/does not contain any stream|matches no streams|Output file #0 does not contain/i.test(err)) return 0;
  const silent = [...err.matchAll(/silence_duration: ([\d.]+)/g)].reduce((a, m) => a + Number(m[1]), 0);
  return Math.max(0, Math.min(1, 1 - silent / Math.max(1, Math.min(dur, 120))));
}

/**
 * Hace el vídeo junto. layout: "stack" (arriba/abajo 1080×1920) | "side" (lado a lado 1920×1080).
 * audio: "a" | "b" | "mix". Devuelve el nombre del archivo en DIRS.media.
 */
export async function composeVideos(a, b, { layout = "stack", audio = "auto" } = {}) {
  const fa = join(DIRS.media, a.file), fb = join(DIRS.media, b.file);
  const D = Math.max(1, Math.min(Number(a.duration) || 0, Number(b.duration) || 0) || Number(a.duration) || 10);
  // Cerebro de editor: se queda la voz del que habla y se silencia el otro (si hablan los dos, se oyen los dos)
  let chosen = audio;
  if (audio === "auto") {
    const [sa, sb] = [a.has_audio ? await speechShare(fa, D) : 0, b.has_audio ? await speechShare(fb, D) : 0];
    chosen = sb > sa + 0.15 ? "b" : "a"; // empate: la del vídeo principal (arriba / izquierda); para oír los dos, «Las dos»
    console.log(`[juntar] voz: A ${Math.round(sa * 100)} %, B ${Math.round(sb * 100)} % → ${chosen}`);
  }
  audio = chosen;
  const stack = layout !== "side";
  const [W, H] = stack ? [1080, 1920] : [1920, 1080];
  const [cw, ch] = stack ? [W, (H - 6) / 2] : [(W - 6) / 2, H];
  // Cada vídeo llena su mitad (recorte centrado, un poco hacia arriba: las caras suelen estar en el tercio de arriba)
  const cover = (i) => `[${i}:v]scale=${cw}:${ch}:force_original_aspect_ratio=increase,crop=${cw}:${ch}:(iw-${cw})/2:(ih-${ch})*0.3,setsar=1,fps=30,format=yuv420p[v${i}]`;
  const join2 = stack
    ? `[v0]pad=${W}:${ch + 6}:0:0:color=0x0b0c10[t];[t][v1]vstack=inputs=2[vv]`
    : `[v0]pad=${cw + 6}:${H}:0:0:color=0x0b0c10[l];[l][v1]hstack=inputs=2[vv]`;
  const aud = audio === "b" ? `[1:a]aresample=48000,loudnorm=I=-16:TP=-1.5[aa]`
    : audio === "mix" ? `[0:a][1:a]amix=inputs=2:duration=shortest:normalize=1,loudnorm=I=-16:TP=-1.5[aa]`
    : `[0:a]aresample=48000,loudnorm=I=-16:TP=-1.5[aa]`;
  const id = uid(), file = `${id}.mp4`, out = join(DIRS.media, file);
  const base = ["-i", fa, "-i", fb, "-t", D.toFixed(3)];
  const video = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  try {
    await ffmpeg([...base, "-filter_complex", `${cover(0)};${cover(1)};${join2};${aud}`, "-map", "[vv]", "-map", "[aa]", ...video, "-c:a", "aac", "-b:a", "192k", out]);
  } catch {
    // Alguno sin sonido: se usa el que lo tenga (o ninguno)
    await ffmpeg([...base, "-filter_complex", `${cover(0)};${cover(1)};${join2}`, "-map", "[vv]", "-map", audio === "b" ? "1:a?" : "0:a?", ...video, "-c:a", "aac", "-b:a", "192k", out]);
  }
  return { id, file, width: W, height: H, duration: D, size: statSync(out).size, audio };
}

/** Guarda el vídeo junto en la Biblioteca (mismo formato que una subida). */
export function insertComposed(r, { name, hasAudio, thumb, layout, folder }) {
  db.prepare(`INSERT INTO media (id, name, kind, file, duration, width, height, has_audio, size, thumb, created_at, folder_id)
    VALUES (?, ?, 'video', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(r.id, name, r.file, r.duration, r.width, r.height, hasAudio ? 1 : 0, r.size, thumb, now(), folder || null);
  db.prepare("UPDATE media SET layout = ? WHERE id = ?").run(layout === "side" ? "side" : "stack", r.id);
}
