// Medidas aproximadas de texto (en «em») para que nada se corte: se calcula el tamaño en el servidor,
// sin depender de medir en el navegador (el render salta de fotograma en fotograma).

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const r3 = (n) => Math.round(n * 1000) / 1000;
export const r2 = (n) => Math.round(n * 100) / 100;

const NARROW = new Set([..."il.,;:!|'\"´`¡()[]íìjI1t f"]);
const WIDE = new Set([..."mwMW@%"]);

// Fuentes del usuario: anchos medidos (fontmetrics.js) o estimados a partir de una base, con su margen
const USER = new Map();
export function registerFont(key, metrics, base = "geist") {
  USER.set(key, metrics ? { metrics, safe: 0.9 } : { base, factor: 1.12, safe: 0.85 });
}

// Ancho de un carácter en em según la fuente (valores conservadores)
function chW(ch, font) {
  const u = USER.get(font);
  if (u) {
    if (u.metrics) {
      const w = u.metrics.widths.get(ch.codePointAt(0));
      return (w ?? u.metrics.avg) * 1.03 + 0.005;
    }
    return chW(ch, u.base) * u.factor;
  }
  if (font === "anton") {
    if (ch === " ") return 0.22;
    if (NARROW.has(ch)) return 0.27;
    if (WIDE.has(ch)) return 0.66;
    if (/[0-9]/.test(ch)) return 0.5;
    return 0.5;
  }
  // geist (sans de subtítulos y tarjetas, peso 600-800)
  if (ch === " ") return 0.29;
  if (NARROW.has(ch)) return 0.3;
  if (WIDE.has(ch)) return 0.9;
  if (/[0-9]/.test(ch)) return 0.62;
  if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) return 0.7;
  return 0.58;
}

export function textEm(text, font = "geist", spacing = 0) {
  let w = 0;
  for (const ch of String(text)) w += chW(ch, font) + spacing;
  return w;
}

// Tamaño para que quepa en una línea
// Margen de seguridad: la medida es aproximada (±4 %), mejor quedarse corto que cortar texto
const SAFE = 0.94;

const safeOf = (font) => USER.get(font)?.safe ?? SAFE;

export function fitLine(text, font, maxW, maxSize, minSize = 10, spacing = 0) {
  maxW *= safeOf(font);
  const em = textEm(text, font, spacing) || 1;
  return Math.floor(clamp(maxW / em, minSize, maxSize));
}

// Reparte en líneas (como el navegador, por palabras) a un tamaño dado
export function wrap(text, font, size, maxW, spacing = 0) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? cur + " " + w : w;
    if (!cur || textEm(cand, font, spacing) * size <= maxW) cur = cand;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Mayor tamaño (entre min y max) con el que el texto cabe en maxLines líneas de ancho maxW
export function fitWrap(text, font, maxW, maxLines, maxSize, minSize = 12, spacing = 0) {
  maxW *= safeOf(font);
  for (let s = maxSize; s >= minSize; s -= 2) {
    const lines = wrap(text, font, s, maxW, spacing);
    if (lines.length <= maxLines && lines.every((l) => textEm(l, font, spacing) * s <= maxW)) return { size: s, lines };
  }
  const lines = wrap(text, font, minSize, maxW, spacing);
  // si ni así cabe, la línea más larga marca el tamaño
  const longest = Math.max(...lines.map((l) => textEm(l, font, spacing)));
  return { size: Math.max(8, Math.floor(Math.min(minSize, maxW / longest))), lines };
}

// Número con separador de miles español: 4000 → «4.000»
export function fmtNum(n, decimals = 0) {
  const neg = n < 0;
  const fixed = Math.abs(n).toFixed(decimals);
  const [i, d] = fixed.split(".");
  const withDots = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + withDots + (d ? "," + d : "");
}

// "#6E58F1" + alfa → "rgba(110,88,241,.5)"
export function rgba(hex, a = 1) {
  let h = String(hex || "#ffffff").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Luminancia relativa y contraste WCAG entre dos HEX
export function luminance(hex) {
  let h = String(hex || "#000").replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// Oscurece (f<0) o aclara (f>0) un HEX
export function shadeHex(hex, f) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f));
  return "#" + ch.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, "0")).join("");
}
// Ajusta «fg» hasta tener contraste ≥ min sobre «bg» (oscureciendo o aclarando)
export function ensureContrast(fg, bg, min = 3) {
  let c = fg;
  const darker = luminance(bg) > 0.4;
  for (let i = 0; i < 12 && contrast(c, bg) < min; i++) c = shadeHex(c, darker ? -0.15 : 0.15);
  return c;
}
