// Logos de marcas (Simple Icons, CC0): más de 3.000 marcas en SVG, ya sin fondo. Claude los nombra
// («Instagram», «Gmail», «Notion») y aquí se resuelven al SVG oficial con su color.
import * as SI from "simple-icons";

const ALL = Object.values(SI).filter((x) => x && typeof x === "object" && x.svg && x.title);
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
const BY = new Map();
for (const i of ALL) { BY.set(norm(i.title), i); BY.set(norm(i.slug), i); }
const ALIAS = { gmail: "gmail", google: "google", x: "x", twitter: "x", meta: "meta", facebook: "facebook", whatsapp: "whatsapp", youtube: "youtube", tiktok: "tiktok", instagram: "instagram", hubspot: "hubspot", notion: "notion", stripe: "stripe", shopify: "shopify", chatgpt: "openai", openai: "openai", claude: "anthropic", anthropic: "anthropic", zapier: "zapier", calendly: "calendly", slack: "slack" };

/** { title, hex, svg } de una marca, o null si no está. */
export function findLogo(name) {
  const n = norm(name);
  if (!n) return null;
  return BY.get(ALIAS[n] || n) || BY.get(n.replace(/(app|inc|hq)$/, "")) || null;
}

/** SVG listo para el render: blanco (por defecto) o con el color de la marca. */
export function logoSvg(name, { color = "#ffffff", size = 64, brand = false } = {}) {
  const i = findLogo(name);
  if (!i) return null;
  const fill = brand ? `#${i.hex}` : color;
  return i.svg.replace("<svg ", `<svg class="brand" width="${size}" height="${size}" fill="${fill}" `);
}
