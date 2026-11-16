// Animaciones a pantalla completa diseñadas por Claude para cada vídeo (no plantillas):
// Claude escribe la escena (HTML + CSS que se adapta a 9:16, 4:5 y 16:9) y su animación como una lista de
// movimientos; se le hace una foto en 3 momentos con el navegador del render y Claude la corrige mirándolas.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanHtml, cleanCss } from "./gfx-template.js";
import { icon, ICONS } from "./autoedit/render/icons.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const GSAP = join(HERE, "..", "node_modules", "gsap", "dist", "gsap.min.js");
const PROPS = new Set(["opacity", "x", "y", "xPercent", "yPercent", "scale", "scaleX", "scaleY", "rotation", "rotationX", "rotationY", "skewX", "filter", "clipPath", "color", "backgroundColor", "borderRadius", "letterSpacing", "transformOrigin"]);
const EASES = /^(none|linear|power[1-4]\.(in|out|inOut)|sine\.(in|out|inOut)|expo\.(in|out|inOut)|circ\.(in|out|inOut)|back\.(in|out|inOut)(\(\d(\.\d+)?\))?|elastic\.out(\([\d.,]+\))?)$/;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Limpia lo que devuelve Claude: HTML/CSS seguros, movimientos con propiedades conocidas, tiempos dentro de la escena. */
export function normalizeMotion(m, dur) {
  if (!m || typeof m.html !== "string") return null;
  let html = cleanHtml(m.html).replace(/\{\{\s*icon:([a-z-]+)\s*\}\}/g, (_, n) => icon(ICONS[n] ? n : "star"));
  if (!/class\s*=\s*["'][^"']*\bm\b/.test(html)) html = `<div class="m">${html}</div>`;
  const val = (v) => (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length < 120 && !/[<>;{}]|url\(|expression|javascript/i.test(v));
  const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => PROPS.has(k) && val(v)));
  const tweens = (Array.isArray(m.tweens) ? m.tweens : []).slice(0, 80).map((t) => ({
    sel: String(t.sel || ""),
    from: clean(t.from), to: clean(t.to),
    at: Math.min(Math.max(0, Number(t.at) || 0), Math.max(0, dur - 0.1)),
    dur: Math.min(Math.max(0.05, Number(t.dur) || 0.5), dur),
    ease: EASES.test(String(t.ease || "")) ? String(t.ease) : "power3.out",
    stagger: Math.min(0.5, Math.max(0, Number(t.stagger) || 0)),
  })).filter((t) => /^\.(mx-)?m(\s+[.#]?[\w-]+(\s*[.#][\w-]+)*)*(\s*,\s*\.m(\s+[.#]?[\w-]+)*)*$/.test(t.sel.trim()) && (Object.keys(t.to).length || Object.keys(t.from).length));
  // Nombres propios (mx-…) para no chocar con las clases de los demás gráficos del render
  let css = cleanCss(m.css);
  const names = new Set();
  for (const mm of html.matchAll(/class\s*=\s*["']([^"']+)["']/g)) for (const c of mm[1].split(/\s+/)) if (c && c !== "ico" && !c.startsWith("mx-")) names.add(c);
  // Una sola pasada: cada «.clase» conocida pasa a «.mx-clase» (sin tocar valores como 0.5 ni otras palabras)
  const reName = (txt) => txt.replace(/\.([A-Za-z_][\w-]*)/g, (all, n) => (names.has(n) ? `.mx-${n}` : all));
  html = html.replace(/class\s*=\s*(["'])([^"']+)\1/g, (_, q, v) => `class=${q}${v.split(/\s+/).map((c) => (names.has(c) ? `mx-${c}` : c)).join(" ")}${q}`);
  css = reName(css);
  for (const t of tweens) t.sel = reName(t.sel);
  return { html, css, tweens, bg: m.bg === "video" ? "video" : "solid", note: String(m.note || "").slice(0, 200) };
}

/** Las líneas de animación (gsap) de una escena, con selectores LITERALES dentro de #id. */
export function motionTweens(design, id, start) {
  return design.tweens.map((t) => {
    const sel = t.sel.split(",").map((x) => `#${id} ${x.trim()}`).join(", ");
    const to = { ...t.to, duration: t.dur, ease: t.ease, ...(t.stagger ? { stagger: t.stagger } : {}) };
    return Object.keys(t.from).length
      ? `gtl.fromTo(${JSON.stringify(sel)}, ${JSON.stringify(t.from)}, ${JSON.stringify(to)}, ${(start + t.at).toFixed(3)});`
      : `gtl.to(${JSON.stringify(sel)}, ${JSON.stringify(to)}, ${(start + t.at).toFixed(3)});`;
  });
}

/** CSS de la escena encerrado en su caja (con unidades de contenedor: cqw/cqh/cqmin se adaptan a cada formato). */
export function motionCss(design, id) {
  return `#${id} .mwrap { position: absolute; inset: 0; container-type: size; overflow: hidden; }\n#${id} .mwrap { ${design.css} }`;
}

const PROMPT = ({ brief, texts, dur, style, words }) => `Eres un motion designer top (estilo anuncios de Apple / reels de agencia). Diseña UNA animación a PANTALLA COMPLETA de ${dur.toFixed(1)} s para este momento de un reel, mientras la persona dice: «${words}».

Qué tiene que contar: ${brief}
Textos que deben salir (cortos, tal cual o mejor): ${JSON.stringify(texts)}

Estilo de la marca (respétalo):
- Fuentes: var(--f-title) (textos), var(--f-keyword) (cifras y palabras de impacto). Colores: var(--accent) ${style.accent}, var(--accent2) ${style.accent2}, var(--gold) ${style.gold}, fondo ${style.bg}.
${style.notes ? `- Así es el estilo de sus referencias: ${style.notes}\n` : ""}${style.sampleCss ? `- Gráficos de sus referencias (mismo lenguaje visual: brillos, cristal, radios, grosores):\n${style.sampleCss}\n` : ""}
Reglas técnicas (OBLIGATORIAS):
- Todo dentro de <div class="m">…</div>. El CSS solo con selectores que empiecen por .m. Medidas SOLO en cqw/cqh/cqmin (la caja es el vídeo entero: 9:16, 4:5 o 16:9 → que quede bien en los tres; usa flex/grid y centra).
- Sin JavaScript, sin <img>, sin url(). Iconos: {{icon:nombre}} con nombre de: ${Object.keys(ICONS).join(", ")}.
- Fondo: un fondo propio y rico (degradados, luces, rejilla, grano con CSS) que tape el vídeo por completo.
- La animación es una lista de movimientos (GSAP): {"sel":".m .titulo","from":{"opacity":0,"yPercent":60},"to":{"opacity":1,"yPercent":0},"at":0.2,"dur":0.6,"ease":"power3.out","stagger":0.08}. "at" en segundos desde que empieza la escena (0 a ${dur.toFixed(1)}). Propiedades: opacity, xPercent, yPercent (desplazamientos SIEMPRE en % del propio elemento, nunca px), scale, scaleX, scaleY, rotation, filter (blur/brightness), clipPath (inset(...) en %), color, backgroundColor. Selectores sencillos: ".m .clase" (sin :nth-child ni >). Usa "from" con el estado inicial (oculto) — el elemento se ve en su estado CSS al final.
- Ritmo de editor: entrada con impacto en 0-0,4 s, cada texto aparece cuando se dice, algo se mueve siempre (deriva lenta del fondo, brillo que pasa), nada se queda quieto, todo legible al menos 1 s. Sin rebotes exagerados.
- Calidad: jerarquía clara (1 idea grande), tipografía grande y apretada, márgenes generosos (zona segura: deja 12cqh arriba y 18cqh abajo libres de texto importante), contraste alto. Nada de aspecto de plantilla o de PowerPoint.

Responde SOLO JSON: {"html":"<div class=\\"m\\">...</div>","css":".m{...}","tweens":[...],"note":"una frase de la idea"}`;

const FIX = (shots, design) => `Esta es tu animación renderizada (fotos en 3 momentos, en vertical 9:16 y en horizontal 16:9). Léelas con Read:
${shots.map((s) => `- ${s.f} (${s.what})`).join("\n")}

Diseño actual: ${JSON.stringify({ html: design.html, css: design.css, tweens: design.tweens })}

Revisa como director creativo: ¿algo cortado, encimado, ilegible, vacío, descentrado, demasiado pequeño, feo o con pinta de plantilla? ¿Funciona en 16:9 igual que en 9:16? Corrígelo todo. Si está perfecta, devuélvela igual.
Responde SOLO JSON con la versión final: {"html":"...","css":"...","tweens":[...],"note":"..."}`;

/** Fotos de la escena en varios momentos y tamaños (navegador del render + GSAP). */
async function snap(design, dur, outDir, vars, chromePath) {
  const { default: puppeteer } = await import("puppeteer-core");
  const gsap = readFileSync(GSAP, "utf8");
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, protocolTimeout: 180000, args: ["--no-sandbox", "--disable-gpu"] });
  const shots = [];
  mkdirSync(outDir, { recursive: true });
  try {
    const page = await browser.newPage();
    for (const [W, H, tag] of [[540, 960, "9x16"], [960, 540, "16x9"]]) {
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      const tl = motionTweens(design, "s", 0).join("\n");
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
        ${vars.fontFaces || ""}
        :root{--f-title:${vars.fTitle};--f-keyword:${vars.fKeyword};--accent:${vars.accent};--accent2:${vars.accent2};--gold:${vars.gold}}
        html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#000;color:#fff;font-family:var(--f-title)}
        #s{position:absolute;inset:0} svg.ico{display:block}
        ${motionCss(design, "s")}
      </style><script>${gsap}</script></head><body><div id="s"><div class="mwrap">${design.html}</div></div>
      <script>const gtl = gsap.timeline({ paused: true });\n${tl}\nwindow.seek = (t) => { gtl.seek(t, false); };</script></body></html>`, { waitUntil: "load", timeout: 20000 });
      await page.evaluate(() => Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 3000))]));
      for (const t of [Math.min(0.9, dur * 0.25), dur * 0.55, Math.max(0, dur - 0.25)]) {
        await page.evaluate((x) => window.seek(x), t);
        const f = join(outDir, `m-${tag}-${t.toFixed(1)}.png`);
        await page.screenshot({ path: f, type: "png" });
        shots.push({ f, what: `${tag}, segundo ${t.toFixed(1)}` });
      }
    }
  } finally { await browser.close().catch(() => {}); }
  return shots;
}

/**
 * Diseña (y revisa) la animación de un momento. askClaude viene de brain.js.
 * Devuelve el diseño limpio o null si no sale.
 */
export async function designMotion({ brief, texts, dur, words, style, vars, dir, askClaude, chromePath }) {
  mkdirSync(dir, { recursive: true });
  const r = await askClaude(PROMPT({ brief, texts, dur, style, words }), { timeoutMs: 8 * 60e3, maxTurns: 4 });
  let design = normalizeMotion(r, dur);
  if (!design) return null;
  if (chromePath && existsSync(chromePath)) {
    try {
      const shots = await snap(design, dur, dir, vars, chromePath);
      const fixed = normalizeMotion(await askClaude(FIX(shots, design), { images: shots.map((s) => s.f), dir, timeoutMs: 8 * 60e3, maxTurns: shots.length + 6 }), dur);
      if (fixed && fixed.tweens.length) design = fixed;
      await snap(design, dur, join(dir, "final"), vars, chromePath).catch(() => []);
    } catch (e) { console.warn("[animación] revisión con fotos:", e.message); }
  }
  writeFileSync(join(dir, "design.json"), JSON.stringify(design, null, 2));
  return design;
}
export const snapForTest = snap;
