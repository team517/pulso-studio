// Análisis a fondo de los vídeos de un estilo: Claude mira hojas de fotogramas (vista general, ráfagas para
// ver zooms y animaciones, y fotogramas a tamaño completo para reconocer la letra) y devuelve el estilo con
// valores exactos. La tipografía se descarga de Google Fonts (la misma o la más parecida).
// Se usa en el PC (worker.js) o en local; nunca en el servidor (allí no hay Claude).
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import { join, extname } from "node:path";
import { askClaude, canSeeImages } from "./autoedit/brain.js";

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

/**
 * Analiza los archivos de un estilo. Devuelve { name, summary, style, fontsWanted, raw } (sin descargar fuentes).
 * @param files rutas locales (vídeos e imágenes)
 */
export async function analyzePresetFiles(files, workDir) {
  if (!(await canSeeImages())) throw new Error("Claude no tiene la sesión iniciada en tu PC: no puede mirar los vídeos.");
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const vids = files.filter((f) => VID_EXT.includes(extname(f).toLowerCase()));
  const imgs = files.filter((f) => !VID_EXT.includes(extname(f).toLowerCase()));
  const list = [];
  for (const [k, v] of vids.slice(0, 6).entries()) list.push(...(await sheetsFor(v, k, workDir)));
  for (const [k, im] of imgs.slice(0, 6).entries()) {
    // Claude solo puede leer dentro de la carpeta de trabajo: se copian ahí
    const to = join(workDir, `captura-${k + 1}${extname(im).toLowerCase()}`);
    copyFileSync(im, to);
    list.push({ f: to, what: `captura ${k + 1}` });
  }
  if (!list.length) throw new Error("No he podido sacar fotogramas de esos archivos.");
  const rhythm = vids.length ? await cutsPerMin(vids) : null;
  const r = await askClaude(PROMPT(list, rhythm), { images: list.map((x) => x.f), dir: workDir, timeoutMs: 15 * 60e3, maxTurns: list.length + 8 });
  const style = toPresetStyle(r, rhythm);
  const fontsWanted = {
    caption: r.fonts?.caption?.family ? { families: [r.fonts.caption.family, ...(r.fonts.caption.alternatives || [])], weight: style.caption.weight, seen: r.fonts.caption.seen || "" } : null,
    keyword: r.fonts?.keyword?.family ? { families: [r.fonts.keyword.family, ...(r.fonts.keyword.alternatives || [])], weight: clamp(r.fonts.keyword.weight, 100, 900, 800), seen: r.fonts.keyword.seen || "" } : null,
  };
  return { name: String(r.name || "Mi estilo").slice(0, 40), summary: String(r.summary || "").slice(0, 1400), style, fontsWanted, raw: r, frames: readdirSync(workDir).length };
}
