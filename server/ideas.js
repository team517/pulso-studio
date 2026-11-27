// Ideas de contenido y plan de la semana/mes.
//  · Inspiración: creadores de Instagram (cuentas profesionales o de creador) con sus posts, leídos con
//    «Business Discovery» de Meta usando tu Instagram conectado por Facebook.
//  · Ideas: Claude las piensa con guion estructurado, a partir de tu perfil, tu semana y lo que les funciona a esos creadores.
//  · Plan: tu semana tipo (qué día cámara, qué día formación grabando pantalla) → plan del mes día a día.
// Claude trabaja en tu PC (worker) o en local; en el servidor los encargos esperan en cola.
import { db, DATA, uid, now, getSetting, setSetting } from "./db.js";
import { IS_SERVER } from "./config.js";
import { isWorker } from "./auth.js";
import { instagramAuth } from "./platforms.js";
import { FORMATS } from "./ideas-brain.js";
import { join, basename } from "node:path";
import { mkdirSync, rmSync, renameSync, copyFileSync } from "node:fs";
import express from "express";
import multer from "multer";

/** Fotos de los posts de los creadores (las de Instagram caducan): data/ideas-media/<creador>/<post>.jpg */
const IDEAS_MEDIA = join(DATA, "ideas-media");
mkdirSync(IDEAS_MEDIA, { recursive: true });
const safeName = (n) => basename(String(n || "foto.jpg")).replace(/[^\w.-]+/g, "_").slice(0, 80);

db.exec(`
  CREATE TABLE IF NOT EXISTS ideas_creators (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, profile TEXT, posts TEXT, analysis TEXT, transcripts TEXT,
    status TEXT NOT NULL, error TEXT, fetched_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, format TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL,
    date TEXT, favorite INTEGER DEFAULT 0, notes TEXT, source_job TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ideas_date ON ideas (date);
  CREATE TABLE IF NOT EXISTS ideas_jobs (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT, input TEXT NOT NULL, status TEXT NOT NULL, step TEXT, progress REAL DEFAULT 0,
    error TEXT, result TEXT, ref TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
`);

const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const STATUSES = ["idea", "plan", "grabada", "editada", "publicada", "descartada"];

/* ---------- Tu perfil y tu semana ---------- */

const DEFAULT_PROFILE = {
  about: "OnePulso: captación de clientes B2B con cold email. Una herramienta que encuentra a tu cliente ideal, personaliza los correos con IA y los envía sin ir a spam (hasta 15.000 correos al mes desde 21 $), con todas las respuestas clasificadas en una sola bandeja.",
  audience: "Dueños de agencias, consultoras y empresas B2B en España que quieren más reuniones con clientes sin depender de anuncios ni de LinkedIn.",
  offer: "Agendar una reunión para ver cómo funciona (enlace en la bio).",
  tone: "Cercano, directo y con energía. Tuteo. Frases cortas. Nada de humo.",
  goals: "Conseguir reuniones con clientes potenciales y ganar autoridad en cold email.",
  avoid: "",
};
// 0 = domingo … 6 = sábado (como Date.getDay)
const DEFAULT_WEEK = {
  days: [
    { dow: 1, type: "camara", label: "" }, { dow: 2, type: "camara", label: "" }, { dow: 3, type: "pantalla", label: "Formación" },
    { dow: 4, type: "camara", label: "" }, { dow: 5, type: "pantalla", label: "Formación" }, { dow: 6, type: "off", label: "" }, { dow: 0, type: "off", label: "" },
  ],
  time: "19:00",
};
export const getProfile = () => ({ ...DEFAULT_PROFILE, ...getSetting("ideas:profile", {}) });
export function getWeek() {
  const w = getSetting("ideas:week", null);
  if (!w?.days?.length) return DEFAULT_WEEK;
  const byDow = new Map(w.days.map((d) => [d.dow, d]));
  return { time: w.time || DEFAULT_WEEK.time, days: DEFAULT_WEEK.days.map((d) => ({ ...d, ...(byDow.get(d.dow) || {}) })) };
}

/* ---------- Instagram: perfiles y posts de otros creadores ---------- */

const cleanUser = (u) => String(u || "").trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").split(/[/?#\s]/)[0].toLowerCase();
const MEDIA_FIELDS = "id,caption,comments_count,like_count,view_count,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";

async function graph(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30e3) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    throw Object.assign(new Error(e.error_user_msg || e.message || `Instagram ${r.status}`), { code: e.code, sub: e.error_subcode });
  }
  return j;
}

async function igAccess() {
  let a;
  try { a = await instagramAuth(); } catch (e) { throw err("Conecta tu Instagram en «Conexiones» (con Facebook) para ver los posts de otros creadores. " + e.message, 409); }
  if (a.mode !== "facebook" || !a.accountId) throw err("Para ver posts de otros creadores, Instagram tiene que estar conectado con Facebook (en «Conexiones»). Con el token de Instagram, Meta no lo permite.", 409);
  return a;
}

/** Perfil + hasta 50 posts de una cuenta profesional o de creador. */
async function fetchCreator(username) {
  const a = await igAccess();
  const q = (prof, media) => `${a.host}/${a.accountId}?fields=${encodeURIComponent(`business_discovery.username(${username}){${prof},media.limit(50){${media}}}`)}&access_token=${encodeURIComponent(a.token)}`;
  let j;
  try {
    j = await graph(q("username,name,biography,followers_count,media_count,profile_picture_url,website", MEDIA_FIELDS));
  } catch (e) {
    // Algún campo no permitido para esta cuenta: se piden solo los públicos
    if (e.code === 100 && !/username|user id|find/i.test(e.message)) j = await graph(q("username,biography,followers_count,media_count,website", MEDIA_FIELDS.replace(",view_count", "")));
    else if (e.code === 110 || e.sub === 2207013 || /cannot find|invalid user|does not exist|not.*business/i.test(e.message)) throw err(`No encuentro @${username}, o no es una cuenta profesional o de creador (Meta solo deja ver esas).`, 404);
    else throw err("Instagram: " + e.message, 502);
  }
  const b = j.business_discovery;
  if (!b) throw err(`No encuentro @${username}.`, 404);
  const followers = b.followers_count ?? null;
  const posts = (b.media?.data || []).map((m) => {
    const isVideo = m.media_type === "VIDEO";
    const likes = m.like_count ?? null, comments = m.comments_count ?? null, views = m.view_count ?? null;
    const inter = (likes || 0) + 2 * (comments || 0);
    return {
      id: m.id,
      type: m.media_product_type === "REELS" || (isVideo && m.media_product_type !== "FEED") ? "reel" : isVideo ? "video" : m.media_type === "CAROUSEL_ALBUM" ? "carrusel" : "imagen",
      caption: m.caption || "", likes, comments, views,
      engagement: followers ? Math.round((inter / followers) * 10000) / 100 : null,
      url: m.permalink, at: m.timestamp,
      img: m.thumbnail_url || (!isVideo ? m.media_url : null) || null,
      video: isVideo ? m.media_url || null : null,
    };
  });
  return {
    profile: {
      username: b.username || username, name: b.name || null, bio: b.biography || "", followers, posts: b.media_count ?? null,
      pic: b.profile_picture_url || null, website: b.website || null,
    },
    posts,
  };
}

const score = (p) => (p.views ?? 0) / 50 + (p.likes ?? 0) + 2 * (p.comments ?? 0);
export const topPosts = (posts, n) => [...posts].sort((a, b) => score(b) - score(a)).slice(0, n);

function creatorOut(c, withPosts = true) {
  const posts = parse(c.posts, []);
  return {
    id: c.id, username: c.username, status: c.status, error: c.error, fetched_at: c.fetched_at, created_at: c.created_at,
    profile: parse(c.profile, null), analysis: parse(c.analysis, null), transcripts: parse(c.transcripts, []),
    postCount: posts.length, ...(withPosts ? { posts } : { preview: topPosts(posts, 3) }),
  };
}

/** Sin Instagram conectado por Facebook, los posts los lee tu PC con tu Composio (ScrapeCreators). */
function queueFetch(c) {
  db.prepare("UPDATE ideas_creators SET status = 'loading', error = NULL WHERE id = ?").run(c.id);
  try { queue("fetch", `Leer a @${c.username}`, { username: c.username, pages: 3 }, c.id); }
  catch (e) { if (e.status !== 409) throw e; }
  return "queued";
}

async function hasGraph() { try { await igAccess(); return true; } catch { return false; } }

async function refreshCreator(id) {
  const c = db.prepare("SELECT * FROM ideas_creators WHERE id = ?").get(id);
  if (!c) return;
  if (!(await hasGraph())) return queueFetch(c);
  db.prepare("UPDATE ideas_creators SET status = 'loading', error = NULL WHERE id = ?").run(id);
  try {
    const r = await fetchCreator(c.username);
    db.prepare("UPDATE ideas_creators SET profile = ?, posts = ?, status = 'ready', error = NULL, fetched_at = ? WHERE id = ?").run(JSON.stringify(r.profile), JSON.stringify(r.posts), now(), id);
  } catch (e) {
    db.prepare("UPDATE ideas_creators SET status = 'error', error = ? WHERE id = ?").run(String(e.message).slice(0, 400), id);
    throw e;
  }
}

// Los enlaces a las fotos de Instagram caducan a los pocos días: los posts se vuelven a leer cada 24 h
let refreshing = false;
async function refreshStale() {
  if (refreshing) return;
  refreshing = true;
  try {
    const old = new Date(Date.now() - 24 * 3600e3).toISOString();
    // Solo los que se leen con Facebook (gratis); los de Composio guardan sus fotos y se actualizan a mano
    if (!(await hasGraph())) return;
    for (const c of db.prepare("SELECT id, profile FROM ideas_creators WHERE status != 'loading' AND (fetched_at IS NULL OR fetched_at < ?)").all(old)) {
      if (parse(c.profile, {}).source === "composio") continue;
      await refreshCreator(c.id).catch(() => {});
    }
  } finally { refreshing = false; }
}

/* ---------- Ideas ---------- */

function ideaOut(r) {
  const d = parse(r.data, {});
  return { ...d, id: r.id, title: r.title, format: r.format, status: r.status, date: r.date, favorite: !!r.favorite, notes: r.notes || "", created_at: r.created_at, updated_at: r.updated_at };
}
function insertIdea(idea, { status = "idea", date = null, job = null } = {}) {
  const id = uid();
  const { title, format, ...data } = idea;
  db.prepare("INSERT INTO ideas (id, title, format, data, status, date, source_job, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, title, format, JSON.stringify(data), status, date, job, now(), now());
  return id;
}
function updateIdeaContent(id, idea) {
  const { title, format, ...data } = idea;
  const cur = db.prepare("SELECT data FROM ideas WHERE id = ?").get(id);
  if (!cur) return;
  db.prepare("UPDATE ideas SET title = ?, format = ?, data = ?, updated_at = ? WHERE id = ?").run(title, format, JSON.stringify({ ...parse(cur.data, {}), ...data, needsScript: false }), now(), id);
}

/* ---------- Contexto para Claude ---------- */

function weekText() {
  const week = getWeek();
  return week.days.map((d) => `- ${WEEKDAYS[d.dow]}: ${d.type === "off" ? "no publico" : FORMATS[d.type] + (d.label ? ` (${d.label})` : "")}`).join("\n") + `\nHora de publicar: ${week.time}`;
}

function contextText({ creatorIds = null } = {}) {
  const p = getProfile();
  const creators = db.prepare("SELECT * FROM ideas_creators WHERE status = 'ready' ORDER BY created_at").all()
    .filter((c) => !creatorIds?.length || creatorIds.includes(c.id)).slice(0, 8);
  const insp = creators.map((c) => {
    const prof = parse(c.profile, {});
    const a = parse(c.analysis, null);
    const top = topPosts(parse(c.posts, []), 6);
    return `@${c.username} (${prof.followers ?? "?"} seguidores)` +
      (a ? `\n  Qué le funciona: ${a.summary}\n  Ganchos: ${a.hooks.slice(0, 4).join(" | ")}\n  Estructuras: ${a.structures.slice(0, 2).join(" | ")}` : "") +
      `\n  Sus mejores posts:\n` + top.map((x) => `   · ${x.type} · ${x.views ?? "—"} vistas, ${x.likes ?? "—"} likes, ${x.comments ?? "—"} coment. · ${x.url} · «${(x.caption || "").replace(/\s+/g, " ").slice(0, 220)}»`).join("\n");
  }).join("\n\n");
  const have = db.prepare("SELECT title FROM ideas WHERE status != 'descartada' ORDER BY created_at DESC LIMIT 80").all().map((r) => `- ${r.title}`).join("\n");
  return `HOY: ${new Date().toISOString().slice(0, 10)}

SOBRE MÍ
- Qué hago: ${p.about}
- A quién hablo: ${p.audience}
- Llamada a la acción / qué vendo: ${p.offer}
- Tono: ${p.tone}
- Objetivo: ${p.goals}${p.avoid ? `\n- Evitar: ${p.avoid}` : ""}

MI SEMANA
${weekText()}

CREADORES QUE ME INSPIRAN
${insp || "(todavía ninguno: usa lo que mejor funciona en reels de negocio en España)"}

IDEAS QUE YA TENGO (no repetir)
${have || "(ninguna)"}`;
}

/** Días de publicación de un mes según la semana tipo (desde hoy si es el mes en curso). */
function publishDays(month) {
  const [y, m] = month.split("-").map(Number);
  const week = getWeek();
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) break;
    const date = dt.toISOString().slice(0, 10);
    if (date < today) continue;
    const t = week.days.find((x) => x.dow === dt.getUTCDay());
    if (!t || t.type === "off") continue;
    out.push({ date, weekday: WEEKDAYS[dt.getUTCDay()], type: t.type, label: t.label || "" });
  }
  return out;
}

/* ---------- Encargos para Claude ---------- */

const jobOut = (j) => ({ id: j.id, kind: j.kind, label: j.label, status: j.status, step: j.step, progress: j.progress, error: j.error, ref: j.ref, created_at: j.created_at, updated_at: j.updated_at });
function setJob(id, f) {
  const k = Object.keys(f);
  db.prepare(`UPDATE ideas_jobs SET ${k.map((x) => x + " = ?").join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...k.map((x) => (f[x] !== null && typeof f[x] === "object" ? JSON.stringify(f[x]) : f[x])), now(), id);
}
function queue(kind, label, input, ref = null) {
  const busy = db.prepare("SELECT id FROM ideas_jobs WHERE kind = ? AND IFNULL(ref, '') = ? AND status IN ('queued', 'running')").get(kind, ref || "");
  if (busy) throw err("Ya hay un encargo igual en marcha. Espera a que termine.", 409);
  const id = uid();
  db.prepare("INSERT INTO ideas_jobs (id, kind, label, input, status, step, ref, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)")
    .run(id, kind, label, JSON.stringify(input), IS_SERVER ? "Esperando a tu PC (Claude)" : "En cola", ref, now(), now());
  if (!IS_SERVER) setTimeout(runLocalQueue, 50);
  return jobOut(db.prepare("SELECT * FROM ideas_jobs WHERE id = ?").get(id));
}

/** Guarda lo que devolvió Claude. */
function applyResult(job, result) {
  const inp = parse(job.input, {});
  if (job.kind === "fetch") {
    db.prepare("UPDATE ideas_creators SET profile = ?, posts = ?, status = 'ready', error = NULL, fetched_at = ? WHERE id = ?")
      .run(JSON.stringify(result.profile), JSON.stringify(result.posts || []), now(), job.ref);
    return { creator: job.ref, posts: (result.posts || []).length };
  }
  if (job.kind === "creator") {
    db.prepare("UPDATE ideas_creators SET analysis = ?, transcripts = ? WHERE id = ?").run(JSON.stringify(result.analysis), JSON.stringify(result.transcripts || []), job.ref);
    return { creator: job.ref };
  }
  if (job.kind === "ideas") {
    const ids = result.ideas.map((x) => insertIdea(x, { job: job.id }));
    return { ideas: ids };
  }
  if (job.kind === "script") {
    updateIdeaContent(job.ref, result.idea);
    return { idea: job.ref };
  }
  if (job.kind === "plan") {
    const month = inp.month;
    if (inp.replace) {
      // Se quitan las piezas planificadas que aún no grabaste (lo grabado, editado o publicado se queda)
      db.prepare("DELETE FROM ideas WHERE status = 'plan' AND date LIKE ? AND source_job IS NOT NULL").run(month + "-%");
      db.prepare("UPDATE ideas SET status = 'idea', date = NULL WHERE status = 'plan' AND date LIKE ?").run(month + "-%");
    }
    let n = 0;
    for (const d of result.days) {
      if (d.ideaId && db.prepare("SELECT 1 FROM ideas WHERE id = ?").get(d.ideaId)) {
        db.prepare("UPDATE ideas SET date = ?, status = 'plan', updated_at = ? WHERE id = ?").run(d.date, now(), d.ideaId);
      } else {
        const full = result.ideas?.[d.date];
        const idea = full || { title: d.title, format: d.format, pillar: d.pillar, angle: d.angle, hook: d.hook, script: [], needsScript: true };
        insertIdea({ ...idea, format: d.format }, { status: "plan", date: d.date, job: job.id });
      }
      n++;
    }
    const plans = getSetting("ideas:plans", {});
    plans[month] = { summary: result.summary, weeks: result.weeks, at: now() };
    setSetting("ideas:plans", plans);
    return { month, days: n };
  }
  return {};
}

/** Si falla la lectura de un creador, el motivo se ve en su tarjeta. */
function jobFailed(job, error) {
  if (job.kind === "fetch" && job.ref) db.prepare("UPDATE ideas_creators SET status = 'error', error = ? WHERE id = ?").run(String(error || "No se pudo leer").slice(0, 400), job.ref);
}

export function nextIdeasTask() {
  if (!IS_SERVER) return null;
  const stale = new Date(Date.now() - 12 * 60e3).toISOString();
  const j = db.prepare("SELECT * FROM ideas_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get()
    || db.prepare("SELECT * FROM ideas_jobs WHERE status = 'running' AND updated_at < ? ORDER BY created_at LIMIT 1").get(stale);
  if (!j) return null;
  setJob(j.id, { status: "running", step: "Tu PC lo ha recogido", progress: 2, error: null });
  return { type: "ideas", job: { id: j.id, kind: j.kind, label: j.label, input: parse(j.input, {}) } };
}

/* ---------- En local: Claude trabaja aquí mismo ---------- */

let localBusy = false;
async function runLocalQueue() {
  if (localBusy || IS_SERVER) return;
  const j = db.prepare("SELECT * FROM ideas_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get();
  if (!j) return;
  localBusy = true;
  try {
    setJob(j.id, { status: "running", step: "Empezando", progress: 2 });
    const { runIdeasJob } = await import("./ideas-brain.js");
    const { askClaude, askClaudeTools, NeedLogin } = await import("./autoedit/brain.js");
    const { transcribeFile } = await import("./media.js");
    try {
      const result = await runIdeasJob({ id: j.id, kind: j.kind, input: parse(j.input, {}) }, {
        ask: askClaude, askTools: askClaudeTools, transcribe: transcribeFile, tmp: join(DATA, "tmp"),
        step: (step, progress) => setJob(j.id, { step, progress }),
        saveFile: async (f, name) => {
          const dir = join(IDEAS_MEDIA, String(j.ref || "otros"));
          mkdirSync(dir, { recursive: true });
          copyFileSync(f, join(dir, safeName(name)));
          return `/files/ideas/${j.ref || "otros"}/${safeName(name)}?v=${Date.now().toString(36)}`;
        },
      });
      // Si lo quitaste mientras Claude trabajaba, no se guarda
      if (db.prepare("SELECT status FROM ideas_jobs WHERE id = ?").get(j.id)?.status === "cancelled") return;
      const applied = applyResult(j, result);
      setJob(j.id, { status: "done", step: "Listo", progress: 100, result: applied });
    } catch (e) {
      console.error("[ideas]", e);
      jobFailed(j, e instanceof NeedLogin ? "Claude no tiene la sesión iniciada." : e.message);
      setJob(j.id, e instanceof NeedLogin ? { status: "needs_login", step: null, error: "Claude no tiene la sesión iniciada en este ordenador." } : { status: "error", step: null, error: String(e.message || e).slice(0, 500) });
    }
  } finally {
    localBusy = false;
    setTimeout(runLocalQueue, 100);
  }
}

/* ---------- Rutas ---------- */

export function registerIdeasRoutes(app, wrap) {
  app.use("/files/ideas", express.static(IDEAS_MEDIA, { maxAge: "7d" }));
  if (!IS_SERVER) {
    db.prepare("UPDATE ideas_jobs SET status = 'queued', step = 'En cola (se retoma)' WHERE status = 'running'").run();
    setTimeout(runLocalQueue, 3000);
  }

  app.get("/api/ideas/state", wrap(async (req, res) => {
    refreshStale().catch(() => {});
    // Con Facebook: Meta (gratis, solo cuentas profesionales). Sin él: tu PC con tu Composio (cualquier cuenta pública)
    let ig = { ready: true, via: "composio", account: null, why: null };
    try { const a = await igAccess(); ig = { ready: true, via: "facebook", account: a.account, why: null }; } catch (e) { ig.why = e.message; }
    res.json({
      profile: getProfile(), week: getWeek(), formats: FORMATS, ig,
      creators: db.prepare("SELECT * FROM ideas_creators ORDER BY created_at").all().map((c) => creatorOut(c, false)),
      ideas: db.prepare("SELECT * FROM ideas ORDER BY COALESCE(date, '9999'), created_at DESC").all().map(ideaOut),
      jobs: db.prepare("SELECT * FROM ideas_jobs WHERE status IN ('queued', 'running') OR updated_at > ? ORDER BY created_at DESC LIMIT 20")
        .all(new Date(Date.now() - 10 * 60e3).toISOString()).map(jobOut),
      plans: getSetting("ideas:plans", {}),
    });
  }));

  app.put("/api/ideas/profile", wrap((req, res) => {
    const b = req.body || {};
    const p = {};
    for (const k of Object.keys(DEFAULT_PROFILE)) if (k in b) p[k] = String(b[k] ?? "").slice(0, 2000);
    setSetting("ideas:profile", { ...getSetting("ideas:profile", {}), ...p });
    res.json(getProfile());
  }));

  app.put("/api/ideas/week", wrap((req, res) => {
    const b = req.body || {};
    const days = (Array.isArray(b.days) ? b.days : []).filter((d) => Number.isInteger(d?.dow) && d.dow >= 0 && d.dow <= 6)
      .map((d) => ({ dow: d.dow, type: ["camara", "pantalla", "off"].includes(d.type) ? d.type : "off", label: String(d.label || "").slice(0, 40) }));
    setSetting("ideas:week", { days, time: /^\d{2}:\d{2}$/.test(b.time) ? b.time : getWeek().time });
    res.json(getWeek());
  }));

  /* Creadores */
  app.post("/api/ideas/creators", wrap(async (req, res) => {
    const names = String(req.body?.usernames ?? req.body?.username ?? "").split(/[\s,;]+/).map(cleanUser).filter(Boolean).slice(0, 10);
    if (!names.length) throw err("Escribe el @ de al menos un creador.");
    const out = [];
    for (const u of names) {
      let c = db.prepare("SELECT * FROM ideas_creators WHERE username = ?").get(u);
      if (!c) {
        const id = uid();
        db.prepare("INSERT INTO ideas_creators (id, username, status, created_at) VALUES (?, ?, 'loading', ?)").run(id, u, now());
        c = { id };
      }
      try { await refreshCreator(c.id); } catch { /* el error queda en la fila */ }
      out.push(creatorOut(db.prepare("SELECT * FROM ideas_creators WHERE id = ?").get(c.id), false));
    }
    res.json(out);
  }));
  app.get("/api/ideas/creators/:id", wrap((req, res) => {
    const c = db.prepare("SELECT * FROM ideas_creators WHERE id = ?").get(req.params.id);
    if (!c) throw err("No encuentro ese creador.", 404);
    res.json(creatorOut(c));
  }));
  app.post("/api/ideas/creators/:id/refresh", wrap(async (req, res) => {
    try { await refreshCreator(req.params.id); } catch (e) { if (e.status !== 404) throw e; }
    res.json(creatorOut(db.prepare("SELECT * FROM ideas_creators WHERE id = ?").get(req.params.id)));
  }));
  app.delete("/api/ideas/creators/:id", wrap((req, res) => {
    db.prepare("DELETE FROM ideas_creators WHERE id = ?").run(req.params.id);
    rmSync(join(IDEAS_MEDIA, safeName(req.params.id)), { recursive: true, force: true });
    res.json({ ok: true });
  }));
  app.post("/api/ideas/creators/:id/analyze", wrap((req, res) => {
    const c = db.prepare("SELECT * FROM ideas_creators WHERE id = ?").get(req.params.id);
    if (!c || c.status !== "ready") throw err("Primero tienen que cargarse sus posts.", 409);
    const posts = topPosts(parse(c.posts, []), 25);
    res.json(queue("creator", `Estudiar a @${c.username}`, { creator: { username: c.username, profile: parse(c.profile, {}), posts } }, c.id));
  }));

  /* Ideas */
  app.post("/api/ideas/generate", wrap((req, res) => {
    const b = req.body || {};
    const count = Math.max(1, Math.min(10, Number(b.count) || 5));
    const format = ["camara", "pantalla"].includes(b.format) ? b.format : "mix";
    let post = null, creatorIds = Array.isArray(b.creatorIds) ? b.creatorIds : null;
    if (b.post?.creatorId && b.post?.postId) {
      const c = db.prepare("SELECT * FROM ideas_creators WHERE id = ?").get(b.post.creatorId);
      const p = c && parse(c.posts, []).find((x) => x.id === b.post.postId);
      if (!p) throw err("No encuentro ese post.", 404);
      const tr = parse(c.transcripts, []).find((t) => t.id === p.id);
      post = `@${c.username} · ${p.type} · ${p.views ?? "—"} vistas, ${p.likes ?? "—"} likes, ${p.comments ?? "—"} comentarios · ${p.url}\nDescripción: ${p.caption.slice(0, 1500)}${tr ? `\nLo que dice: ${tr.text.slice(0, 2500)}` : ""}`;
      creatorIds = [c.id];
    }
    const label = post ? `${count} ideas inspiradas en un post` : `${count} ideas${b.focus ? ` sobre «${String(b.focus).slice(0, 40)}»` : ""}`;
    res.json(queue("ideas", label, { ctx: contextText({ creatorIds }), count, format, focus: String(b.focus || "").slice(0, 500), post }, post ? b.post.postId : null));
  }));

  app.patch("/api/ideas/:id", wrap((req, res) => {
    const r = db.prepare("SELECT * FROM ideas WHERE id = ?").get(req.params.id);
    if (!r) throw err("No encuentro esa idea.", 404);
    const b = req.body || {};
    const f = {};
    if (STATUSES.includes(b.status)) f.status = b.status;
    if ("date" in b) {
      f.date = b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
      if (f.date && !f.status && r.status === "idea") f.status = "plan";
      if (!f.date && !f.status && r.status === "plan") f.status = "idea";
    }
    if ("favorite" in b) f.favorite = b.favorite ? 1 : 0;
    if ("notes" in b) f.notes = String(b.notes || "").slice(0, 4000);
    if (typeof b.title === "string" && b.title.trim()) f.title = b.title.trim().slice(0, 90);
    if (b.data && typeof b.data === "object") f.data = JSON.stringify({ ...parse(r.data, {}), ...b.data });
    const k = Object.keys(f);
    if (k.length) db.prepare(`UPDATE ideas SET ${k.map((x) => x + " = ?").join(", ")}, updated_at = ? WHERE id = ?`).run(...k.map((x) => f[x]), now(), r.id);
    res.json(ideaOut(db.prepare("SELECT * FROM ideas WHERE id = ?").get(r.id)));
  }));
  app.delete("/api/ideas/:id", wrap((req, res) => {
    db.prepare("DELETE FROM ideas WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  }));
  app.post("/api/ideas/:id/rewrite", wrap((req, res) => {
    const r = db.prepare("SELECT * FROM ideas WHERE id = ?").get(req.params.id);
    if (!r) throw err("No encuentro esa idea.", 404);
    const idea = ideaOut(r);
    const request = String(req.body?.request || "").slice(0, 1000) || (idea.needsScript ? "Escribe el guion completo de esta idea." : "");
    const clean = { title: idea.title, format: idea.format, pillar: idea.pillar, angle: idea.angle, hook: idea.hook, hookVisual: idea.hookVisual, duration: idea.duration, script: idea.script, screen: idea.screen, prep: idea.prep, howTo: idea.howTo, cover: idea.cover, caption: idea.caption, hashtags: idea.hashtags, inspiration: idea.inspiration };
    res.json(queue("script", `Guion: ${idea.title}`, { ctx: contextText(), idea: clean, request }, r.id));
  }));

  /* Plan del mes */
  app.post("/api/ideas/plan", wrap((req, res) => {
    const month = String(req.body?.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) throw err("Mes no válido.");
    const days = publishDays(month);
    if (!days.length) throw err("Ese mes no tiene días de publicación (revisa tu semana o elige un mes que no haya pasado).");
    const bank = db.prepare("SELECT * FROM ideas WHERE status = 'idea' ORDER BY favorite DESC, created_at DESC LIMIT 30").all().map(ideaOut)
      .filter((i) => !i.needsScript).map((i) => ({ id: i.id, title: i.title, format: i.format, hook: i.hook }));
    const [y, m] = month.split("-");
    const label = `Plan de ${new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" })}`;
    res.json(queue("plan", label, { ctx: contextText(), month, days, bank, replace: !!req.body?.replace }, month));
  }));

  app.get("/api/ideas/jobs/:id", wrap((req, res) => {
    const j = db.prepare("SELECT * FROM ideas_jobs WHERE id = ?").get(req.params.id);
    if (!j) throw err("No encuentro ese encargo.", 404);
    res.json(jobOut(j));
  }));
  app.delete("/api/ideas/jobs/:id", wrap((req, res) => {
    db.prepare("UPDATE ideas_jobs SET status = 'cancelled', step = NULL WHERE id = ? AND status IN ('queued', 'running', 'needs_login', 'error')").run(req.params.id);
    res.json({ ok: true });
  }));
  app.post("/api/ideas/jobs/:id/retry", wrap((req, res) => {
    db.prepare("UPDATE ideas_jobs SET status = 'queued', step = ?, error = NULL, progress = 0 WHERE id = ? AND status IN ('error', 'needs_login')")
      .run(IS_SERVER ? "Esperando a tu PC (Claude)" : "En cola", req.params.id);
    if (!IS_SERVER) setTimeout(runLocalQueue, 50);
    res.json({ ok: true });
  }));

  /* El PC (Claude) devuelve el resultado */
  if (IS_SERVER) {
    const guard = (req, res, next) => (isWorker(req) ? next() : res.status(401).json({ error: "Token del PC incorrecto." }));
    const up = multer({ dest: join(DATA, "tmp"), limits: { fileSize: 20 * 1024 ** 2 } });
    app.post("/api/worker/ideas/:id/file", guard, up.single("file"), wrap((req, res) => {
      const j = db.prepare("SELECT * FROM ideas_jobs WHERE id = ?").get(req.params.id);
      if (!j || !req.file) { if (req.file) rmSync(req.file.path, { force: true }); throw err("Falta el archivo.", 400); }
      const ref = safeName(j.ref || "otros"), name = safeName(req.body?.name || req.file.originalname);
      mkdirSync(join(IDEAS_MEDIA, ref), { recursive: true });
      renameSync(req.file.path, join(IDEAS_MEDIA, ref, name));
      res.json({ url: `/files/ideas/${ref}/${name}?v=${Date.now().toString(36)}` });
    }));
    // El editor del PC acaba de arrancar: lo que tenía a medias (se cerró o se reinició) vuelve a la cola
    app.post("/api/worker/ideas/requeue", guard, wrap((req, res) => {
      const r = db.prepare("UPDATE ideas_jobs SET status = 'queued', step = 'Esperando a tu PC (Claude)', progress = 0 WHERE status = 'running'").run();
      res.json({ ok: true, requeued: r.changes });
    }));
    app.post("/api/worker/ideas/:id/state", guard, wrap((req, res) => {
      const j = db.prepare("SELECT * FROM ideas_jobs WHERE id = ?").get(req.params.id);
      if (!j || j.status === "cancelled") return res.json({ gone: true });
      const b = req.body || {};
      if (b.result) {
        try {
          const applied = applyResult(j, b.result);
          setJob(j.id, { status: "done", step: "Listo", progress: 100, error: null, result: applied });
        } catch (e) {
          setJob(j.id, { status: "error", step: null, error: "No se pudo guardar el resultado: " + e.message });
        }
      } else {
        const f = {};
        if (["running", "error", "needs_login"].includes(b.status)) f.status = b.status;
        if ("step" in b) f.step = b.step;
        if ("progress" in b) f.progress = Number(b.progress) || 0;
        if ("error" in b) f.error = b.error ? String(b.error).slice(0, 500) : null;
        setJob(j.id, f);
        if (f.status === "error" || f.status === "needs_login") jobFailed(j, f.error);
      }
      res.json({ ok: true });
    }));
  }
}
