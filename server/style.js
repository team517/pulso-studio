// Estilo de edición del usuario: fuentes, colores, subtítulos, tarjetas, animación, logo, referencias e
// instrucciones para la IA. Se aplica a todas las auto-ediciones (RenderInput.style + el plan de la IA).
import express from "express";
import multer from "multer";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { spawn } from "node:child_process";
import { db, DATA, uid, now, getSetting, setSetting } from "./db.js";
import { askClaude, canSeeImages } from "./autoedit/brain.js";
import { IS_SERVER } from "./config.js";

export const STYLE_DIR = join(DATA, "style");
mkdirSync(STYLE_DIR, { recursive: true });

db.exec(`
  CREATE TABLE IF NOT EXISTS style_assets (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, file TEXT NOT NULL, family TEXT, created_at TEXT NOT NULL
  );
`);

export const DEFAULT_STYLE = {
  fonts: { caption: null, keyword: null, title: null },          // ids de style_assets (fuentes)
  colors: { accent: "#4F8CFF", accent2: "#22D3EE", keyword: "#F2C84B", caption: "#FFFFFF", bg: "#070B18" },
  caption: { size: "m", uppercase: false, position: "auto", animation: "soft", keywordStyle: "big" },
  cards: { look: "glass" },
  motion: { intensity: 2 },
  logo: null,                                                     // { id, position, size }
  music: "auto",                                                  // auto (una por versión) | synthwave | lofi | none
  graphics: "balanced",                                           // none | few | balanced | many
  look: null,                                                     // { grain, vignette, letterbox } (cine)
  grade: "neutral",                                               // color de la imagen: neutral | warm | cool | punchy | soft | cinematic
  rules: [],                                                      // reglas concretas sacadas de un estilo guardado
  activePreset: null,                                             // estilo guardado en uso
  templates: [],                                                  // gráficos copiados de tus referencias (HTML+CSS)
  notes: "",                                                      // instrucciones para la IA
  aiNotes: "",                                                    // lo que la IA vio en las referencias
  palette: [],                                                    // colores sacados de las referencias
  rhythm: null,                                                   // { cutsPerMin } medido en los vídeos de referencia
  aiSuggested: null,                                              // lo que Claude propone tras ver las referencias
};
export const DEFAULT_AUTO = { enabled: true, kind: "variants", variants: ["reference", "headline", "minimal", "horizontal", "framed"] };

const merge = (base, over) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? { ...base[k], ...v } : v;
  return out;
};
export const getStyle = () => merge(DEFAULT_STYLE, getSetting("style:default", {}));
export const getAutoSettings = () => ({ ...DEFAULT_AUTO, ...getSetting("autoedit:auto", {}) });

const asset = (id) => (id ? db.prepare("SELECT * FROM style_assets WHERE id = ?").get(id) : null);
const assetOut = (a) => ({ ...a, url: `/files/style/${a.file}` });
const HEX = /^#[0-9a-f]{6}$/i;

/** Estilo listo para el renderizador (CONTRACT.md · RenderInput.style), con rutas absolutas. */
export function toRenderStyle() {
  const s = getStyle();
  const font = (id) => {
    const a = asset(id);
    return a && a.kind === "font" ? { family: a.family || a.name, file: join(STYLE_DIR, a.file) } : undefined;
  };
  const colors = Object.fromEntries(Object.entries(s.colors).filter(([, v]) => HEX.test(String(v))));
  const logoA = s.logo?.id ? asset(s.logo.id) : null;
  return {
    fonts: { caption: font(s.fonts.caption), keyword: font(s.fonts.keyword), title: font(s.fonts.title) },
    colors,
    caption: s.caption,
    cards: s.cards,
    motion: s.motion,
    ...(s.look ? { look: s.look } : {}),
    graphics: s.graphics, // lo usa plan.js (none = sin gráficos); el render lo ignora
    ...(Array.isArray(s.templates) && s.templates.length ? { templates: s.templates } : {}),
    logo: logoA ? { file: join(STYLE_DIR, logoA.file), position: s.logo.position || "top-right", size: Math.min(0.2, Math.max(0.06, Number(s.logo.size) || 0.1)) } : null,
  };
}

/** Indicaciones de estilo para el prompt de la IA. */
export function styleNotesForAI() {
  const s = getStyle();
  const parts = [];
  if (s.graphics === "none") parts.push("SIN GRÁFICOS: nada de tarjetas, iconos, escenas ni palabras detrás de la cabeza. Solo subtítulos y zooms (graphics y behind vacíos).");
  if (s.graphics === "few") parts.push("Pocos gráficos: como mucho 2-3 en todo el vídeo, solo donde aporten un dato que NO dice el subtítulo.");
  if (s.graphics === "many") parts.push("Muchos gráficos: casi cada idea con su gráfico, ritmo alto.");
  if (s.caption.uppercase) parts.push("Los textos de pantalla van en MAYÚSCULAS.");
  if (Array.isArray(s.templates) && s.templates.length && s.graphics !== "none") {
    parts.push(`GRÁFICOS COPIADOS DE TUS REFERENCIAS (úsalos EN VEZ de card/checklist/stat cuando encajen; mismo diseño que el original): `
      + s.templates.map((t) => `{"type":"custom","tpl":"${t.id}","from":i,"to":j,${t.hasIcon ? `"icon":"${t.icon || "star"}",` : ""}"fields":{${t.fields.map((f) => `"${f.key}":"máx. ${f.max} letras, p. ej. ${f.example}"`).join(",")}}} → ${t.name}${t.use ? ` (${t.use})` : ""}`).join(" · "));
  }
  if (s.caption.maxWords) parts.push(`Subtítulos de ${s.caption.maxWords} palabra(s) como máximo por chunk.`);
  if (s.motion?.zoomStyle === "punch") parts.push("Zooms de golpe al empezar algunas frases (como cortes de cámara), no zooms lentos.");
  if (s.motion?.zoomStyle === "none") parts.push("Sin zooms.");
  if (Array.isArray(s.rules) && s.rules.length) parts.push("Reglas del estilo elegido (calcarlas):\n- " + s.rules.join("\n- "));
  if (s.aiNotes) parts.push("Estilo visto en sus referencias: " + s.aiNotes);
  if (s.rhythm?.cutsPerMin) parts.push(`Ritmo de sus referencias: unos ${s.rhythm.cutsPerMin} cambios visuales por minuto (cortes, gráficos o zooms): mantén ese ritmo, un estímulo nuevo cada ~${Math.max(1.5, Math.round(600 / s.rhythm.cutsPerMin) / 10)} s.`);
  if (s.notes) parts.push("Instrucciones del usuario (obligatorias): " + s.notes);
  return parts.join("\n");
}

/* ---------- Colores de las referencias (medidos, no adivinados) ---------- */

function rawPixels(file, isVideo) {
  return new Promise((resolve) => {
    const args = isVideo
      ? ["-v", "error", "-i", file, "-vf", "fps=1/2,scale=48:48:flags=area", "-frames:v", "12", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
      : ["-v", "error", "-i", file, "-vf", "scale=64:64:flags=area", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"];
    const p = spawn("ffmpeg", args, { windowsHide: true });
    const out = [];
    p.stdout.on("data", (d) => out.push(d));
    p.on("close", () => resolve(Buffer.concat(out)));
    p.on("error", () => resolve(Buffer.alloc(0)));
  });
}

const toHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
function sat(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function hue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

/** Agrupa los píxeles en cubos de color y devuelve los más frecuentes (con su peso). */
export async function extractPalette(files) {
  const buckets = new Map();
  for (const f of files) {
    const buf = await rawPixels(f.path, f.video);
    for (let i = 0; i + 2 < buf.length; i += 3) {
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      buckets.set(key, e);
    }
  }
  const total = [...buckets.values()].reduce((a, e) => a + e.n, 0) || 1;
  const colors = [...buckets.values()].map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, w: e.n / total }))
    .sort((a, b) => b.w - a.w);
  // Quitar colores casi iguales
  const picked = [];
  for (const c of colors) {
    if (picked.some((p) => Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) < 60)) continue;
    picked.push(c);
    if (picked.length >= 10) break;
  }
  const palette = picked.map((c) => ({ hex: toHex(c.r, c.g, c.b), weight: +c.w.toFixed(3), sat: +sat(c.r, c.g, c.b).toFixed(2), lum: Math.round(lum(c.r, c.g, c.b)), hue: hue(c.r, c.g, c.b) }));
  // Los colores de los gráficos ocupan poco: se buscan aparte entre los píxeles muy saturados (sin tonos de piel)
  const vividBuckets = new Map();
  for (const [, e] of buckets) {
    const r = e.r / e.n, g = e.g / e.n, b = e.b / e.n;
    const s = sat(r, g, b), h = hue(r, g, b), l = lum(r, g, b);
    const skin = h >= 5 && h <= 45 && s < 0.7;
    if (s < 0.45 || l < 35 || skin) continue;
    const key = Math.round(h / 20);
    const v = vividBuckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    v.n += e.n; v.r += e.r; v.g += e.g; v.b += e.b;
    vividBuckets.set(key, v);
  }
  const vivid = [...vividBuckets.values()].map((v) => ({ hex: toHex(v.r / v.n, v.g / v.n, v.b / v.n), n: v.n, sat: sat(v.r / v.n, v.g / v.n, v.b / v.n), lum: lum(v.r / v.n, v.g / v.n, v.b / v.n), hue: hue(v.r / v.n, v.g / v.n, v.b / v.n) }))
    .sort((a, b) => b.n * b.sat - a.n * a.sat);
  for (const v of vivid.slice(0, 4)) if (!palette.some((p) => p.hex === v.hex)) palette.push({ hex: v.hex, weight: +(v.n / total).toFixed(4), sat: +v.sat.toFixed(2), lum: Math.round(v.lum), hue: v.hue });
  // Propuesta: fondo = el oscuro más frecuente; acento = el vivo más presente; palabra clave = el vivo cálido (amarillo/naranja) si hay
  const dark = palette.filter((c) => c.lum < 60).sort((a, b) => b.weight - a.weight)[0];
  const cool = vivid.filter((c) => c.hue >= 160 && c.hue <= 300);
  const warm = vivid.find((c) => c.hue >= 35 && c.hue <= 65 && c.lum > 120);
  const accent = cool[0] || vivid[0];
  const accent2 = (cool[1] || vivid.find((c) => c !== accent && c !== warm));
  return {
    palette,
    suggestion: {
      ...(dark ? { bg: dark.hex } : {}),
      ...(accent ? { accent: accent.hex } : {}),
      ...(accent2 ? { accent2: accent2.hex } : {}),
      ...(warm ? { keyword: warm.hex } : {}),
    },
  };
}

/* ---------- Rutas ---------- */

const upload = multer({
  storage: multer.diskStorage({
    destination: STYLE_DIR,
    filename: (req, file, cb) => cb(null, uid() + (extname(file.originalname) || "").toLowerCase()),
  }),
  limits: { fileSize: 600 * 1024 * 1024 },
});

const FONT_EXT = [".ttf", ".otf", ".woff", ".woff2"];
const IMG_EXT = [".png", ".jpg", ".jpeg", ".webp", ".svg"];
const VID_EXT = [".mp4", ".mov", ".m4v", ".webm"];

export async function lookAtReferences() {
  const refs = db.prepare("SELECT * FROM style_assets WHERE kind = 'reference'").all();
  const files = refs.map((r) => ({ path: join(STYLE_DIR, r.file), video: VID_EXT.includes(extname(r.file).toLowerCase()) })).filter((f) => existsSync(f.path));
  let aiNotes = "";
  let seen = false;
  if (files.length && (await canSeeImages())) {
    // Fotogramas de los vídeos de referencia (los primeros 6 de cada uno) + las imágenes
    const shots = [];
    const tmp = join(STYLE_DIR, "_analisis");
    mkdirSync(tmp, { recursive: true });
    for (const [k, f] of files.entries()) {
      if (!f.video) { shots.push(f.path); continue; }
      await new Promise((r) => { const p = spawn("ffmpeg", ["-v", "error", "-y", "-i", f.path, "-vf", "fps=1/3,scale=-2:720", "-frames:v", "6", join(tmp, `ref${k}-%02d.jpg`)], { windowsHide: true }); p.on("close", r); p.on("error", r); });
      for (let i = 1; i <= 6; i++) { const s = join(tmp, `ref${k}-${String(i).padStart(2, "0")}.jpg`); if (existsSync(s)) shots.push(s); }
    }
    try {
      const r = await askClaude(`Eres director de arte de reels. Mira estas capturas de referencia y describe su ESTILO DE EDICIÓN con valores concretos para copiarlo: tipografías (tipo, grosor, mayúsculas), subtítulos (tamaño relativo, posición, cuántas palabras, cómo resaltan la palabra clave), tarjetas/gráficos (forma, color, transparencia, iconos), animaciones que se intuyen, colores y ritmo. Responde SOLO con JSON: {"notes":"descripción breve y accionable en español (máx. 900 caracteres)","caption":{"size":"s|m|l","uppercase":true|false,"position":"auto|high|low","keywordStyle":"big|highlight|box"},"cards":{"look":"glass|solid|light"},"motion":{"intensity":1|2|3}}`,
        { images: shots.slice(0, 18), dir: STYLE_DIR, timeoutMs: 6 * 60e3 });
      aiNotes = String(r.notes || "").slice(0, 900);
      seen = true;
      const cur = getSetting("style:default", {});
      setSetting("style:default", { ...cur, aiNotes, aiSuggested: { caption: r.caption, cards: r.cards, motion: r.motion } });
    } catch (e) {
      aiNotes = "";
      console.warn("[estilo] análisis visual falló:", e.message);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { aiNotes, seen };
}

export function registerStyleRoutes(app, wrap) {
  app.use("/files/style", express.static(STYLE_DIR, { maxAge: "1h" }));

  app.get("/api/style", wrap((req, res) => {
    res.json({
      style: getStyle(),
      auto: getAutoSettings(),
      assets: db.prepare("SELECT * FROM style_assets ORDER BY created_at DESC").all().map(assetOut),
    });
  }));

  app.put("/api/style", wrap((req, res) => {
    const cur = getSetting("style:default", {});
    // Lo que sale del análisis (colores medidos, ritmo, lo que vio Claude) no lo pisa el guardado automático de la página
    const { palette, rhythm, aiNotes, aiSuggested, ...incoming } = req.body?.style || {};
    void palette; void rhythm; void aiNotes; void aiSuggested;
    const next = merge(merge(DEFAULT_STYLE, cur), incoming);
    next.notes = String(next.notes || "").slice(0, 2000);
    setSetting("style:default", next);
    if (req.body?.auto) setSetting("autoedit:auto", { ...getAutoSettings(), ...req.body.auto });
    res.json({ style: getStyle(), auto: getAutoSettings() });
  }));

  app.post("/api/style/assets", upload.array("files", 30), wrap((req, res) => {
    const out = [];
    for (const f of req.files || []) {
      const ext = extname(f.filename).toLowerCase();
      const name = Buffer.from(f.originalname, "latin1").toString("utf8");
      let kind = String(req.body.kind || "");
      if (!kind) kind = FONT_EXT.includes(ext) ? "font" : "reference";
      const ok = (kind === "font" && FONT_EXT.includes(ext)) || (kind === "logo" && IMG_EXT.includes(ext)) || (kind === "reference" && [...IMG_EXT, ...VID_EXT].includes(ext));
      if (!ok) { rmSync(join(STYLE_DIR, f.filename), { force: true }); continue; }
      // Nombre de la familia: el del archivo sin la extensión ni sufijos de peso
      const family = kind === "font" ? basename(name, extname(name)).replace(/[-_ ]?(regular|bold|black|medium|semibold|light|italic|\d{3})$/i, "").replace(/[-_]+/g, " ").trim() || "Mi fuente" : null;
      const id = f.filename.replace(/\.[^.]+$/, "");
      db.prepare("INSERT INTO style_assets (id, kind, name, file, family, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, kind, name, f.filename, family, now());
      out.push(assetOut(db.prepare("SELECT * FROM style_assets WHERE id = ?").get(id)));
    }
    res.json(out);
  }));

  app.delete("/api/style/assets/:id", wrap((req, res) => {
    const a = asset(req.params.id);
    if (a) {
      rmSync(join(STYLE_DIR, a.file), { force: true });
      db.prepare("DELETE FROM style_assets WHERE id = ?").run(a.id);
      // Si estaba en uso, se quita del estilo
      const s = getSetting("style:default", {});
      if (s.fonts) for (const k of Object.keys(s.fonts)) if (s.fonts[k] === a.id) s.fonts[k] = null;
      if (s.logo?.id === a.id) s.logo = null;
      setSetting("style:default", s);
    }
    res.json({ ok: true });
  }));

  // Analizar las referencias: colores medidos y, si la IA puede ver imágenes, cómo es el estilo
  app.post("/api/style/analyze", wrap(async (req, res) => {
    const refs = db.prepare("SELECT * FROM style_assets WHERE kind = 'reference'").all();
    if (!refs.length) throw Object.assign(new Error("Sube primero alguna referencia (capturas o vídeos de reels que te gusten)."), { status: 400 });
    const files = refs.map((r) => ({ path: join(STYLE_DIR, r.file), video: VID_EXT.includes(extname(r.file).toLowerCase()) })).filter((f) => existsSync(f.path));
    const { palette, suggestion } = await extractPalette(files);
    // Ritmo de edición: cambios de plano por minuto en los vídeos de referencia
    let rhythm = null;
    const vids = files.filter((f) => f.video);
    if (vids.length) {
      let cuts = 0, secs = 0;
      for (const v of vids) {
        const err = await new Promise((resolve) => {
          const p = spawn("ffmpeg", ["-hide_banner", "-i", v.path, "-vf", "scale=320:-2,select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"], { windowsHide: true });
          const out = [];
          p.stderr.on("data", (d) => out.push(d));
          p.on("close", () => resolve(Buffer.concat(out).toString("utf8")));
          p.on("error", () => resolve(""));
        });
        cuts += (err.match(/pts_time:/g) || []).length;
        const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
        if (d) secs += Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
      }
      if (secs > 3) rhythm = { cutsPerMin: Math.round((cuts / secs) * 60), seconds: Math.round(secs) };
    }
    let aiNotes = "";
    let seen = false;
    let pending = false;
    if (IS_SERVER) {
      // Claude está en el PC: se le pide que mire las referencias en cuanto pueda
      setSetting("worker:analyzeReq", Date.now());
      pending = true;
    } else {
      ({ aiNotes, seen } = await lookAtReferences());
    }
    const cur = getSetting("style:default", {});
    setSetting("style:default", { ...cur, palette, ...(rhythm ? { rhythm } : {}) });
    const saved = getSetting("style:default", {});
    res.json({ palette, suggestion, aiNotes, seen, pending, rhythm, aiSuggested: saved.aiSuggested ?? null, style: getStyle() });
  }));
}
