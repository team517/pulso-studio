// Qué cortar: pausas, tomas repetidas y silencios reales; tramos finales afinados con la energía del audio.
// (Método de la skill: Whisper alarga palabras sobre los silencios, así que los cortes se miden en el audio.)
import { spawn } from "node:child_process";

// Cortes de editor dinámico: fuera cualquier silencio entre palabras de más de 0,22 s y poco aire alrededor
// (los bordes los marca la energía real de la voz, así no se come ninguna sílaba)
export const CUT = { pause: 0.22, breath: 0.05, silenceDb: -38, energyDb: -45, mergeGap: 0.08, fps: 30 };

const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export function parseEnergy(text) {
  const out = [];
  const re = /pts_time:([\d.]+)[\s\S]*?RMS_level=(-?[\d.]+|-inf)/g;
  let m;
  while ((m = re.exec(text))) out.push({ t: Number(m[1]), db: m[2] === "-inf" ? -99 : Number(m[2]) });
  return out;
}

/** Ejecuta ffmpeg y devuelve su stderr (ahí van los análisis). */
export function ffStderr(args) {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", args, { windowsHide: true });
    const err = [];
    p.stderr.on("data", (d) => err.push(d));
    p.stdout.on("data", () => {});
    p.on("close", () => resolve(Buffer.concat(err).toString("utf8")));
    p.on("error", () => resolve(""));
  });
}

export async function analyzeAudio(audioPath) {
  const [en, sil] = await Promise.all([
    ffStderr(["-hide_banner", "-i", audioPath, "-af", "astats=metadata=1:reset=1:length=0.05,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"]),
    ffStderr(["-hide_banner", "-i", audioPath, "-af", `silencedetect=noise=${CUT.silenceDb}dB:d=0.35`, "-f", "null", "-"]),
  ]);
  const silences = [];
  const re = /silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g;
  let m;
  while ((m = re.exec(sil))) silences.push([Number(m[1]), Number(m[2])]);
  return { energy: parseEnergy(en), silences };
}

/** Pausas largas y repeticiones (tomas falsas) para enseñárselas a Claude. */
export function findIssues(words) {
  const pauses = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap > CUT.pause) pauses.push({ after: i - 1, gap: Math.round(gap * 100) / 100 });
  }
  const repeats = [];
  const n = words.map((w) => norm(w.w));
  for (let len = 1; len <= 6; len++) {
    for (let i = 0; i + 2 * len <= n.length; i++) {
      const a = n.slice(i, i + len), b = n.slice(i + len, i + 2 * len);
      if (a.every(Boolean) && a.join(" ") === b.join(" ")) repeats.push({ from: i, to: i + len - 1, again: i + len });
    }
  }
  return { pauses, repeats };
}

/** Reglas fijas si no hay Claude: quita la primera copia de cada repetición (se queda la buena, la segunda). */
export function heuristicDrops(words) {
  const { repeats } = findIssues(words);
  const drop = [];
  for (const r of repeats) if (!drop.some(([a, b]) => r.from >= a && r.to <= b)) drop.push([r.from, r.to]);
  // Muletillas sueltas al principio de una frase
  words.forEach((w, i) => { if (/^(eh+|em+|mm+|este)$/i.test(norm(w.w)) && w.p < 0.8) drop.push([i, i]); });
  return drop;
}

const snap = (t) => Math.round(t * CUT.fps) / CUT.fps;

/**
 * Tramos que se quedan: grupos de palabras sin pausas largas (ni palabras quitadas en medio),
 * con ~0,1 s de respiración y los bordes ajustados a donde de verdad hay voz.
 */
export function keepSegments(words, drops, en, totalDur) {
  const dropped = new Set();
  for (const [a, b] of drops) for (let i = a; i <= b; i++) dropped.add(i);
  const groups = [];
  let cur = null, cutNext = false;
  words.forEach((w, i) => {
    if (dropped.has(i)) { if (cur) { cur.dropAfter = true; groups.push(cur); cur = null; } cutNext = true; return; }
    if (cur && w.start - words[cur.last].end <= CUT.pause) cur.last = i;
    else { if (cur) groups.push(cur); cur = { first: i, last: i, dropBefore: cutNext }; }
    cutNext = false;
  });
  if (cur) groups.push(cur);

  // Umbral de voz según la grabación: el ruido de fondo (percentil 15) + 9 dB, nunca por debajo de -45 dB
  const sorted = en.map((e) => e.db).filter((d) => d > -90).sort((x, y) => x - y);
  const floor = sorted.length ? sorted[Math.floor(sorted.length * 0.15)] : -60;
  const thr = Math.max(CUT.energyDb, Math.min(-28, floor + 9));
  const loud = (t0, t1) => en.filter((e) => e.t >= t0 && e.t < t1 && e.db > thr);
  const segs = groups.map(({ first, last, dropBefore, dropAfter }) => {
    const ws = words[first], we = words[last];
    let s, e;
    if (dropBefore) {
      // Justo después de una palabra quitada: se corta pegado, sin respiración (si no, se colaría lo quitado)
      s = Math.max(ws.start - 0.03, words[first - 1] ? words[first - 1].end : 0);
    } else {
      // Inicio: donde empieza la energía alrededor de la primera palabra
      const pre = loud(ws.start - 0.3, ws.start + 0.1);
      s = (pre.length ? Math.min(ws.start, pre[0].t) : ws.start) - CUT.breath;
    }
    if (dropAfter) {
      e = Math.min(we.end + 0.03, words[last + 1] ? words[last + 1].start : totalDur);
    } else {
      // Final: la última ventana con voz dentro de la última palabra (Whisper la estira sobre el silencio)
      const post = loud(we.start, we.end + 0.25);
      e = (post.length ? post[post.length - 1].t + 0.05 : we.end) + CUT.breath;
    }
    s = Math.max(0, s);
    e = Math.min(totalDur, Math.max(e, we.start + 0.12));
    return { seg: [snap(s), snap(e)], dropBefore };
  });
  // Unir tramos casi pegados (pero nunca a través de una palabra quitada)
  const out = [];
  for (const { seg, dropBefore } of segs) {
    const prev = out[out.length - 1];
    if (prev && !dropBefore && seg[0] - prev[1] < CUT.mergeGap) prev[1] = Math.max(prev[1], seg[1]);
    else out.push([...seg]);
  }
  return out.filter(([s, e]) => e - s >= 0.2);
}

const NEGATION = /^(no|sin|ni|nunca|jamás|jamas|nada|nadie|tampoco)$/i;

/**
 * Seguridad: no se aceptan cortes que quiten negaciones u otras palabras que cambian el sentido,
 * salvo que formen parte de una toma repetida (la misma frase se dice otra vez justo después).
 */
export function safeDrops(words, drops) {
  const { repeats } = findIssues(words);
  const inRepeat = (a, b) => repeats.some((r) => a >= r.from && b <= r.to);
  return drops.filter(([a, b]) => {
    if (b - a + 1 > Math.max(8, words.length * 0.25)) return false;          // nada de quitar trozos enormes
    const hasNeg = words.slice(a, b + 1).some((w) => NEGATION.test(norm(w.w)));
    return !hasNeg || inRepeat(a, b);
  });
}
