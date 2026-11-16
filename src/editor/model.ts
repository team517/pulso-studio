// Lógica del proyecto: posiciones en la línea de tiempo, cortes y subtítulos.
import { newId, type Caption, type CaptionStyle, type Clip, type Media, type ProjectData, type TextItem, type Word } from "../api";

export const CAPTION_DEFAULTS: CaptionStyle = {
  font: "Arial Black", size: 72, color: "#ffffff", highlight: "#ffd60a", y: 0.72, uppercase: true, box: false, wordsPerLine: 3,
};
export const capStyle = (d: ProjectData): CaptionStyle => ({ ...CAPTION_DEFAULTS, ...d.captions.style });

export const FONTS = ["Arial Black", "Arial", "Impact", "Segoe UI", "Verdana", "Georgia", "Trebuchet MS", "Courier New"];

export const clipDur = (c: Clip) => Math.max(0, c.out - c.in);
export const totalDuration = (d: ProjectData) => d.clips.reduce((n, c) => n + clipDur(c), 0);

/** Inicio de cada clip en la línea de tiempo. */
export function clipStarts(d: ProjectData): number[] {
  const out: number[] = [];
  let t = 0;
  for (const c of d.clips) { out.push(t); t += clipDur(c); }
  return out;
}

/** Clip que suena en el instante t (y cuánto lleva de él). */
export function clipAt(d: ProjectData, t: number): { index: number; local: number } | null {
  let start = 0;
  for (let i = 0; i < d.clips.length; i++) {
    const dur = clipDur(d.clips[i]);
    if (t < start + dur || i === d.clips.length - 1) return { index: i, local: Math.min(Math.max(0, t - start), dur) };
    start += dur;
  }
  return null;
}

export function newClip(m: Media): Clip {
  return { id: newId(), mediaId: m.id, in: 0, out: m.kind === "image" ? 4 : Math.max(0.1, m.duration), volume: 1, fit: "cover" };
}

/** Corta el clip que hay en t en dos. */
export function splitAt(d: ProjectData, t: number): ProjectData | null {
  const at = clipAt(d, t);
  if (!at) return null;
  const c = d.clips[at.index];
  if (at.local < 0.1 || clipDur(c) - at.local < 0.1) return null;
  const cut = c.in + at.local;
  const a = { ...c, out: cut };
  const b = { ...c, id: newId(), in: cut };
  const clips = [...d.clips];
  clips.splice(at.index, 1, a, b);
  return { ...d, clips };
}

export function newText(d: ProjectData, t: number): TextItem {
  const total = totalDuration(d) || 3;
  const start = Math.min(t, Math.max(0, total - 0.5));
  return {
    id: newId(), text: "Escribe aquí", start, end: Math.min(total, start + 3), x: 0.5, y: 0.2,
    size: Math.round(d.width * 0.065), color: "#ffffff", font: "Arial Black", box: false, boxColor: "#000000", boxOpacity: 0.6,
  };
}

/** Textos que quedan fuera del vídeo se recortan para que no se pierdan. */
export function clampTexts(d: ProjectData): ProjectData {
  const total = totalDuration(d);
  if (!total) return d;
  return {
    ...d,
    texts: d.texts.map((t) => {
      const start = Math.min(t.start, Math.max(0, total - 0.3));
      return { ...t, start, end: Math.max(start + 0.3, Math.min(t.end, total)) };
    }),
  };
}

/* ---------- Subtítulos a partir de la voz ---------- */

/** Palabras de todos los clips colocadas en la línea de tiempo. */
export function timelineWords(d: ProjectData, mediaById: Record<string, Media>): Word[] {
  const starts = clipStarts(d);
  const out: Word[] = [];
  d.clips.forEach((c, i) => {
    const m = mediaById[c.mediaId];
    if (!m?.transcript || c.muted) return;
    for (const w of m.transcript) {
      const mid = (w.s + w.e) / 2;
      if (mid < c.in || mid > c.out) continue;
      out.push({ w: w.w, s: starts[i] + Math.max(0, w.s - c.in), e: starts[i] + Math.min(clipDur(c), w.e - c.in) });
    }
  });
  return out;
}

/** Agrupa las palabras en frases cortas (como los subtítulos de reels). */
export function groupCaptions(words: Word[], perLine: number): Caption[] {
  const items: Caption[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    items.push({ id: newId(), start: cur[0].s, end: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(" "), words: cur });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (cur.length && (cur.length >= perLine || (prev && w.s - prev.e > 0.6))) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w) || (/[,;:]$/.test(w.w) && cur.length >= 2)) flush();
  });
  flush();
  // Sin huecos pequeños entre frases (se ve más fluido)
  for (let i = 0; i < items.length - 1; i++) {
    if (items[i + 1].start - items[i].end < 0.35) items[i].end = items[i + 1].start;
  }
  // Quitar la puntuación final en pantalla (también en la última palabra, que es la que se resalta)
  const strip = (s: string) => s.replace(/[.,;:]+$/g, "");
  return items.map((it) => ({
    ...it,
    text: strip(it.text),
    words: it.words.map((w, i) => (i === it.words.length - 1 ? { ...w, w: strip(w.w) } : w)),
  }));
}

/** Palabras de un subtítulo cuando el usuario cambia el texto a mano: se reparten los tiempos. */
export function retimeWords(c: Caption, text: string): Caption {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { ...c, text, words: [] };
  const step = (c.end - c.start) / parts.length;
  return { ...c, text, words: parts.map((w, i) => ({ w, s: c.start + i * step, e: c.start + (i + 1) * step })) };
}
