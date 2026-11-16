// Vista previa del estilo: un reel de ejemplo o uno de tus vídeos con los subtítulos, zooms y color
// tal y como los pone la auto-edición (mismas medidas «a 1080», mismos trozos y mismas entradas).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { FolderOpen, Loader2, Play, Subtitles, Volume2, VolumeX } from "lucide-react";
import { api, type Media, type Word } from "../api";
import { fontFamily, type EditStyle, type PresetCaption, type StyleAsset } from "../style-api";
import { navigate } from "../ui";
import "./style-preview.css";

type Look = { grain: number; vignette: number; letterbox: boolean };
type PreviewStyle = EditStyle & {
  caption: PresetCaption;
  motion: EditStyle["motion"] & { zoomStyle?: "smooth" | "punch" | "none"; zoomMax?: number };
  look?: Look | null;
  grade?: string;
  colors: EditStyle["colors"] & { captionShadow?: string };
};
type Mode = "sample" | "video";
type Chunk = { s: number; end: number; words: Word[]; key: boolean; phrase: number };
type Zoom = { t: number; to: number; dur: number };

const DEFAULT_FONT = { caption: "Inter, sans-serif", keyword: "Impact, 'Arial Black', sans-serif", title: "Inter, sans-serif" } as const;
const SOFT_MODES = ["words", "chars", "line", "words", "line", "chars"] as const;

// Texto de ejemplo con tiempos de habla (se repite en bucle)
const SAMPLE_WORDS: Word[] = [
  ["Te", 0.3, 0.45], ["garantizamos", 0.48, 1.12], ["30", 1.6, 1.86], ["reuniones", 1.9, 2.42], ["al", 2.46, 2.56], ["mes.", 2.6, 2.98],
  ["Sin", 3.5, 3.66], ["llamadas", 3.7, 4.1], ["en", 4.14, 4.22], ["frío", 4.26, 4.6], ["y", 5.05, 5.12], ["sin", 5.15, 5.3],
  ["perder", 5.34, 5.66], ["el", 5.7, 5.78], ["tiempo.", 5.82, 6.3],
].map(([w, s, e]) => ({ w: w as string, s: s as number, e: e as number }));
const SAMPLE_LOOP = 7.6;

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

/* ---------- Trozos, palabra clave y zooms (como en la auto-edición) ---------- */

function buildChunks(src: Word[], maxWords: number): Chunk[] {
  const words = src.map((w) => ({ ...w, w: (w.w || "").trim() })).filter((w) => w.w);
  const out: Chunk[] = [];
  let cur: Word[] = [], phrase = 0;
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const gap = next ? next.s - w.e : 9;
    const endPhrase = /[.!?…]["»”]?$/.test(w.w) || gap > 0.6;
    if (cur.length >= maxWords || /[.,;:!?…]["»”]?$/.test(w.w) || gap > 0.35) {
      out.push({ s: cur[0].s, end: 0, words: cur, key: false, phrase });
      cur = [];
      if (endPhrase) phrase++;
    }
  });
  if (cur.length) out.push({ s: cur[0].s, end: 0, words: cur, key: false, phrase });
  out.forEach((c, i) => {
    const next = out[i + 1];
    let end = c.words[c.words.length - 1].e + 0.35;
    if (next) end = Math.min(end, next.s);
    c.end = Math.max(end, c.s + 0.4);
  });
  // Palabra clave: primero las que llevan cifras, luego palabras largas; nunca dos a menos de 3 trozos
  const letters = (s: string) => s.replace(/[^\p{L}]/gu, "").length;
  const free = (i: number) => !out.some((c, j) => c.key && Math.abs(j - i) < 3);
  out.forEach((c, i) => { if (c.words.some((w) => /\d/.test(w.w)) && free(i)) c.key = true; });
  out.forEach((c, i) => { if (!c.key && c.words.some((w) => letters(w.w) >= 7) && free(i)) c.key = true; });
  return out;
}

function buildZooms(chunks: Chunk[], style: PreviewStyle["motion"]): Zoom[] {
  const zs = style.zoomStyle ?? "smooth";
  if (zs === "none") return [];
  const zMax = Math.min(1.25, Math.max(1, Number(style.zoomMax) || (style.zoomStyle ? 1.1 : 1.06)));
  const out: Zoom[] = [];
  let last = -9, close = false, prevPhrase = -1;
  for (const c of chunks) {
    const first = c.phrase !== prevPhrase;
    prevPhrase = c.phrase;
    if (zs === "punch") {
      if (c.s - last < 2.5 || c.s < 0.5) continue;
      close = !close;
      out.push({ t: c.s, to: close ? zMax : 1, dur: 0 });
      last = c.s;
    } else if (first && c.s - last >= 3) {
      close = !close;
      out.push({ t: c.s, to: close ? zMax : 1, dur: 2.6 });
      last = c.s;
    }
  }
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const p3out = (p: number) => 1 - (1 - p) ** 3;
const p2out = (p: number) => 1 - (1 - p) ** 2;
const inOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const backOut = (p: number, s = 1.3) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2;

function zoomAt(zooms: Zoom[], t: number) {
  let z = 1;
  for (const e of zooms) {
    if (e.t > t) break;
    const p = e.dur ? clamp01((t - e.t) / e.dur) : 1;
    z = z + (e.to - z) * inOut(p);
  }
  return z;
}

function findChunk(chunks: Chunk[], t: number) {
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].s <= t) return t < chunks[i].end ? i : -1;
  }
  return -1;
}

/* ---------- Aspecto de los subtítulos (las mismas reglas que el render) ---------- */

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(f, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => `rgba(${hexRgb(hex).join(",")},${a})`;
function lum(hex: string) {
  const c = hexRgb(hex).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

type CapLook = {
  top: string; avail: number; oneLine: boolean;
  base: number; bigSize: number; hlSize: number;
  word: CSSProperties; big: CSSProperties; hl: CSSProperties; box: CSSProperties;
  line: CSSProperties; boxLine: CSSProperties;
};

function captionLook(style: PreviewStyle, W: number, font: (slot: keyof EditStyle["fonts"]) => string): CapLook {
  const cs = style.caption, k = W / 1080, px = (n: number) => `${+(n * k).toFixed(2)}px`;
  const v2 = cs.scale != null;
  const base = v2 ? 56 * cs.scale! * k : { s: 15, m: 18, l: 23 }[cs.size] * (W / 340);
  const kScale = cs.keywordScale ?? 1, same = cs.keywordFont === "same", kwFont = cs.keywordFont === "keyword";
  const G = cs.keywordColor || style.colors.keyword;
  const capFont = font("caption"), keyFont = font("keyword");
  const capWeight = cs.weight ?? 600;
  const ls = cs.letterSpacing ?? null;
  const sc = style.colors.captionShadow ? "255,255,255" : "0,0,0";
  const framed = !!(cs.stroke || cs.bg);
  const sh = cs.shadow === "soft" ? `0 ${px(2)} ${px(10)} rgba(${sc},.45), 0 ${px(1)} ${px(2)} rgba(${sc},.35)`
    : cs.shadow === "strong" ? `0 ${px(3)} ${px(6)} rgba(${sc},.85), 0 0 ${px(22)} rgba(${sc},.55), 0 ${px(1)} ${px(2)} rgba(${sc},.9)`
    : cs.shadow === "none" ? (framed ? "none" : `0 ${px(1)} ${px(3)} rgba(${sc},.4)`) : null;
  const strokePx = cs.stroke ? cs.stroke.width * k : 0;
  const stroke: CSSProperties = cs.stroke ? { WebkitTextStroke: `${+(strokePx * 2).toFixed(2)}px ${cs.stroke.color}`, paintOrder: "stroke fill" } : {};
  const tt = cs.uppercase ? "uppercase" : "none";
  const yPct = cs.yPct != null ? Math.min(0.95, Math.max(0.05, cs.yPct)) : { high: 0.58, auto: 0.63, low: 0.7 }[cs.position];
  const boxFg = cs.keywordColor ? (contrast("#ffffff", G) >= 3 ? "#ffffff" : "#111318") : (contrast("#ffffff", G) >= 2.4 ? "#ffffff" : "#111318");
  return {
    top: `${(yPct * 100).toFixed(2)}%`,
    avail: W * 0.9 - 2 * strokePx,
    oneLine: cs.lines === 1,
    base,
    bigSize: base * 1.96 * kScale,
    hlSize: base * kScale,
    word: {
      fontFamily: capFont, fontWeight: capWeight, color: style.colors.caption, lineHeight: 1.08, textTransform: tt,
      letterSpacing: `${ls ?? -0.02}em`, textShadow: sh ?? `0 ${px(3)} ${px(14)} rgba(0,0,0,.55), 0 ${px(1)} ${px(3)} rgba(0,0,0,.75)`, ...stroke,
    },
    big: {
      fontFamily: same ? capFont : keyFont, fontWeight: same ? capWeight : style.fonts.keyword ? 700 : 400, color: G, textTransform: tt,
      lineHeight: same ? 1.1 : 1, letterSpacing: `${ls ?? (same ? -0.02 : 0.01)}em`,
      textShadow: sh ?? `0 0 ${px(34)} ${rgba(G, 0.5)}, 0 ${px(6)} ${px(18)} rgba(0,0,0,.65)`, ...stroke,
    },
    hl: {
      fontFamily: kwFont ? keyFont : capFont, fontWeight: same ? capWeight : 800, color: G, textTransform: tt, lineHeight: kwFont ? 0.98 : 1.08,
      letterSpacing: `${ls ?? (kwFont ? 0.01 : -0.02)}em`, textShadow: sh ?? `0 0 ${px(22)} ${rgba(G, 0.45)}, 0 ${px(3)} ${px(12)} rgba(0,0,0,.6)`, ...stroke,
    },
    box: {
      fontFamily: kwFont ? keyFont : capFont, fontWeight: same ? capWeight : 800, color: boxFg, textTransform: tt, lineHeight: kwFont ? 0.98 : 1.08,
      letterSpacing: `${ls ?? (kwFont ? 0.01 : -0.02)}em`, textShadow: "none",
    },
    line: { columnGap: ".26em", ...(cs.bg ? { background: rgba(cs.bg.color, cs.bg.opacity), padding: ".25em .45em", borderRadius: px(cs.bg.radius) } : {}) },
    boxLine: { background: G, padding: ".1em .38em .14em", borderRadius: ".24em", boxShadow: `0 ${px(10)} ${px(30)} ${px(-8)} ${rgba(G, 0.8)}` },
  };
}

/* ---------- Animación fotograma a fotograma (leyendo el tiempo del vídeo) ---------- */

type Shown = { el: HTMLElement; chunk: Chunk; anim: PresetCaption["animation"]; mode: string; boxed: boolean };

function setFx(el: HTMLElement, o: number, y = 0, sc = 1, blur = 0) {
  el.style.opacity = String(+o.toFixed(3));
  el.style.transform = y || sc !== 1 ? `translateY(${y.toFixed(2)}px) scale(${sc.toFixed(4)})` : "";
  el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
}

function paint(sh: Shown | null, t: number, k: number) {
  if (!sh) return;
  const { el, chunk, anim, mode, boxed } = sh;
  const words = el.querySelectorAll<HTMLElement>("[data-w]");
  const at = (i: number) => Math.max(chunk.s, Math.min(chunk.words[i]?.s ?? chunk.s, chunk.end - 0.1));
  const d0 = t - chunk.s;
  const keyW = (node: HTMLElement, d: number) => { const e = p3out(clamp01(d / 0.45)); setFx(node, d < 0 ? 0 : e, 0, 1.12 - 0.12 * e, 10 * (1 - e) * k); };
  const softW = (node: HTMLElement, d: number, dur: number, y: number, b: number) => { const e = p3out(clamp01(d / dur)); setFx(node, d < 0 ? 0 : e, y * (1 - e) * k, 1, b * (1 - e) * k); };
  if (boxed) {
    if (anim === "soft") keyW(el, d0);
    else setFx(el, clamp01(d0 / 0.12), 0, 0.7 + 0.3 * backOut(clamp01(d0 / 0.6)));
    words.forEach((w) => setFx(w, 1));
    return;
  }
  if (anim === "soft" && mode === "line") {
    if (chunk.key) keyW(el, d0); else softW(el, d0, 0.42, 18, 8);
    words.forEach((w) => setFx(w, 1));
    return;
  }
  setFx(el, 1);
  words.forEach((w, i) => {
    const d = t - at(i);
    if (anim === "pop") {
      const p = clamp01(d / 0.6), e = backOut(p);
      setFx(w, d < 0 ? 0 : Math.min(1, e), 0, 0.55 + 0.45 * e);
    } else if (anim === "word") setFx(w, clamp01(d / 0.05));
    else if (anim === "typewriter") {
      setFx(w, 1);
      const chars = w.querySelectorAll<HTMLElement>("[data-c]");
      const nt = i + 1 < chunk.words.length ? Math.min(at(i + 1), chunk.end) : chunk.end;
      const step = Math.max(0.012, Math.min(0.05, ((nt - at(i)) * 0.7) / Math.max(1, chars.length)));
      chars.forEach((c, j) => { c.style.opacity = d >= j * step ? "1" : "0"; });
    } else if (mode === "chars") {
      setFx(w, 1);
      const [stag, dur, y] = chunk.key ? [0.035, 0.34, 23] : [0.022, 0.3, 11];
      w.querySelectorAll<HTMLElement>("[data-c]").forEach((c, j) => {
        const dj = d - j * stag, e = (chunk.key ? p3out : p2out)(clamp01(dj / dur));
        setFx(c, dj < 0 ? 0 : e, y * (1 - e) * k);
      });
    } else if (chunk.key) keyW(w, d);
    else softW(w, d, 0.36, 14, 6);
  });
}

/* ---------- Capa de subtítulos + zoom ---------- */

function CaptionLayer({ chunks, zooms, clock, zoomEl, look, style, W }: {
  chunks: Chunk[]; zooms: Zoom[]; clock: () => number; zoomEl: RefObject<HTMLDivElement | null>;
  look: CapLook; style: PreviewStyle; W: number;
}) {
  const [idx, setIdx] = useState(-1);
  const [fontTick, setFontTick] = useState(0);
  const lineRef = useRef<HTMLDivElement>(null);
  const shown = useRef<Shown | null>(null);
  const live = useRef({ chunks, zooms, clock, k: W / 1080, idx: -1 });
  live.current = { ...live.current, chunks, zooms, clock, k: W / 1080 };
  const anim = style.caption.animation, kst = style.caption.keywordStyle;
  const chunk = idx >= 0 ? chunks[idx] : undefined;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const L = live.current, t = L.clock();
      const i = findChunk(L.chunks, t);
      if (i !== L.idx) { L.idx = i; setIdx(i); }
      paint(shown.current, t, L.k);
      if (zoomEl.current) zoomEl.current.style.transform = `scale(${zoomAt(L.zooms, t).toFixed(4)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [zoomEl]);

  // Si cambian los trozos (otro vídeo, otro nº de palabras), se vuelve a buscar el actual
  useEffect(() => { live.current.idx = -2; }, [chunks]);

  useEffect(() => {
    const f = document.fonts;
    if (!f) return;
    const on = () => setFontTick((n) => n + 1);
    f.addEventListener("loadingdone", on);
    f.ready.then(on).catch(() => {});
    return () => f.removeEventListener("loadingdone", on);
  }, []);

  const mode = anim === "soft" && chunk ? SOFT_MODES[chunk.phrase % SOFT_MODES.length] : anim === "typewriter" ? "chars" : "words";
  const boxed = !!chunk?.key && kst === "box";
  const wordStyle = !chunk?.key ? look.word : kst === "big" ? look.big : kst === "highlight" ? look.hl : look.box;
  const base = !chunk?.key ? look.base : kst === "big" ? look.bigSize : kst === "highlight" ? look.hlSize : look.base;
  const withChars = !boxed && (anim === "typewriter" || (anim === "soft" && mode === "chars"));

  // Tamaño: mejor en una línea (reduciendo hasta el 60 %); si no cabe, dos líneas. «lines: 1» reduce lo que haga falta.
  useLayoutEffect(() => {
    const el = lineRef.current;
    if (!el || !chunk) { shown.current = null; return; }
    el.style.transform = ""; el.style.fontSize = `${base}px`; el.style.flexWrap = "nowrap"; el.style.maxWidth = "none"; el.style.width = "max-content";
    const w = el.offsetWidth;
    let size = base, wrap = false;
    if (w > look.avail) {
      const f = look.avail / w;
      if (look.oneLine || f >= 0.6) size = base * f; else wrap = true;
    }
    el.style.fontSize = `${size.toFixed(2)}px`; el.style.flexWrap = wrap ? "wrap" : "nowrap"; el.style.maxWidth = `${look.avail}px`; el.style.width = "";
    shown.current = { el, chunk, anim, mode, boxed };
    paint(shown.current, live.current.clock(), W / 1080);
  }, [chunk, base, look, anim, mode, boxed, withChars, W, fontTick]);

  if (!chunk) return null;
  return (
    <div className="sp-caps" style={{ top: look.top }}>
      <div ref={lineRef} className="sp-line" style={{ ...look.line, ...(boxed ? look.boxLine : {}) }}>
        {chunk.words.map((w, i) => (
          <span key={idx + ":" + i} data-w="" className="sp-w" style={{ ...wordStyle, opacity: 0 }}>
            {withChars ? [...w.w].map((ch, j) => <span key={j} data-c="" className="sp-c" style={{ opacity: 0 }}>{ch}</span>) : w.w}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Color, grano, viñeta y franjas ---------- */

const GRADE: Record<string, { filter?: string; tint?: string }> = {
  warm: { filter: "sepia(.12) saturate(1.08)", tint: "rgba(255,150,70,.22)" },
  cool: { filter: "saturate(1.03) brightness(1.01)", tint: "rgba(70,140,255,.24)" },
  punchy: { filter: "contrast(1.1) saturate(1.16) brightness(.99)" },
  soft: { filter: "contrast(.94) saturate(.94) brightness(1.015)" },
  cinematic: { filter: "contrast(1.06) saturate(.9) brightness(.97) sepia(.06)", tint: "linear-gradient(180deg, rgba(0,120,140,.28), rgba(0,95,120,.18) 55%, rgba(255,150,80,.16))" },
};
const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>")}")`;

function LookLayers({ style }: { style: PreviewStyle }) {
  const lk = style.look;
  return (
    <>
      {lk && lk.vignette > 0 && <div className="sp-vignette" style={{ background: `radial-gradient(ellipse 75% 65% at 50% 45%, transparent 45%, rgba(0,0,0,${(Math.min(1, lk.vignette) * 0.85).toFixed(2)}) 100%)` }} />}
      {lk && lk.grain > 0 && <div className="sp-grain" style={{ backgroundImage: GRAIN, opacity: Math.min(1, lk.grain) * 0.55 }} />}
    </>
  );
}

/* ---------- Componente principal ---------- */

export default function StylePreview({ style: raw, fonts, logos, replay }: { style: EditStyle; fonts: StyleAsset[]; logos: StyleAsset[]; replay: number }) {
  const style = raw as PreviewStyle;
  const [mode, setModeState] = useState<Mode>(() => (lsGet("ps:previewMode") === "video" ? "video" : "sample"));
  const [restart, setRestart] = useState(0);
  const [W, setW] = useState(340);
  const phoneRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // vídeos
  const [list, setList] = useState<Media[] | null>(null);
  const [vid, setVid] = useState<string | null>(() => lsGet("ps:previewVideo"));
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // si el vídeo se corta al cargar (p. ej. el servidor se reinicia), se vuelve a pedir y sigue donde iba
  const [vKey, setVKey] = useState(0);
  const [vFail, setVFail] = useState(false);
  const retry = useRef({ n: 0, at: 0 });

  // ejemplo: reloj propio que se repite
  const t0 = useRef(performance.now());
  const [loop, setLoop] = useState(0);

  const setMode = (m: Mode) => { setModeState(m); lsSet("ps:previewMode", m); };

  useEffect(() => {
    const el = phoneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 340));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (mode !== "video" || list) return;
    api.media().then((l) => setList(l.filter((m) => m.kind === "video"))).catch((e) => { setList([]); setErr((e as Error).message); });
  }, [mode, list]);

  const cur = list ? list.find((m) => m.id === vid) ?? list[0] ?? null : null;
  const hasText = !!cur?.transcript?.length;
  const status = cur?.transcript_status ?? null;
  const failed = !!status && status.startsWith("error");
  const busy = !!cur && !hasText && !failed && (status === "running" || asked === cur.id);

  useEffect(() => { if (cur && cur.id !== vid) { setVid(cur.id); lsSet("ps:previewVideo", cur.id); } }, [cur, vid]);

  // Transcripción: se pregunta cada 3 s hasta que esté
  useEffect(() => {
    if (!busy || !cur) return;
    const id = cur.id;
    const iv = setInterval(() => {
      api.mediaOne(id).then((m) => {
        setList((l) => l?.map((x) => (x.id === m.id ? m : x)) ?? l);
        if (m.transcript_status === "done" || m.transcript_status?.startsWith("error")) setAsked(null);
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(iv);
  }, [busy, cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function transcribe() {
    if (!cur) return;
    setErr(null); setAsked(cur.id);
    try {
      await api.transcribe(cur.id);
      const m = await api.mediaOne(cur.id).catch(() => null);
      if (m) setList((l) => l?.map((x) => (x.id === m.id ? m : x)) ?? l);
    } catch (e) { setErr((e as Error).message); setAsked(null); }
  }

  // Repetir: todo desde el principio. Cambiar el estilo: el ejemplo vuelve a empezar (el vídeo sigue donde va).
  useEffect(() => { t0.current = performance.now(); setLoop((n) => n + 1); }, [replay, restart]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !restart) return;
    v.currentTime = 0; v.play().catch(() => {}); setPaused(false);
  }, [restart]);
  // el titular y la tarjeta del ejemplo vuelven a entrar en cada vuelta
  useEffect(() => {
    if (mode !== "sample") return;
    let last = -1;
    const iv = setInterval(() => {
      const n = Math.floor((performance.now() - t0.current) / 1000 / SAMPLE_LOOP);
      if (last >= 0 && n !== last) setLoop((x) => x + 1);
      last = n;
    }, 250);
    return () => clearInterval(iv);
  }, [mode, replay, restart]);

  const font = useCallback((slot: keyof EditStyle["fonts"]) => {
    const a = fonts.find((x) => x.id === style.fonts[slot]);
    return a ? `"${fontFamily(a)}", sans-serif` : DEFAULT_FONT[slot];
  }, [fonts, style.fonts]);

  const maxWords = Math.min(4, Math.max(1, Math.round(Number(style.caption.maxWords) || 3)));
  const useSample = mode === "sample" || !hasText;
  const transcript = cur?.transcript;
  const chunks = useMemo(() => buildChunks(useSample ? SAMPLE_WORDS : transcript ?? [], maxWords), [useSample, transcript, maxWords]);
  const zooms = useMemo(() => buildZooms(chunks, style.motion), [chunks, style.motion]);
  const look = useMemo(() => captionLook(style, W, font), [style, W, font]);

  const clock = useCallback((): number => {
    if (mode === "sample") return ((performance.now() - t0.current) / 1000) % SAMPLE_LOOP;
    const t = videoRef.current?.currentTime ?? 0;
    return hasText ? t : t % SAMPLE_LOOP;
  }, [mode, hasText]);

  const logo = style.logo ? logos.find((l) => l.id === style.logo!.id) : null;
  const up = (s: string) => (style.caption.uppercase ? s.toUpperCase() : s);
  const grade = GRADE[style.grade ?? "neutral"];
  const vars = { ["--bg" as string]: style.colors.bg, ["--acc" as string]: style.colors.accent, ["--acc2" as string]: style.colors.accent2, ["--kw" as string]: style.colors.keyword, ["--cap" as string]: style.colors.caption, ["--int" as string]: String(style.motion.intensity) };
  const showVideo = mode === "video" && !!cur;

  return (
    <>
      <div className="st-preview__head">
        <b>Vista previa</b>
        <button className="btn btn--ghost btn--sm" onClick={() => setRestart((n) => n + 1)}><Play size={13} /> Repetir</button>
      </div>
      <div className="seg sp-modes" role="tablist">
        <button type="button" className={mode === "sample" ? "is-on" : ""} onClick={() => setMode("sample")}>Ejemplo</button>
        <button type="button" className={mode === "video" ? "is-on" : ""} onClick={() => setMode("video")}>Mi vídeo</button>
      </div>

      {mode === "video" && list && list.length > 0 && cur && (
        <div className="sp-pick">
          <select className="select select--sm" value={cur.id} onChange={(e) => { setVid(e.target.value); lsSet("ps:previewVideo", e.target.value); setErr(null); setVFail(false); retry.current = { n: 0, at: 0 }; }}>
            {list.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button type="button" className="btn btn--sm btn--ghost sp-icon" onClick={() => { setMuted((m) => !m); videoRef.current?.play().catch(() => {}); }} title={muted ? "Activar sonido" : "Silenciar"}>
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
        </div>
      )}

      <div ref={phoneRef} className={"st-phone sp-phone" + (showVideo ? " sp-phone--video" : "")} style={vars}>
        <div ref={mediaRef} className="sp-media" style={{ filter: grade?.filter }}>
          {showVideo ? (
            <video
              key={cur!.id + ":" + vKey} ref={videoRef} src={cur!.url} poster={cur!.thumbUrl ?? undefined}
              autoPlay loop muted={muted} playsInline preload="auto"
              onLoadedMetadata={(e) => { if (retry.current.at) { e.currentTarget.currentTime = retry.current.at; retry.current.at = 0; } }}
              onPlaying={() => { retry.current.n = 0; setVFail(false); }}
              onError={(e) => {
                retry.current.at = e.currentTarget.currentTime || retry.current.at;
                if (retry.current.n++ < 4) setTimeout(() => setVKey((k) => k + 1), 1500); else setVFail(true);
              }}
              onClick={(e) => { const v = e.currentTarget; if (v.paused) { v.play().catch(() => {}); setPaused(false); } else { v.pause(); setPaused(true); } }}
            />
          ) : mode === "sample" ? (
            <div className="st-person" aria-hidden="true"><span className="st-head" /><span className="st-body" /><span className="st-mic" /></div>
          ) : null}
          {grade?.tint && <div className="sp-tint" style={{ background: grade.tint }} />}
        </div>
        <LookLayers style={style} />
        {style.look?.letterbox && <><div className="sp-bar sp-bar--top" /><div className="sp-bar sp-bar--bottom" /></>}

        {mode === "sample" && (
          <>
            <div key={"t" + loop} className="st-title" style={{ fontFamily: font("title") }}>{up("Cómo conseguir")} <em>{up("30 reuniones")}</em> {up("al mes")}</div>
            <div key={"g" + loop} className={"st-card st-card--" + style.cards.look} style={{ fontFamily: font("title") }}>
              <span className="st-card__ic">✓</span>
              <span><b>{up("30 reuniones")}</b><small>{up("al mes, garantizadas")}</small></span>
            </div>
          </>
        )}

        {(mode === "sample" || showVideo) && (
          <CaptionLayer key={mode + (cur?.id ?? "") + (useSample ? ":s" : ":t")} chunks={chunks} zooms={zooms} clock={clock} zoomEl={mediaRef} look={look} style={style} W={W} />
        )}
        {logo && <img className={"st-wm st-wm--" + style.logo!.position} src={logo.url} alt="" style={{ width: `${style.logo!.size * 100}%` }} />}

        {showVideo && paused && !vFail && <div className="sp-paused"><Play size={26} /></div>}
        {showVideo && vFail && (
          <div className="sp-empty">
            <p>No se puede cargar este vídeo ahora mismo.</p>
            <button className="btn btn--sm" onClick={() => { retry.current.n = 0; setVFail(false); setVKey((k) => k + 1); }}>Volver a intentarlo</button>
          </div>
        )}
        {mode === "video" && !list && <div className="sp-empty"><Loader2 size={18} className="spin" /> Cargando tus vídeos…</div>}
        {mode === "video" && list && !cur && (
          <div className="sp-empty">
            <p>Aún no tienes vídeos. Sube uno en la Biblioteca y aquí verás tu estilo encima.</p>
            <button className="btn btn--sm" onClick={() => navigate("/biblioteca")}><FolderOpen size={14} /> Ir a la Biblioteca</button>
          </div>
        )}
      </div>

      {showVideo && !hasText && (
        <div className="sp-note">
          {busy ? (
            <p><Loader2 size={13} className="spin" /> Sacando el texto de este vídeo. Puede tardar unos minutos (lo hace tu ordenador); mientras, ves el estilo con un texto de ejemplo.</p>
          ) : (
            <>
              <p>{failed ? "No se pudo sacar el texto de este vídeo. Puedes volver a intentarlo." : "Este vídeo aún no tiene texto: ahora ves un texto de ejemplo con tu estilo."}</p>
              <button className="btn btn--sm" onClick={transcribe}><Subtitles size={14} /> Transcribir para ver los subtítulos</button>
            </>
          )}
        </div>
      )}
      {err && <p className="sp-err">{err}</p>}
    </>
  );
}
