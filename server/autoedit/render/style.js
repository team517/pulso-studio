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
  caption: { scale: 1, uppercase: null, position: "auto", animation: "soft", keywordStyle: "big" },
  look: "glass",
  motion: { level: 2, spring: 1, dist: 1, zoom: 1, zoomDur: 1 },
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
  const hex = (v) => (typeof v === "string" && /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v.trim()) ? (v.trim().startsWith("#") ? v.trim() : "#" + v.trim()) : null);
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

  st.look = ["glass", "solid", "light"].includes(u.cards?.look) ? u.cards.look : "glass";
  if (st.look === "light") st.colors.keywordOnLight = ensureContrast(theme.gold, "#ffffff", 3);

  const lv = [1, 2, 3].includes(Number(u.motion?.intensity)) ? Number(u.motion.intensity) : 2;
  st.motion = {
    level: lv,
    spring: { 1: 0.5, 2: 1, 3: 1.6 }[lv],
    dist: { 1: 0.6, 2: 1, 3: 1.45 }[lv],
    zoom: { 1: 0.55, 2: 1, 3: 1.4 }[lv],
    zoomDur: { 1: 1.2, 2: 1, 3: 0.8 }[lv],
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

// Muelle VB con la fuerza escalada por la intensidad (con 2 queda el texto de siempre)
export const vb = (f) => `VB(${r3(f * S().motion.spring)})`;
export const IN = () => `duration: 1.1, ease: ${vb(0.07)}`;
export const IN_SOFT = () => `duration: 1.1, ease: ${vb(0.045)}`;
export const dist = (px) => r3(px * S().motion.dist);
