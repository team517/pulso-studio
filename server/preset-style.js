// Convierte un estilo de subtítulo encontrado en un vídeo (lo que Claude leyó + lo medido) en los ajustes
// del render (caption, colores, fuentes). Lo usan el análisis (PC) y el servidor (al elegir otro subtítulo).

const clamp = (v, a, b, d) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Number(v))) : d);
export const HEX = (v) => (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v.trim()) ? ("#" + v.trim().replace(/^#/, "")).toUpperCase() : undefined);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

/** Tamaño de letra (px a 1080 de lado corto) a partir de lo que mide el texto en el fotograma. */
export function fontPxFrom(s, frame) {
  const W = frame?.width || 1080, H = frame?.height || 1920, short = Math.min(W, H);
  const cap = Number(s.capHeightPct);
  if (cap > 0 && cap < 0.3) return (cap * H) / 0.7 * (1080 / short); // las mayúsculas miden ~0,7 em
  const line = Number(s.lineHeightPct);
  if (line > 0 && line < 0.4) return (line * H) / 1.15 * (1080 / short);
  return 56;
}

/** Ajustes de subtítulo del render a partir del estilo elegido (y el de palabra clave, si hay). */
export function captionFrom(sub, kw) {
  const s = sub?.spec || {};
  const k = kw?.spec || null;
  const px = Number(sub?.fontPx) || 56;
  const anim = sub?.animation?.type;
  const caption = {
    size: "m",
    position: "auto",
    uppercase: !!s.uppercase,
    animation: oneOf(anim, ["soft", "pop", "typewriter", "word"], "soft"),
    keywordStyle: k ? (k.bg ? "box" : (Number(kw.fontPx) || px) > px * 1.25 ? "big" : "highlight") : oneOf(s.keywordStyle, ["big", "highlight", "box"], "highlight"),
    yPct: +clamp(s.yPct, 0.08, 0.92, 0.72).toFixed(3),
    scale: +clamp(px / 56, 0.35, 1.8, 1).toFixed(2),
    weight: clamp(sub?.font?.weight ?? s.font?.weight, 100, 900, 700),
    maxWords: clamp(s.maxWords, 1, 6, 2) | 0,
    lines: clamp(s.lines, 1, 2, 1) | 0,
    stroke: s.stroke && HEX(s.stroke.color) && Number(s.stroke.width) > 0 ? { color: HEX(s.stroke.color), width: clamp(s.stroke.width, 0, 20, 4) } : null,
    shadow: oneOf(s.shadow, ["none", "soft", "strong"], "soft"),
    bg: s.bg && HEX(s.bg.color) ? { color: HEX(s.bg.color), opacity: clamp(s.bg.opacity, 0, 1, 0.6), radius: clamp(s.bg.radius, 0, 40, 8) } : null,
    letterSpacing: clamp(s.letterSpacing, -0.05, 0.2, 0),
    keywordColor: HEX(k?.color) || HEX(s.keywordColor),
    keywordScale: k ? +clamp((Number(kw.fontPx) || px) / px, 0.8, 1.8, 1).toFixed(2) : 1,
    keywordFont: k && kw.font?.family && kw.font.family !== sub?.font?.family ? "keyword" : "same",
  };
  // Cuánto tarda en entrar cada palabra (medido en la tira de fotogramas)
  const ms = Number(sub?.animation?.inMs);
  if (ms > 0) caption.inMs = caption.animation === "word" ? (ms <= 300 ? ms : 120) : caption.animation === "pop" ? Math.min(900, Math.max(200, ms)) : ms;
  const colors = {};
  if (HEX(s.color)) colors.caption = HEX(s.color);
  if (caption.keywordColor) colors.keyword = caption.keywordColor;
  const fonts = {
    caption: sub?.font?.assetId || null,
    keyword: (caption.keywordFont === "keyword" ? kw?.font?.assetId : sub?.font?.assetId) || null,
    title: sub?.font?.assetId || null,
  };
  return { caption, colors, fonts };
}

/** Elige por defecto: el subtítulo que más sale y, si hay, la palabra clave que más sale. */
export function defaultChoice(subs) {
  const by = (role) => subs.filter((x) => x.role === role).sort((a, b) => (b.count || 0) - (a.count || 0))[0] || null;
  const subtitle = by("subtitle") || by("keyword") || by("title") || subs[0] || null;
  const keyword = by("keyword");
  return { subtitle: subtitle?.id || null, keyword: keyword && keyword.id !== subtitle?.id ? keyword.id : null };
}

/** Aplica la elección al estilo del preset (devuelve un estilo nuevo). */
export function withChoice(style, subs, choice) {
  const sub = subs.find((x) => x.id === choice.subtitle);
  if (!sub) return style;
  const kw = choice.keyword ? subs.find((x) => x.id === choice.keyword) : null;
  const c = captionFrom(sub, kw);
  return {
    ...style,
    caption: { ...(style.caption || {}), ...c.caption },
    colors: { ...(style.colors || {}), ...c.colors },
    fonts: { ...(style.fonts || {}), ...Object.fromEntries(Object.entries(c.fonts).filter(([, v]) => v)) },
  };
}
