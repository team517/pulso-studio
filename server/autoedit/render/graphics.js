// Plantillas de gráficos (cristal líquido). Cada constructor devuelve el HTML interior, su tamaño estimado
// (en px de diseño 1080) y añade al timeline las animaciones con selectores LITERALES.
// Regla del cristal: la opacidad se anima en el propio .glass (si se anima en un padre, Chrome deja de desenfocar).
import { icon } from "./icons.js";
import { esc, fitLine, fitWrap, textEm, fmtNum, r2, r3, rgba, clamp, shadeHex, ensureContrast } from "./text.js";
import { S, IN, IN_SOFT, vb, dist } from "./style.js";
import { fillTemplate, scopedCss } from "../../gfx-template.js";

export const SPRING = `const rb = (vel, fuerza, rebotes, frenado, t) => vel * fuerza * Math.sin(rebotes * t * 2 * Math.PI) / Math.exp(frenado * t);
        const VB = (fuerza = 0.12, llegada = 0.3) => (p) => { const tot = llegada + 0.8, t = p * tot; if (t < llegada) { const u = t / llegada; return u * u; } return 1 + rb(2 / llegada, fuerza, 2.5, 5, t - llegada); };`;
// claves de medida: texto de tarjetas (fuente «title») y cifras/palabras gigantes (fuente «keyword»)
const FT = () => S().fonts.title.key, FK = () => S().fonts.keyword.key;
// color del texto de las tarjetas (y su versión atenuada) según el aspecto
const TXT = () => (S().look === "light" ? ["rgba(21,22,30,1)", "rgba(21,22,30,.4)"] : ["rgba(255,255,255,1)", "rgba(255,255,255,.5)"]);
// Aparición con rebote: la opacidad va aparte y corta, para no pisar el fundido de salida
const POP = (sel, t, from = "scale: 0", to = "scale: 1", ease = IN_SOFT()) =>
  [`gtl.fromTo("${sel}", { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power1.out" }, ${r3(t)});`,
   `gtl.fromTo("${sel}", { ${from} }, { ${to}, ${ease} }, ${r3(t)});`];
const TXT_IN = (y = 14) => `{ opacity: 0, y: ${y}, filter: "blur(6px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.4, ease: "power3.out" }`;

// ─────────────── CSS común de los gráficos ───────────────
export function graphicsCss(theme) {
  return baseCss(theme) + styleCss(theme);
}

function baseCss(theme) {
  const A = theme.accent, A2 = theme.accent2, G = theme.gold, R = theme.red;
  return `
        #gfx-root { position: absolute; inset: 0; font-family: "Geist", "Rajdhani", sans-serif; color: #fff; }
        #gfx-root .slot { position: absolute; display: flex; justify-content: center; }
        #gfx-root .sc { display: block; }
        #gfx-root .in { display: block; position: relative; }
        #gfx-root .glass { position: relative; overflow: hidden; border-radius: 32px;
              background: linear-gradient(160deg, rgba(255,255,255,.16), rgba(255,255,255,.04) 55%), rgba(12,12,20,.38);
              border: 1.5px solid rgba(255,255,255,.24);
              backdrop-filter: blur(23px) saturate(1.45); -webkit-backdrop-filter: blur(23px) saturate(1.45);
              box-shadow: 0 35px 75px -25px rgba(0,0,0,.7), inset 0 1.5px 0 rgba(255,255,255,.22), 0 0 40px -12px ${rgba(A, 0.45)}; }
        #gfx-root .glass::before { content: ""; position: absolute; top: 0; left: 12%; right: 12%; height: 1.5px;
              background: linear-gradient(90deg, transparent, rgba(255,255,255,.85), transparent); }
        #gfx-root .sweep { position: absolute; top: -10%; bottom: -10%; left: 0; width: 110px; transform: skewX(-18deg);
              background: linear-gradient(100deg, transparent, rgba(255,255,255,.2), transparent); pointer-events: none; }
        #gfx-root .tx { display: block; text-shadow: 0 2px 10px rgba(0,0,0,.35); }
        #gfx-root svg.ico { display: block; }
        #gfx-root .itile { flex: none; width: 92px; height: 92px; border-radius: 26px; display: grid; place-items: center; color: #fff;
              background: linear-gradient(135deg, ${A}, ${A2}); box-shadow: 0 10px 30px -8px ${rgba(A, 0.8)}, inset 0 1.5px 0 rgba(255,255,255,.35); }
        #gfx-root .itile svg { width: 52px; height: 52px; }
        #gfx-root .bdg { position: absolute; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; color: #fff; z-index: 3;
              background: ${A}; box-shadow: 0 0 22px ${rgba(A, 0.85)}, 0 0 0 3px rgba(255,255,255,.9); }
        #gfx-root .bdg svg { width: 28px; height: 28px; stroke-width: 3.2; }
        #gfx-root .bdg.bad { background: ${R}; box-shadow: 0 0 22px ${rgba(R, 0.85)}, 0 0 0 3px rgba(255,255,255,.9); }

        /* tarjeta */
        #gfx-root .card { display: flex; align-items: center; gap: 24px; padding: 22px 36px 22px 22px; }
        #gfx-root .ctext { display: flex; flex-direction: column; gap: 4px; }
        #gfx-root .ct { font-weight: 700; line-height: 1.06; letter-spacing: -.02em; }
        #gfx-root .cs { font-weight: 500; line-height: 1.15; color: rgba(255,255,255,.74); letter-spacing: -.01em; }

        /* checklist */
        #gfx-root .chk { padding: 28px 40px 30px 30px; display: flex; flex-direction: column; gap: 12px; }
        #gfx-root .kick { line-height: 1.2; font-weight: 600; font-size: 28px; letter-spacing: .16em; text-transform: uppercase; color: ${rgba(A2, 1)}; filter: brightness(1.5); margin-bottom: 4px; }
        #gfx-root .row { display: flex; align-items: center; gap: 18px; }
        #gfx-root .ck { position: relative; flex: none; width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: ${A};
              box-shadow: 0 0 18px ${rgba(A, 0.8)}; }
        #gfx-root .ck svg { width: 28px; height: 28px; stroke-width: 3.2; }
        #gfx-root .rt { line-height: 1.2; font-weight: 600; letter-spacing: -.015em; white-space: nowrap; }

        /* tachados */
        #gfx-root .stk { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 14px; }
        #gfx-root .finrow { flex-basis: 100%; display: flex; justify-content: center; margin-top: 2px; }
        #gfx-root .pill { padding: 12px 32px; border-radius: 999px; white-space: nowrap; }
        #gfx-root .pill .pt { position: relative; display: inline-block; line-height: 1.25; font-weight: 600; letter-spacing: -.02em; }
        #gfx-root .pill .ln { position: absolute; left: -6px; right: -6px; top: 54%; height: 4px; border-radius: 2px; background: ${R};
              box-shadow: 0 0 12px ${rgba(R, 0.8)}; transform-origin: 0 50%; transform: scaleX(0); display: block; }
        #gfx-root .pill.fin { border-color: rgba(255,255,255,.65); background: linear-gradient(160deg, rgba(255,255,255,.26), rgba(255,255,255,.08)), rgba(12,12,20,.42);
              box-shadow: 0 0 46px -6px ${rgba(A, 0.75)}, 0 35px 75px -25px rgba(0,0,0,.7); }
        #gfx-root .pill.fin .pt { font-weight: 700; }

        /* dato con anillo */
        #gfx-root .stat { display: flex; flex-direction: column; align-items: center; gap: 14px; }
        #gfx-root .ringw { position: relative; width: 240px; height: 240px; }
        #gfx-root .ringbg { position: absolute; inset: 14px; border-radius: 50%; }
        #gfx-root .ringsvg { position: absolute; inset: 0; width: 240px; height: 240px; transform: rotate(-90deg); overflow: visible;
              filter: drop-shadow(0 0 10px ${rgba(G, 0.9)}) drop-shadow(0 0 26px ${rgba(G, 0.55)}); }
        #gfx-root .ringsvg circle { fill: none; stroke-width: 9; }
        #gfx-root .ringsvg .rb { stroke: rgba(255,255,255,.13); }
        #gfx-root .ringsvg .rp { stroke: ${G}; stroke-linecap: round; }
        #gfx-root .halo { position: absolute; inset: -6px; border-radius: 50%; border: 3px solid ${G}; opacity: 0; display: block; }
        #gfx-root .num { position: absolute; inset: 0; display: grid; place-items: center; font-family: "Anton", sans-serif; color: #fff; letter-spacing: .01em;
              text-shadow: 0 0 28px ${rgba(G, 0.55)}; z-index: 2; }
        #gfx-root .slab { font-weight: 600; letter-spacing: -.02em; text-shadow: 0 3px 14px rgba(0,0,0,.6), 0 1px 2px rgba(0,0,0,.7); white-space: nowrap; }

        /* días */
        #gfx-root .days { display: flex; flex-direction: column; align-items: center; gap: 16px; }
        #gfx-root .drow { display: flex; gap: 18px; }
        #gfx-root .chipw { position: relative; width: 112px; height: 112px; }
        #gfx-root .chip { width: 112px; height: 112px; border-radius: 30px; display: grid; place-items: center; }
        #gfx-root .chip span { font-weight: 700; font-size: 48px; letter-spacing: -.02em; }
        #gfx-root .chipw .bdg { right: -12px; top: -14px; }
        #gfx-root .dlab { font-weight: 500; letter-spacing: -.015em; color: rgba(255,255,255,.92); white-space: nowrap;
              text-shadow: 0 3px 14px rgba(0,0,0,.6), 0 1px 2px rgba(0,0,0,.7); }

        /* comparación */
        #gfx-root .cmp { display: flex; gap: 150px; align-items: flex-start; }
        #gfx-root .col { position: relative; display: flex; flex-direction: column; align-items: center; gap: 14px; }
        #gfx-root .tile { width: 164px; height: 164px; border-radius: 40px; display: grid; place-items: center; }
        #gfx-root .tile svg { width: 84px; height: 84px; }
        #gfx-root .tile.good { color: ${G}; }
        #gfx-root .col .bdg { right: -14px; top: -14px; width: 54px; height: 54px; }
        #gfx-root .col .bdg svg { width: 32px; height: 32px; }
        #gfx-root .clab { font-weight: 600; letter-spacing: -.02em; white-space: nowrap; text-shadow: 0 3px 14px rgba(0,0,0,.6), 0 1px 2px rgba(0,0,0,.7); }

        /* gráfica */
        #gfx-root .chart { width: 640px; padding: 26px 32px 20px; }
        #gfx-root .chd { font-weight: 700; letter-spacing: -.025em; white-space: nowrap; }
        #gfx-root .chd span { color: rgba(255,255,255,.55); font-weight: 500; }
        #gfx-root .chs { display: block; width: 576px; height: 180px; margin-top: 14px; overflow: visible; }
        #gfx-root .chs .gl { stroke: rgba(255,255,255,.09); stroke-width: 1.5; }
        #gfx-root .chs .lnp { fill: none; stroke: ${G}; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round;
              filter: drop-shadow(0 0 8px ${rgba(G, 0.8)}); }
        #gfx-root .chs .dot { fill: #fff; stroke: ${G}; stroke-width: 5; }

        /* iconos */
        #gfx-root .icons { display: flex; gap: 30px; align-items: flex-start; }
        #gfx-root .icw { display: flex; flex-direction: column; align-items: center; gap: 12px; }
        #gfx-root .itl { width: 132px; height: 132px; border-radius: 36px; display: grid; place-items: center; }
        #gfx-root .itl svg { width: 66px; height: 66px; }
        #gfx-root .il { font-weight: 600; letter-spacing: -.015em; white-space: nowrap; text-shadow: 0 3px 14px rgba(0,0,0,.6), 0 1px 2px rgba(0,0,0,.7); }

        /* palabra gigante (delante, cuando no hay mate) */
        #gfx-root .ow { position: absolute; display: flex; align-items: center; justify-content: center; }
        #gfx-root .big, .big { font-family: "Anton", sans-serif; line-height: .92; letter-spacing: .01em; white-space: nowrap; text-transform: uppercase;
              background: linear-gradient(180deg, #fff6d8 0%, ${G} 52%, ${shade(G, -0.25)} 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
              filter: drop-shadow(0 0 30px ${rgba(G, 0.45)}) drop-shadow(0 12px 20px rgba(0,0,0,.45)); padding: .14em .04em .02em; }

        /* titular */
        #gfx-root .hook { position: absolute; display: flex; flex-direction: column; justify-content: center; }
        #gfx-root .hband { padding: 22px 34px 24px; border-radius: 32px; background: linear-gradient(160deg, rgba(255,255,255,.1), rgba(255,255,255,.02) 55%), rgba(10,10,18,.62); }
        #gfx-root .hook .htit, #gfx-root .hook .hsub { text-shadow: 0 2px 12px rgba(0,0,0,.45); }
        #gfx-root .htit { font-weight: 800; letter-spacing: -.035em; line-height: 1.04; color: #fff; }
        #gfx-root .htit .hw { display: inline-block; }
        #gfx-root .hsub { font-weight: 500; letter-spacing: -.01em; color: rgba(255,255,255,.72); margin-top: 10px; }
        #gfx-root .hk { color: ${G}; }

        /* escena a pantalla completa */
        #gfx-root .fs { position: absolute; inset: 0; }
        #gfx-root .fs-panel { position: absolute; inset: 0; overflow: hidden; background: ${theme.bg}; }
        #gfx-root .orb { position: absolute; border-radius: 50%; display: block; }
        #gfx-root .fs-grid { position: absolute; inset: 0; display: block;
              background-image: linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px); background-size: 60px 60px;
              -webkit-mask-image: radial-gradient(ellipse 80% 65% at 50% 45%, #000 30%, transparent 100%); mask-image: radial-gradient(ellipse 80% 65% at 50% 45%, #000 30%, transparent 100%); }
        #gfx-root .fs-vign { position: absolute; inset: 0; display: block; background: radial-gradient(130% 100% at 50% 40%, transparent 50%, rgba(0,0,0,.75) 100%); }
        #gfx-root .fs-grain { position: absolute; inset: 0; display: block; opacity: .06; background-size: 200px;
              background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        #gfx-root .fs-head { position: absolute; display: flex; flex-direction: column; gap: 14px; }
        #gfx-root .fs-kick { font-weight: 600; font-size: 28px; letter-spacing: .28em; text-transform: uppercase; color: ${G}; }
        #gfx-root .fs-title { padding-top: .14em; margin-top: -.14em; font-family: "Anton", sans-serif; line-height: .98; letter-spacing: .005em; text-transform: uppercase;
              background: linear-gradient(180deg, #ffffff 35%, ${rgba(A2, 1)} 140%); -webkit-background-clip: text; background-clip: text; color: transparent; }
        #gfx-root .fs-rail { position: absolute; display: block; border-radius: 3px; background: rgba(255,255,255,.12); }
        #gfx-root .fs-fill { position: absolute; display: block; border-radius: 3px; background: linear-gradient(180deg, ${A}, ${G}); box-shadow: 0 0 18px ${rgba(G, 0.6)}; }
        #gfx-root .step { position: absolute; }
        #gfx-root .sbox { position: absolute; inset: 0; display: flex; align-items: center; gap: 28px; padding: 0 30px 0 22px; border-radius: 30px; }
        #gfx-root .stile { flex: none; display: grid; place-items: center; border-radius: 26px; color: #fff; background: rgba(255,255,255,.08); border: 1.5px solid rgba(255,255,255,.18); }
        #gfx-root .stile.lit { position: absolute; background: linear-gradient(135deg, ${A}, ${A2}); border-color: rgba(255,255,255,.5); box-shadow: 0 0 40px ${rgba(A, 0.8)}; opacity: 0; }
        #gfx-root .slabel { font-weight: 700; letter-spacing: -.025em; line-height: 1.04; }
        #gfx-root .step .bdg { width: 52px; height: 52px; }
        #gfx-root .step .bdg svg { width: 30px; height: 30px; }
        #gfx-root .snum { font-family: "Anton", sans-serif; color: ${G}; line-height: 1; }
`;
}

// Oscurece (−) o aclara (+) un color HEX
export function shade(hex, f) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f));
  return "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("");
}

// ─────────────── constructores ───────────────
// ctx: { id, s, e, js(line), sfx(t, kind), theme }
const B = {};

B.card = (g, c) => {
  const title = g.title || "", sub = g.subtitle || "";
  const T = fitWrap(title, FT(), 600, 2, 52, 32, -0.02);
  const S = sub ? fitWrap(sub, FT(), 600, 2, 32, 26) : null;
  const tw = Math.max(...T.lines.map((l) => textEm(l, FT()) * T.size), S ? Math.max(...S.lines.map((l) => textEm(l, FT()) * S.size)) : 0);
  const html = `<div class="glass gp e0 card"><span class="sweep"></span><div class="itile">${icon(g.icon)}</div><div class="ctext">`
    + `<div class="ct tx" style="font-size:${T.size}px">${esc(title)}</div>`
    + (S ? `<div class="cs tx" style="font-size:${S.size}px">${esc(sub)}</div>` : "") + `</div></div>`;
  const h = Math.max(92, T.lines.length * T.size * 1.08 + (S ? S.lines.length * S.size * 1.18 + 4 : 0)) + 44;
  c.js(`gtl.fromTo("#${c.id} .tx", ${TXT_IN()}, ${r3(c.s + 0.15)});`);
  c.js(`gtl.fromTo("#${c.id} .itile", { scale: .5, rotation: -12 }, { scale: 1, rotation: 0, ${IN_SOFT()} }, ${r3(c.s + 0.08)});`);
  return { html, w: Math.min(860, 22 + 92 + 24 + tw + 40), h };
};

B.checklist = (g, c) => {
  const items = (g.items || []).slice(0, 5);
  const size = Math.min(...items.map((it) => fitLine(it.text, FT(), 600, 44, 28, -0.015)), 44);
  const tw = Math.max(...items.map((it) => textEm(it.text, FT()) * size), g.title ? textEm(g.title.toUpperCase(), FT(), 0.16) * 26 : 0);
  let html = `<div class="glass gp e0 chk"><span class="sweep"></span>` + (g.title ? `<div class="kick tx">${esc(g.title)}</div>` : "");
  items.forEach((it, k) => {
    html += `<div id="${c.id}r${k}" class="row"><span id="${c.id}k${k}" class="ck">${icon("check")}</span><span class="rt" style="font-size:${size}px">${esc(it.text)}</span></div>`;
  });
  html += `</div>`;
  if (g.title) c.js(`gtl.fromTo("#${c.id} .kick", ${TXT_IN(10)}, ${r3(c.s + 0.12)});`);
  items.forEach((it, k) => {
    const t = clamp(Math.max(it.t ?? 0, c.s + 0.3 + k * 0.14), c.s, c.e - 0.75 - (items.length - 1 - k) * 0.12);
    c.js(`gtl.fromTo("#${c.id}r${k}", { opacity: 0, x: -26 }, { opacity: 1, x: 0, duration: 0.38, ease: "power3.out" }, ${r3(t - 0.1)});`);
    POP(`#${c.id}k${k}`, t).forEach(c.js);
    c.sfx(t - 0.03, "pop");
  });
  const h = 61 + (g.title ? 50 : 0) + items.length * Math.max(46, size * 1.2) + (items.length - 1) * 12;
  return { html, w: Math.min(860, 70 + 64 + tw), h };
};

B.strike = (g, c) => {
  const items = (g.items || []).slice(0, 4);
  const size = Math.min(...items.map((it) => fitLine(it.text, FT(), 700, 42, 26, -0.02)), 42);
  const fsz = g.final ? fitLine(g.final, FT(), 700, 50, 28, -0.02) : 0;
  // reparto en filas (como hará el navegador con flex-wrap) para saber ancho y alto
  const maxW = 820, pw = items.map((it) => textEm(it.text, FT()) * size + 67);
  const rows = [];
  pw.forEach((w) => { const r = rows[rows.length - 1]; if (r && r.w + 14 + w <= maxW) r.w += 14 + w; else rows.push({ w }); });
  const W = Math.ceil(Math.max(...rows.map((r) => r.w), g.final ? textEm(g.final, FT()) * fsz + 67 : 0) + 2);
  let html = `<div class="stk" style="width:${W}px">`;
  items.forEach((it, k) => {
    html += `<div id="${c.id}p${k}" class="glass gp pill"><span class="pt tx" style="font-size:${size}px">${esc(it.text)}<i id="${c.id}l${k}" class="ln"></i></span></div>`;
  });
  if (g.final) html += `<div class="finrow"><div id="${c.id}f" class="glass gp pill fin"><span class="pt" style="font-size:${fsz}px">${esc(g.final)}</span></div></div>`;
  html += `</div>`;
  let last = c.s + 0.3;
  items.forEach((it, k) => {
    c.js(`gtl.fromTo("#${c.id}p${k}", { opacity: 0, y: ${dist(24)} }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, ${r3(c.s + k * 0.08)});`);
    const t = clamp(Math.max(it.t ?? 0, c.s + 0.5 + k * 0.22), c.s, c.e - (g.final ? 1.45 : 0.6) - (items.length - 1 - k) * 0.15);
    c.js(`gtl.fromTo("#${c.id}l${k}", { scaleX: 0 }, { scaleX: 1, duration: 0.28, ease: "power2.out" }, ${r3(t)});`);
    c.js(`gtl.fromTo("#${c.id}p${k} .pt", { color: "${TXT()[0]}" }, { color: "${TXT()[1]}", duration: 0.25, immediateRender: false }, ${r3(t + 0.05)});`);
    c.sfx(t - 0.02, "click");
    last = Math.max(last, t);
  });
  if (g.final) {
    const tf = Math.min(last + 0.4, c.e - 1.0);
    POP(`#${c.id}f`, tf, "scale: .6").forEach(c.js);
    c.sfx(tf - 0.03, "pop");
  }
  const h = rows.length * (size * 1.25 + 27) + (rows.length - 1) * 12 + (g.final ? fsz * 1.25 + 27 + 14 : 0);
  return { html, w: W, h, noFadeIn: true };
};

const RING = r2(2 * Math.PI * 108);
B.stat = (g, c) => {
  const value = Number(g.value) || 0;
  const dec = Number.isInteger(value) ? 0 : 1;
  const final = (g.prefix || "") + fmtNum(value, dec) + (g.suffix || "");
  const nsz = fitLine(final, FK(), 172, 96, 36);
  const lsz = fitLine(g.label || "", FT(), 820, 40, 28, -0.02);
  const html = `<div class="stat"><div class="ringw"><span class="glass gp e0 ringbg"></span><i id="${c.id}h" class="halo"></i>`
    + `<svg class="ringsvg" viewBox="0 0 240 240"><circle class="rb" cx="120" cy="120" r="108"/><circle id="${c.id}rp" class="rp" cx="120" cy="120" r="108" style="stroke-dasharray:${RING} ${RING};stroke-dashoffset:${RING}"/></svg>`
    + `<div id="${c.id}n" class="num" style="font-size:${nsz}px">${esc((g.prefix || "") + "0" + (g.suffix || ""))}</div></div>`
    + (g.label ? `<div class="slab tx" style="font-size:${lsz}px">${esc(g.label)}</div>` : "") + `</div>`;
  const t0 = c.s + 0.15, dur = 1.2;
  c.js(`gtl.fromTo("#${c.id}rp", { strokeDashoffset: ${RING} }, { strokeDashoffset: 0, duration: ${dur}, ease: "power2.out" }, ${r3(t0)});`);
  // contador determinista: un paso por fotograma
  const steps = Math.round(dur * 30);
  for (let k = 0; k <= steps; k++) {
    const p = k / steps, eased = 1 - Math.pow(1 - p, 2.2);
    const txt = (g.prefix || "") + fmtNum(value * eased, dec) + (g.suffix || "");
    c.js(`gtl.call(() => { document.getElementById("${c.id}n").textContent = ${JSON.stringify(txt)}; }, null, ${r3(t0 + p * dur)});`);
  }
  c.js(`gtl.fromTo("#${c.id}h", { scale: .92, opacity: .9 }, { scale: 1.22, opacity: 0, duration: 0.8, ease: "power2.out" }, ${r3(t0 + dur)});`);
  c.js(`gtl.fromTo("#${c.id}n", { scale: 1 }, { scale: 1.08, duration: 0.16, yoyo: true, repeat: 1, ease: "power2.out" }, ${r3(t0 + dur - 0.05)});`);
  if (g.label) c.js(`gtl.fromTo("#${c.id} .slab", ${TXT_IN()}, ${r3(c.s + 0.35)});`);
  c.sfx(t0 + dur - 0.04, "sparkle");
  const w = Math.max(240, g.label ? textEm(g.label, FT()) * lsz : 0);
  return { html, w: Math.min(860, w), h: 240 + (g.label ? 14 + lsz * 1.3 : 0) };
};

B.days = (g, c) => {
  const days = (g.days && g.days.length ? g.days : ["L", "M", "X", "J", "V"]).slice(0, 7);
  const lsz = g.label ? fitLine(g.label, FT(), 820, 36, 28) : 0;
  let html = `<div class="days"><div class="drow">`;
  days.forEach((d, k) => {
    html += `<div id="${c.id}c${k}" class="chipw"><div class="glass gp chip"><span>${esc(String(d).slice(0, 2))}</span></div><span id="${c.id}k${k}" class="bdg">${icon("check")}</span></div>`;
  });
  html += `</div>` + (g.label ? `<div class="dlab tx" style="font-size:${lsz}px">${esc(g.label)}</div>` : "") + `</div>`;
  days.forEach((d, k) => {
    c.js(`gtl.fromTo("#${c.id}c${k} .glass", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, ${r3(c.s + k * 0.06)});`);
    c.js(`gtl.fromTo("#${c.id}c${k}", { y: ${dist(40)}, scale: .8 }, { y: 0, scale: 1, ${IN()} }, ${r3(c.s + k * 0.06)});`);
    const t = Math.min(c.s + 0.6 + k * 0.2, c.e - 0.6 - (days.length - 1 - k) * 0.1);
    POP(`#${c.id}k${k}`, t).forEach(c.js);
    c.sfx(t - 0.03, "pop");
  });
  if (g.label) c.js(`gtl.fromTo("#${c.id} .dlab", ${TXT_IN()}, ${r3(c.s + 0.4)});`);
  const w = Math.max(days.length * 112 + (days.length - 1) * 18 + 24, g.label ? textEm(g.label, FT()) * lsz : 0);
  return { html, w: Math.min(860, w), h: 126 + (g.label ? 16 + lsz * 1.3 : 0), noFadeIn: true };
};

B.compare = (g, c) => {
  const L = g.left || { icon: "check", label: "" }, R = g.right || { icon: "x", label: "" };
  const bad = R.bad !== false;
  const lsz = Math.min(fitLine(L.label || "", FT(), 330, 38, 28), fitLine(R.label || "", FT(), 330, 38, 28));
  const col = (side, it, cls, bcls, bic) => `<div id="${c.id}${side}" class="col"><div class="glass gp tile ${cls}">${icon(it.icon)}</div>`
    + `<span id="${c.id}${side}b" class="bdg ${bcls}">${icon(bic)}</span><div class="clab tx" style="font-size:${lsz}px">${esc(it.label || "")}</div></div>`;
  const html = `<div class="cmp">${col("a", L, "good", "", "check")}${col("b", R, "", bad ? "bad" : "", bad ? "x" : "check")}</div>`;
  ["a", "b"].forEach((side, k) => {
    const t = c.s + k * 0.14;
    c.js(`gtl.fromTo("#${c.id}${side} .glass", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, ${r3(t)});`);
    c.js(`gtl.fromTo("#${c.id}${side}", { y: ${dist(40)}, scale: .8 }, { y: 0, scale: 1, ${IN()} }, ${r3(t)});`);
    c.js(`gtl.fromTo("#${c.id}${side} .clab", ${TXT_IN()}, ${r3(t + 0.2)});`);
  });
  const ta = Math.min(c.s + 0.55, c.e - 1.0), tb = Math.min(c.s + 0.9, c.e - 0.75);
  POP(`#${c.id}ab`, ta).forEach(c.js);
  POP(`#${c.id}bb`, tb, "scale: 0, rotation: -40", "scale: 1, rotation: 0").forEach(c.js);
  if (bad) c.js(`gtl.fromTo("#${c.id}b .tile svg", { opacity: 1 }, { opacity: .5, duration: 0.3, immediateRender: false }, ${r3(tb + 0.1)});`);
  c.sfx(ta - 0.03, "pop");
  c.sfx(tb - 0.03, bad ? "click" : "pop");
  const lw = Math.max(textEm(L.label || "", FT()) * lsz, 164), rw = Math.max(textEm(R.label || "", FT()) * lsz, 164);
  return { html, w: Math.min(860, lw + rw + 150), h: 164 + 14 + lsz * 1.3, noFadeIn: true };
};

// Curva suave (Catmull-Rom → Bézier) por los puntos
function smoothPath(pts) {
  let len = 0;
  const bez = (a, b, c2, d2, t) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c2 + t * t * t * d2; };
  let d = `M${r2(pts[0][0])},${r2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r2(c1[0])},${r2(c1[1])} ${r2(c2[0])},${r2(c2[1])} ${r2(p2[0])},${r2(p2[1])}`;
    let px = p1[0], py = p1[1];
    for (let k = 1; k <= 24; k++) {
      const t = k / 24, x = bez(p1[0], c1[0], c2[0], p2[0], t), y = bez(p1[1], c1[1], c2[1], p2[1], t);
      len += Math.hypot(x - px, y - py); px = x; py = y;
    }
  }
  return { d, len: Math.ceil(len + 2) };
}

B.chart = (g, c) => {
  let pts = (g.points || []).map(Number).filter((n) => Number.isFinite(n));
  if (pts.length < 2) pts = [2, 3, 2.5, 5, 4.5, 8, 7, 12];
  const mn = Math.min(...pts), mx = Math.max(...pts), Wd = 576, Hd = 180, pad = 14;
  const P = pts.map((v, i) => [pad + (i / (pts.length - 1)) * (Wd - 2 * pad), Hd - pad - ((v - mn) / (mx - mn || 1)) * (Hd - 2 * pad)]);
  const { d, len } = smoothPath(P), last = P[P.length - 1];
  const area = d + ` L${r2(last[0])},${Hd} L${r2(P[0][0])},${Hd} Z`;
  const [t1, t2] = String(g.title || "").split("/").map((s) => s.trim());
  const tsz = fitLine((t1 || "") + (t2 ? " / " + t2 : ""), FT(), 576, 44, 28, -0.025);
  const gid = `${c.id}grad`;
  const html = `<div class="glass gp e0 chart"><span class="sweep"></span><div class="chd tx" style="font-size:${tsz}px">${esc(t1 || "")}${t2 ? `<span> / ${esc(t2)}</span>` : ""}</div>`
    + `<svg class="chs" viewBox="0 0 ${Wd} ${Hd}"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.theme.gold}" stop-opacity=".38"/><stop offset="1" stop-color="${c.theme.gold}" stop-opacity="0"/></linearGradient></defs>`
    + [0.25, 0.5, 0.75].map((f) => `<line class="gl" x1="0" x2="${Wd}" y1="${Hd * f}" y2="${Hd * f}"/>`).join("")
    + `<path id="${c.id}ar" d="${area}" fill="url(#${gid})" opacity="0"/><path id="${c.id}ln" class="lnp" d="${d}" style="stroke-dasharray:${len} ${len};stroke-dashoffset:${len}"/>`
    + `<circle id="${c.id}dt" class="dot" cx="${r2(last[0])}" cy="${r2(last[1])}" r="11"/></svg></div>`;
  c.js(`gtl.fromTo("#${c.id}ln", { strokeDashoffset: ${len} }, { strokeDashoffset: 0, duration: 1.3, ease: "power2.inOut" }, ${r3(c.s + 0.35)});`);
  c.js(`gtl.fromTo("#${c.id}ar", { opacity: 0 }, { opacity: 1, duration: 0.6, ease: "power2.out" }, ${r3(c.s + 1.0)});`);
  c.js(`gtl.fromTo("#${c.id}dt", { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, ${IN_SOFT()} }, ${r3(c.s + 1.6)});`);
  c.sfx(c.s + 1.57, "pop");
  return { html, w: 640, h: 26 + tsz * 1.2 + 14 + 180 + 22 };
};

B.icons = (g, c) => {
  const items = (g.items || []).slice(0, 5);
  const lsz = Math.min(...items.map((it) => (it.label ? fitLine(it.label, FT(), 200, 30, 28) : 28)));
  let html = `<div class="icons">`;
  items.forEach((it, k) => {
    html += `<div id="${c.id}i${k}" class="icw"><div class="glass gp itl">${icon(it.icon)}</div>` + (it.label ? `<div class="il" style="font-size:${lsz}px">${esc(it.label)}</div>` : "") + `</div>`;
  });
  html += `</div>`;
  items.forEach((it, k) => {
    const t = clamp(Math.max(it.t ?? 0, c.s + k * 0.12), c.s, c.e - 0.6 - (items.length - 1 - k) * 0.1);
    c.js(`gtl.fromTo("#${c.id}i${k} .glass", { opacity: 0 }, { opacity: 1, duration: 0.22, ease: "power2.out" }, ${r3(t)});`);
    c.js(`gtl.fromTo("#${c.id}i${k}", { scale: .4, y: ${dist(30)} }, { scale: 1, y: 0, ${IN_SOFT()} }, ${r3(t)});`);
    if (it.label) c.js(`gtl.fromTo("#${c.id}i${k} .il", ${TXT_IN(10)}, ${r3(t + 0.15)});`);
    c.sfx(t - 0.03, "pop");
  });
  const colW = items.map((it) => Math.max(132, it.label ? textEm(it.label, FT()) * lsz : 0));
  return { html, w: Math.min(860, colW.reduce((a, b) => a + b, 0) + (items.length - 1) * 30), h: 132 + (items.some((i) => i.label) ? 12 + lsz * 1.3 : 0), noFadeIn: true };
};

// Gráfico copiado de una referencia: su HTML+CSS con los textos de este vídeo
const tplCssDone = new WeakMap();
B.custom = (g, c) => {
  const st = S(), t = (st.templates || []).find((x) => x.id === g.tpl);
  if (!t) return B.card({ ...g, title: g.fields?.title || g.title || "", subtitle: g.fields?.subtitle || g.subtitle || "" }, c);
  const done = tplCssDone.get(st) || new Set();
  tplCssDone.set(st, done);
  if (!done.has(t.id)) {
    done.add(t.id);
    c.css(`#gfx-root { --f-title: ${st.fonts.title.css}; --f-keyword: ${st.fonts.keyword.css}; --f-caption: ${st.fonts.caption.css}; --accent: ${c.theme.accent}; --accent2: ${c.theme.accent2}; --gold: ${c.theme.gold}; }`);
    c.css(scopedCss(t).replace(/\n/g, " "));
  }
  const html = `<div class="gp e0 tpl tpl-${t.id}">${fillTemplate(t, g.fields || {}, g.icon)}</div>`;
  const a = t.anim || {}, d = r3(Math.min(1.2, Math.max(0.15, (a.ms || 450) / 1000)));
  const sel = `#${c.id} .tpl`;
  if (a.in === "pop") POP(sel, c.s + 0.02, "scale: .6", "scale: 1").forEach(c.js);
  else if (a.in === "slide-up") c.js(`gtl.fromTo("${sel}", { y: 60 }, { y: 0, duration: ${d}, ease: "power3.out" }, ${r3(c.s)});`);
  else if (a.in === "slide-left") c.js(`gtl.fromTo("${sel}", { x: 90 }, { x: 0, duration: ${d}, ease: "power3.out" }, ${r3(c.s)});`);
  else if (a.in === "slide-right") c.js(`gtl.fromTo("${sel}", { x: -90 }, { x: 0, duration: ${d}, ease: "power3.out" }, ${r3(c.s)});`);
  else if (a.in === "scale") c.js(`gtl.fromTo("${sel}", { scale: 1.25 }, { scale: 1, duration: ${d}, ease: "power3.out" }, ${r3(c.s)});`);
  else if (a.in === "glow") c.js(`gtl.fromTo("${sel}", { filter: "brightness(2.2) blur(6px)" }, { filter: "brightness(1) blur(0px)", duration: ${d}, ease: "power2.out" }, ${r3(c.s)});`);
  return { html, w: t.width, h: t.height };
};

export const SLOT_BUILDERS = B;

// Palabra gigante (para la capa de detrás o delante sin mate). Devuelve tamaño de letra para caber en w×h.
export function bigWordSize(text, w, h, max) {
  const t = String(text).toUpperCase();
  return Math.floor(Math.min(max, w / (textEm(t, FK(), 0.01) + 0.08), h / 1.1));
}

// ─────────────── escena a pantalla completa ───────────────
export function buildScene(g, c, geo) {
  const light = S().look === "light";
  const SH_DIM = light ? "0 30px 60px -24px rgba(0,0,0,.35), inset 0 1.5px 0 rgba(255,255,255,.6), 0 4px 14px rgba(0,0,0,.08)" : `0 35px 75px -25px rgba(0,0,0,.7), inset 0 1.5px 0 rgba(255,255,255,.22), 0 0 40px -12px ${rgba(c.theme.accent, 0.45)}`;
  const B_DIM = light ? "rgba(15,20,30,.08)" : "rgba(255,255,255,.24)", B_OFF = light ? "rgba(15,20,30,.12)" : "rgba(255,255,255,.3)";
  const SH_LIT = `0 0 50px -6px ${rgba(c.theme.gold, 0.5)}, inset 0 1.5px 0 rgba(255,255,255,.22), 0 0 40px -12px ${rgba(c.theme.gold, 0.45)}`;
  const { W, H } = geo, theme = c.theme, row = geo.scene.orient === "row";
  const steps = (g.steps || []).slice(0, row ? 5 : 5);
  const vertical = H > W;
  // márgenes: zona segura en verticales; en 4:5 y horizontal, márgenes limpios
  const M = vertical && H >= 1900 ? { l: 80, r: 140, t: 250, b: 400 } : row ? { l: 120, r: 120, t: 90, b: 90 } : { l: 80, r: 80, t: 90, b: 90 };
  const aw = W - M.l - M.r;
  const tf = fitWrap(String(g.title || "").toUpperCase(), FK(), aw, 2, row ? 110 : 128, 52, 0.005);
  const headH = (g.kicker ? 46 : 0) + tf.lines.length * tf.size * 0.98;
  const head = `<div id="${c.id}hd" class="fs-head" style="left:${M.l}px;top:${M.t}px;width:${aw}px;${row ? "align-items:center;text-align:center;" : ""}">`
    + (g.kicker ? `<div class="fs-kick">${esc(g.kicker)}</div>` : "")
    + `<div class="fs-title" style="font-size:${tf.size}px">${tf.lines.map(esc).join("<br>")}</div></div>`;
  const orbs = [
    { cls: "o1", st: `width:${W * 1.3}px;height:${W * 1.3}px;left:${-W * 0.55}px;top:${-H * 0.15}px;background:radial-gradient(circle, ${rgba(theme.accent, 0.55)}, transparent 64%)` },
    { cls: "o2", st: `width:${W * 1.25}px;height:${W * 1.25}px;right:${-W * 0.55}px;top:${H * 0.42}px;background:radial-gradient(circle, ${rgba(theme.accent2, 0.42)}, transparent 64%)` },
    { cls: "o3", st: `width:${W * 1.1}px;height:${W * 0.8}px;left:${W * 0.0}px;bottom:${-H * 0.25}px;background:radial-gradient(circle, ${rgba(theme.gold, 0.14)}, transparent 70%)` },
  ];
  let html = `<div id="${c.id}pn" class="fs-panel"><div class="fs-bg">` + orbs.map((o, k) => `<span id="${c.id}o${k}" class="orb" style="${o.st}"></span>`).join("")
    + `<span class="fs-grid"></span><span class="fs-vign"></span><span class="fs-grain"></span></div>` + head;
  // pasos
  const n = Math.max(1, steps.length);
  let rail = "", nodes = "";
  if (!row) {
    const top = M.t + headH + 80, bottom = H - M.b;
    const gap = 26, rh = Math.min(170, (bottom - top - gap * (n - 1)) / n);
    const tile = Math.round(rh * 0.68), lsz = Math.min(...steps.map((s) => fitWrap(s.label, FT(), aw - tile - 160, 2, Math.round(rh * 0.3), 24, -0.025).size));
    const total = n * rh + (n - 1) * gap, y0 = top + Math.max(0, (bottom - top - total) / 2);
    const cx = M.l + 22 + tile / 2;
    if (n > 1) {
      rail = `<span id="${c.id}rl" class="fs-rail" style="left:${cx - 3}px;top:${y0 + rh / 2}px;width:6px;height:${(n - 1) * (rh + gap)}px;transform-origin:50% 0"></span>`
        + `<span id="${c.id}rf" class="fs-fill" style="left:${cx - 3}px;top:${y0 + rh / 2}px;width:6px;height:${(n - 1) * (rh + gap)}px;transform-origin:50% 0"></span>`;
    }
    steps.forEach((s, k) => {
      const y = y0 + k * (rh + gap);
      nodes += `<div id="${c.id}s${k}" class="step" style="left:${M.l}px;top:${r2(y)}px;width:${aw}px;height:${r2(rh)}px">`
        + `<div class="glass sbox"><span class="stile" style="width:${tile}px;height:${tile}px">${icon(s.icon)}</span>`
        + `<span class="stile lit" style="left:22px;top:${r2((rh - tile) / 2 - 1.5)}px;width:${tile}px;height:${tile}px">${icon(s.icon)}</span>`
        + `<span class="slabel" style="font-size:${lsz}px">${esc(s.label)}</span></div>`
        + `<span id="${c.id}b${k}" class="bdg" style="right:-12px;top:-14px">${icon("check")}</span></div>`;
    });
    c.css(`#${c.id} .stile svg { width: ${Math.round(tile * 0.5)}px; height: ${Math.round(tile * 0.5)}px; }`);
  } else {
    const top = M.t + headH + 70, bottom = H - M.b;
    const gap = 40, cw = Math.min(360, (aw - gap * (n - 1)) / n), ch = Math.min(bottom - top, cw * 1.2);
    const tile = Math.round(cw * 0.52), lsz = Math.min(...steps.map((s) => fitWrap(s.label, FT(), cw - 40, 2, 42, 24, -0.025).size));
    const total = n * cw + (n - 1) * gap, x0 = M.l + (aw - total) / 2, y = top + (bottom - top - ch) / 2;
    if (n > 1) {
      rail = `<span id="${c.id}rl" class="fs-rail" style="left:${x0 + cw / 2}px;top:${y + ch / 2 - 3}px;height:6px;width:${(n - 1) * (cw + gap)}px;transform-origin:0 50%"></span>`
        + `<span id="${c.id}rf" class="fs-fill" style="left:${x0 + cw / 2}px;top:${y + ch / 2 - 3}px;height:6px;width:${(n - 1) * (cw + gap)}px;transform-origin:0 50%"></span>`;
    }
    steps.forEach((s, k) => {
      const x = x0 + k * (cw + gap);
      nodes += `<div id="${c.id}s${k}" class="step" style="left:${r2(x)}px;top:${r2(y)}px;width:${r2(cw)}px;height:${r2(ch)}px">`
        + `<div class="glass sbox" style="flex-direction:column;justify-content:center;padding:20px;gap:22px;text-align:center"><span class="stile" style="width:${tile}px;height:${tile}px">${icon(s.icon)}</span>`
        + `<span class="stile lit" style="left:${r2((cw - tile) / 2)}px;top:${r2((ch - tile) / 2 - (lsz * 1.05 + 22) / 2)}px;width:${tile}px;height:${tile}px">${icon(s.icon)}</span>`
        + `<span class="slabel" style="font-size:${lsz}px">${esc(s.label)}</span></div>`
        + `<span id="${c.id}b${k}" class="bdg" style="right:-12px;top:-14px">${icon("check")}</span></div>`;
    });
    c.css(`#${c.id} .stile svg { width: ${Math.round(tile * 0.5)}px; height: ${Math.round(tile * 0.5)}px; }`);
  }
  html += rail + nodes + `</div>`;

  // animación
  const s = c.s, e = c.e, id = c.id;
  c.js(`gtl.fromTo("#${id}pn", { opacity: 0 }, { opacity: 1, duration: 0.12, ease: "none" }, ${r3(s)});`);
  c.js(`gtl.fromTo("#${id}pn", { clipPath: "inset(38% 9% 44% 9% round 32px)" }, { clipPath: "inset(0% 0% 0% 0% round 0px)", duration: 1.1, ease: VB(${r3(0.03 * S().motion.spring)}, 0.34) }, ${r3(s)});`);
  c.js(`gtl.fromTo("#${id}hd", { opacity: 0, y: 40, filter: "blur(10px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.6, ease: "power3.out" }, ${r3(s + 0.2)});`);
  const D = Math.max(1, e - s);
  c.js(`gtl.fromTo("#${id}o0", { x: ${-W * 0.08}, y: 0 }, { x: ${W * 0.18}, y: ${H * 0.1}, duration: ${r2(D)}, ease: "sine.inOut" }, ${r3(s)});`);
  c.js(`gtl.fromTo("#${id}o1", { x: ${W * 0.1}, y: 0 }, { x: ${-W * 0.16}, y: ${-H * 0.1}, duration: ${r2(D)}, ease: "sine.inOut" }, ${r3(s)});`);
  c.js(`gtl.fromTo("#${id}o2", { scale: 1 }, { scale: 1.25, duration: ${r2(D)}, ease: "sine.inOut" }, ${r3(s)});`);
  if (steps.length > 1) {
    const ax = row ? "scaleX" : "scaleY";
    c.js(`gtl.fromTo("#${id}rl", { ${ax}: 0 }, { ${ax}: 1, duration: 0.8, ease: "power3.inOut" }, ${r3(s + 0.3)});`);
    c.js(`gtl.set("#${id}rf", { ${ax}: 0 }, ${r3(s)});`);
  }
  let prevT = s + 0.4;
  steps.forEach((st, k) => {
    c.js(`gtl.fromTo("#${id}s${k} .glass", { opacity: 0 }, { opacity: .5, duration: 0.3, ease: "power2.out" }, ${r3(s + 0.35 + k * 0.1)});`);
    c.js(`gtl.fromTo("#${id}s${k}", { ${row ? "y" : "x"}: ${dist(80)} }, { ${row ? "y" : "x"}: 0, ${IN()} }, ${r3(s + 0.35 + k * 0.1)});`);
    const t = clamp(Math.max(st.t ?? 0, s + 0.9 + k * 0.3, prevT + 0.25), s + 0.5, e - 0.6);
    prevT = t;
    c.js(`gtl.fromTo("#${id}s${k} .glass", { opacity: .5, borderColor: "${B_DIM}", boxShadow: "${SH_DIM}" }, { opacity: 1, borderColor: "${rgba(theme.gold, 0.85)}", boxShadow: "${SH_LIT}", duration: 0.25, immediateRender: false }, ${r3(t - 0.08)});`);
    POP(`#${id}s${k} .lit`, t - 0.08, "scale: .6").forEach(c.js);
    c.js(`gtl.fromTo("#${id}s${k}", { scale: .96 }, { scale: 1, ${IN()} }, ${r3(t - 0.1)});`);
    POP(`#${id}b${k}`, t + 0.3).forEach(c.js);
    if (k > 0) {
      c.js(`gtl.fromTo("#${id}s${k - 1} .glass", { borderColor: "${rgba(theme.gold, 0.85)}", boxShadow: "${SH_LIT}" }, { borderColor: "${B_OFF}", boxShadow: "${SH_DIM}", duration: 0.3, immediateRender: false }, ${r3(t - 0.1)});`);
      if (steps.length > 1) c.js(`gtl.fromTo("#${id}rf", { ${row ? "scaleX" : "scaleY"}: ${r3((k - 1) / (steps.length - 1))} }, { ${row ? "scaleX" : "scaleY"}: ${r3(k / (steps.length - 1))}, duration: 0.45, ease: "power3.inOut", immediateRender: false }, ${r3(t - 0.35)});`);
    }
    c.sfx(t - 0.03, "pop");
  });
  c.js(`gtl.fromTo("#${id}pn", { clipPath: "inset(0% 0% 0% 0% round 0px)", opacity: 1 }, { clipPath: "inset(30% 9% 30% 9% round 40px)", opacity: 0, duration: 0.42, ease: "power3.in", immediateRender: false }, ${r3(e - 0.42)});`);
  c.sfx(s - 1.0, "riser");
  c.sfx(s - 0.03, "whoosh");
  c.sfx(e - 0.45, "whoosh");
  return html;
}

// ─────────────── estilo del usuario: se añade DESPUÉS del CSS base (sin estilo, nada) ───────────────
function styleCss(theme) {
  const st = S();
  if (!st.user) return "";
  const A = theme.accent, G = theme.gold, fT = st.fonts.title, fK = st.fonts.keyword;
  let css = "\n        /* estilo del usuario */";
  if (fT.user) {
    css += `
        #gfx-root, #gfx-root .htit, #gfx-root .slabel, #gfx-root .kick, #gfx-root .fs-kick { font-family: ${fT.css}; }`;
  }
  if (fK.user) {
    css += `
        #gfx-root .big, #gfx-root .num, #gfx-root .fs-title, #gfx-root .snum { font-family: ${fK.css}; }`;
  }
  // texto sobre el color de acento (iconos de las tarjetas, checks)
  css += `
        #gfx-root .itile, #gfx-root .bdg:not(.bad), #gfx-root .ck, #gfx-root .stile.lit { color: ${st.colors.onAccent}; }`;
  if (st.look === "solid") {
    let bg = theme.bg || "#0b0d18";
    for (let i = 0; i < 6 && luminanceOf(bg) > 0.08; i++) bg = shadeHex(bg, -0.3); // fondo oscuro para el texto blanco
    css += `
        #gfx-root .glass { background: ${shadeHex(bg, 0.08)}; border: 1.5px solid rgba(255,255,255,.1); backdrop-filter: none; -webkit-backdrop-filter: none;
              box-shadow: 0 30px 70px -25px rgba(0,0,0,.75), inset 0 1.5px 0 rgba(255,255,255,.08); }
        #gfx-root .glass::before { opacity: .35; }
        #gfx-root .pill.fin { background: ${shadeHex(bg, 0.16)}; border-color: ${rgba(A, 0.8)}; }`;
  }
  if (st.look === "light") {
    const K = st.colors.keywordOnLight || ensureContrast(G, "#ffffff", 3);
    const AK = ensureContrast(A, "#ffffff", 3);
    css += `
        #gfx-root .glass { background: #ffffff; color: #15161e; border: 1.5px solid rgba(15,20,30,.08); backdrop-filter: none; -webkit-backdrop-filter: none;
              box-shadow: 0 30px 60px -24px rgba(0,0,0,.35), inset 0 1.5px 0 rgba(255,255,255,.6), 0 4px 14px rgba(0,0,0,.08); }
        #gfx-root .glass::before, #gfx-root .sweep { opacity: 0; }
        #gfx-root .glass .tx, #gfx-root .glass .pt { text-shadow: none; }
        #gfx-root .cs { color: rgba(21,22,30,.62); }
        #gfx-root .kick { color: ${AK}; filter: none; }
        #gfx-root .chd span { color: rgba(21,22,30,.5); }
        #gfx-root .pill.fin { background: #ffffff; border: 2px solid ${AK}; box-shadow: 0 0 0 4px ${rgba(A, 0.18)}, 0 30px 60px -24px rgba(0,0,0,.35); }
        #gfx-root .num { color: #15161e; text-shadow: none; }
        #gfx-root .chs .gl { stroke: rgba(15,20,30,.08); }
        #gfx-root .chs .lnp { stroke: ${K}; filter: drop-shadow(0 3px 6px ${rgba(K, 0.35)}); }
        #gfx-root .chs .dot { stroke: ${K}; }
        #gfx-root .tile.good { color: ${K}; }
        #gfx-root .glass.hband { background: #ffffff; }
        #gfx-root .glass.hband .htit { color: #15161e; text-shadow: none; }
        #gfx-root .glass.hband .hsub { color: rgba(21,22,30,.62); text-shadow: none; }
        #gfx-root .glass.hband .hk { color: ${K}; }
        /* escena clara, como la escena blanca de la referencia */
        #gfx-root .fs-panel { background: #f3f2ef; }
        #gfx-root .fs-grid { background-image: linear-gradient(rgba(15,20,30,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(15,20,30,.05) 1px, transparent 1px); }
        #gfx-root .fs-vign { background: radial-gradient(130% 100% at 50% 40%, transparent 55%, rgba(0,0,0,.1) 100%); }
        #gfx-root .fs-grain { opacity: .035; }
        #gfx-root .orb { opacity: .45; }
        #gfx-root .fs-title { background: linear-gradient(180deg, #15161e 40%, ${AK} 150%); -webkit-background-clip: text; background-clip: text; color: transparent; }
        #gfx-root .fs-kick { color: ${AK}; }
        #gfx-root .slabel { color: #15161e; }
        #gfx-root .stile { background: rgba(15,20,30,.05); border-color: rgba(15,20,30,.08); color: #15161e; }
        #gfx-root .fs-rail { background: rgba(15,20,30,.1); }`;
  }
  return css + "\n";
}

function luminanceOf(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
