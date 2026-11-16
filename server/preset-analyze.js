// Análisis a fondo de los vídeos de un estilo: Claude mira hojas de fotogramas (vista general, ráfagas para
// ver zooms y animaciones, y fotogramas a tamaño completo para reconocer la letra) y devuelve el estilo con
// valores exactos. La tipografía se descarga de Google Fonts (la misma o la más parecida).
// Se usa en el PC (worker.js) o en local; nunca en el servidor (allí no hay Claude).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { askClaude, canSeeImages, NeedLogin } from "./autoedit/brain.js";
import { measureZooms } from "./motion-measure.js";
import { fontPxFrom, defaultChoice, withChoice } from "./preset-style.js";
import { normalizeTemplate, snapTemplates } from "./gfx-template.js";
import { ICONS as ICON_SET } from "./autoedit/render/icons.js";

const VID_EXT = [".mp4", ".mov", ".m4v", ".webm"];

function ff(args) {
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", args, { windowsHide: true });
    const err = [];
    p.stderr.on("data", (d) => err.push(d));
    p.on("close", (code) => resolve({ code, err: Buffer.concat(err).toString("utf8") }));
    p.on("error", () => resolve({ code: -1, err: "" }));
  });
}

async function duration(file) {
  const { err } = await ff(["-hide_banner", "-i", file]);
  const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
}

/** Cambios de plano por minuto (cortes de escena medidos). */
async function cutsPerMin(files) {
  let cuts = 0, secs = 0;
  for (const f of files) {
    const { err } = await ff(["-hide_banner", "-i", f, "-vf", "scale=320:-2,select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"]);
    cuts += (err.match(/pts_time:/g) || []).length;
    secs += await duration(f);
  }
  return secs > 3 ? { cutsPerMin: Math.round((cuts / secs) * 60), seconds: Math.round(secs) } : null;
}

/** Hojas de fotogramas de un vídeo: general (3×3), dos ráfagas (4×3 a 4 fps) y 2 fotogramas grandes. */
export async function sheetsFor(file, k, dir) {
  const d = await duration(file);
  const out = [];
  if (!d) return out;
  const stamp = "drawtext=text='%{pts\\:hms}':x=12:y=12:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6";
  // Vista general: 18 fotogramas repartidos → 2 hojas
  const every = Math.max(0.5, d / 18);
  for (const [i, start] of [[0, 0], [1, every * 9]]) {
    if (start >= d) continue;
    const f = join(dir, `v${k}-general-${i + 1}.jpg`);
    const r_ = await ff(["-v", "error", "-y", "-ss", start.toFixed(3), "-i", file, "-vf", `fps=1/${every.toFixed(3)},scale=360:-2,${stamp},tile=3x3:padding=4:color=black`, "-frames:v", "1", f]);
    if (!existsSync(f)) console.warn("[estilos] ffmpeg:", r_.err.trim().split(/\r?\n/).pop());
    if (existsSync(f)) out.push({ f, what: `vídeo ${k + 1}, vista general ${i + 1} (9 fotogramas cada ${every.toFixed(1)} s, de izquierda a derecha y de arriba abajo)` });
  }
  // Ráfagas a 4 fps (3 s): se ven los zooms, los cortes y cómo entran los subtítulos
  for (const [i, at] of [[0, Math.min(1, d * 0.05)], [1, d * 0.45]]) {
    const f = join(dir, `v${k}-rafaga-${i + 1}.jpg`);
    const r_ = await ff(["-v", "error", "-y", "-ss", at.toFixed(3), "-i", file, "-vf", `fps=4,scale=270:-2,${stamp},tile=4x3:padding=4:color=black`, "-frames:v", "1", f]);
    if (!existsSync(f)) console.warn("[estilos] ffmpeg:", r_.err.trim().split(/\r?\n/).pop());
    if (existsSync(f)) out.push({ f, what: `vídeo ${k + 1}, ráfaga ${i + 1} (12 fotogramas seguidos a 4 por segundo desde ${at.toFixed(1)} s)` });
  }
  // Dos fotogramas grandes para reconocer la tipografía, el color y el contorno exactos
  for (const [i, at] of [[0, d * 0.25], [1, d * 0.65]]) {
    const f = join(dir, `v${k}-grande-${i + 1}.jpg`);
    const r_ = await ff(["-v", "error", "-y", "-ss", at.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale=1080:-2", "-q:v", "2", f]);
    if (!existsSync(f)) console.warn("[estilos] ffmpeg:", r_.err.trim().split(/\r?\n/).pop());
    if (existsSync(f)) out.push({ f, what: `vídeo ${k + 1}, fotograma a tamaño completo (${at.toFixed(1)} s)` });
  }
  return out;
}

const PROMPT = (list, rhythm) => `Eres director de postproducción de reels. Tu trabajo: estudiar estos vídeos de referencia FOTOGRAMA A FOTOGRAMA y sacar su estilo de edición con valores EXACTOS para que un motor de render lo calque (misma letra, mismo color, mismo sitio, mismo tamaño, mismos zooms, mismo look).

Imágenes (léelas TODAS con la herramienta Read, en este orden):
${list.map((x, i) => `${i + 1}. ${x.f} — ${x.what}`).join("\n")}
${rhythm ? `\nMedido con ffmpeg: ${rhythm.cutsPerMin} cambios de plano por minuto.` : ""}

Fíjate en:
- SUBTÍTULOS: tipografía (familia, grosor, cursiva), MAYÚSCULAS o no, color exacto (HEX), contorno (color y grosor en px si el vídeo midiera 1080 de ancho), sombra, caja de fondo, tamaño (alto de la línea en px a 1080×1920), posición vertical (centro del subtítulo como fracción del alto: 0 arriba, 1 abajo), cuántas palabras salen a la vez, una o dos líneas, cómo entran (de golpe palabra a palabra, con rebote, deslizando, letra a letra).
- PALABRA CLAVE: ¿hay palabras resaltadas? color, si es más grande, si usa otra letra, si va en caja.
- MOVIMIENTO: zooms (suaves o de golpe entre frases), cuánto zoom (1.0 = nada, 1.15 = 15 %), cortes, transiciones.
- GRÁFICOS: ¿hay tarjetas, iconos, textos grandes? ¿cuántos? (si casi no hay, dilo: "none" o "few").
- LOOK: color de la imagen (cálido, frío, contraste, desaturado, cinematográfico), grano, viñeta, bandas negras.

Para la tipografía da el nombre EXACTO de Google Fonts si existe; si la del vídeo no es de Google Fonts (p. ej. Proxima Nova, SF Pro, TikTok Sans), di cuál crees que es en "seen" y en "family" la de Google Fonts más parecida, con 2 alternativas.

Responde SOLO con JSON (sin texto antes ni después):
{"name":"nombre corto del estilo (2-4 palabras)",
 "summary":"descripción precisa y accionable del estilo en español (máx. 1200 caracteres)",
 "fonts":{"caption":{"family":"Google Font","weight":700,"seen":"lo que crees que es","alternatives":["...","..."]},
          "keyword":null o {"family":"...","weight":800,"seen":"...","alternatives":[]}},
 "caption":{"yPct":0.72,"fontPx":64,"uppercase":false,"maxWords":2,"lines":1,"color":"#FFFFFF",
            "stroke":null o {"color":"#000000","width":6},"shadow":"none|soft|strong","bg":null o {"color":"#000000","opacity":0.6,"radius":8},
            "letterSpacing":0,"animation":"soft|pop|typewriter|word",
            "keywordStyle":"big|highlight|box","keywordColor":"#FFD400","keywordScale":1.0,"keywordFont":"same|keyword"},
 "motion":{"zoomStyle":"smooth|punch|none","zoomMax":1.12,"intensity":1},
 "look":{"grade":"neutral|warm|cool|punchy|soft|cinematic","grain":0.0,"vignette":0.0,"letterbox":false},
 "graphics":"none|few|balanced|many",
 "cards":{"look":"glass|solid|light"},
 "colors":{"accent":"#HEX","accent2":"#HEX","bg":"#HEX"},
 "music":"lofi|synthwave|none|auto",
 "rules":["reglas concretas para el editor, p. ej. 'subtítulos de 2 palabras, nunca más'", "..."]}`;

/** Descarga la tipografía de Google Fonts (TTF). Devuelve { family, weight, file } o null. */
export async function downloadGoogleFont(families, weight, dir) {
  // Con un navegador antiguo como agente, Google Fonts devuelve TTF (el render los mide mejor que WOFF2)
  const UA = "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Chrome/12.0.742.112 Safari/534.30";
  for (const family of families.filter(Boolean)) {
    for (const w of [weight, 700, 400].filter((v, i, a) => v && a.indexOf(v) === i)) {
      try {
        const q = `${encodeURIComponent(family).replace(/%20/g, "+")}:wght@${w}`;
        const css = await fetch(`https://fonts.googleapis.com/css2?family=${q}&display=swap`, { headers: { "user-agent": UA } });
        if (!css.ok) continue;
        const text = await css.text();
        const url = text.match(/src:\s*url\((https:[^)]+)\)/)?.[1];
        if (!url) continue;
        const bin = await fetch(url);
        if (!bin.ok) continue;
        const ext = extname(new URL(url).pathname) || ".ttf";
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${family.replace(/[^\w-]+/g, "-")}-${w}${ext}`);
        writeFileSync(file, Buffer.from(await bin.arrayBuffer()));
        return { family, weight: w, file };
      } catch { /* siguiente */ }
    }
  }
  return null;
}

const clamp = (v, a, b, d) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Number(v))) : d);
const HEX = (v) => (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v.trim()) ? ("#" + v.trim().replace(/^#/, "")).toUpperCase() : undefined);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

/** Convierte la respuesta de Claude en un estilo de Pulso Studio (EditStyle parcial + análisis). */
export function toPresetStyle(r, rhythm) {
  const c = r.caption || {};
  const caption = {
    size: "m",
    uppercase: !!c.uppercase,
    position: "auto",
    animation: oneOf(c.animation, ["soft", "pop", "typewriter", "word"], "soft"),
    keywordStyle: oneOf(c.keywordStyle, ["big", "highlight", "box"], "highlight"),
    yPct: clamp(c.yPct, 0.12, 0.86, 0.72),
    scale: +clamp(Number(c.fontPx) / 56, 0.6, 1.6, 1).toFixed(2),
    weight: clamp(r.fonts?.caption?.weight, 100, 900, 700),
    maxWords: clamp(c.maxWords, 1, 4, 2) | 0,
    lines: clamp(c.lines, 1, 2, 1) | 0,
    stroke: c.stroke && HEX(c.stroke.color) ? { color: HEX(c.stroke.color), width: clamp(c.stroke.width, 0, 20, 4) } : null,
    shadow: oneOf(c.shadow, ["none", "soft", "strong"], "soft"),
    bg: c.bg && HEX(c.bg.color) ? { color: HEX(c.bg.color), opacity: clamp(c.bg.opacity, 0, 1, 0.6), radius: clamp(c.bg.radius, 0, 40, 8) } : null,
    letterSpacing: clamp(c.letterSpacing, -0.05, 0.2, 0),
    keywordColor: HEX(c.keywordColor),
    keywordScale: clamp(c.keywordScale, 0.8, 1.8, 1),
    keywordFont: oneOf(c.keywordFont, ["same", "keyword"], "same"),
  };
  const colors = {};
  for (const k of ["accent", "accent2", "bg"]) if (HEX(r.colors?.[k])) colors[k] = HEX(r.colors[k]);
  if (HEX(c.color)) colors.caption = HEX(c.color);
  if (caption.keywordColor) colors.keyword = caption.keywordColor;
  return {
    caption,
    colors,
    motion: { intensity: clamp(r.motion?.intensity, 1, 3, 2) | 0, zoomStyle: oneOf(r.motion?.zoomStyle, ["smooth", "punch", "none"], "smooth"), zoomMax: +clamp(r.motion?.zoomMax, 1, 1.25, 1.1).toFixed(3) },
    look: { grain: clamp(r.look?.grain, 0, 1, 0), vignette: clamp(r.look?.vignette, 0, 1, 0), letterbox: !!r.look?.letterbox },
    grade: oneOf(r.look?.grade, ["neutral", "warm", "cool", "punchy", "soft", "cinematic"], "neutral"),
    // Edición limpia y cinematográfica: aunque la referencia lleve muchos gráficos, se queda en pocos (el usuario lo puede subir)
    graphics: r.graphics === "none" ? "none" : "few",
    cards: { look: oneOf(r.cards?.look, ["glass", "solid", "light"], "glass") },
    music: oneOf(r.music, ["lofi", "synthwave", "none", "auto"], "auto"),
    rhythm: rhythm || null,
    rules: Array.isArray(r.rules) ? r.rules.map(String).slice(0, 12) : [],
  };
}

/* ---------- Análisis a fondo, vídeo a vídeo ---------- */

/** Ancho, alto y duración. */
async function probeVideo(file) {
  const out = await new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_tags=rotate:format=duration", "-of", "json", file], { windowsHide: true });
    let s = "";
    p.stdout.on("data", (d) => (s += d));
    p.on("close", () => resolve(s));
    p.on("error", () => resolve(""));
  });
  try {
    const j = JSON.parse(out);
    let w = j.streams?.[0]?.width || 0, h = j.streams?.[0]?.height || 0;
    if ([90, 270].includes(Math.abs(Number(j.streams?.[0]?.tags?.rotate || 0)))) [w, h] = [h, w];
    return { width: w, height: h, duration: Number(j.format?.duration) || (await duration(file)) };
  } catch { return { width: 0, height: 0, duration: await duration(file) }; }
}

/** Segundos donde hay cambio de plano. */
async function sceneCuts(file) {
  const { err } = await ff(["-hide_banner", "-i", file, "-vf", "scale=320:-2,select='gt(scene,0.32)',showinfo", "-an", "-f", "null", "-"]);
  return [...err.matchAll(/pts_time:([\d.]+)/g)].map((m) => +m[1]);
}

const box4 = (b) => (Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(Number(v))) ? b.map(Number) : null);
/** Caja [x,y,w,h] (fracciones) con margen, recortada al fotograma, en píxeles pares. */
function padBox(b, W, H, padX, padY) {
  let [x, y, w, h] = b;
  x -= w * padX; w += 2 * w * padX; y -= h * padY; h += 2 * h * padY;
  x = Math.max(0, x); y = Math.max(0, y); w = Math.min(1 - x, w); h = Math.min(1 - y, h);
  const even = (v) => Math.max(2, Math.floor(v / 2) * 2);
  return { x: even(x * W), y: even(y * H), w: even(w * W), h: even(h * H) };
}

const SUBS_PROMPT = (frames, info) => `Eres experto en edición de reels. Estudia estos ${frames.length} fotogramas de UN vídeo (${info.width}×${info.height}, ${info.duration.toFixed(1)} s) y encuentra TODOS los textos sobreimpresos: subtítulos, palabras resaltadas, titulares, nombres de usuario o marcas de agua.

Fotogramas (léelos TODOS con la herramienta Read):
${frames.map((f, i) => `${i + 1}. ${f.f} — segundo ${f.t.toFixed(2)}`).join("\n")}

Para cada texto que veas da su caja EXACTA en fracciones del fotograma: [x, y, ancho, alto] (x,y = esquina superior izquierda; 0..1). Ajusta la caja a las letras, sin margen.
Agrupa los textos en ESTILOS visuales distintos (misma letra, color y tamaño = mismo estilo). Ejemplos de estilos: «subtítulo blanco palabra a palabra», «palabra clave amarilla grande», «titular arriba», «@usuario (marca de agua)».

Por estilo mide con precisión:
- role: "subtitle" (lo que se dice, va cambiando), "keyword" (palabra resaltada dentro del subtítulo), "title" (titular fijo), "watermark" (usuario/logo) u "other".
- font: la tipografía que ves ("seen") y la de Google Fonts igual o más parecida ("family") con 2 alternativas; grosor (100-900); cursiva.
- color (HEX exacto de la letra), uppercase (¿todo en mayúsculas?), stroke (contorno: color y grosor en px a 1080 de lado corto) o null, shadow (none|soft|strong), bg (caja de fondo: color, opacidad 0-1, radio en px) o null, letterSpacing (em, 0 normal, negativo = apretado).
- capHeightPct: alto de una MAYÚSCULA dividido por el alto del fotograma (mídelo bien: es lo que fija el tamaño).
- yPct: centro vertical del texto (0 arriba, 1 abajo); xPct: centro horizontal; align (center|left|right).
- maxWords: cuántas palabras salen a la vez como máximo; lines: 1 o 2.
- keywordColor: si dentro del subtítulo hay palabras de otro color, ese color; si no, null.

Responde SOLO con JSON:
{"texts":[{"frame":1,"text":"y de","box":[0.36,0.47,0.06,0.04],"style":"A"}],
 "styles":[{"id":"A","role":"subtitle","label":"descripción corta en español","font":{"seen":"","family":"","weight":600,"italic":false,"alternatives":["",""]},"color":"#FFFFFF","uppercase":false,"stroke":null,"shadow":"soft","bg":null,"letterSpacing":0,"capHeightPct":0.03,"yPct":0.5,"xPct":0.5,"align":"center","maxWords":2,"lines":1,"keywordColor":null}]}

Además, apunta los GRÁFICOS diseñados que veas (no el vídeo en sí): tarjetas, píldoras/etiquetas con fondo o neón, iconos en baldosa, insignias, contadores, listas con checks, rótulos con caja, flechas… En "graphics" pon cada uno UNA vez (el fotograma donde mejor se vea entero): {"frame":3,"box":[x,y,w,h],"kind":"card|pill|icon|badge|counter|list|label|other","description":"qué es y cómo es"}. Los subtítulos sueltos sin caja NO son gráficos.
Respuesta completa: {"texts":[...],"styles":[...],"graphics":[...]}
Si no hay ningún texto ni gráfico: {"texts":[],"styles":[],"graphics":[]}`;

const ANIM_PROMPT = (strips) => `Estas imágenes son tiras de fotogramas SEGUIDOS (10 por segundo, de izquierda a derecha y de arriba abajo, con el segundo encima) recortadas alrededor de un texto de un reel. En cada tira se ve cómo ENTRA ese texto.

${strips.map((s, i) => `${i + 1}. ${s.f} — estilo ${s.id}: «${s.text}» (${s.label})`).join("\n")}

Léelas con la herramienta Read y, para cada estilo, di cómo aparece:
- type: "pop" (cada palabra crece desde pequeña con un pequeño rebote), "word" (cada palabra aparece de golpe, una tras otra), "typewriter" (letra a letra), "soft" (el bloque aparece con fundido/deslizando/desenfoque) o "none" (aparece entero de golpe sin animación).
- inMs: cuánto dura la entrada en milisegundos (cuenta fotogramas: cada uno son 100 ms).
- wordByWord: ¿las palabras del bloque aparecen una a una?
- notes: una frase con lo que ves (escala inicial, desde dónde desliza, si hay desenfoque, si cambia de color).

Responde SOLO con JSON: {"styles":[{"id":"A","type":"pop","inMs":250,"wordByWord":true,"notes":"..."}]}`;


const GFX_PROMPT = (crops, icons) => `Eres diseñador de motion graphics. Estos recortes son GRÁFICOS de reels de referencia. Recrea cada uno como una pieza HTML + CSS que se vea IGUAL (calcado): misma forma, proporciones, colores y degradados, bordes, radios, brillos/neón (box-shadow, text-shadow), transparencias/cristal (backdrop-filter), tipografía (grosor, tamaño, espaciado, mayúsculas), espacios internos e iconos.

Recortes (léelos con la herramienta Read):
${crops.map((c, i) => `${i + 1}. ${c.f} — ${c.kind}: ${c.description} (en el vídeo mide ${c.wPx}×${c.hPx} px a 1080 de ancho)`).join("\n")}

Reglas de la pieza:
- Todo dentro de UN elemento raíz con class="root". El CSS solo con selectores que empiecen por .root (p. ej. ".root{...} .root .pill{...}").
- Medidas en px para un vídeo vertical de 1080 de ancho (usa el tamaño que te doy).
- Textos que cambian según el vídeo: {{title}}, {{subtitle}}, {{label}}, {{value}}… (los nombres que quieras). El icono: {{icon}} (se pondrá un SVG de línea; dale tamaño y color con ".root svg{width:..;height:..;color:..;stroke:currentColor}"). Iconos posibles: ${icons}.
- Fuentes: font-family: var(--f-title) (textos), var(--f-keyword) (cifras/palabras de impacto). Colores libres (HEX) o var(--accent).
- Sin JavaScript, sin <img>, sin <style>, sin url() externas, sin position:fixed. Animaciones CSS no (las pone el render).
- Si el texto puede ser más largo que el ejemplo, que no se salga: white-space:nowrap y tamaños razonables; indica "max" de caracteres por campo.

Responde SOLO con JSON:
{"templates":[{"ref":1,"name":"Icono con etiqueta","kind":"icon","use":"cuándo usarlo (p. ej. nombrar una herramienta o un paso)",
  "fields":[{"key":"title","label":"Título","example":"Tu sistema","max":16}],"icon":"rocket",
  "html":"<div class=\\"root\\">...</div>","css":".root{...}","width":420,"height":300,"xPct":0.5,"yPct":0.4,
  "anim":{"in":"pop|fade|slide-up|slide-left|slide-right|scale|glow|typewriter","ms":400}}]}`;

const FIX_PROMPT = (pairs) => `Compara cada gráfico ORIGINAL con tu RECREACIÓN (foto del render) y corrige el HTML/CSS para que quede calcado: tamaños relativos, colores, brillos, bordes, radios, grosor y tamaño de letra, espacios, posición del icono.

${pairs.map((p, i) => `${i + 1}. original: ${p.orig} · recreación: ${p.render}\n   plantilla actual: ${JSON.stringify({ html: p.t.html, css: p.t.css, width: p.t.width, height: p.t.height })}`).join("\n")}

Léelas todas con Read. Devuelve SOLO JSON con las plantillas corregidas (mismas reglas: raíz class="root", CSS con .root, {{campos}} y {{icon}}):
{"templates":[{"ref":1,"html":"...","css":"...","width":420,"height":300}]}`;

/** Gráficos de un vídeo: recortes, Claude los recrea, foto de la recreación, una vuelta de corrección. */
async function recreateGraphics(found, file, info, k, dir, { saveFile, step }) {
  const crops = [];
  for (const [n, g] of found.slice(0, 5).entries()) {
    const c = padBox(g.box, info.width, info.height, 0.12, 0.12);
    const f = join(dir, `v${k}-g${n + 1}.png`);
    await ff(["-v", "error", "-y", "-ss", g.t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", `crop=${c.w}:${c.h}:${c.x}:${c.y}`, f]);
    if (!existsSync(f)) continue;
    const s1080 = 1080 / Math.min(info.width, info.height);
    crops.push({ f, kind: g.kind || "card", description: String(g.description || "").slice(0, 200), wPx: Math.round(g.box[2] * info.width * s1080), hPx: Math.round(g.box[3] * info.height * s1080), t: g.t, box: g.box });
  }
  if (!crops.length) return [];
  step("Claude recrea los gráficos (HTML + CSS)");
  const r = await askClaude(GFX_PROMPT(crops, ICON_SET), { images: crops.map((c) => c.f), dir, timeoutMs: 10 * 60e3, maxTurns: crops.length + 6 });
  let tpls = (Array.isArray(r.templates) ? r.templates : []).map((t) => ({ t: normalizeTemplate(t, `v${k}g${Number(t.ref) || 0}`), ref: Number(t.ref) })).filter((x) => x.t && crops[x.ref - 1]);
  // Foto de cada recreación y una vuelta de corrección comparando con el original
  step("Comparando la recreación con el original");
  const snap = async (tag) => {
    const items = tpls.map((x) => ({ t: x.t, out: join(dir, `v${k}-g${x.ref}-${tag}.png`) }));
    try { await snapTemplates(items); } catch (e) { console.warn("[estilos] foto de gráficos:", e.message); }
    return items.filter((i) => existsSync(i.out));
  };
  const first = await snap("r1");
  if (first.length) {
    try {
      const fix = await askClaude(FIX_PROMPT(tpls.filter((x) => first.some((i) => i.t === x.t)).map((x) => ({ orig: crops[x.ref - 1].f, render: join(dir, `v${k}-g${x.ref}-r1.png`), t: x.t }))),
        { images: [...first.map((i) => i.out), ...tpls.map((x) => crops[x.ref - 1].f)], dir, timeoutMs: 10 * 60e3, maxTurns: first.length * 2 + 6 });
      for (const f of Array.isArray(fix.templates) ? fix.templates : []) {
        const x = tpls.find((y) => y.ref === Number(f.ref));
        if (!x) continue;
        const better = normalizeTemplate({ ...x.t, ...f, fields: x.t.fields, anim: x.t.anim, name: x.t.name, kind: x.t.kind, use: x.t.use, icon: x.t.icon, xPct: x.t.xPct, yPct: x.t.yPct }, x.t.id);
        if (better) x.t = better;
      }
    } catch (e) { console.warn("[estilos] corrección de gráficos:", e.message); }
  }
  const final = await snap("r2");
  const out = [];
  for (const x of tpls) {
    const c = crops[x.ref - 1];
    const shot = final.find((i) => i.t === x.t);
    out.push({
      ...x.t, video: k,
      sample: { url: await saveFile(c.f, `v${k}-g${x.ref}.png`), t: +c.t.toFixed(2) },
      render: shot ? await saveFile(shot.out, `v${k}-g${x.ref}-recreado.png`) : null,
    });
  }
  return out;
}

/**
 * Analiza un vídeo: zooms medidos, subtítulos encontrados (recortes reales) y cómo entran (tiras de animación).
 * onStep(pct, step) informa del avance de ESTE vídeo. saveFile(path, name) → url pública de un recorte.
 */
async function analyzeOneVideo(file, k, dir, { onStep, saveFile }) {
  const step = (pct, s) => onStep?.(pct, s);
  step(3, "Midiendo cortes de plano");
  const info = await probeVideo(file);
  if (!info.duration) throw new Error("No se puede leer este vídeo.");
  const cuts = await sceneCuts(file);
  step(10, "Midiendo los zooms fotograma a fotograma");
  const zooms = await measureZooms(file, join(dir, `v${k}.trf`), { duration: info.duration, width: info.width, height: info.height, cuts }).catch(() => null);

  // 16 fotogramas repartidos para encontrar los textos
  step(20, "Sacando fotogramas");
  const frames = [];
  const N = Math.min(16, Math.max(6, Math.round(info.duration / 2)));
  for (let i = 0; i < N; i++) {
    const t = info.duration * (0.03 + (0.92 * i) / Math.max(1, N - 1));
    const f = join(dir, `v${k}-t${String(i + 1).padStart(2, "0")}.jpg`);
    await ff(["-v", "error", "-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", "scale='min(900,iw)':-2", "-q:v", "3", f]);
    if (existsSync(f)) frames.push({ f, t });
  }
  if (!frames.length) throw new Error("No he podido sacar fotogramas de este vídeo.");

  step(30, "Claude está leyendo los subtítulos");
  const r = await askClaude(SUBS_PROMPT(frames, info), { images: frames.map((x) => x.f), dir, timeoutMs: 10 * 60e3, maxTurns: frames.length + 6 });
  const texts = (Array.isArray(r.texts) ? r.texts : []).map((x) => ({ ...x, box: box4(x.box), frame: Number(x.frame) })).filter((x) => x.box && frames[x.frame - 1]);
  const styles = (Array.isArray(r.styles) ? r.styles : []).filter((s) => s && s.id);

  // Recortes reales de cada estilo (a tamaño completo) para que los veas y elijas
  step(55, "Recortando los subtítulos encontrados");
  const subs = [];
  for (const s of styles) {
    const mine = texts.filter((x) => x.style === s.id);
    const samples = [];
    for (const [n, x] of mine.slice(0, 3).entries()) {
      const t = frames[x.frame - 1].t;
      const c = padBox(x.box, info.width, info.height, 0.25, 0.6);
      const f = join(dir, `v${k}-${s.id}-${n + 1}.jpg`);
      await ff(["-v", "error", "-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", `crop=${c.w}:${c.h}:${c.x}:${c.y},scale='min(720,iw)':-2`, "-q:v", "2", f]);
      if (existsSync(f)) samples.push({ url: await saveFile(f, `v${k}-${s.id}-${n + 1}.jpg`), t: +t.toFixed(2), text: String(x.text || "").slice(0, 80) });
    }
    const fontPx = fontPxFrom(s, info);
    subs.push({
      id: `v${k}-${s.id}`, sid: s.id, video: k, role: oneOf(s.role, ["subtitle", "keyword", "title", "watermark", "other"], "other"),
      label: String(s.label || "").slice(0, 120), count: mine.length, samples, fontPx: Math.round(fontPx),
      font: { family: s.font?.family || null, seen: s.font?.seen || "", weight: clamp(s.font?.weight, 100, 900, 700), italic: !!s.font?.italic, alternatives: Array.isArray(s.font?.alternatives) ? s.font.alternatives.filter(Boolean).slice(0, 3) : [], assetId: null },
      spec: {
        color: HEX(s.color) || "#FFFFFF", uppercase: !!s.uppercase, stroke: s.stroke || null, shadow: s.shadow, bg: s.bg || null,
        letterSpacing: s.letterSpacing, yPct: s.yPct, xPct: s.xPct, align: s.align, maxWords: s.maxWords, lines: s.lines,
        keywordColor: s.keywordColor || null, capHeightPct: s.capHeightPct,
      },
      firstBox: mine[0] ? { box: mine[0].box, t: frames[mine[0].frame - 1].t, text: mine[0].text } : null,
      animation: null, strip: null,
    });
  }

  // Cómo entra cada texto: 16 fotogramas seguidos (10 por segundo) alrededor de su aparición
  step(68, "Capturando la animación de cada subtítulo");
  const strips = [];
  for (const s of subs.filter((x) => x.firstBox && ["subtitle", "keyword", "title"].includes(x.role))) {
    const c = padBox(s.firstBox.box, info.width, info.height, 0.6, 1.2);
    const from = Math.max(0, s.firstBox.t - 1.1);
    const f = join(dir, `v${k}-${s.sid}-anim.jpg`);
    // El tiempo va en una franja encima de cada fotograma (no tapa el texto)
    const stamp = "pad=iw:ih+22:0:22:black,drawtext=text='+%{eif\\:t*1000\\:d} ms':x=6:y=3:fontsize=16:fontcolor=white";
    await ff(["-v", "error", "-y", "-ss", from.toFixed(3), "-i", file, "-vf", `fps=10,crop=${c.w}:${c.h}:${c.x}:${c.y},scale=320:-2,${stamp},tile=4x4:padding=3:color=0x222222`, "-frames:v", "1", "-q:v", "3", f]);
    if (!existsSync(f)) continue;
    s.strip = { url: await saveFile(f, `v${k}-${s.sid}-anim.jpg`), from: +from.toFixed(2), fps: 10 };
    strips.push({ f, id: s.sid, text: s.firstBox.text, label: s.label });
  }
  if (strips.length) {
    step(78, "Claude estudia cómo entran los subtítulos");
    try {
      const a = await askClaude(ANIM_PROMPT(strips), { images: strips.map((x) => x.f), dir, timeoutMs: 8 * 60e3, maxTurns: strips.length + 6 });
      for (const x of Array.isArray(a.styles) ? a.styles : []) {
        const s = subs.find((y) => y.sid === x.id);
        if (!s) continue;
        let type = oneOf(x.type, ["pop", "word", "typewriter", "soft", "none"], "soft");
        if (type === "none") type = "word"; // de golpe: cada bloque aparece en su momento
        s.animation = { type, inMs: clamp(x.inMs, 0, 2000, 300) | 0, wordByWord: !!x.wordByWord, notes: String(x.notes || "").slice(0, 200) };
      }
    } catch (e) { console.warn("[estilos] animación:", e.message); }
  }
  for (const s of subs) delete s.firstBox;

  // Gráficos: recortes, recreación en HTML+CSS y comparación con el original
  let graphics = [];
  const found = (Array.isArray(r.graphics) ? r.graphics : []).map((g) => ({ ...g, box: box4(g.box), frame: Number(g.frame) })).filter((g) => g.box && frames[g.frame - 1] && g.box[2] > 0.03 && g.box[3] > 0.02)
    .map((g) => ({ ...g, t: frames[g.frame - 1].t }));
  if (found.length) {
    step(86, `Recortando ${found.length} gráfico(s)`);
    try { graphics = await recreateGraphics(found, file, info, k, dir, { saveFile, step: (s) => step(92, s) }); }
    catch (e) { if (e instanceof NeedLogin) throw e; console.warn("[estilos] gráficos:", e.message); }
  }
  step(100, "Listo");
  return { file, info, cuts: cuts.length, zooms, subs, graphics };
}

/**
 * Analiza los archivos de un estilo, vídeo a vídeo.
 * opts.onProgress({ videos:[{name,pct,step}], pct, step }) · opts.saveFile(path, name) → url · opts.names (nombres a mostrar)
 * Devuelve { name, summary, style, subtitles, choice, zooms, fontsWanted, raw, frames }.
 */
export async function analyzePresetFiles(files, workDir, opts = {}) {
  if (!(await canSeeImages())) throw new Error("Claude no tiene la sesión iniciada en tu PC: no puede mirar los vídeos.");
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const saveFile = opts.saveFile || (async (f) => f);
  const vids = files.filter((f) => VID_EXT.includes(extname(f).toLowerCase())).slice(0, 8);
  const imgs = files.filter((f) => !VID_EXT.includes(extname(f).toLowerCase())).slice(0, 6);
  const names = opts.names || {};
  const prog = { videos: vids.map((f) => ({ name: names[f] || basename(f), pct: 0, step: "En cola" })), pct: 0, step: "Empezando" };
  const report = () => {
    prog.pct = Math.round(prog.videos.reduce((a, v) => a + v.pct, 0) / Math.max(1, prog.videos.length) * 0.85 + (prog.final || 0) * 0.15);
    opts.onProgress?.(JSON.parse(JSON.stringify(prog)));
  };
  report();

  // 1) Cada vídeo, uno a uno
  const results = [];
  for (const [k, f] of vids.entries()) {
    prog.step = `Vídeo ${k + 1} de ${vids.length}`;
    try {
      results.push(await analyzeOneVideo(f, k, workDir, { saveFile, onStep: (pct, step) => { prog.videos[k].pct = pct; prog.videos[k].step = step; report(); } }));
    } catch (e) {
      prog.videos[k].pct = 100; prog.videos[k].step = "No se pudo analizar: " + String(e.message || e).slice(0, 120);
      report();
      if (e instanceof NeedLogin) throw e;
    }
  }

  // 2) Vista de conjunto (look, gráficos, reglas) con lo medido como dato
  prog.step = "Claude junta todo en un estilo";
  prog.final = 20; report();
  const list = [];
  for (const [k, v] of vids.entries()) list.push(...(await sheetsFor(v, k, workDir)).filter((x) => !/grande/.test(x.f)));
  for (const [k, im] of imgs.entries()) {
    const to = join(workDir, `captura-${k + 1}${extname(im).toLowerCase()}`);
    copyFileSync(im, to);
    list.push({ f: to, what: `captura ${k + 1}` });
  }
  if (!list.length && !results.length) throw new Error("No he podido sacar fotogramas de esos archivos.");
  const rhythm = vids.length ? await cutsPerMin(vids) : null;
  const measured = results.map((r, k) => `Vídeo ${k + 1}: ${r.info.width}×${r.info.height}, ${r.info.duration.toFixed(1)} s, ${r.cuts} cortes; zooms medidos: ${r.zooms ? `${r.zooms.zoomStyle} (máx. ×${r.zooms.zoomMax}, ${r.zooms.perMin}/min)` : "no medidos"}; textos: ${r.subs.map((s) => `${s.role} «${s.label}»`).join("; ") || "ninguno"}`).join("\n");
  const r = await askClaude(PROMPT(list, rhythm) + `\n\nDATOS MEDIDOS (fíate de ellos para zooms y subtítulos):\n${measured}`, { images: list.map((x) => x.f), dir: workDir, timeoutMs: 15 * 60e3, maxTurns: list.length + 8 });
  prog.final = 90; report();

  // 3) Estilo final: el del conjunto + el subtítulo elegido + los zooms medidos
  const subtitles = results.flatMap((x) => x.subs).filter((s) => s.role !== "other");
  const choice = defaultChoice(subtitles.filter((s) => s.role !== "watermark"));
  let style = toPresetStyle(r, rhythm);
  const zs = results.map((x) => x.zooms).filter(Boolean);
  if (zs.length) {
    const votes = {};
    for (const z of zs) votes[z.zoomStyle] = (votes[z.zoomStyle] || 0) + (z.zooms.length || 1);
    const zoomStyle = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
    const maxes = zs.filter((z) => z.zoomStyle === zoomStyle).map((z) => z.zoomMax).sort();
    style.motion = { ...style.motion, zoomStyle, zoomMax: zoomStyle === "none" ? 1 : +Math.min(1.25, Math.max(1.03, maxes[Math.floor(maxes.length / 2)] || 1.1)).toFixed(3) };
  }
  style = withChoice(style, subtitles, choice);
  style.templates = results.flatMap((x) => x.graphics || []).map(({ sample, render, video, ...t }) => t);
  const fontsWanted = {
    caption: r.fonts?.caption?.family ? { families: [r.fonts.caption.family, ...(r.fonts.caption.alternatives || [])], weight: style.caption.weight, seen: r.fonts.caption.seen || "" } : null,
    keyword: r.fonts?.keyword?.family ? { families: [r.fonts.keyword.family, ...(r.fonts.keyword.alternatives || [])], weight: clamp(r.fonts.keyword.weight, 100, 900, 800), seen: r.fonts.keyword.seen || "" } : null,
  };
  prog.final = 100; prog.step = "Descargando tipografías"; report();
  return {
    name: String(r.name || "Mi estilo").slice(0, 40), summary: String(r.summary || "").slice(0, 1400), style, fontsWanted, raw: r,
    graphics: results.flatMap((x) => x.graphics || []),
    subtitles, choice: { ...choice, graphics: results.flatMap((x) => x.graphics || []).map((g) => g.id) }, zooms: results.map((x, k) => ({ video: k, name: prog.videos[k].name, ...(x.zooms ? { zoomStyle: x.zooms.zoomStyle, zoomMax: x.zooms.zoomMax, perMin: x.zooms.perMin, list: x.zooms.zooms.slice(0, 20) } : {}) })),
    videos: prog.videos, frames: readdirSync(workDir).length,
  };
}

/**
 * Descarga las tipografías de los subtítulos encontrados y las registra (registerFont(got) → id del asset).
 * Pone el id en cada subtítulo y en el estilo.
 */
export async function fetchFontsFor(result, dir, registerFont, onStep) {
  const want = new Map();
  for (const s of result.subtitles.filter((x) => x.role !== "watermark" && x.font?.family)) {
    const key = `${s.font.family}|${s.font.weight}`;
    if (!want.has(key)) want.set(key, { families: [s.font.family, ...s.font.alternatives], weight: s.font.weight, subs: [] });
    want.get(key).subs.push(s);
  }
  const ordered = [...want.values()].sort((a, b) => b.subs.reduce((n, s) => n + s.count, 0) - a.subs.reduce((n, s) => n + s.count, 0)).slice(0, 5);
  for (const w of ordered) {
    onStep?.(`Descargando la tipografía (${w.families[0]})`);
    const got = await downloadGoogleFont(w.families, w.weight, dir);
    if (!got) continue;
    const id = await registerFont(got);
    for (const s of w.subs) { s.font.assetId = id; s.font.got = `${got.family} ${got.weight}`; s.font.weight = got.weight; }
  }
  // Si Claude pidió otras (vista de conjunto) y no hay subtítulos con letra, como antes
  if (!ordered.length && result.fontsWanted.caption) {
    const got = await downloadGoogleFont(result.fontsWanted.caption.families, result.fontsWanted.caption.weight, dir);
    if (got) result.style.fonts = { caption: await registerFont(got), keyword: null, title: null };
  }
  result.style = withChoice(result.style, result.subtitles, result.choice);
  if (!result.style.fonts) result.style.fonts = { caption: null, keyword: null, title: null };
  return result;
}
