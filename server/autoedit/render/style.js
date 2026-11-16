// Estilo de edición del usuario (RenderInput.style). Sin estilo, todo vale lo de siempre (salida idéntica).
// resolveStyle() se llama una vez por render; el resto de módulos leen el estilo activo con S().
import fs from "node:fs";
import path from "node:path";
import { measureFont } from "./fontmetrics.js";
import { registerFont, ensureContrast, contrast, luminance, r3 } from "./text.js";

const DEFAULT = {
  user: false,
  fonts: {
    caption: { key: "geist", css: `"Geist", "Rajdhani", sans-serif`, weight: 600 },
    keyword: { key: "anton", css: `"Anton", sans-serif`, weight: 400 },
    title: { key: "geist", css: `"Geist", "Rajdhani", sans-serif`, weight: 700 },
  },
  faces: [], files: [],
  colors: { caption: "#ffffff" },
  caption: { scale: 1, uppercase: null, position: "auto", animation: "soft", keywordStyle: "big",
    // v2 (calcar una referencia): null = lo de siempre
    yPct: null, weight: null, stroke: null, shadow: null, bg: null, letterSpacing: null, lines: null,
    keywordColor: null, keywordScale: 1, keywordFont: null },
  look: "glass",
  motion: { level: 2, spring: 1, dist: 1, zoom: 1, zoomDur: 1, zoomStyle: "smooth", zoomMax: null },
  fx: { grain: 0, vignette: 0, letterbox: false }, // aspecto de cine (UserStyle.look)
  logo: null,
};

let CUR = DEFAULT;
export const S = () => CUR;
export function setStyle(st) { CUR = st || DEFAULT; }

const FMT = { ".ttf": "truetype", ".otf": "opentype", ".woff": "woff", ".woff2": "woff2" };

// Une el estilo del usuario con el tema; devuelve { style, theme }
export function resolveStyle(input) {
  const u = input.style;
  const theme = { ...input.theme };
  if (!u || typeof u !== "object") return { style: DEFAULT, theme };
  const st = JSON.parse(JSON.stringify({ ...DEFAULT, faces: [], files: [] }));
  st.user = true;

  // fuentes: se copian dentro del proyecto y se miden (si no se puede, se estima con más margen)
  for (const role of ["caption", "keyword", "title"]) {
    const f = u.fonts?.[role];
    if (!f?.file || !fs.existsSync(f.file)) continue;
    const ext = path.extname(f.file).toLowerCase();
    if (!FMT[ext]) continue;
    const family = `U${role[0].toUpperCase()}${role.slice(1)}`; // nombre interno sin espacios ni comillas
    const key = `user-${role}`;
    registerFont(key, measureFont(f.file), role === "keyword" ? "anton" : "geist");
    const weight = Number(f.weight) || (role === "keyword" ? 400 : 700);
    st.files.push({ from: f.file, to: `user-${role}${ext}` });
    st.faces.push(`@font-face { font-family: "${family}"; src: url("assets/fonts/user-${role}${ext}") format("${FMT[ext]}"); font-weight: 100 900; font-display: block; }`);
    const fallback = role === "keyword" ? `"Anton", sans-serif` : `"Geist", sans-serif`;
    st.fonts[role] = { key, css: `"${family}", ${fallback}`, weight, user: true };
  }

  // colores: mandan sobre el tema
  const c = u.colors || {};
  if (hex(c.accent)) theme.accent = hex(c.accent);
  if (hex(c.accent2)) theme.accent2 = hex(c.accent2);
  if (hex(c.keyword)) theme.gold = hex(c.keyword);
  if (hex(c.bg)) theme.bg = hex(c.bg);
  if (hex(c.caption)) st.colors.caption = hex(c.caption);
  // contraste: el texto sobre el color de acento (iconos, píldora de karaoke, caja de palabra clave)
  st.colors.onAccent = contrast("#ffffff", theme.accent) >= 2.6 ? "#ffffff" : "#111318";
  st.colors.onKeyword = contrast("#ffffff", theme.gold) >= 3 ? "#ffffff" : "#111318";
  // subtítulo oscuro sobre vídeo: sombra clara en vez de oscura
  st.colors.captionShadow = luminance(st.colors.caption) < 0.25
    ? "0 0 14px rgba(255,255,255,.85), 0 1px 3px rgba(255,255,255,.9)"
    : null;

  const cap = u.caption || {};
  st.caption.scale = { s: 0.82, m: 1, l: 1.2 }[cap.size] || 1;
  st.caption.uppercase = typeof cap.uppercase === "boolean" ? cap.uppercase : null;
  st.caption.position = ["auto", "high", "low"].includes(cap.position) ? cap.position : "auto";
  st.caption.animation = ["soft", "pop", "typewriter", "word"].includes(cap.animation) ? cap.animation : "soft";
  st.caption.keywordStyle = ["big", "highlight", "box"].includes(cap.keywordStyle) ? cap.keywordStyle : "big";
  // v2: copiar al detalle los subtítulos de una referencia (todo opcional; lo que no venga, como siempre)
  if (num(cap.scale) != null) st.caption.scale = clampN(num(cap.scale), 0.35, 1.8);
  if (num(cap.yPct) != null) st.caption.yPct = clampN(num(cap.yPct), 0.12, 0.86);
  if (num(cap.weight) != null) st.caption.weight = Math.round(clampN(num(cap.weight), 100, 900) / 100) * 100;
  if (cap.stroke && typeof cap.stroke === "object" && hex(cap.stroke.color) && num(cap.stroke.width) > 0) {
    st.caption.stroke = { color: hex(cap.stroke.color), width: clampN(num(cap.stroke.width), 0.5, 16) };
  }
  if (["none", "soft", "strong"].includes(cap.shadow)) st.caption.shadow = cap.shadow;
  if (cap.bg && typeof cap.bg === "object" && hex(cap.bg.color)) {
    const op = num(cap.bg.opacity) ?? 0.6;
    if (op > 0) st.caption.bg = { color: hex(cap.bg.color), opacity: clampN(op, 0.05, 1), radius: clampN(num(cap.bg.radius) ?? 10, 0, 60) };
  }
  if (num(cap.letterSpacing) != null) st.caption.letterSpacing = clampN(num(cap.letterSpacing), -0.1, 0.3);
  if ([1, 2].includes(Number(cap.lines))) st.caption.lines = Number(cap.lines);
  if (hex(cap.keywordColor)) st.caption.keywordColor = hex(cap.keywordColor);
  if (num(cap.keywordScale) != null) st.caption.keywordScale = clampN(num(cap.keywordScale), 0.6, 2);
  if (["same", "keyword"].includes(cap.keywordFont)) st.caption.keywordFont = cap.keywordFont;
  if (num(cap.inMs) != null) st.caption.inMs = clampN(num(cap.inMs), 30, 1500); // cuánto tarda en entrar cada palabra (medido)

  st.look = ["glass", "solid", "light"].includes(u.cards?.look) ? u.cards.look : "glass";
  // Gráficos copiados de tus referencias (plantillas HTML+CSS ya limpiadas al analizarlas)
  st.templates = (Array.isArray(u.templates) ? u.templates : []).filter((t) => t && /^[\w-]+$/.test(String(t.id)) && typeof t.html === "string" && typeof t.css === "string").slice(0, 12);
  if (st.look === "light") st.colors.keywordOnLight = ensureContrast(theme.gold, "#ffffff", 3);

  const lv = [1, 2, 3].includes(Number(u.motion?.intensity)) ? Number(u.motion.intensity) : 2;
  st.motion = {
    level: lv,
    spring: { 1: 0.5, 2: 1, 3: 1.6 }[lv],
    dist: { 1: 0.6, 2: 1, 3: 1.45 }[lv],
    zoom: { 1: 0.55, 2: 1, 3: 1.4 }[lv],
    zoomDur: { 1: 1.2, 2: 1, 3: 0.8 }[lv],
    // smooth = zooms suaves (actual); punch = saltos de escala al instante (reels de cortes); none = sin zooms
    zoomStyle: ["smooth", "punch", "none"].includes(u.motion?.zoomStyle) ? u.motion.zoomStyle : "smooth",
    zoomMax: num(u.motion?.zoomMax) != null ? clampN(num(u.motion.zoomMax), 1, 1.25) : null,
  };

  // aspecto de cine: grano, viñeta y franjas negras (UserStyle.look; nada que ver con cards.look)
  const lk = u.look && typeof u.look === "object" ? u.look : {};
  st.fx = {
    grain: num(lk.grain) != null ? r3(clampN(num(lk.grain), 0, 1)) : 0,
    vignette: num(lk.vignette) != null ? r3(clampN(num(lk.vignette), 0, 1)) : 0,
    letterbox: lk.letterbox === true,
  };

  if (u.logo?.file && fs.existsSync(u.logo.file)) {
    const ext = path.extname(u.logo.file).toLowerCase();
    if ([".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(ext)) {
      st.logo = {
        file: u.logo.file, ext,
        position: ["top-left", "top-right", "bottom-left", "bottom-right"].includes(u.logo.position) ? u.logo.position : "top-right",
        size: Math.min(0.2, Math.max(0.06, Number(u.logo.size) || 0.1)),
      };
    }
  }
  return { style: st, theme };
}

// HEX válido («#abc», «abc», «#aabbcc») → con «#»; si no, null
function hex(v) {
  return typeof v === "string" && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v.trim()) ? (v.trim().startsWith("#") ? v.trim() : "#" + v.trim()) : null;
}
// número finito o null
function num(v) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

// Muelle VB con la fuerza escalada por la intensidad (con 2 queda el texto de siempre)
export const vb = (f) => `VB(${r3(f * S().motion.spring)})`;
export const IN = () => `duration: 1.1, ease: ${vb(0.07)}`;
export const IN_SOFT = () => `duration: 1.1, ease: ${vb(0.045)}`;
export const dist = (px) => r3(px * S().motion.dist);
