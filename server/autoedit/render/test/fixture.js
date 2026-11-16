// Plan de prueba realista (20 s): frases con palabra clave, 10 tipos de gráfico, zooms y titular.
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DUR = 20;
export const SIZES = { reference: [1080, 1920, "chest"], headline: [1080, 1920, "bottom"], minimal: [1080, 1920, "karaoke"], horizontal: [1920, 1080, "side"], framed: [1080, 1350, "below-frame"] };

// Frases con la palabra clave entre asteriscos; cada trozo separado por «|»
const PHRASES = [
  [0.1, 2.4, "Conseguimos | *30 reuniones* | al mes"],
  [2.4, 4.5, "todos los días | sin depender | de *publicidad*"],
  [4.5, 7.0, "ni de inversión | ni de marca personal | *ni de LinkedIn*"],
  [7.0, 9.0, "te montamos | el *sistema*"],
  [9.0, 12.6, "con dominios, | cuentas de email | y bases | de *datos*"],
  [12.6, 14.3, "todo *incluido* | desde el día uno"],
  [14.3, 15.7, "y si no llegan | *no pagas*"],
  [15.7, 17.5, "ya llevamos | *más de 4.000* | reuniones"],
  [17.5, 20.0, "cada mes | *crecen* | escríbeme y te lo explico"],
];

export function buildCaptions() {
  const caps = [], words = [];
  PHRASES.forEach(([a, b, text], phrase) => {
    const chunks = text.split("|").map((s) => s.trim());
    const per = (b - a) / chunks.length;
    chunks.forEach((ch, k) => {
      const key = ch.startsWith("*");
      const ws = ch.replace(/\*/g, "").split(/\s+/);
      const s = a + k * per, e = s + per;
      const cw = ws.map((w, j) => ({ w, t: +(s + (j * per * 0.8) / ws.length).toFixed(3) }));
      cw.forEach((w, j) => words.push({ w: w.w, s: w.t, e: +(j + 1 < cw.length ? cw[j + 1].t : e).toFixed(3) }));
      caps.push({ start: +s.toFixed(3), end: +e.toFixed(3), key, phrase, words: cw });
    });
  });
  return { caps, words };
}

export const GRAPHICS = [
  { type: "card", start: 0.3, end: 2.4, icon: "calendar", title: "30 reuniones al mes", subtitle: "Con tu propio sistema de captación" },
  { type: "days", start: 2.5, end: 4.5, days: ["L", "M", "X", "J", "V"], label: "Reuniones todos los días" },
  { type: "strike", start: 4.6, end: 6.95, items: [{ text: "Inversión publicitaria", t: 5.0 }, { text: "Marca personal", t: 5.6 }, { text: "LinkedIn", t: 6.2 }], final: "Sistema propio" },
  { type: "behind", start: 7.0, end: 8.8, text: "Sistema" },
  { type: "scene", start: 9.0, end: 12.6, kicker: "Lo que montamos", title: "Tu sistema en automático", steps: [
    { icon: "gear", label: "Dominios", t: 9.6 }, { icon: "mail", label: "Cuentas de email", t: 10.3 },
    { icon: "users", label: "Bases de datos", t: 11.0 }, { icon: "calendar", label: "Reuniones en tu agenda", t: 11.7 }] },
  { type: "checklist", start: 12.7, end: 14.2, title: "Incluido", items: [{ text: "Dominios", t: 12.9 }, { text: "Cuentas de email", t: 13.25 }, { text: "Bases de datos", t: 13.6 }] },
  { type: "compare", start: 14.3, end: 15.6, left: { icon: "doc", label: "Bajo contrato" }, right: { icon: "money", label: "No pagas", bad: true } },
  { type: "stat", start: 15.7, end: 17.4, value: 4000, prefix: "+", label: "reuniones generadas" },
  { type: "chart", start: 17.5, end: 18.7, title: "30 Reuniones / Por mes", points: [3, 5, 4, 8, 7, 12, 11, 18, 22, 30] },
  { type: "icons", start: 18.8, end: 20.0, items: [{ icon: "mail", label: "Escríbeme", t: 18.9 }, { icon: "chat", label: "Te respondo", t: 19.2 }, { icon: "calendar", label: "Agendamos", t: 19.5 }] },
];

export const ZOOMS = [
  { t: 0.2, to: 1.03, dur: 2.0 },
  { t: 4.6, to: 1.06, dur: 1.4 },
  { t: 7.0, to: 1.1, dur: 1.2 },
  { t: 8.9, to: 1.0, dur: 0.6 },
  { t: 14.3, to: 1.08, dur: 1.5 },
  { t: 17.5, to: 1.0, dur: 1.0 },
  { t: 18.8, to: 1.1, dur: 1.0 },
];


export function fixture(layout, workDir, { matte = true } = {}) {
  const [W, H, captionStyle] = SIZES[layout];
  const { caps, words } = buildCaptions();
  const plate = path.join(HERE, "out", "plate", "plate.mp4"), mt = path.join(HERE, "out", "plate", "matte.mp4");
  return {
    workDir, layout, width: W, height: H, fps: 30, duration: DUR,
    base: { video: plate, matte: matte ? mt : null, srcWidth: 1080, srcHeight: 1920 },
    words, captions: caps,
    hook: layout === "reference" || layout === "minimal" ? null : { title: "Cómo conseguir *30 reuniones* al mes sin publicidad", subtitle: "El sistema que usamos con más de 40 empresas" },
    graphics: GRAPHICS, zooms: ZOOMS, captionStyle,
    theme: { accent: "#2F8BFF", accent2: "#6E58F1", gold: "#F2C84B", bg: "#070B1A", red: "#FF4D5E" },
    hideCaptionsDuring: [[7.0, 8.8]],
  };
}
