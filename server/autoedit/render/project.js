// Genera los proyectos HyperFrames (index.html + compositions/*.html) de cada etapa.
// Todo el JS de animación se escribe aquí con selectores literales (el bundler no admite plantillas dentro).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SLOT_BUILDERS, SPRING, graphicsCss, buildScene, bigWordSize } from "./graphics.js";
import { buildCaptions } from "./captions.js";
import { esc, fitWrap, r2, r3, rgba, clamp } from "./text.js";
import { MAX_ZOOM } from "./layouts.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "assets");
const NL = "\n";
const IN = "duration: 1.1, ease: VB(0.07)";
// piezas que no son cristal y se van con desenfoque al salir
const XB = [".tx", ".bdg", ".ringsvg", ".num", ".slab", ".dlab", ".clab", ".il", ".halo", ".pt", ".ck", ".rt", ".kick", ".big"];

const FONTS = `
        @font-face { font-family: "Anton"; src: url("assets/fonts/anton-400.woff2") format("woff2"); font-weight: 400; }
        @font-face { font-family: "Geist"; src: url("assets/fonts/geist-latin.woff2") format("woff2"); font-weight: 100 900;
              unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }
        @font-face { font-family: "Geist"; src: url("assets/fonts/geist-latin-ext.woff2") format("woff2"); font-weight: 100 900;
              unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF; }
        @font-face { font-family: "Rajdhani"; src: url("assets/fonts/rajdhani-600.woff2") format("woff2"); font-weight: 600; }
        @font-face { font-family: "Rajdhani"; src: url("assets/fonts/rajdhani-700.woff2") format("woff2"); font-weight: 700; }`;

function copyAssets(dir) {
  fs.mkdirSync(path.join(dir, "assets", "fonts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "compositions"), { recursive: true });
  for (const f of fs.readdirSync(path.join(ASSETS, "fonts"))) fs.copyFileSync(path.join(ASSETS, "fonts", f), path.join(dir, "assets", "fonts", f));
  fs.copyFileSync(path.join(ASSETS, "gsap.min.js"), path.join(dir, "assets", "gsap.min.js"));
}

// Enlace duro (rápido) o copia
export function linkOrCopy(src, dst) {
  try { fs.rmSync(dst, { force: true }); } catch {}
  try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
}

function write(file, text) {
  fs.writeFileSync(file, text, { encoding: "utf8" });
}

function composition(id, rootId, W, H, D, css, body, script, tlName) {
  return `<!doctype html>
<html lang="es"><head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <style>${FONTS}${css}
      </style>
      <div id="${rootId}" data-composition-id="${id}" data-width="${W}" data-height="${H}" data-duration="${r3(D)}">
${body}
      </div>
      <script>
        ${SPRING}
        const ${tlName} = gsap.timeline({ paused: true });
${script.map((l) => "        " + l).join(NL)}
        window.__timelines["${id}"] = ${tlName};
      </script>
    </template>
  </body>
</html>
`;
}

function host(cid, src, track, W, H, D, extra = "") {
  return `      <div id="${cid}-host" class="layer" data-composition-id="${cid}" data-composition-src="compositions/${src}"${extra} data-start="0" data-duration="${r3(D)}" data-track-index="${track}" data-width="${W}" data-height="${H}"></div>`;
}

function indexHtml({ W, H, D, bg, head = "", body, script }) {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="assets/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${bg}; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; }
      .layer { position: absolute; inset: 0; }${head}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${r3(D)}" data-width="${W}" data-height="${H}">
${body}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
${script.map((l) => "      " + l).join(NL)}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

// ─────────────── reparto de gráficos según el formato ───────────────
export function planGraphics(input, geo, hasMatte) {
  const D = input.duration;
  const ok = (input.graphics || [])
    .filter((g) => g && geo.types.includes(g.type))
    .map((g) => ({ ...g, start: clamp(+g.start || 0, 0, D), end: clamp(+g.end || 0, 0, D) }))
    .filter((g) => g.end - g.start >= 0.5)
    .sort((a, b) => a.start - b.start);
  const scenes = ok.filter((g) => g.type === "scene");
  const behind = ok.filter((g) => g.type === "behind");
  let slot = ok.filter((g) => g.type !== "scene" && g.type !== "behind");
  // sin mate y sin hueco encima de la cabeza (horizontal): la palabra va al panel como un gráfico más
  if (!hasMatte && !geo.overlayWord) slot = [...slot, ...behind.map((g) => ({ ...g, type: "word" }))].sort((a, b) => a.start - b.start);
  // nada de tarjetas durante una escena a pantalla completa
  for (const sc of scenes) {
    slot = slot.map((g) => {
      if (g.end <= sc.start || g.start >= sc.end) return g;
      if (g.start < sc.start) return { ...g, end: sc.start };
      return { ...g, start: sc.end };
    }).filter((g) => g.end - g.start >= 0.6 && g.end <= D);
  }
  // una idea cada vez: si se pisan, el anterior sale antes
  slot.sort((a, b) => a.start - b.start);
  for (let i = 0; i < slot.length - 1; i++) if (slot[i].end > slot[i + 1].start - 0.05) slot[i] = { ...slot[i], end: slot[i + 1].start - 0.05 };
  slot = slot.filter((g) => g.end - g.start >= 0.6);
  if (slot.length > geo.maxSlot) {
    const keep = new Set([...slot].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, geo.maxSlot));
    slot = slot.filter((g) => keep.has(g));
  }
  return { slot, scenes, behind };
}

// Tramos sin subtítulos
export function hiddenRanges(input, geo, plan) {
  const r = [...(input.hideCaptionsDuring || [])].map(([a, b]) => [+a, +b]);
  for (const s of plan.scenes) r.push([s.start, s.end]);
  if (geo.layout === "minimal") for (const g of plan.slot) r.push([g.start, g.end]);
  return r.sort((a, b) => a[0] - b[0]);
}

// ─────────────── zooms ───────────────
function zoomScript(input, geo) {
  const D = input.duration, out = [];
  const punchy = geo.layout === "minimal";
  const zs = [...(input.zooms || [])].map((z) => ({ t: clamp(+z.t || 0, 0, D), to: clamp(+z.to || 1, 1, MAX_ZOOM), dur: Math.max(0.3, +z.dur || 1.2), ease: z.ease }))
    .sort((a, b) => a.t - b.t);
  let cur = 1;
  if (!zs.length || zs[0].t >= 1.5) { out.push(`tl.fromTo("#zoom", { scale: 1.06 }, { scale: 1, duration: 1.4, ease: "power3.out" }, 0);`); }
  zs.forEach((z, i) => {
    let dur = punchy ? Math.max(0.35, z.dur * 0.6) : z.dur;
    const next = zs[i + 1];
    if (next && z.t + dur > next.t) dur = Math.max(0.2, next.t - z.t);
    if (z.t + dur > D) dur = Math.max(0.1, D - z.t);
    const ease = z.ease || (punchy ? "power3.inOut" : "power2.inOut");
    out.push(`tl.fromTo("#zoom", { scale: ${r3(cur)} }, { scale: ${r3(z.to)}, duration: ${r3(dur)}, ease: "${ease}"${out.length ? ", immediateRender: false" : ""} }, ${r3(z.t)});`);
    cur = z.to;
  });
  return out;
}

// ─────────────── etapa 1: capa «detrás» (en el espacio de la toma) ───────────────
export function buildBehindProject(input, words, dir) {
  copyAssets(dir);
  const W = input.base.srcWidth || 1080, H = input.base.srcHeight || 1920, k = W / 1080;
  const t0 = Math.max(0, Math.min(...words.map((g) => g.start)) - 0.1);
  const t1 = Math.min(input.duration, Math.max(...words.map((g) => g.end)) + 0.1);
  const D = t1 - t0;
  const body = [], js = [];
  words.forEach((g, i) => {
    const id = `b${i}`, s = g.start - t0, e = g.end - t0;
    const box = { x: 70 * k, y: 190 * k, w: 940 * k, h: 520 * k };
    const fs_ = bigWordSize(g.text, box.w, box.h, 420 * k);
    body.push(`        <div id="${id}" class="bh clip" data-start="${r3(s)}" data-duration="${r3(e - s)}" data-track-index="1" style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"><div class="in"><div class="big" style="font-size:${fs_}px">${esc(String(g.text).toUpperCase())}</div></div></div>`);
    js.push(`btl.fromTo("#${id} > .in", { opacity: 0, scale: 1.25, y: ${70 * k} }, { opacity: 1, scale: 1, y: 0, ${IN} }, ${r3(s)});`);
    if (g.end < input.duration - 0.05) js.push(`btl.fromTo("#${id} > .in", { opacity: 1, scale: 1 }, { opacity: 0, scale: .96, duration: 0.2, ease: "power2.in", immediateRender: false }, ${r3(e - 0.2)});`);
  });
  const G = input.theme.gold;
  const css = `
        #behind-root { position: absolute; inset: 0; }
        #behind-root .bh { position: absolute; display: flex; align-items: center; justify-content: center; }
        #behind-root .in { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
        #behind-root .big { font-family: "Anton", sans-serif; line-height: .92; letter-spacing: .01em; white-space: nowrap; padding: .14em .04em .02em;
              background: linear-gradient(180deg, #fff6d8 0%, ${G} 52%, ${shadeHex(G, -0.25)} 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
              filter: drop-shadow(0 0 ${30 * k}px ${rgba(G, 0.45)}) drop-shadow(0 ${12 * k}px ${20 * k}px rgba(0,0,0,.45)); }`;
  write(path.join(dir, "compositions", "behind.html"), composition("behind", "behind-root", W, H, D, css, body.join(NL), js, "btl"));
  write(path.join(dir, "index.html"), indexHtml({ W, H, D, bg: "transparent", body: host("behind", "behind.html", 1, W, H, D), script: [] }));
  return { t0, t1 };
}

function shadeHex(hex, f) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return "#" + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * (1 + f)).toString(16).padStart(2, "0")).join("");
}

// ─────────────── etapa 2: composición final ───────────────
export function buildFinalProject(input, geo, plan, baseVideo, dir, hasMatte) {
  copyAssets(dir);
  linkOrCopy(baseVideo, path.join(dir, "assets", "base.mp4"));
  const { W, H } = geo, D = input.duration, theme = input.theme;
  const sfx = [{ t: 0, kind: "hit" }];
  const addSfx = (t, kind) => sfx.push({ t: Math.max(0, Math.min(D - 0.05, t)), kind });
  const gjs = [], gcss = [], gbody = [];

  // titular
  const hook = input.hook && geo.title ? input.hook : null;
  if (hook) {
    const T = geo.title, band = !!T.band, padX = band ? 34 : 0;
    const raw = String(hook.title || "");
    const tf = fitWrap(raw.replace(/\*/g, ""), "geist", T.w - padX * 2, T.lines, T.maxSize, 30, -0.035);
    const subSize = Math.min(36, Math.round(tf.size * 0.5));
    const sf = hook.subtitle ? fitWrap(hook.subtitle, "geist", T.w - padX * 2, 2, subSize, 20) : null;
    let gold = false;
    const words = raw.split(/\s+/).filter(Boolean).map((w) => {
      const open = w.startsWith("*"), close = w.endsWith("*");
      if (open) gold = true;
      const html = `<span class="hw${gold ? " hk" : ""}">${esc(w.replace(/\*/g, ""))}</span>`;
      if (close) gold = false;
      return html;
    }).join(" ");
    const align = T.align === "left" ? "flex-start" : "center";
    gbody.push(`        <div id="hook" class="hook clip" data-start="0" data-duration="${r3(D)}" data-track-index="4" style="left:${T.x}px;top:${T.y}px;width:${T.w}px;${band ? "" : `height:${T.h}px;`}align-items:${align};text-align:${T.align}">`
      + `<div id="hookb" class="${band ? "glass hband" : ""}"><div class="htit" style="font-size:${tf.size}px">${words}</div>`
      + (sf ? `<div class="hsub" style="font-size:${sf.size}px">${esc(hook.subtitle)}</div>` : "") + `</div></div>`);
    if (band) gjs.push(`gtl.fromTo("#hookb", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, 0.05);`);
    gjs.push(`gtl.fromTo("#hook", { y: -30 }, { y: 0, ${IN} }, 0.05);`);
    gjs.push(`gtl.fromTo("#hook .hw", { opacity: 0, y: 12, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.4, ease: "power3.out", stagger: 0.05 }, 0.15);`);
    if (sf) gjs.push(`gtl.fromTo("#hook .hsub", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, 0.5);`);
    // en verticales el titular se aparta durante las palabras gigantes
    if (geo.H > geo.W && geo.frame.r === 0 && (hasMatte || geo.overlayWord)) {
      for (const b of plan.behind) {
        gjs.push(`gtl.fromTo("#hookb, #hook .htit, #hook .hsub", { opacity: 1 }, { opacity: 0, duration: 0.2, immediateRender: false }, ${r3(Math.max(0.6, b.start - 0.15))});`);
        if (b.end < D - 0.3) {
          gjs.push(`gtl.fromTo("#hookb, #hook .htit, #hook .hsub", { opacity: 0 }, { opacity: 1, duration: 0.3, immediateRender: false }, ${r3(b.end)});`);
        }
      }
    }
  }

  // gráficos en la zona de tarjetas
  plan.slot.forEach((g, i) => {
    const id = `g${i}`, s = g.start, e = g.end;
    const ctx = { id, s, e, theme, js: (l) => gjs.push(l), css: (l) => gcss.push(l), sfx: addSfx };
    let built;
    if (g.type === "word") {
      const fz = bigWordSize(g.text, geo.slot.w, geo.slot.h * 0.7, 260);
      built = { html: `<div class="big" style="font-size:${fz}px">${esc(String(g.text).toUpperCase())}</div>`, w: geo.slot.w, h: fz, noFadeIn: true };
      gjs.push(`gtl.fromTo("#${id} .big", { opacity: 0 }, { opacity: 1, duration: 0.2 }, ${r3(s)});`);
      addSfx(s - 0.02, "hit");
    } else {
      built = SLOT_BUILDERS[g.type](g, ctx);
      addSfx(s - 0.03, "whoosh");
    }
    const z = geo.slot;
    const scale = r3(Math.min(z.maxScale, z.w / built.w, z.h / (built.h * 1.06)));
    const ai = { start: "flex-start", center: "center", end: "flex-end" }[z.align];
    const origin = { start: "50% 0%", center: "50% 50%", end: "50% 100%" }[z.align];
    gbody.push(`        <div id="${id}" class="slot clip" data-start="${r3(s)}" data-duration="${r3(e - s)}" data-track-index="1" style="left:${z.x}px;top:${z.y}px;width:${z.w}px;height:${z.h}px;align-items:${ai}">`
      + `<div class="sc" style="transform:scale(${scale});transform-origin:${origin}"><div class="in">${built.html}</div></div></div>`);
    const sel = `#${id} > .sc > .in`;
    const inDur = r3(Math.min(1.1, Math.max(0.5, e - s - 0.25)));
    gjs.push(`gtl.fromTo("${sel}", { y: 70, scale: .9 }, { y: 0, scale: 1, duration: ${inDur}, ease: VB(0.07) }, ${r3(s)});`);
    if (!built.noFadeIn) gjs.push(`gtl.fromTo("#${id} .e0", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, ${r3(s)});`);
    if (built.html.includes('class="sweep"')) gjs.push(`gtl.fromTo("#${id} .sweep", { x: -200 }, { x: 1000, duration: 0.9, ease: "power2.inOut" }, ${r3(s + 0.3)});`);
    if (e < D - 0.05) {
      gjs.push(`gtl.fromTo("${sel}", { y: 0, scale: 1 }, { y: -30, scale: .95, duration: 0.22, ease: "power2.in", immediateRender: false }, ${r3(e - 0.22)});`);
      gjs.push(`gtl.fromTo("#${id} .gp", { opacity: 1 }, { opacity: 0, duration: 0.2, ease: "power2.in", immediateRender: false }, ${r3(e - 0.22)});`);
      gjs.push(`gtl.fromTo("${XB.map((c) => `#${id} ${c}`).join(", ")}", { opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(10px)", duration: 0.2, ease: "power2.in", immediateRender: false }, ${r3(e - 0.22)});`);
    }
  });

  // palabras gigantes sin mate: delante, encima de la cabeza
  if (!hasMatte && geo.overlayWord) {
    plan.behind.forEach((g, i) => {
      const id = `w${i}`, b = geo.overlayWord, s = g.start, e = g.end;
      const fz = bigWordSize(g.text, b.w, b.h, b.max);
      gbody.push(`        <div id="${id}" class="ow clip" data-start="${r3(s)}" data-duration="${r3(e - s)}" data-track-index="2" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><div class="in"><div class="big" style="font-size:${fz}px">${esc(String(g.text).toUpperCase())}</div></div></div>`);
      gjs.push(`gtl.fromTo("#${id} > .in", { opacity: 0, scale: 1.25, y: 40 }, { opacity: 1, scale: 1, y: 0, ${IN} }, ${r3(s)});`);
      if (e < D - 0.05) gjs.push(`gtl.fromTo("#${id} > .in", { opacity: 1, scale: 1, filter: "blur(0px)" }, { opacity: 0, scale: .96, filter: "blur(10px)", duration: 0.2, ease: "power2.in", immediateRender: false }, ${r3(e - 0.2)});`);
      addSfx(s - 0.02, "hit");
    });
  } else if (hasMatte) {
    plan.behind.forEach((g) => addSfx(g.start - 0.02, "hit"));
  }

  // escenas a pantalla completa (encima de todo)
  plan.scenes.forEach((g, i) => {
    const id = `s${i}`;
    const ctx = { id, s: g.start, e: g.end, theme, js: (l) => gjs.push(l), css: (l) => gcss.push(l), sfx: addSfx };
    const html = buildScene(g, ctx, geo);
    gbody.push(`        <div id="${id}" class="fs clip" data-layout-allow-occlusion data-start="${r3(g.start)}" data-duration="${r3(g.end - g.start)}" data-track-index="3">${html}</div>`);
  });

  write(path.join(dir, "compositions", "graphics.html"),
    composition("graphics", "gfx-root", W, H, D, graphicsCss(theme) + gcss.map((l) => "        " + l).join(NL), gbody.join(NL), gjs, "gtl"));

  // subtítulos
  const hidden = hiddenRanges(input, geo, plan);
  const cap = buildCaptions(input, geo, hidden);
  write(path.join(dir, "compositions", "captions.html"), composition("captions", "captions-root", W, H, D, cap.css, cap.html, cap.js, "ctl"));

  // index: fondo (formatos con marco), marco con #zoom y la toma, capas
  const f = geo.frame;
  let head = `
      #frame { position: absolute; left: ${f.x}px; top: ${f.y}px; width: ${f.w}px; height: ${f.h}px; overflow: hidden; border-radius: ${f.r}px;${f.shadow ? ` box-shadow: 0 40px 90px -30px rgba(0,0,0,.75), 0 0 0 1.5px rgba(255,255,255,.14), 0 0 80px -20px ${rgba(theme.accent, 0.45)};` : ""} }
      #zoom { position: absolute; inset: 0; transform-origin: 50% ${r2(f.originY * 100)}%; }
      #base { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% ${r2(f.py * 100)}%; }`;
  const body = [];
  const script = zoomScript(input, geo);
  if (geo.bg) {
    head += `
      #bg { position: absolute; inset: 0; overflow: hidden; background: ${theme.bg}; }
      #bg .orb { position: absolute; border-radius: 50%; display: block; }
      #bg .grid { position: absolute; inset: 0; display: block; background-image: linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px);
            background-size: 54px 54px; -webkit-mask-image: radial-gradient(ellipse 75% 70% at 50% 50%, #000 25%, transparent 100%); mask-image: radial-gradient(ellipse 75% 70% at 50% 50%, #000 25%, transparent 100%); }
      #bg .vign { position: absolute; inset: 0; display: block; background: radial-gradient(120% 100% at 50% 45%, transparent 55%, rgba(0,0,0,.6) 100%); }`;
    const M = Math.max(W, H);
    body.push(`      <div id="bg"><span id="orb0" class="orb" style="width:${M * 0.95}px;height:${M * 0.95}px;left:${-M * 0.3}px;top:${-M * 0.35}px;background:radial-gradient(circle, ${rgba(theme.accent, 0.5)}, transparent 65%)"></span>`
      + `<span id="orb1" class="orb" style="width:${M * 0.9}px;height:${M * 0.9}px;right:${-M * 0.3}px;bottom:${-M * 0.4}px;background:radial-gradient(circle, ${rgba(theme.accent2, 0.42)}, transparent 65%)"></span>`
      + `<span id="orb2" class="orb" style="width:${M * 0.6}px;height:${M * 0.6}px;left:${W * 0.45}px;top:${H * 0.1}px;background:radial-gradient(circle, ${rgba(theme.gold, 0.12)}, transparent 68%)"></span>`
      + `<span class="grid"></span><span class="vign"></span></div>`);
    script.push(`tl.fromTo("#orb0", { x: 0, y: 0 }, { x: ${r2(W * 0.18)}, y: ${r2(H * 0.12)}, duration: ${r3(D / 2)}, ease: "sine.inOut", yoyo: true, repeat: 1 }, 0);`);
    script.push(`tl.fromTo("#orb1", { x: 0, y: 0 }, { x: ${r2(-W * 0.16)}, y: ${r2(-H * 0.14)}, duration: ${r3(D / 2)}, ease: "sine.inOut", yoyo: true, repeat: 1 }, 0);`);
    script.push(`tl.fromTo("#orb2", { scale: 1, x: 0 }, { scale: 1.3, x: ${r2(-W * 0.2)}, duration: ${r3(D / 2)}, ease: "sine.inOut", yoyo: true, repeat: 1 }, 0);`);
  }
  body.push(`      <div id="frame"><div id="zoom"><video id="base" class="clip" src="assets/base.mp4" muted playsinline data-start="0" data-duration="${r3(D)}" data-track-index="0"></video></div></div>`);
  body.push(host("graphics", "graphics.html", 2, W, H, D));
  body.push(host("captions", "captions.html", 3, W, H, D, ' data-track-kind="captions"'));
  write(path.join(dir, "index.html"), indexHtml({ W, H, D, bg: geo.bg ? theme.bg : "#000", head, body: body.join(NL), script }));

  // efectos: ordenados y sin duplicados muy juntos
  sfx.sort((a, b) => a.t - b.t);
  const clean = [];
  for (const e of sfx) {
    const prev = clean.findLast?.((x) => x.kind === e.kind) ?? [...clean].reverse().find((x) => x.kind === e.kind);
    if (prev && e.t - prev.t < 0.08) continue;
    clean.push({ t: r3(e.t), kind: e.kind });
  }
  return { sfx: clean, hidden };
}
