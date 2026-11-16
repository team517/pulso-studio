// Gráficos copiados de tus referencias: Claude los recrea como piezas HTML+CSS («plantillas») que el render
// rellena con los textos de cada vídeo. Aquí: limpiar lo que escribe Claude, rellenarlo y hacerle una foto
// (con el mismo navegador que usa el render) para compararlo con el original.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { icon } from "./autoedit/render/icons.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Quita lo peligroso o lo que no funcionaría en el render: scripts, eventos, enlaces y recursos externos. */
export function cleanHtml(html) {
  return String(html || "")
    .replace(/<\s*(script|iframe|object|embed|link|meta|style|img|video|audio|form|input)[\s\S]*?(<\/\s*\1\s*>|\/?>)/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/javascript:/gi, "")
    .slice(0, 8000);
}
export function cleanCss(css) {
  return String(css || "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*['"]?(?!data:)[^)]*\)/gi, "none")
    .replace(/position\s*:\s*fixed/gi, "position:absolute")
    .replace(/<\/?\w+[^>]*>/g, "")
    .slice(0, 12000);
}

const KEY = /\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g;
/** Normaliza una plantilla de Claude. Devuelve null si no sirve. */
export function normalizeTemplate(t, id) {
  if (!t || typeof t.html !== "string" || !t.html.trim()) return null;
  const html = cleanHtml(t.html);
  if (!/class\s*=\s*["'][^"']*\broot\b/.test(html)) return null;
  const keys = [...new Set([...html.matchAll(KEY)].map((m) => m[1]).filter((k) => k !== "icon"))];
  const fields = keys.map((k) => {
    const f = (Array.isArray(t.fields) ? t.fields : []).find((x) => x?.key === k) || {};
    return { key: k, label: String(f.label || k).slice(0, 40), example: String(f.example ?? "").slice(0, 60), max: Math.min(60, Math.max(3, Number(f.max) || 24)) };
  });
  const n = (v, a, b, d) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Number(v))) : d);
  return {
    id, name: String(t.name || "Gráfico").slice(0, 60), kind: String(t.kind || "card").slice(0, 30), use: String(t.use || "").slice(0, 200),
    fields, hasIcon: /\{\{\s*icon\s*\}\}/.test(html), icon: typeof t.icon === "string" ? t.icon : null,
    html, css: cleanCss(t.css),
    width: Math.round(n(t.width, 60, 1080, 600)), height: Math.round(n(t.height, 30, 1500, 200)),
    xPct: n(t.xPct, 0, 1, 0.5), yPct: n(t.yPct, 0, 1, 0.7),
    anim: { in: ["pop", "fade", "slide-up", "slide-left", "slide-right", "scale", "glow", "typewriter"].includes(t.anim?.in) ? t.anim.in : "pop", ms: Math.round(n(t.anim?.ms, 100, 1500, 450)) },
  };
}

/** HTML de la plantilla con sus campos (textos escapados) y el icono. */
export function fillTemplate(t, fields = {}, iconName) {
  return t.html.replace(KEY, (_, k) => (k === "icon" ? icon(iconName || t.icon || "star") : esc(fields[k] ?? t.fields.find((f) => f.key === k)?.example ?? "")));
}

/** CSS de la plantilla dentro de su caja (.tpl-<id>), con las variables de fuentes y colores. */
export function scopedCss(t) {
  return `.tpl-${t.id} { position: relative; width: ${t.width}px; height: ${t.height}px; }\n.tpl-${t.id} { ${t.css} }`;
}

/* ---------- Foto de la plantilla con el navegador del render ---------- */

export function chromePath() {
  if (process.env.STUDIO_CHROME && existsSync(process.env.STUDIO_CHROME)) return process.env.STUDIO_CHROME;
  const base = join(homedir(), ".cache", "hyperframes", "chrome", "chrome-headless-shell");
  try {
    for (const v of readdirSync(base).sort().reverse()) {
      for (const sub of readdirSync(join(base, v))) {
        for (const exe of ["chrome-headless-shell.exe", "chrome-headless-shell"]) {
          const p = join(base, v, sub, exe);
          if (existsSync(p)) return p;
        }
      }
    }
  } catch { /* no está */ }
  return null;
}

/**
 * Hace una foto PNG de cada plantilla (con sus ejemplos) sobre un fondo de vídeo oscuro.
 * vars: { fTitle, fKeyword, fCaption, accent, accent2, gold, fontFaces } · items: [{ t, out }]
 */
export async function snapTemplates(items, vars = {}) {
  const exe = chromePath();
  if (!exe || !items.length) return 0;
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: exe, headless: true, protocolTimeout: 180000, args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"] });
  let n = 0;
  try {
    const page = await browser.newPage();
    for (const { t, out, bg } of items) {
      const W = Math.max(200, t.width + 80), H = Math.max(120, t.height + 80);
      await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        ${vars.fontFaces || ""}
        :root { --f-title: ${vars.fTitle || '"Inter", sans-serif'}; --f-keyword: ${vars.fKeyword || '"Anton", sans-serif'}; --f-caption: ${vars.fCaption || '"Inter", sans-serif'};
                --accent: ${vars.accent || "#4F8CFF"}; --accent2: ${vars.accent2 || "#22D3EE"}; --gold: ${vars.gold || "#F2C84B"}; }
        html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
        body { display: grid; place-items: center; background: ${bg || "radial-gradient(120% 90% at 30% 20%, #3a4250, #12151c 60%, #07080b)"}; font-family: var(--f-title); color: #fff; }
        svg.ico { display: block; }
        ${scopedCss(t)}
      </style></head><body><div class="tpl-${t.id}">${fillTemplate(t, {}, t.icon)}</div></body></html>`;
      await page.setContent(html, { waitUntil: "load", timeout: 15000 });
      await page.evaluate(() => Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 3000))]));
      await page.screenshot({ path: out, type: "png" });
      n++;
    }
  } finally { await browser.close().catch(() => {}); }
  return n;
}
