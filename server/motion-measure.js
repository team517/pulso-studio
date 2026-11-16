// Mide los zooms de un vídeo fotograma a fotograma (no a ojo): ffmpeg vidstabdetect da el movimiento de
// muchos puntos de la imagen; si se alejan del centro, la imagen crece (zoom). De ahí sale cada zoom:
// de golpe (salto en 1-2 fotogramas) o suave (poco a poco), cuánto y cuándo.
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

function run(args) {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => { if (err.length < 200000) err += d; });
    p.on("close", (code) => resolve({ code, err }));
    p.on("error", () => resolve({ code: -1, err: "" }));
  });
}

/** Escala de un fotograma respecto al anterior (1 = igual, 1.05 = 5 % más grande) con sus puntos de movimiento. */
function frameScale(lms, w, h) {
  if (lms.length < 8) return null;
  const cx = w / 2, cy = h / 2;
  let mvx = 0, mvy = 0, mrx = 0, mry = 0;
  for (const m of lms) { mvx += m.vx; mvy += m.vy; mrx += m.x - cx; mry += m.y - cy; }
  const n = lms.length; mvx /= n; mvy /= n; mrx /= n; mry /= n;
  let num = 0, den = 0;
  for (const m of lms) {
    const rx = m.x - cx - mrx, ry = m.y - cy - mry;
    num += (m.vx - mvx) * rx + (m.vy - mvy) * ry;
    den += rx * rx + ry * ry;
  }
  if (den < 1) return null;
  return 1 + num / den;
}

/**
 * @returns {{ fps, frames, zooms: {t, kind: "punch"|"smooth", from, to}[], zoomStyle, zoomMax, perMin }}
 */
export async function measureZooms(file, tmpFile, { duration, width, height, cuts = [] } = {}) {
  const W = 360;
  const r = await run(["-v", "error", "-y", "-i", file, "-vf", `scale=${W}:-2,vidstabdetect=shakiness=6:accuracy=9:stepsize=6:result='${tmpFile.replace(/\\/g, "/").replace(/:/g, "\\:")}':fileformat=ascii`, "-an", "-f", "null", "-"]);
  let text = "";
  try { text = readFileSync(tmpFile, "utf8"); } catch { return null; }
  rmSync(tmpFile, { force: true });
  void r;
  const lines = text.split(/\r?\n/).filter((l) => l.startsWith("Frame "));
  if (lines.length < 10) return null;
  // Alto del fotograma reducido (se deduce de las posiciones; basta con el máximo)
  const parsed = lines.map((l) => [...l.matchAll(/\(LM (-?\d+) (-?\d+) (\d+) (\d+) (\d+) ([\d.]+) ([\d.]+)\)/g)].map((m) => ({ vx: +m[1], vy: +m[2], x: +m[3], y: +m[4], contrast: +m[6], match: +m[7] })));
  const H = width && height ? Math.round((W * height) / width / 2) * 2 : Math.max(...parsed.flat().map((m) => m.y)) + 40;
  const fps = lines.length / Math.max(0.5, duration || lines.length / 25);
  // Los cambios de plano no son zooms: esos fotogramas no cuentan
  const nearCut = (i) => cuts.some((c) => Math.abs(c * fps - i) < 2.5);
  const scales = parsed.map((lms, i) => {
    if (nearCut(i)) return null;
    const good = lms.filter((m) => m.match < 12); // los puntos que encajan bien
    return frameScale(good, W, H);
  });
  // Zooms: un salto grande en 1 fotograma (de golpe) o una subida continua (suave)
  const zooms = [];
  let i = 0;
  while (i < scales.length) {
    const s = scales[i];
    const calm = (k) => scales[k] == null || Math.abs(scales[k] - 1) < 0.015;
    // De golpe: un salto aislado (antes y después la imagen está quieta)
    if (s != null && Math.abs(s - 1) > 0.04 && Math.abs(s - 1) < 0.4 && calm(i - 1) && calm(i + 1)) {
      zooms.push({ t: +(i / fps).toFixed(2), kind: "punch", from: 1, to: +s.toFixed(3) });
      i += 2;
      continue;
    }
    // suave: varios fotogramas seguidos creciendo (o decreciendo) poco a poco
    let j = i, acc = 1;
    while (j < scales.length && scales[j] != null && scales[j] > 1.0015 && scales[j] < 1.03) { acc *= scales[j]; j++; }
    if (j - i >= Math.round(fps * 0.6) && acc > 1.04) { zooms.push({ t: +(i / fps).toFixed(2), kind: "smooth", from: 1, to: +acc.toFixed(3), secs: +((j - i) / fps).toFixed(2) }); i = j; continue; }
    j = i; acc = 1;
    while (j < scales.length && scales[j] != null && scales[j] < 0.9985 && scales[j] > 0.97) { acc *= scales[j]; j++; }
    if (j - i >= Math.round(fps * 0.6) && acc < 0.96) { zooms.push({ t: +(i / fps).toFixed(2), kind: "smooth", from: 1, to: +acc.toFixed(3), secs: +((j - i) / fps).toFixed(2) }); i = j; continue; }
    i++;
  }
  const punch = zooms.filter((z) => z.kind === "punch"), smooth = zooms.filter((z) => z.kind === "smooth");
  const mins = Math.max(0.1, (duration || lines.length / fps) / 60);
  const amount = (z) => Math.abs(z.to - 1);
  const avg = (l) => (l.length ? l.reduce((a, z) => a + amount(z), 0) / l.length : 0);
  const zoomStyle = punch.length >= 2 && punch.length >= smooth.length ? "punch" : smooth.length >= 2 ? "smooth" : punch.length ? "punch" : "none";
  const zoomMax = +(1 + Math.min(0.25, avg(zoomStyle === "punch" ? punch : smooth) || 0)).toFixed(3);
  return { fps: +fps.toFixed(2), frames: lines.length, zooms: zooms.slice(0, 60), zoomStyle, zoomMax, perMin: +(zooms.length / mins).toFixed(1) };
}
