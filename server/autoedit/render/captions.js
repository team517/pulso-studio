// Subtítulos: trozos de 1-3 palabras (chest/bottom/side/below-frame) o karaoke por frase (minimal).
// Textos SIN rebote: entradas suaves variadas (caracteres, palabras o línea).
import { esc, fitWrap, fitLine, r2, r3, rgba, contrast, ensureContrast } from "./text.js";
import { S, vb } from "./style.js";

const SOFT_W = '{ opacity: 0, y: 14, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.36, ease: "power3.out" }';
const SOFT_C = '{ opacity: 0, y: 11 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: 0.022 }';
const SOFT_L = '{ opacity: 0, y: 18, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.42, ease: "power3.out" }';
const KEY_W = '{ opacity: 0, scale: 1.12, filter: "blur(10px)" }, { opacity: 1, scale: 1, filter: "blur(0px)", duration: 0.45, ease: "power3.out" }';
const KEY_C = '{ opacity: 0, y: 23 }, { opacity: 1, y: 0, duration: 0.34, ease: "power3.out", stagger: 0.035 }';
const MODES = ["words", "chars", "line", "words", "line", "chars"];

// Lado corto del lienzo: las medidas v2 en px (borde, radio) van «a 1080» y se escalan con él
const shortSide = (input) => Math.min(input.width || 1080, input.height || 1920);

export function inRanges(t, ranges) {
  return ranges.some(([a, b]) => t >= a - 0.01 && t < b - 0.01);
}

// Recorta un tramo [s,e] para que no pise ningún tramo oculto; devuelve null si no queda nada útil
function trimToVisible(s, e, ranges) {
  if (inRanges(s, ranges)) return null;
  for (const [a] of ranges) if (a > s && a < e) e = a;
  return e - s >= 0.25 ? [s, e] : null;
}

export function buildCaptions(input, geo, hidden) {
  const box = geo.cap, theme = input.theme;
  const caps = [...(input.captions || [])].filter((c) => c.words && c.words.length).sort((a, b) => a.start - b.start);
  const lines = [], js = [];
  if (box.style === "karaoke") return buildKaraoke(caps, input, geo, hidden);
  const st = S(), cs = st.caption, anim = cs.animation, kst = cs.keywordStyle;
  const size = Math.round(box.size * cs.scale), keyMax = Math.round(box.key * cs.scale);
  const fCap = st.fonts.caption.key, fKey = st.fonts.keyword.key;
  const up = (t) => (cs.uppercase ? t.toUpperCase() : t);
  // v2 (calcar una referencia): sin estos campos, las cuentas son las de siempre
  const kScale = cs.keywordScale ?? 1, same = cs.keywordFont === "same", kwFont = cs.keywordFont === "keyword";
  const ls = cs.letterSpacing ?? null;
  const strokePx = cs.stroke ? (cs.stroke.width * shortSide(input)) / 1080 : 0; // borde visible a cada lado
  const wEm = cs.weight > 700 ? ((cs.weight - 700) / 200) * 0.03 : 0; // más peso = letras más anchas

  caps.forEach((c, i) => {
    const next = caps[i + 1];
    let s = c.start, e = Math.max(c.end, s + 0.4);
    if (next) e = Math.min(e, next.start);
    e = Math.min(e, input.duration);
    const vis = trimToVisible(s, e, hidden);
    if (!vis) return;
    [s, e] = vis;
    const id = `c${i}`;
    const text = c.words.map((w) => w.w).join(" ");
    const mode = anim === "soft" ? MODES[(c.phrase ?? i) % MODES.length] : anim === "typewriter" ? "chars" : "words";
    const big = c.key && kst === "big", boxed = c.key && kst === "box";
    // mejor en una línea; si no cabe ni reducida, dos líneas que quepan en el alto de la caja
    let [font, t2, max, sp, lh] = big
      ? [same ? fCap : fKey, cs.uppercase === false ? text : text.toUpperCase(), kScale !== 1 ? Math.round(keyMax * kScale) : keyMax, 0.01, same ? 1.1 : 1.0]
      : [c.key && kwFont ? fKey : fCap, up(text), c.key && kst === "highlight" && kScale !== 1 ? Math.round(size * kScale) : size, -0.02, 1.1];
    if (ls != null) sp = ls;
    else if (font !== (big ? fKey : fCap)) sp = font === fKey ? 0.01 : -0.02; // fuente cambiada por keywordFont
    const ms = font === fCap && wEm ? sp + wEm : sp; // espaciado para medir (más peso, más ancho)
    if (cs.bg) max = Math.min(max, Math.floor(box.h / (lh + 0.55))); // la caja añade .25em arriba y abajo
    let bw = boxed ? box.w - max * 0.9 : box.w; // la caja de color añade relleno
    if (cs.bg && !boxed) bw -= max * 0.9;
    if (strokePx) bw -= 2 * strokePx;
    let F;
    if (cs.lines === 1) F = { size: fitLine(t2, font, bw, max, 8, ms) }; // siempre una línea: se reduce lo que haga falta
    else {
      F = fitWrap(t2, font, bw, 1, max, Math.round(max * 0.6), ms);
      if (F.lines.length > 1 || F.size < Math.round(max * 0.6)) F = fitWrap(t2, font, bw, 2, Math.min(max, Math.floor(box.h / (2 * lh + 0.1))), 20, ms);
    }
    let spans = "";
    c.words.forEach((w, k) => {
      const wid = `${id}w${k}`;
      const inner = mode === "chars" ? [...w.w].map((ch) => `<span class="ch">${esc(ch)}</span>`).join("") : esc(w.w);
      spans += `<span id="${wid}" class="w">${inner}</span>`;
      const t = Math.max(s, Math.min(w.t ?? s, e - 0.1));
      if (boxed) { /* la caja entra entera con sus palabras (abajo) */ }
      else if (anim === "pop") js.push(`ctl.fromTo("#${wid}", { opacity: 0, scale: .55 }, { opacity: 1, scale: 1, duration: ${cs.inMs ? r3(Math.min(0.9, Math.max(0.2, cs.inMs / 1000))) : 0.6}, ease: ${vb(0.06)} }, ${r3(t)});`);
      else if (anim === "typewriter") {
        const n = [...w.w].length, nt = k + 1 < c.words.length ? Math.min(c.words[k + 1].t ?? e, e) : e;
        const step = r3(Math.max(0.012, Math.min(0.05, ((nt - t) * 0.7) / Math.max(1, n))));
        js.push(`ctl.fromTo("#${wid} .ch", { opacity: 0 }, { opacity: 1, duration: 0.01, ease: "none", stagger: ${step} }, ${r3(t)});`);
      } else if (anim === "word") js.push(`ctl.fromTo("#${wid}", { opacity: 0 }, { opacity: 1, duration: ${cs.inMs ? r3(Math.min(0.4, Math.max(0.03, cs.inMs / 1000))) : 0.05}, ease: "none" }, ${r3(t)});`);
      else if (mode === "chars") js.push(`ctl.fromTo("#${wid} .ch", ${c.key ? KEY_C : SOFT_C}, ${r3(t)});`);
      else if (mode === "words") js.push(`ctl.fromTo("#${wid}", ${c.key ? KEY_W : SOFT_W}, ${r3(t)});`);
    });
    if (boxed && anim === "soft") js.push(`ctl.fromTo("#${id} .line", ${KEY_W}, ${r3(s)});`);
    else if (boxed) {
      js.push(`ctl.fromTo("#${id} .line", { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, ${r3(s)});`);
      js.push(`ctl.fromTo("#${id} .line", { scale: .7 }, { scale: 1, duration: 0.6, ease: ${vb(0.06)} }, ${r3(s)});`);
    } else if (anim === "soft" && mode === "line") js.push(`ctl.fromTo("#${id} .line", ${c.key ? KEY_W : SOFT_L}, ${r3(s)});`);
    lines.push(`        <div id="${id}" class="cap${c.key ? (big ? " key" : " k-" + kst) : ""} clip" data-start="${r3(s)}" data-duration="${r3(e - s)}" data-track-index="1"><div class="line" style="font-size:${F.size}px">${spans}</div></div>`);
  });

  const css = `
        #captions-root { position: absolute; inset: 0; }
        #captions-root .cap { position: absolute; left: ${box.x}px; top: ${box.y}px; width: ${box.w}px; height: ${box.h}px; display: flex; align-items: center; justify-content: center; text-align: center; }
        #captions-root .ch { display: inline-block; }
        #captions-root .line { display: flex; flex-wrap: wrap; justify-content: center; align-items: baseline; column-gap: .26em; max-width: 100%; }
        #captions-root .w { display: inline-block; font-family: "Geist", "Rajdhani", sans-serif; font-weight: 600; line-height: 1.08; letter-spacing: -.02em; color: #fff; white-space: nowrap;
              text-shadow: 0 3px 14px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.75); }
        #captions-root .key .line { column-gap: .2em; }
        #captions-root .key .w { font-family: "Anton", sans-serif; font-weight: 400; line-height: .98; letter-spacing: .01em; text-transform: uppercase; color: ${theme.gold};
              text-shadow: 0 0 34px ${rgba(theme.gold, 0.5)}, 0 6px 18px rgba(0,0,0,.65); }` + userCaptionCss(theme, shortSide(input));
  return { html: lines.join("\n"), js, css };
}

// Karaoke: la frase entera visible; la palabra que suena se marca con una píldora de color.
function buildKaraoke(caps, input, geo, hidden) {
  const box = geo.cap, theme = input.theme;
  // páginas: por frase, en grupos de ≤ 6 palabras (cortando entre trozos)
  const pages = [];
  let cur = null;
  for (const c of caps) {
    const nw = c.words.length;
    if (!cur || cur.phrase !== c.phrase || cur.words.length + nw > 6) {
      cur = { phrase: c.phrase, start: c.start, end: c.end, words: [] };
      pages.push(cur);
    }
    c.words.forEach((w) => cur.words.push({ w: w.w, t: w.t ?? c.start, key: !!c.key }));
    cur.end = Math.max(cur.end, c.end);
  }
  const html = [], js = [];
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    let s = p.start, e = Math.max(p.end + 0.15, s + 0.5);
    if (next) e = Math.min(e, next.start);
    e = Math.min(e, input.duration);
    const vis = trimToVisible(s, e, hidden);
    if (!vis) return;
    [s, e] = vis;
    const id = `k${i}`;
    const st = S(), kUp = st.caption.uppercase !== false;
    const text = kUp ? p.words.map((w) => w.w).join(" ").toUpperCase() : p.words.map((w) => w.w).join(" ");
    const kc = st.caption, kStroke = kc.stroke ? (2 * kc.stroke.width * shortSide(input)) / 1080 : 0;
    const kSp = (kc.letterSpacing ?? 0.0) + (kc.weight > 800 ? ((kc.weight - 800) / 100) * 0.03 : 0);
    const F = fitWrap(text, st.fonts.caption.key, box.w - 40 - kStroke, 3, Math.round(box.size * st.caption.scale), 40, kSp);
    let spans = "";
    p.words.forEach((w, k) => {
      spans += `<span id="${id}w${k}" class="kw${w.key ? " gold" : ""}"><span id="${id}h${k}" class="hl"></span><span class="kt">${esc(w.w)}</span></span>`;
      const t = Math.max(s, Math.min(w.t, e - 0.08));
      const tn = k + 1 < p.words.length ? Math.max(t + 0.08, Math.min(p.words[k + 1].t, e)) : e;
      js.push(`ctl.fromTo("#${id}w${k}", { opacity: .4 }, { opacity: 1, duration: 0.1, ease: "none" }, ${r3(t)});`);
      js.push(`ctl.fromTo("#${id}h${k}", { opacity: 0, scale: .8 }, { opacity: 1, scale: 1, duration: 0.14, ease: "power2.out" }, ${r3(t)});`);
      js.push(`ctl.fromTo("#${id}w${k} .kt", { scale: 1 }, { scale: 1.08, duration: 0.14, ease: "power2.out" }, ${r3(t)});`);
      if (tn < e - 0.02) {
        js.push(`ctl.fromTo("#${id}h${k}", { opacity: 1 }, { opacity: 0, duration: 0.1, ease: "none", immediateRender: false }, ${r3(tn)});`);
        js.push(`ctl.fromTo("#${id}w${k} .kt", { scale: 1.08 }, { scale: 1, duration: 0.12, ease: "power2.out", immediateRender: false }, ${r3(tn)});`);
      }
    });
    js.push(`ctl.fromTo("#${id} .kl", { opacity: 0, y: 24, filter: "blur(8px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.3, ease: "power3.out" }, ${r3(s)});`);
    html.push(`        <div id="${id}" class="kp clip" data-start="${r3(s)}" data-duration="${r3(e - s)}" data-track-index="1"><div class="kl" style="font-size:${F.size}px">${spans}</div></div>`);
  });
  const css = `
        #captions-root { position: absolute; inset: 0; }
        #captions-root .kp { position: absolute; left: ${box.x}px; top: ${box.y}px; width: ${box.w}px; height: ${box.h}px; display: flex; align-items: center; justify-content: center; text-align: center; }
        #captions-root .kl { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; column-gap: .3em; row-gap: .12em; max-width: 100%;
              font-family: "Geist", sans-serif; font-weight: 800; line-height: 1.1; letter-spacing: -.01em; text-transform: uppercase; }
        #captions-root .kw { position: relative; display: inline-block; color: #fff; white-space: nowrap; }
        #captions-root .kw.gold { color: ${theme.gold}; }
        #captions-root .hl { position: absolute; left: -.16em; right: -.16em; top: .02em; bottom: -.02em; border-radius: .2em; background: ${theme.accent};
              box-shadow: 0 8px 26px -6px ${rgba(theme.accent, 0.9)}; opacity: 0; display: block; }
        #captions-root .kt { position: relative; display: inline-block; text-shadow: 0 4px 16px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.7); }` + userKaraokeCss(theme, shortSide(input));
  return { html: html.join("\n"), js, css };
}

// ─────────────── estilo del usuario (sin estilo no añade nada) ───────────────
function userCaptionCss(theme, W) {
  const st = S();
  if (!st.user) return "";
  const col = st.colors.caption, sh = st.colors.captionShadow, fC = st.fonts.caption, fK = st.fonts.keyword;
  const G = st.caption.keywordColor || theme.gold; // color de la palabra clave (v2) o el de siempre
  // la palabra clave «normal» de un trozo con caja/color sigue las mismas reglas de mayúsculas
  let css = `
        #captions-root .w { font-family: ${fC.css}; color: ${col};${fC.user ? " font-weight: " + fC.weight + ";" : ""}${sh ? " text-shadow: " + sh + ";" : ""}${st.caption.uppercase ? " text-transform: uppercase;" : ""} }`;
  if (st.caption.keywordStyle === "big") {
    css += `
        #captions-root .key .w { font-family: ${fK.css}; color: ${G};${st.caption.uppercase === false ? " text-transform: none;" : " text-transform: uppercase;"} text-shadow: 0 0 34px ${rgba(G, 0.5)}, 0 6px 18px rgba(0,0,0,.65); }`;
  } else if (st.caption.keywordStyle === "highlight") {
    css += `
        #captions-root .k-highlight .w { color: ${G}; font-weight: 800; text-shadow: 0 0 22px ${rgba(G, 0.45)}, 0 3px 12px rgba(0,0,0,.6); }`;
  } else {
    const bg = G, fg = st.caption.keywordColor ? (contrast("#ffffff", G) >= 3 ? "#ffffff" : "#111318") : st.colors.onKeyword;
    css += `
        #captions-root .k-box .line { background: ${bg}; padding: .1em .38em .14em; border-radius: .24em; box-shadow: 0 10px 30px -8px ${rgba(bg, 0.8)}; }
        #captions-root .k-box .w { color: ${fg}; font-weight: 800; text-shadow: none; }`;
  }
  return css + v2CaptionCss(W);
}

// Sombra v2 del texto: texto oscuro (captionShadow) → sombras claras; «none» sin borde ni caja deja lo justo para leerse
function v2Shadow(st, framed) {
  const cs = st.caption, sc = st.colors.captionShadow ? "255,255,255" : "0,0,0";
  if (cs.shadow === "soft") return `0 2px 10px rgba(${sc},.45), 0 1px 2px rgba(${sc},.35)`;
  if (cs.shadow === "strong") return `0 3px 6px rgba(${sc},.85), 0 0 22px rgba(${sc},.55), 0 1px 2px rgba(${sc},.9)`;
  if (cs.shadow === "none") return framed ? "none" : `0 1px 3px rgba(${sc},.4)`;
  return null;
}

// v2: peso, espaciado, borde, sombra, caja detrás, una sola línea y fuente de la palabra clave (solo lo que venga)
function v2CaptionCss(W) {
  const st = S(), cs = st.caption, fC = st.fonts.caption, fK = st.fonts.keyword, k = W / 1080;
  const ALL = "#captions-root .w, #captions-root .key .w, #captions-root .k-highlight .w";
  let css = "";
  const add = (rule) => { css += "\n        " + rule; };
  if (cs.weight != null) add(`#captions-root .w { font-weight: ${cs.weight}; }`);
  if (cs.letterSpacing != null) add(`${ALL}, #captions-root .k-box .w { letter-spacing: ${r3(cs.letterSpacing)}em; }`);
  if (cs.keywordFont === "same") {
    const w = cs.weight ?? (fC.user ? fC.weight : 600);
    add(`#captions-root .key .w, #captions-root .k-highlight .w, #captions-root .k-box .w { font-family: ${fC.css}; font-weight: ${w};${cs.letterSpacing == null ? " letter-spacing: -.02em;" : ""} }`);
    add(`#captions-root .key .w { line-height: 1.08; }`);
    add(`#captions-root .key .line { column-gap: .26em; }`);
  } else if (cs.keywordFont === "keyword" && cs.keywordStyle !== "big") {
    add(`#captions-root .k-highlight .w, #captions-root .k-box .w { font-family: ${fK.css}; font-weight: ${fK.weight}; line-height: .98;${cs.letterSpacing == null ? " letter-spacing: .01em;" : ""} }`);
  }
  const sh = v2Shadow(st, !!(cs.stroke || cs.bg));
  if (sh) add(`${ALL} { text-shadow: ${sh}; }`);
  // borde: el trazo va por detrás del relleno (paint-order), así que se pinta al doble para que se vean «width» px fuera
  if (cs.stroke) add(`${ALL} { -webkit-text-stroke: ${r2(cs.stroke.width * k * 2)}px ${cs.stroke.color}; paint-order: stroke fill; }`);
  if (cs.bg) add(`#captions-root .line { background: ${rgba(cs.bg.color, cs.bg.opacity)}; padding: .25em .45em; border-radius: ${r2(cs.bg.radius * k)}px; }`);
  if (cs.lines === 1) add(`#captions-root .line { flex-wrap: nowrap; }`);
  return css;
}

function v2KaraokeCss(st, W) {
  const cs = st.caption, k = W / 1080;
  let css = "";
  const add = (rule) => { css += "\n        " + rule; };
  if (cs.weight != null) add(`#captions-root .kl { font-weight: ${cs.weight}; }`);
  if (cs.letterSpacing != null) add(`#captions-root .kl { letter-spacing: ${r3(cs.letterSpacing)}em; }`);
  if (cs.keywordColor) add(`#captions-root .kw.gold { color: ${cs.keywordColor}; }`);
  const sh = v2Shadow(st, !!cs.stroke);
  if (sh) add(`#captions-root .kt { text-shadow: ${sh}; }`);
  if (cs.stroke) add(`#captions-root .kt { -webkit-text-stroke: ${r2(cs.stroke.width * k * 2)}px ${cs.stroke.color}; paint-order: stroke fill; }`);
  return css;
}

function userKaraokeCss(theme, W) {
  const st = S();
  if (!st.user) return "";
  const col = st.colors.caption, fC = st.fonts.caption;
  const pill = contrast(col, theme.accent) >= 2.5 ? theme.accent : ensureContrast(theme.accent, col, 2.5);
  return `
        #captions-root .kl { font-family: ${fC.css};${st.caption.uppercase === false ? " text-transform: none;" : ""} }
        #captions-root .kw { color: ${col}; }
        #captions-root .kw.gold { color: ${theme.gold}; }
        #captions-root .hl { background: ${pill}; box-shadow: 0 8px 26px -6px ${rgba(pill, 0.9)}; }${st.colors.captionShadow ? `
        #captions-root .kt { text-shadow: ${st.colors.captionShadow}; }` : ""}` + v2KaraokeCss(st, W);
}
