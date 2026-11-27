// Ideas de contenido: lo que se le pide a Claude y los pasos de cada encargo.
// Se ejecuta donde está Claude: en tu PC (worker.js) o en local. El servidor solo prepara el contexto
// (tu perfil, tu semana, los creadores y sus posts) y guarda el resultado.
import { mkdirSync, rmSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export const FORMATS = { camara: "Hablando a cámara", pantalla: "Formación · grabando pantalla" };
const PILLARS = ["educar", "autoridad", "caso", "venta", "personal"];
const ANGLES = ["tutorial", "lista", "error", "mito", "historia", "comparativa", "opinion", "caso"];

/* ---------- Forma de una idea ---------- */

const IDEA_SCHEMA = `{
  "title": "título corto y concreto (máx. 60 caracteres)",
  "format": "camara" | "pantalla",
  "pillar": "educar" | "autoridad" | "caso" | "venta" | "personal",
  "angle": "tutorial" | "lista" | "error" | "mito" | "historia" | "comparativa" | "opinion" | "caso",
  "hook": "la frase EXACTA que dices en los 3 primeros segundos",
  "hookVisual": "qué se ve en el primer segundo (texto en pantalla, gesto, plano o lo que enseñas en la pantalla)",
  "duration": segundos (entre 25 y 60),
  "script": [
    { "part": "Gancho", "time": "0-3 s", "say": "texto exacto que dices", "show": "qué se ve: texto en pantalla, gráfico o qué enseñas en la grabación" },
    { "part": "Problema", "time": "3-8 s", "say": "…", "show": "…" },
    { "part": "Desarrollo 1", "time": "…", "say": "…", "show": "…" },
    { "part": "…", "time": "…", "say": "…", "show": "…" },
    { "part": "Llamada a la acción", "time": "…", "say": "…", "show": "…" }
  ],
  "screen": ["SOLO si format es pantalla: pasos exactos de la grabación, en orden (qué abres, dónde haces clic, qué escribes)"],
  "prep": ["qué dejar preparado antes de grabar (2-4 cosas)"],
  "howTo": "cómo grabarlo en 2-3 frases: plano, energía, dónde mirar, ritmo",
  "cover": "texto de la portada (máx. 5 palabras)",
  "caption": "descripción para Instagram: 2-4 frases y la llamada a la acción",
  "hashtags": ["5-8 hashtags sin #"],
  "inspiration": { "creator": "@usuario o null", "post": "enlace del post o null", "why": "qué tomas de él: estructura, tipo de gancho, formato. Nunca su contenido" }
}`;

const RULES = `REGLAS DEL GUION
- Escribe como hablo yo: español de España, tuteando, frases cortas, cercano y directo. Es para decirlo en voz alta.
- Gancho en los 3 primeros segundos: una promesa concreta, un error que duele, una cifra o una pregunta que el público se hace. Nada de «Hola, hoy os voy a hablar de…».
- Estructura: Gancho → Problema → Desarrollo (2-4 puntos, un punto = una frase o dos) → Prueba o ejemplo → Llamada a la acción.
- Unas 2,5 palabras por segundo: el texto de «say» tiene que caber en «duration».
- «show» dice qué se ve en cada parte: en «camara», el texto o gráfico que va en pantalla; en «pantalla», exactamente qué estás enseñando en la grabación.
- Formato «pantalla» (formación): grabo la pantalla del ordenador y explico con la voz. Tiene que ser un tutorial que se pueda seguir paso a paso, con «screen» rellenado con los pasos reales en la herramienta.
- Formato «camara»: hablo a cámara, sin grabación de pantalla; «screen» va vacío.
- La llamada a la acción lleva a lo que vendo (ver «Sobre mí»).
- No inventes cifras, clientes ni resultados que no estén en «Sobre mí». Si hace falta un dato mío, escribe [tu dato] para que lo rellene.
- De los creadores copia la ESTRUCTURA y el TIPO de gancho de lo que mejor les funciona, nunca sus frases ni su contenido.`;

/* ---------- Normalizar lo que devuelve Claude ---------- */

const str = (v, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : v == null ? "" : String(v).slice(0, max));
const list = (v, max = 12, len = 400) => (Array.isArray(v) ? v.map((x) => str(x, len)).filter(Boolean).slice(0, max) : []);
const unquote = (s) => s.replace(/^[s«"“'»]+|[s»"”'«]+$/g, "").trim();
const oneOf = (v, opts, d) => (opts.includes(String(v || "").toLowerCase()) ? String(v).toLowerCase() : d);

export function normIdea(x, fallbackFormat = "camara") {
  if (!x || typeof x !== "object") return null;
  const format = oneOf(x.format, ["camara", "pantalla"], fallbackFormat);
  const script = (Array.isArray(x.script) ? x.script : []).map((p) => ({
    part: str(p?.part, 60) || "Parte", time: str(p?.time, 30), say: str(p?.say, 1200), show: str(p?.show, 600),
  })).filter((p) => p.say || p.show).slice(0, 12);
  const title = str(x.title, 90);
  if (!title || !script.length) return null;
  const insp = x.inspiration && typeof x.inspiration === "object" ? x.inspiration : {};
  return {
    title, format,
    pillar: oneOf(x.pillar, PILLARS, "educar"),
    angle: oneOf(x.angle, ANGLES, "tutorial"),
    hook: unquote(str(x.hook, 300)) || script[0].say,
    hookVisual: str(x.hookVisual, 300),
    duration: Math.max(10, Math.min(180, Math.round(Number(x.duration) || 40))),
    script,
    screen: format === "pantalla" ? list(x.screen, 15) : [],
    prep: list(x.prep, 6),
    howTo: str(x.howTo, 600),
    cover: str(x.cover, 60),
    caption: str(x.caption, 2200),
    hashtags: list(x.hashtags, 10, 40).map((h) => h.replace(/^#/, "").replace(/\s+/g, "")),
    inspiration: { creator: str(insp.creator, 60) || null, post: str(insp.post, 300) || null, why: str(insp.why, 400) },
  };
}

/* ---------- Prompts ---------- */

const ideasPrompt = ({ ctx, count, focus, format, post }) => `Eres el estratega de contenido y guionista de mi Instagram (reels). Tu trabajo: ideas que funcionen y guiones listos para grabar.

${ctx}
${post ? `\nINSPÍRATE EN ESTE POST CONCRETO (adapta su estructura y su gancho a mi negocio):\n${post}\n` : ""}
ENCARGO
Dame ${count} ideas de reel NUEVAS (que no estén en «Ideas que ya tengo»)${format === "camara" ? ", todas hablando a cámara" : format === "pantalla" ? ", todas de formación grabando pantalla" : ", mezclando formatos como en mi semana"}.${focus ? `\nEnfoque que pido: ${focus}` : ""}
Variedad: distintos ángulos (tutorial, lista, error, mito, historia, comparativa, opinión, caso) y pilares (sobre todo educar; algo de autoridad, caso y venta).
Cada idea, con su guion completo.

${RULES}

Responde SOLO con JSON: {"ideas": [ ${IDEA_SCHEMA} ]}`;

const planPrompt = ({ ctx, month, days, bank }) => `Eres el estratega de contenido de mi Instagram. Toca el plan de publicaciones de ${month}.

${ctx}

DÍAS DE PUBLICACIÓN DE ESTE MES (fecha · día · formato que toca ese día según mi semana):
${days.map((d) => `- ${d.date} · ${d.weekday} · ${d.type}${d.label ? ` (${d.label})` : ""}`).join("\n")}

BANCO DE IDEAS GUARDADAS (puedes usarlas si encajan en el formato del día; pon su "ideaId"):
${bank.length ? bank.map((b) => `- id ${b.id} · ${b.format} · ${b.title} — ${b.hook}`).join("\n") : "(vacío)"}

ENCARGO
1. Divide el mes en semanas con un tema cada una que cuente una historia de menos a más (por ejemplo: el problema → cómo se hace → pruebas y casos → por qué conmigo).
2. Para CADA día de la lista, una pieza: el formato tiene que ser EXACTAMENTE el del día («pantalla» = formación grabando pantalla, tutorial práctico; «camara» = hablando a cámara).
3. Reparto: ~60 % educar, ~20 % autoridad o caso, ~20 % venta. Ángulos variados. Nada repetido.
4. Usa ideas del banco cuando encajen (máximo la mitad del mes).

Responde SOLO con JSON:
{"summary": "el plan del mes en 2-3 frases",
 "weeks": [ { "week": 1, "theme": "tema de la semana", "goal": "qué consigue esa semana" } ],
 "days": [ { "date": "AAAA-MM-DD", "ideaId": "id del banco o null", "title": "…", "format": "camara|pantalla", "pillar": "…", "angle": "…", "hook": "frase exacta de los 3 primeros segundos" } ]}`;

const planScriptsPrompt = ({ ctx, items, weekTheme }) => `Eres el guionista de mis reels. Escribe el guion COMPLETO de estas piezas del plan del mes (respeta su título, formato y gancho; puedes pulir el gancho si lo mejoras).

${ctx}

PIEZAS${weekTheme ? ` (tema de la semana: ${weekTheme})` : ""}:
${items.map((d) => `- ${d.date} · ${d.format} · ${d.pillar}/${d.angle} · «${d.title}» · gancho: ${d.hook}`).join("\n")}

${RULES}

Responde SOLO con JSON: {"items": [ { "date": "AAAA-MM-DD", "idea": ${IDEA_SCHEMA} } ]}`;

const rewritePrompt = ({ ctx, idea, request }) => `Eres el guionista de mis reels. Mejora este guion según lo que pido.

${ctx}

GUION ACTUAL (JSON):
${JSON.stringify(idea)}

LO QUE PIDO: ${request || "hazlo más directo y con un gancho más fuerte"}

${RULES}

Responde SOLO con JSON: {"idea": ${IDEA_SCHEMA}}`;

const creatorPrompt = ({ creator, posts, transcripts }) => `Eres analista de contenido de Instagram. Estudia a este creador para que yo aprenda de lo que le funciona (no para copiarle).

CREADOR: @${creator.username}${creator.profile?.name ? ` (${creator.profile.name})` : ""} · ${creator.profile?.followers ?? "?"} seguidores
Bio: ${creator.profile?.bio || "—"}

SUS POSTS, de más a menos alcance (tipo · fecha · vistas/likes/comentarios · descripción):
${posts.map((p, i) => `${i + 1}. ${p.type} · ${p.at?.slice(0, 10)} · ${p.views ?? "—"} vistas / ${p.likes ?? "—"} likes / ${p.comments ?? "—"} comentarios · ${(p.caption || "").replace(/\s+/g, " ").slice(0, 350)}`).join("\n")}

${transcripts.length ? `LO QUE DICE EN SUS MEJORES REELS (transcripción):\n${transcripts.map((t) => `— Reel ${t.url}:\n${t.text.slice(0, 2500)}`).join("\n\n")}` : "(No hay transcripciones: analiza por las descripciones y los números.)"}

Responde SOLO con JSON:
{"summary": "qué hace y por qué le funciona, en 3-4 frases",
 "hooks": ["fórmula de gancho que usa + ejemplo suyo real (4-6)"],
 "structures": ["estructura típica de sus reels, paso a paso (2-4)"],
 "topics": ["temas que más le funcionan (4-8)"],
 "formats": "formatos y duración: a cámara, pantalla, carrusel, texto en pantalla, ritmo",
 "copy": ["qué puedo copiar yo (3-5)"],
 "avoid": ["qué no copiar o no me encaja (1-3)"]}`;

/* ---------- Encargos ---------- */

async function downloadTo(url, file) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120e3) });
  if (!r.ok || !r.body) throw new Error(`descarga ${r.status}`);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
}

/**
 * Ejecuta un encargo de Ideas.
 * @param job   { id, kind, input }
 * @param deps  { ask(prompt, opts) → JSON, transcribe(file) → [{w}], step(text, pct), tmp }
 * @returns el resultado que guarda el servidor
 */
export async function runIdeasJob(job, { ask, transcribe, step, tmp }) {
  const inp = job.input || {};

  if (job.kind === "creator") {
    const c = inp.creator;
    const posts = (c.posts || []).slice(0, 25);
    const transcripts = [];
    const videos = posts.filter((p) => p.video).slice(0, 3);
    if (videos.length && transcribe) {
      const dir = join(tmp, "ideas-" + job.id);
      mkdirSync(dir, { recursive: true });
      try {
        for (const [i, p] of videos.entries()) {
          step(`Escuchando su reel ${i + 1} de ${videos.length}`, 10 + i * 25);
          try {
            const f = join(dir, `${i}.mp4`);
            await downloadTo(p.video, f);
            const words = await transcribe(f);
            const text = words.map((w) => w.w).join(" ").replace(/\s+([.,!?;:])/g, "$1").trim();
            if (text) transcripts.push({ id: p.id, url: p.url, text });
          } catch (e) { console.error("[ideas] reel sin transcribir:", e.message); }
        }
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
    step("Claude estudia qué le funciona", 85);
    const a = await ask(creatorPrompt({ creator: c, posts, transcripts }), { timeoutMs: 8 * 60e3 });
    return {
      analysis: {
        summary: str(a.summary, 1200), hooks: list(a.hooks, 8), structures: list(a.structures, 5), topics: list(a.topics, 10, 120),
        formats: str(a.formats, 600), copy: list(a.copy, 6), avoid: list(a.avoid, 4), at: new Date().toISOString(),
      },
      transcripts,
    };
  }

  if (job.kind === "ideas") {
    step("Claude está pensando las ideas y escribiendo los guiones", 30);
    const r = await ask(ideasPrompt(inp), { timeoutMs: 12 * 60e3 });
    const ideas = (r.ideas || []).map((x) => normIdea(x, inp.format === "pantalla" ? "pantalla" : "camara")).filter(Boolean);
    if (!ideas.length) throw new Error("Claude no devolvió ideas válidas. Vuelve a intentarlo.");
    return { ideas };
  }

  if (job.kind === "script") {
    step("Claude está reescribiendo el guion", 40);
    const r = await ask(rewritePrompt(inp), { timeoutMs: 8 * 60e3 });
    const idea = normIdea(r.idea, inp.idea?.format);
    if (!idea) throw new Error("Claude no devolvió un guion válido. Vuelve a intentarlo.");
    return { idea };
  }

  if (job.kind === "plan") {
    step("Claude reparte el mes en semanas y temas", 8);
    const sk = await ask(planPrompt(inp), { timeoutMs: 10 * 60e3 });
    const byDate = new Map(inp.days.map((d) => [d.date, d]));
    const bankIds = new Set(inp.bank.map((b) => b.id));
    const days = (sk.days || []).filter((d) => byDate.has(d?.date)).map((d) => ({
      date: d.date,
      ideaId: d.ideaId && bankIds.has(d.ideaId) ? d.ideaId : null,
      title: str(d.title, 90), format: byDate.get(d.date).type, pillar: oneOf(d.pillar, PILLARS, "educar"),
      angle: oneOf(d.angle, ANGLES, "tutorial"), hook: unquote(str(d.hook, 300)),
    }));
    if (!days.length) throw new Error("Claude no devolvió el plan. Vuelve a intentarlo.");
    const weeks = (sk.weeks || []).map((w) => ({ week: Number(w.week) || 0, theme: str(w.theme, 120), goal: str(w.goal, 300) }));
    // Guiones completos, de 5 en 5 (las del banco ya tienen el suyo)
    const todo = days.filter((d) => !d.ideaId);
    const ideas = {};
    for (let i = 0; i < todo.length; i += 5) {
      const items = todo.slice(i, i + 5);
      step(`Claude escribe los guiones (${Math.min(i + 5, todo.length)} de ${todo.length})`, 15 + Math.round((80 * i) / Math.max(1, todo.length)));
      const weekN = Math.ceil(Number(items[0].date.slice(8, 10)) / 7);
      let r;
      try { r = await ask(planScriptsPrompt({ ctx: inp.ctx, items, weekTheme: weeks.find((w) => w.week === weekN)?.theme }), { timeoutMs: 12 * 60e3 }); }
      catch (e) { if (/sesión|login/i.test(e.message)) throw e; r = { items: [] }; }
      for (const it of r.items || []) {
        const d = items.find((x) => x.date === it?.date);
        const idea = d && normIdea(it.idea, d.format);
        if (idea) ideas[d.date] = { ...idea, format: d.format };
      }
    }
    return { summary: str(sk.summary, 800), weeks, days, ideas };
  }

  throw new Error("Encargo desconocido: " + job.kind);
}
