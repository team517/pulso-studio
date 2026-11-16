// Lo que decide Claude (cortes, frases, palabras clave, gráficos, zooms, gancho, texto de la publicación)
// y cómo se convierte en la entrada del renderizador (CONTRACT.md). Con reglas fijas si no hay Claude.
import { askClaude, NeedLogin, lastProvider } from "./brain.js";
import { findIssues, heuristicDrops, safeDrops } from "./analysis.js";

/* ---------- Las 5 versiones ---------- */

const THEME_BLUE = { accent: "#4F8CFF", accent2: "#22D3EE", gold: "#F2C84B", bg: "#070B18", red: "#FF5470" };
const THEME_VIOLET = { accent: "#7C3AED", accent2: "#A855F7", gold: "#F2C84B", bg: "#09040F", red: "#FF5470" };

export const VARIANTS = [
  { key: "reference", label: "Como la referencia", layout: "reference", width: 1080, height: 1920, captionStyle: "chest", music: "synthwave", theme: THEME_BLUE },
  { key: "headline", label: "Titular arriba", layout: "headline", width: 1080, height: 1920, captionStyle: "bottom", music: "lofi", theme: THEME_VIOLET },
  { key: "minimal", label: "Minimal con subtítulos grandes", layout: "minimal", width: 1080, height: 1920, captionStyle: "karaoke", music: "synthwave", theme: THEME_VIOLET },
  { key: "horizontal", label: "Horizontal 16:9", layout: "horizontal", width: 1920, height: 1080, captionStyle: "side", music: "lofi", theme: THEME_BLUE },
  { key: "framed", label: "4:5 con marco", layout: "framed", width: 1080, height: 1350, captionStyle: "below-frame", music: "lofi", theme: THEME_VIOLET },
];

const ICONS = ["check", "x", "mail", "calendar", "chart", "gear", "user", "users", "money", "rocket", "clock", "target", "bolt", "phone",
  "star", "video", "chat", "lock", "heart", "search", "doc", "megaphone", "trophy", "camera", "link", "warning"];

const wordList = (words) => words.map((w, i) => `${i}\t${w.start.toFixed(2)}\t${w.w}${w.p != null && w.p < 0.6 ? "\t(?)" : ""}`).join("\n");

/* ---------- 1 · Qué cortar ---------- */

/** Claude lo intenta hasta 3 veces (con calma); si no sale, el trabajo se para con el motivo (nunca se edita «por reglas» sin pedirlo). */
async function withClaude(label, fn) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fn();
      if (r) return r;
      last = new Error("respuesta no válida");
    } catch (e) {
      if (e instanceof NeedLogin) throw e;
      last = e;
    }
    console.warn(`[autoedit] ${label}: intento ${i + 1} falló:`, last?.message);
    if (i < 2) await new Promise((ok) => setTimeout(ok, 5000 + i * 10000));
  }
  throw new Error(`Claude no ha podido ${label} tras 3 intentos (${String(last?.message || last).slice(0, 200)}). Pulsa «Reintentar».`);
}

export async function decideCuts(words, { vocab = "", useClaude = true } = {}) {
  const { pauses, repeats } = findIssues(words);
  if (useClaude) {
    return withClaude("decidir los cortes", async () => {
      const prompt = `Eres editor de vídeo profesional de reels en español. Te paso la transcripción palabra a palabra de una toma hablada a cámara (índice, segundo, palabra; "(?)" = Whisper no está seguro).
Decide qué QUITAR para que quede fluido: tomas falsas (cuando repite una frase, quédate con la ÚLTIMA buena), arranques fallidos, muletillas («eh», «em», «o sea» sueltos), tartamudeos y frases cortadas que luego repite. NO quites contenido con sentido y NUNCA quites negaciones («no», «sin», «ni», «nunca»…) ni palabras que cambien lo que se dice. Si dudas, no lo quites. Las pausas se quitan solas, no hace falta que las marques.
Corrige también palabras que Whisper ha oído MAL (nombres, marcas, términos técnicos que no existen como «Codefemail» → «cold email»). NUNCA cambies cifras, años, fechas ni datos que suenan bien escritos: no corrijas lo que dice la persona, solo lo que Whisper transcribió mal.${vocab ? `\nVocabulario del vídeo: ${vocab}` : ""}

Pausas largas detectadas (después de la palabra): ${JSON.stringify(pauses.slice(0, 200))}
Repeticiones detectadas: ${JSON.stringify(repeats.slice(0, 100))}

PALABRAS:
${wordList(words)}

Responde SOLO con JSON:
{"drop": [[desde, hasta], ...], "fixes": {"palabraMal": "palabraBien"}, "resumen": "una frase con lo que has quitado"}
("desde" y "hasta" son índices incluidos. "fixes" con la palabra exacta tal como aparece; valor null para borrarla.)`;
      const r = await askClaude(prompt);
      const drop = safeDrops(words, (Array.isArray(r.drop) ? r.drop : []).filter((d) => Array.isArray(d) && d.length === 2 && d[0] <= d[1] && d[0] >= 0 && d[1] < words.length));
      return { drop, fixes: r.fixes && typeof r.fixes === "object" ? r.fixes : {}, summary: r.resumen || "", brain: lastProvider() || "claude" };
    });
  }
  return { drop: heuristicDrops(words), fixes: {}, summary: "Cortes por reglas: pausas y repeticiones.", brain: "reglas" };
}

/* ---------- 2 · Plan de edición ---------- */

const GRAPHIC_HELP = `Tipos de gráfico (elige el que mejor cuente la idea; textos MUY cortos, máx. 4 palabras por etiqueta; iconos solo de esta lista: ${ICONS.join(", ")}):
- card: {"type":"card","from":i,"to":j,"icon":"mail","title":"Tu sistema","subtitle":"en automático"}
- checklist: {"type":"checklist","from":i,"to":j,"title":"Incluye","items":[{"text":"Dominios","at":k}, ...]}   (2-4 items, cada uno entra en su palabra)
- strike: {"type":"strike","from":i,"to":j,"items":[{"text":"Inversión publicitaria","at":k},...],"final":"LinkedIn"}   (lo que NO hace falta, tachado)
- stat: {"type":"stat","from":i,"to":j,"value":30,"prefix":"+","suffix":"","label":"reuniones al mes"}   (solo cifras que DICE la persona)
- days: {"type":"days","from":i,"to":j,"days":["L","M","X","J","V"],"label":"Todos los días"}
- compare: {"type":"compare","from":i,"to":j,"left":{"icon":"doc","label":"Bajo contrato"},"right":{"icon":"money","label":"No pagas","bad":true}}
- chart: {"type":"chart","from":i,"to":j,"title":"30 reuniones / mes","points":[2,5,4,9,14,22,30]}
- icons: {"type":"icons","from":i,"to":j,"items":[{"icon":"gear","label":"Automatiza","at":k},...]}   (2-4)
- scene: {"type":"scene","from":i,"to":j,"kicker":"ASÍ FUNCIONA","title":"Tu sistema","steps":[{"icon":"target","label":"Buscamos clientes","at":k},...]}   (pantalla completa, 2-4 pasos; tapa a la persona: úsala 1 vez en un tramo explicativo de 4-8 s)`;

export async function makePlan(words, { vocab = "", useClaude = true, isShort = false, styleNotes = "", angle = "", hook = "" } = {}) {
  const duration = words.length ? words[words.length - 1].end : 0;
  if (useClaude) {
    return withClaude("planificar la edición", async () => {
      const prompt = `Eres el editor de un reel profesional en español (estilo anuncio B2B: persona hablando a cámara con micro, subtítulos de 1-3 palabras a la altura del pecho, tarjetas de cristal con iconos que aparecen JUSTO en la palabra que las nombra, palabras gigantes detrás de la cabeza, una escena a pantalla completa, zooms suaves).
Te paso la transcripción YA CORTADA (índice, segundo, palabra). Duración: ${duration.toFixed(1)} s.${vocab ? `\nVocabulario: ${vocab}` : ""}

PALABRAS:
${wordList(words)}

Devuelve el plan de edición. Reglas:
1. "phrases": cubre TODAS las palabras en orden, sin saltos ni solapes. Una frase = una idea (acaba en punto, coma fuerte o pausa). Cada frase tiene "chunks" (rangos [desde,hasta] de 1-3 palabras que se leen juntos con sentido: nunca acabes un chunk en «de», «y», «que», «el», «la», «un», «a», «en»; esas van al principio del siguiente) y "key" = índice del chunk que lleva la PALABRA CLAVE (una por frase, la que más importa). El chunk clave debe tener SOLO la palabra clave o la expresión clave (1-2 palabras, p. ej. «automático», «30 reuniones»), sin artículos ni conjunciones.
2. "graphics": menos es más (edición cinematográfica y limpia, no un gráfico todo el rato). Solo donde un gráfico APORTA algo que el subtítulo no da (un número que sube, una lista, una comparación); como mucho uno cada 8-12 s y nunca dos a la vez. Prohibido: tarjetas o etiquetas que repitan las mismas palabras del subtítulo, el mismo dato dos o tres veces (etiqueta + subtítulo + rótulo), textos que se pisen, anillos o contadores vacíos o encimados. Disparado en su palabra ("from" = índice de la palabra que lo provoca, "to" = índice hasta el que se queda, 2-5 s). Textos en minúscula normal (no «Por Mes»). Nada inventado: solo lo que dice la persona. Marca en "layouts" en qué versiones va: "reference" (todos), "headline" y "framed" (los 2-4 más fuertes), "horizontal" (3-5), "minimal" (solo stat).
3. "behind": 1-2 palabras gigantes (1 palabra, MAYÚSCULAS, la idea fuerte) que salen detrás de la cabeza durante 1-2 s en su palabra; no coincidan con gráficos.
4. "zooms": 4-8 zooms suaves (to entre 1.03 y 1.10) hacia los momentos importantes; el primero a 0 con to 1.0 (el gancho se asienta desde 1.08).
5. "hook": titular corto y potente (máx. 6 palabras) que resuma el valor del vídeo, y subtítulo opcional (máx. 5 palabras).
${styleNotes ? `ESTILO DEL USUARIO (manda sobre lo demás):
${styleNotes}

` : ""}6. "post": texto para publicar (2-4 líneas que inviten a ver el vídeo, en español, y 3-5 hashtags al final) y "youtubeTitle" (máx. 70 caracteres).${isShort ? "\n7. Es un short sacado de un vídeo más largo: el gancho tiene que funcionar sin contexto." + (angle ? " Su ángulo es «" + angle + "»: que los gráficos y el titular lo refuercen." : "") + (hook ? " Titular de gancho propuesto: «" + hook + "» (úsalo en hook.title salvo que tengas uno mejor)." : "") : ""}

${GRAPHIC_HELP}

Responde SOLO con JSON:
{"topic":"3-5 palabras","hook":{"title":"...","subtitle":"..."},"post":{"caption":"...","youtubeTitle":"..."},
 "phrases":[{"chunks":[[0,1],[2,3]],"key":1}, ...],
 "graphics":[{...,"layouts":["reference","headline"]}, ...],
 "behind":[{"from":i,"to":j,"text":"PALABRA"}],
 "zooms":[{"at":0,"to":1.0,"dur":1.6},{"at":i,"to":1.05,"dur":1.6}]}`;
      const plan = await askClaude(prompt);
      const fixed = validatePlan(plan, words);
      return fixed ? { ...fixed, brain: lastProvider() || "claude" } : null;
    });
  }
  return { ...heuristicPlan(words), brain: "reglas" };
}

/** Comprueba y arregla el plan: frases que cubren todas las palabras, índices válidos, iconos conocidos. */
export function validatePlan(plan, words) {
  const n = words.length;
  if (!plan || !Array.isArray(plan.phrases) || !n) return null;
  const phrases = repairPhrases(plan.phrases, words);
  const idx = (i) => Math.min(n - 1, Math.max(0, i | 0));
  const icon = (i) => (ICONS.includes(i) ? i : "star");
  const graphics = (Array.isArray(plan.graphics) ? plan.graphics : [])
    .filter((g) => g && typeof g.type === "string" && Number.isFinite(g.from))
    .map((g) => {
      const out = { ...g, from: idx(g.from), to: idx(g.to ?? g.from), layouts: Array.isArray(g.layouts) && g.layouts.length ? g.layouts : ["reference"] };
      if (out.icon) out.icon = icon(out.icon);
      if (Array.isArray(out.items)) out.items = out.items.map((it) => ({ ...it, at: idx(it.at ?? out.from), ...(it.icon ? { icon: icon(it.icon) } : {}) }));
      if (Array.isArray(out.steps)) out.steps = out.steps.map((it) => ({ ...it, at: idx(it.at ?? out.from), icon: icon(it.icon) }));
      if (out.left) out.left = { ...out.left, icon: icon(out.left.icon) };
      if (out.right) out.right = { ...out.right, icon: icon(out.right.icon) };
      if (out.to < out.from) out.to = out.from;
      return out;
    })
    .sort((a, b) => a.from - b.from);
  return {
    topic: String(plan.topic || "Reel").slice(0, 60),
    hook: plan.hook?.title ? { title: String(plan.hook.title).slice(0, 60), subtitle: plan.hook.subtitle ? String(plan.hook.subtitle).slice(0, 50) : undefined } : null,
    post: { caption: String(plan.post?.caption || "").slice(0, 2000), youtubeTitle: String(plan.post?.youtubeTitle || plan.hook?.title || "").slice(0, 90) },
    phrases,
    graphics,
    behind: (Array.isArray(plan.behind) ? plan.behind : []).filter((b) => b?.text).map((b) => ({ from: idx(b.from), to: idx(b.to ?? b.from), text: String(b.text).toUpperCase().slice(0, 14) })),
    zooms: (Array.isArray(plan.zooms) ? plan.zooms : []).filter((z) => Number.isFinite(z.at)).map((z) => ({ at: idx(z.at), to: Math.min(1.1, Math.max(1, Number(z.to) || 1)), dur: Math.min(4, Math.max(0.6, Number(z.dur) || 1.6)) })),
  };
}

/**
 * Frases de la IA arregladas sin tirarlas: se respetan sus puntos de corte (inicio de frase y de trozo)
 * y su palabra clave; se rellenan huecos, se quitan solapes y se parten los trozos de más de 3 palabras.
 */
function repairPhrases(modelPhrases, words) {
  const n = words.length;
  const phraseStarts = new Set([0]);
  const chunkStarts = new Set([0]);
  const keyStarts = new Set();
  for (const ph of Array.isArray(modelPhrases) ? modelPhrases : []) {
    const chunks = (ph?.chunks || []).filter((c) => Array.isArray(c) && c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]));
    if (!chunks.length) continue;
    const a0 = Math.max(0, Math.min(n - 1, chunks[0][0] | 0));
    phraseStarts.add(a0);
    chunks.forEach(([a, b], k) => {
      a = Math.max(0, Math.min(n - 1, a | 0)); b = Math.max(a, Math.min(n - 1, b | 0));
      chunkStarts.add(a);
      if (b + 1 < n) chunkStarts.add(b + 1);
      if (k === (ph.key | 0)) keyStarts.add(a);
    });
  }
  if (phraseStarts.size <= 1 && chunkStarts.size <= 1) return heuristicPhrases(words);
  for (const s of phraseStarts) chunkStarts.add(s);
  const starts = [...chunkStarts].filter((x) => x >= 0 && x < n).sort((a, b) => a - b);
  // Trozos seguidos; los de más de 3 palabras se parten
  const chunks = [];
  starts.forEach((s, i) => {
    const e = (i + 1 < starts.length ? starts[i + 1] : n) - 1;
    for (let a = s; a <= e; a += 3) chunks.push([a, Math.min(e, a + 2)]);
  });
  // Agrupar en frases
  const phrases = [];
  for (const c of chunks) {
    if (!phrases.length || phraseStarts.has(c[0])) phrases.push({ chunks: [], key: 0 });
    phrases[phrases.length - 1].chunks.push(c);
  }
  for (const ph of phrases) {
    const k = ph.chunks.findIndex(([a]) => keyStarts.has(a));
    if (k >= 0) ph.key = k;
    else {
      // Sin clave marcada: la palabra más larga o una cifra
      let best = -1;
      ph.chunks.forEach(([a, b], idx) => {
        for (let i = a; i <= b; i++) {
          const w = words[i].w.replace(/[^\p{L}\p{N}]/gu, "");
          const score = /\d/.test(w) ? 100 : w.length;
          if (score > best) { best = score; ph.key = idx; }
        }
      });
    }
  }
  return phrases;
}

/* ---------- Reglas fijas (sin Claude) ---------- */

function heuristicPhrases(words) {
  const phrases = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const chunks = [];
    for (let i = 0; i < cur.length; i += 3) chunks.push([cur[i], cur[Math.min(i + 2, cur.length - 1)]]);
    // Palabra clave: la más larga (o una cifra)
    let key = 0, best = -1;
    chunks.forEach(([a, b], k) => {
      for (let i = a; i <= b; i++) {
        const w = words[i].w.replace(/[^\p{L}\p{N}]/gu, "");
        const score = /\d/.test(w) ? 100 : w.length;
        if (score > best) { best = score; key = k; }
      }
    });
    phrases.push({ chunks, key });
    cur = [];
  };
  words.forEach((w, i) => {
    if (cur.length && w.start - words[i - 1].end > 0.35) flush();
    cur.push(i);
    if (/[.!?]$/.test(w.w) || cur.length >= 9) flush();
  });
  flush();
  return phrases;
}

function heuristicPlan(words) {
  const phrases = heuristicPhrases(words);
  const graphics = [];
  words.forEach((w, i) => {
    const m = w.w.replace(/\./g, "").match(/^\+?(\d{1,6})/);
    if (m && (!graphics.length || words[i].start - words[graphics[graphics.length - 1].from].start > 5)) {
      const label = words.slice(i + 1, i + 4).map((x) => x.w).join(" ").replace(/[.,;:]$/, "");
      graphics.push({ type: "stat", from: i, to: Math.min(words.length - 1, i + 6), value: Number(m[1]), label, layouts: ["reference", "headline", "horizontal", "framed", "minimal"] });
    }
  });
  const first = words.slice(0, 6).map((w) => w.w).join(" ").replace(/[.,;:]$/, "");
  const dur = words.length ? words[words.length - 1].end : 0;
  const zooms = [{ at: 0, to: 1, dur: 1.6 }];
  for (let t = 6; t < dur - 3; t += 7) {
    const i = words.findIndex((w) => w.start >= t);
    if (i > 0) zooms.push({ at: i, to: zooms.length % 2 ? 1.05 : 1.0, dur: 1.8 });
  }
  return {
    topic: first.split(" ").slice(0, 4).join(" "),
    hook: { title: first },
    post: { caption: words.slice(0, 20).map((w) => w.w).join(" ") + "…", youtubeTitle: first },
    phrases, graphics, behind: [], zooms,
  };
}

/* ---------- 3 · Del plan a la entrada del renderizador ---------- */

/** Subtítulos con tiempos: cada trozo dura hasta el siguiente (+0,35 s de cola como mucho), nunca menos de 0,4 s. */
export function buildCaptions(plan, words, maxWords = 0) {
  const chunks = [];
  plan.phrases.forEach((ph, p) => ph.chunks.forEach(([a, b], k) => {
    // El estilo manda: si pide N palabras como máximo, los trozos largos se parten
    if (maxWords > 0 && b - a + 1 > maxWords) {
      for (let x = a; x <= b; x += maxWords) chunks.push({ a: x, b: Math.min(b, x + maxWords - 1), key: k === ph.key, phrase: p });
    } else chunks.push({ a, b, key: k === ph.key, phrase: p });
  }));
  return chunks.map((c, i) => {
    const start = words[c.a].start;
    const nextStart = i + 1 < chunks.length ? words[chunks[i + 1].a].start : Infinity;
    let end = Math.min(nextStart, words[c.b].end + 0.35);
    if (end - start < 0.4) end = Math.min(start + 0.4, nextStart === Infinity ? start + 0.4 : Math.max(nextStart, start + 0.4));
    return {
      start: +start.toFixed(3), end: +end.toFixed(3), key: c.key, phrase: c.phrase,
      words: words.slice(c.a, c.b + 1).map((w) => ({ w: w.w, t: +w.start.toFixed(3) })),
    };
  });
}

/** Entrada de renderVariant para una versión. */
export function renderInputFor(variant, plan, words, { workDir, base, duration, style = null }) {
  const T = (i) => words[Math.min(words.length - 1, Math.max(0, i))].start;
  const E = (i) => words[Math.min(words.length - 1, Math.max(0, i))].end;
  // Estilo sin gráficos: solo subtítulos y zooms, pase lo que pase en el plan
  const noGraphics = style?.graphics === "none";
  const pick = noGraphics ? [] : plan.graphics.filter((g) => g.layouts.includes(variant.layout));
  // Tiempos: entra 30 ms antes de su palabra; se queda hasta "to" + 0,6 s, sin pisar al siguiente
  const graphics = [];
  pick.forEach((g, k) => {
    const start = Math.max(0, T(g.from) - 0.03);
    const nextStart = k + 1 < pick.length ? T(pick[k + 1].from) - 0.15 : duration;
    const end = Math.min(nextStart, Math.max(start + 1.6, E(g.to) + 0.6), duration);
    if (end - start < 1) return;
    const { from, to, layouts, ...rest } = g;
    const out = { ...rest, start: +start.toFixed(3), end: +end.toFixed(3) };
    if (Array.isArray(out.items)) out.items = out.items.map(({ at, ...it }) => ({ ...it, t: +Math.max(start + 0.2, T(at) - 0.03).toFixed(3) }));
    if (Array.isArray(out.steps)) out.steps = out.steps.map(({ at, ...it }) => ({ ...it, t: +Math.max(start + 0.4, T(at) - 0.03).toFixed(3) }));
    graphics.push(out);
  });
  // Palabras detrás de la cabeza: solo en la versión de referencia y si hay recorte
  if (variant.layout === "reference" && !noGraphics) {
    for (const b of plan.behind) {
      const start = Math.max(0, T(b.from) - 0.03);
      const end = Math.min(duration, Math.max(start + 1.2, E(b.to) + 0.3));
      if (!graphics.some((g) => g.start < end && start < g.end)) graphics.push({ type: "behind", start: +start.toFixed(3), end: +end.toFixed(3), text: b.text });
    }
    graphics.sort((a, b) => a.start - b.start);
  }
  const hide = graphics.filter((g) => g.type === "scene" || g.type === "behind").map((g) => [g.start, g.end]);
  const zoomK = variant.layout === "minimal" ? 1.5 : 1;
  const zs = style?.motion?.zoomStyle;
  const zMax = Math.min(1.25, Math.max(1, Number(style?.motion?.zoomMax) || 1.1));
  let zooms;
  if (zs === "none") zooms = [];
  else if (zs === "punch") {
    // Zoom de golpe al empezar frases (como un corte de cámara): alterna plano normal y cerrado, nunca dos seguidos en < 2,5 s
    zooms = [];
    let last = -9, close = false;
    plan.phrases.forEach((ph) => {
      const t = T(ph.chunks[0][0]);
      if (t - last < 2.5 || t < 0.5) return;
      close = !close;
      zooms.push({ t: +t.toFixed(3), to: +(close ? zMax : 1).toFixed(3), dur: 0, ease: "cut" });
      last = t;
    });
  } else zooms = plan.zooms.map((z) => ({ t: +T(z.at).toFixed(3), to: +Math.min(zMax, 1 + (z.to - 1) * zoomK).toFixed(3), dur: z.dur, ease: "power2.inOut" }));
  return {
    workDir, layout: variant.layout, width: variant.width, height: variant.height, fps: 30, duration,
    base, words: words.map((w) => ({ w: w.w, s: w.start, e: w.end })),
    captions: buildCaptions(plan, words, Number(style?.caption?.maxWords) || 0),
    hook: ["headline", "horizontal", "framed"].includes(variant.layout) ? plan.hook : null,
    graphics, zooms, captionStyle: variant.captionStyle, theme: variant.theme, hideCaptionsDuring: hide,
    ...(style ? { style } : {}),
  };
}

/* ---------- Shorts de un vídeo largo ---------- */

export async function pickShorts(words, { count = 3, vocab = "", useClaude = true } = {}) {
  const duration = words.length ? words[words.length - 1].end : 0;
  if (useClaude) {
    return withClaude("elegir los shorts", async () => {
      const r = await askClaude(`Eres editor de shorts virales en español. De esta transcripción de un vídeo largo (${(duration / 60).toFixed(1)} min), saca ${count} shorts de 25-60 s cada uno que NO PAREZCAN EL MISMO VÍDEO:
- Cada short trata una idea distinta (nada de dos shorts sobre lo mismo) y tiene un ÁNGULO distinto: consejo práctico, historia/caso real, error común, lista de pasos, dato sorprendente, opinión polémica, pregunta al público, antes/después, mito vs realidad.
- Empieza con un gancho fuerte en la primera frase (si la mejor frase de gancho está más adelante, puedes empezar el short por ella y seguir con el resto: usa varios tramos).
- Se entiende sin contexto y cierra una idea completa.
- Puede ser un tramo seguido o 2-3 tramos que se unen bien. Sin solaparse entre shorts.${count > 10 ? "\n- Tienes que sacar muchos: aprovecha todo el vídeo, pero solo momentos que se sostengan solos." : ""}${vocab ? `\nVocabulario: ${vocab}` : ""}

PALABRAS (índice, segundo, palabra):
${wordList(words)}

Responde SOLO con JSON:
{"shorts":[{"title":"titular del short (máx. 6 palabras)","angle":"consejo|historia|error|lista|dato|polémica|pregunta|antes-después|mito","hook":"texto del gancho en pantalla (máx. 7 palabras, distinto en cada short)","why":"por qué funciona (1 frase)","ranges":[[desde,hasta]]}]}
(desde/hasta = índices de palabra incluidos; que cada short sume 25-60 s.)`, { timeoutMs: 12 * 60e3 });
      const used = new Set();
      const list = (r.shorts || []).map((s) => ({
        title: String(s.title || "Short").slice(0, 60), why: String(s.why || ""),
        angle: String(s.angle || "").slice(0, 30), hook: String(s.hook || "").slice(0, 70),
        ranges: (s.ranges || []).filter((x) => Array.isArray(x) && x[0] <= x[1] && x[0] >= 0 && x[1] < words.length),
      }))
        // Sin solapes entre shorts (si Claude se equivoca, se queda el primero)
        .map((s) => ({ ...s, ranges: s.ranges.filter(([a, b]) => { for (let i = a; i <= b; i++) if (used.has(i)) return false; return true; }) }))
        .filter((s) => {
          if (!s.ranges.length) return false;
          for (const [a, b] of s.ranges) for (let i = a; i <= b; i++) used.add(i);
          return true;
        });
      return list.length ? list : null;
    });
  }
  // Reglas: trozos de ~45 s que empiezan y acaban en final de frase
  const out = [];
  let i = 0;
  while (out.length < count && i < words.length) {
    const t0 = words[i].start;
    let j = i;
    while (j + 1 < words.length && words[j + 1].end - t0 < 45) j++;
    while (j > i && !/[.!?]$/.test(words[j].w) && words[j].end - t0 > 25) j--;
    out.push({ title: words.slice(i, i + 5).map((w) => w.w).join(" "), why: "Tramo seguido de ~45 s", ranges: [[i, j]] });
    i = j + 1;
  }
  return out;
}
