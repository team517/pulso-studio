// Resultados de lo publicado: visualizaciones, alcance, me gusta… de Instagram, YouTube y TikTok.
// Cada hora se consultan las publicaciones de los últimos 30 días y se guarda una foto en `post_insights`
// (así se ve cómo crecen). Nunca tumba el servidor: cualquier fallo queda anotado en `post_insights_state`.
import { db, now, row } from "./db.js";
import { accessToken, getConf, instagramAuth, trialGraduation } from "./platforms.js";

/** Regla para marcar un reel de prueba como «Ha funcionado» (un único sitio para cambiarla). */
export const TRIAL_WINNER_RULE = {
  factor: 1.5,        // visualizaciones ≥ 1,5 × la mediana de tus otros reels de prueba…
  minOthers: 3,       // …si hay al menos 3 otros con datos;
  minViewsIfFew: 1000, // si hay menos, basta con llegar a 1.000 visualizaciones.
};

export const METRICS = ["views", "reach", "likes", "comments", "shares", "saves", "interactions", "avg_watch_ms"];
const IG_METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time"];
const IG_NAME_TO_KEY = {
  views: "views", plays: "views", reach: "reach", likes: "likes", comments: "comments", shares: "shares",
  saved: "saves", total_interactions: "interactions", ig_reels_avg_watch_time: "avg_watch_ms",
};

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const WINDOW_MS = 30 * DAY;      // el sondeo automático mira solo lo publicado en los últimos 30 días
const STAGGER_MS = 1500;         // pausa entre consultas a las redes
const STAGGER_SMALL_MS = 300;    // pausa entre métricas cuando se piden de una en una
const HISTORY_POINTS = 60;       // fotos que se mandan a la web por publicación y red

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v));
  return null;
};
/** Quita tokens de cualquier texto antes de guardarlo o enseñarlo. */
const noTokens = (s) => String(s ?? "")
  .replace(/access_token=[^&\s"']+/gi, "access_token=***")
  .replace(/Bearer\s+[\w.\-~+/=]+/gi, "Bearer ***");
const scrub = (s) => noTokens(s).slice(0, 600);

class InsightError extends Error {
  /** fatal = afecta a toda la red (token, permisos, límite): no seguir con esa red en esta pasada.
   *  unavailable = esta red/publicación no puede dar estadísticas (no tiene sentido reintentar pronto). */
  constructor(message, { fatal = false, unavailable = false, metric = false } = {}) {
    super(scrub(message));
    this.fatal = fatal; this.unavailable = unavailable; this.metric = metric;
  }
}

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { ok: res.ok, status: res.status, json };
}

/* ---------- Lectura de las respuestas (funciones puras, probadas aparte) ---------- */

/** Respuesta de /{media-id}/insights → métricas. Lo que no viene queda en null (no en 0). */
export function parseIgInsights(json) {
  const out = {};
  for (const m of json?.data ?? []) {
    const key = IG_NAME_TO_KEY[m?.name];
    if (!key) continue;
    const v = num(m.total_value?.value) ?? num(m.values?.[0]?.value);
    if (v == null) continue;
    if (key === "views" && m.name === "plays" && out.views != null) continue; // «views» manda sobre «plays»
    out[key] = v;
  }
  return out;
}

export function parseYtStats(json, id) {
  const it = (json?.items ?? []).find((x) => !id || x.id === id) ?? null;
  if (!it) return null;
  const s = it.statistics ?? {};
  return { views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount) };
}

export function parseTtVideos(json, id) {
  const v = (json?.data?.videos ?? []).find((x) => String(x.id) === String(id)) ?? null;
  if (!v) return null;
  return { views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) };
}

/** Une métricas: lo nuevo manda; lo que falta se toma de `prev` (las cifras de por vida no bajan a «nada»). */
export function mergeMetrics(fresh, prev) {
  const out = {};
  for (const k of METRICS) out[k] = fresh?.[k] ?? prev?.[k] ?? null;
  return out;
}
const hasAny = (m) => !!m && METRICS.some((k) => m[k] != null);
const sameMetrics = (a, b) => METRICS.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));

export function median(list) {
  const a = list.filter((v) => typeof v === "number").sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** ¿Ha funcionado este reel de prueba? `otherViews` = visualizaciones de tus OTROS reels de prueba. */
export function isTrialWinner(views, otherViews, rule = TRIAL_WINNER_RULE) {
  if (typeof views !== "number" || views <= 0) return false;
  const others = otherViews.filter((v) => typeof v === "number");
  if (others.length >= rule.minOthers) return views >= rule.factor * median(others);
  return views >= rule.minViewsIfFew;
}

/** Id del vídeo en cada red, a partir de lo que guardó el programador al publicar. */
export function mediaIdOf(platform, result) {
  if (!result || result.status !== "ok") return null;
  if (platform === "tiktok") return result.videoId ?? String(result.url ?? "").match(/\/video\/(\d+)/)?.[1] ?? null;
  return result.id ?? null;
}

/* ---------- Consultas a cada red ---------- */

function graphError(r) {
  const e = r.json?.error ?? {};
  const code = Number(e.code);
  const msg = `Instagram: ${e.message || e.error_user_msg || r.json?.raw || "error " + r.status}`;
  if (code === 190 || code === 102 || r.status === 401) return new InsightError(msg + " (vuelve a conectar Instagram en Conexiones)", { fatal: true });
  if ([4, 17, 32, 613].includes(code)) return new InsightError(msg + " (límite de consultas: se reintenta más tarde)", { fatal: true });
  if (code === 10 || code === 200 || (code >= 200 && code < 300)) return new InsightError(msg + " (al token le falta el permiso instagram_manage_insights)", { fatal: true });
  if (code === 100 && /does not exist|cannot be loaded|unsupported get request/i.test(e.message || "")) return new InsightError("Instagram ya no encuentra esta publicación (¿borrada?).", { unavailable: true });
  return new InsightError(msg, { metric: code === 100 });
}

async function fetchInstagram(mediaId) {
  const { host, token } = await instagramAuth();
  const tk = "access_token=" + encodeURIComponent(token);
  const base = `${host}/${encodeURIComponent(mediaId)}/insights`;
  let metrics = {};
  const raw = { insights: [] };
  let insightsOk = false;
  let firstErr = null;

  const r = await getJson(`${base}?metric=${IG_METRICS.join(",")}&${tk}`);
  if (r.ok) { insightsOk = true; metrics = parseIgInsights(r.json); raw.insights.push(...(r.json.data ?? [])); }
  else {
    firstErr = graphError(r);
    if (firstErr.fatal || firstErr.unavailable) throw firstErr;
    // Alguna métrica no está disponible para este vídeo: se piden de una en una y se queda lo que funcione
    for (const m of IG_METRICS) {
      await sleep(STAGGER_SMALL_MS);
      const r1 = await getJson(`${base}?metric=${m}&${tk}`);
      if (r1.ok) {
        insightsOk = true;
        for (const [k, v] of Object.entries(parseIgInsights(r1.json))) if (v != null) metrics[k] = v;
        raw.insights.push(...(r1.json.data ?? []));
      } else {
        const e1 = graphError(r1);
        if (e1.fatal || e1.unavailable) throw e1;
      }
    }
  }
  // Me gusta y comentarios llegan al momento en los campos del propio vídeo (las estadísticas pueden tardar)
  if (metrics.likes == null || metrics.comments == null) {
    await sleep(STAGGER_SMALL_MS);
    const f = await getJson(`${host}/${encodeURIComponent(mediaId)}?fields=like_count,comments_count&${tk}`);
    if (f.ok) {
      metrics.likes ??= num(f.json.like_count);
      metrics.comments ??= num(f.json.comments_count);
      raw.fields = { like_count: f.json.like_count ?? null, comments_count: f.json.comments_count ?? null };
    }
  }
  if (!insightsOk && !hasAny(metrics) && firstErr) throw firstErr;
  return { metrics, raw: { insights: raw.insights.map(({ name, period, values, total_value }) => ({ name, period, values, total_value })), fields: raw.fields } };
}

async function fetchYouTube(videoId) {
  const token = await accessToken("youtube");
  const r = await getJson(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(videoId)}`, { headers: { authorization: "Bearer " + token } });
  if (!r.ok) {
    const e = r.json?.error ?? {};
    const reason = e.errors?.[0]?.reason ?? "";
    const msg = `YouTube: ${e.message || r.json?.raw || "error " + r.status}`;
    if (r.status === 401) throw new InsightError(msg + " (vuelve a conectar YouTube)", { fatal: true });
    if (/quota|rateLimit/i.test(reason)) throw new InsightError(msg + " (cuota agotada: se reintenta más tarde)", { fatal: true });
    if (r.status === 403) throw new InsightError(msg, { fatal: true });
    throw new InsightError(msg);
  }
  const metrics = parseYtStats(r.json, videoId);
  if (!metrics) throw new InsightError("YouTube no encuentra el vídeo (¿borrado o privado?).", { unavailable: true });
  return { metrics, raw: { statistics: r.json.items?.[0]?.statistics ?? null } };
}

async function fetchTikTok(videoId) {
  const scope = getConf("tiktok").tokens?.scope;
  if (scope && !String(scope).split(/[,\s]+/).includes("video.list")) {
    throw new InsightError("No disponible: la conexión con TikTok no tiene el permiso video.list (hay que añadirlo a tu app de TikTok y volver a conectar).", { unavailable: true, fatal: true });
  }
  const token = await accessToken("tiktok");
  const r = await getJson("https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count", {
    method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ filters: { video_ids: [String(videoId)] } }),
  });
  const code = r.json?.error?.code;
  if (!r.ok || (code && code !== "ok")) {
    const msg = `TikTok: ${r.json?.error?.message || code || "error " + r.status}`;
    if (code === "scope_not_authorized" || code === "scope_permission_missed") throw new InsightError("No disponible: la conexión con TikTok no tiene el permiso video.list.", { unavailable: true, fatal: true });
    if (code === "access_token_invalid" || r.status === 401) throw new InsightError(msg + " (vuelve a conectar TikTok)", { fatal: true });
    if (code === "rate_limit_exceeded" || r.status === 429) throw new InsightError(msg + " (límite de consultas)", { fatal: true });
    throw new InsightError(msg);
  }
  const metrics = parseTtVideos(r.json, videoId);
  if (!metrics) throw new InsightError("TikTok no devuelve este vídeo (puede ser privado o seguir procesándose).");
  return { metrics, raw: { video: r.json.data.videos.find((x) => String(x.id) === String(videoId)) } };
}

const FETCHERS = { instagram: fetchInstagram, youtube: fetchYouTube, tiktok: fetchTikTok };

/* ---------- Guardado ---------- */

const getState = (postId, p) => db.prepare("SELECT * FROM post_insights_state WHERE post_id = ? AND platform = ?").get(postId, p) ?? null;
function setState(postId, p, mediaId, status, error, ok) {
  const t = now();
  db.prepare(`INSERT INTO post_insights_state (post_id, platform, media_id, status, error, last_try_at, last_ok_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(post_id, platform) DO UPDATE SET media_id = excluded.media_id, status = excluded.status, error = excluded.error,
    last_try_at = excluded.last_try_at, last_ok_at = COALESCE(excluded.last_ok_at, post_insights_state.last_ok_at)`)
    .run(postId, p, mediaId, status, error ? scrub(error) : null, t, ok ? t : null);
}
const lastSnapshot = (postId, p) => db.prepare("SELECT * FROM post_insights WHERE post_id = ? AND platform = ? ORDER BY fetched_at DESC, id DESC LIMIT 1").get(postId, p) ?? null;

/** Guarda una foto de las métricas (si cambió algo). Devuelve las métricas que quedan como actuales. */
export function saveSnapshot(postId, p, mediaId, fresh, raw) {
  const prev = lastSnapshot(postId, p);
  const merged = mergeMetrics(fresh, prev);
  if (!hasAny(merged)) { setState(postId, p, mediaId, "pending", null, false); return null; }
  if (!prev || !sameMetrics(merged, prev)) {
    db.prepare(`INSERT INTO post_insights (post_id, platform, media_id, fetched_at, ${METRICS.join(", ")}, raw) VALUES (?, ?, ?, ?, ${METRICS.map(() => "?").join(", ")}, ?)`)
      .run(postId, p, mediaId, now(), ...METRICS.map((k) => merged[k]), raw ? noTokens(JSON.stringify(raw)).slice(0, 20000) : null);
  }
  setState(postId, p, mediaId, "ok", null, true);
  return merged;
}

/* ---------- Consultar ---------- */

const busyKeys = new Set();
const platformErrors = {}; // último fallo general por red (token caducado, permisos…), para enseñarlo arriba

/** Consulta una red de una publicación. Nunca lanza: devuelve { ok, fatal }. */
export async function refreshPlatform(post, p) {
  const result = post.results?.[p];
  const mediaId = mediaIdOf(p, result);
  if (!mediaId) {
    setState(post.id, p, null, "unavailable", p === "tiktok" ? "No disponible: TikTok no dio el id público del vídeo (p. ej. si quedó en tu bandeja o es privado)." : "No hay id del vídeo publicado.", false);
    return { ok: false, fatal: false };
  }
  const key = post.id + ":" + p;
  if (busyKeys.has(key)) return { ok: false, fatal: false };
  busyKeys.add(key);
  try {
    const { metrics, raw } = await FETCHERS[p](mediaId);
    saveSnapshot(post.id, p, mediaId, metrics, raw);
    delete platformErrors[p];
    return { ok: true, fatal: false };
  } catch (e) {
    const err = e instanceof InsightError ? e : new InsightError(e?.message || String(e));
    setState(post.id, p, mediaId, err.unavailable ? "unavailable" : "error", err.message, false);
    if (err.fatal) platformErrors[p] = err.message;
    return { ok: false, fatal: err.fatal };
  } finally {
    busyKeys.delete(key);
  }
}

const publishedAtOf = (post, p) => post.results?.[p]?.at ?? post.scheduled_at;

/** ¿Toca consultar? Más a menudo al principio, cuando más cambian las cifras. */
export function isDue(state, publishedAt, at = Date.now()) {
  const age = at - new Date(publishedAt).getTime();
  if (!(age >= 0) || age > WINDOW_MS) return false;
  let every = age < 3 * DAY ? HOUR : age < 10 * DAY ? 6 * HOUR : DAY;
  if (state?.status === "unavailable") every = Math.max(every, DAY);
  if (!state?.last_try_at) return true;
  return at - new Date(state.last_try_at).getTime() >= every - 5 * 60e3;
}

const publishedPosts = () => db.prepare("SELECT * FROM posts WHERE status IN ('published', 'partial') ORDER BY scheduled_at DESC LIMIT 500").all().map(row);

let running = false;
let lastRunAt = null;

/** Una pasada por todo lo publicado en los últimos 30 días. `force` = sin esperar a que «toque». */
export async function pollInsights({ force = false } = {}) {
  if (running) return false;
  running = true;
  try {
    db.prepare("DELETE FROM post_insights WHERE post_id NOT IN (SELECT id FROM posts)").run();
    db.prepare("DELETE FROM post_insights_state WHERE post_id NOT IN (SELECT id FROM posts)").run();
    const blocked = new Set();
    for (const post of publishedPosts()) {
      for (const p of post.platforms ?? []) {
        if (post.results?.[p]?.status !== "ok" || blocked.has(p) || !FETCHERS[p]) continue;
        const at = publishedAtOf(post, p);
        if (Date.now() - new Date(at).getTime() > WINDOW_MS) continue;
        if (!force && !isDue(getState(post.id, p), at)) continue;
        const r = await refreshPlatform(post, p);
        if (r.fatal) blocked.add(p);
        await sleep(STAGGER_MS);
      }
    }
    return true;
  } catch (e) {
    console.error("[insights]", scrub(e?.message || e));
    return false;
  } finally {
    running = false;
    lastRunAt = now();
  }
}

/** Consulta ya todas las redes de una publicación (botón «Actualizar» de una tarjeta). */
export async function refreshPost(id) {
  const post = row(db.prepare("SELECT * FROM posts WHERE id = ?").get(id));
  if (!post) return null;
  for (const p of post.platforms ?? []) {
    if (post.results?.[p]?.status !== "ok" || !FETCHERS[p]) continue;
    await refreshPlatform(post, p);
    await sleep(STAGGER_SMALL_MS);
  }
  return post;
}

/* ---------- Lo que ve la web ---------- */

function videoOf(exportId) {
  const e = exportId ? db.prepare("SELECT id, name, file, thumb, duration FROM exports WHERE id = ?").get(exportId) : null;
  return e ? { id: e.id, name: e.name, duration: e.duration, url: e.file ? `/files/exports/${e.file}` : null, thumbUrl: e.thumb ? `/files/thumbs/${e.thumb}` : null } : null;
}

const sumOf = (list, k) => {
  const vals = list.map((m) => m?.[k]).filter((v) => typeof v === "number");
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
};

/** Lista de publicaciones con sus resultados, las ganadoras de prueba primero y luego por visualizaciones. */
export function listInsights() {
  const posts = publishedPosts().filter((p) => (p.platforms ?? []).some((x) => p.results?.[x]?.status === "ok"));
  const ids = posts.map((p) => p.id);

  // Fotos y estado, de una vez
  const snaps = new Map();
  const states = new Map();
  if (ids.length) {
    const marks = ids.map(() => "?").join(",");
    for (const s of db.prepare(`SELECT post_id, platform, fetched_at, ${METRICS.join(", ")} FROM post_insights WHERE post_id IN (${marks}) ORDER BY fetched_at, id`).all(...ids)) {
      const k = s.post_id + ":" + s.platform;
      if (!snaps.has(k)) snaps.set(k, []);
      snaps.get(k).push(s);
    }
    for (const s of db.prepare(`SELECT * FROM post_insights_state WHERE post_id IN (${marks})`).all(...ids)) states.set(s.post_id + ":" + s.platform, s);
  }

  // Reels normales creados a partir de un reel de prueba
  const promotedTo = new Map();
  for (const r of db.prepare("SELECT id, options, status, scheduled_at, results FROM posts").all().map(row)) {
    const from = r.options?.promotedFrom;
    if (!from) continue;
    if (!promotedTo.has(from)) promotedTo.set(from, []);
    promotedTo.get(from).push({ id: r.id, status: r.status, scheduled_at: r.scheduled_at, url: r.results?.instagram?.url ?? null });
  }

  const items = posts.map((post) => {
    const plats = (post.platforms ?? []).map((p) => {
      const res = post.results?.[p];
      const k = post.id + ":" + p;
      const hist = snaps.get(k) ?? [];
      const st = states.get(k);
      const last = hist.at(-1) ?? null;
      const latest = last ? Object.fromEntries(METRICS.map((m) => [m, last[m]])) : null;
      let status = res?.status !== "ok" ? "not_published" : st?.status ?? "pending";
      if (status === "error" && latest) status = "stale"; // hay datos, pero la última consulta falló
      return {
        platform: p, status, url: res?.url ?? null, mediaId: mediaIdOf(p, res),
        publishedAt: res?.at ?? null, latest,
        history: hist.slice(-HISTORY_POINTS).map((s) => ({ at: s.fetched_at, views: s.views, likes: s.likes, reach: s.reach })),
        checkedAt: st?.last_try_at ?? null, okAt: st?.last_ok_at ?? null,
        error: res?.status !== "ok" ? res?.error ?? null : st?.error ?? null,
      };
    });
    const latestList = plats.map((x) => x.latest).filter(Boolean);
    const totals = Object.fromEntries(["views", "reach", "likes", "comments", "shares", "saves"].map((k) => [k, sumOf(latestList, k)]));
    const published = plats.map((x) => x.publishedAt).filter(Boolean).sort()[0] ?? post.scheduled_at;
    const trial = post.results?.instagram?.status === "ok" ? (post.results.instagram.trial ?? trialGraduation(post)) : null;
    return {
      id: post.id, title: post.title, caption: post.caption, export_id: post.export_id, status: post.status,
      publishedAt: published, video: videoOf(post.export_id), trial: trial || null,
      promotedFrom: post.options?.promotedFrom ?? null, promotedTo: promotedTo.get(post.id) ?? [],
      platforms: plats, totals, winner: false, trialViews: trial ? plats.find((x) => x.platform === "instagram")?.latest?.views ?? null : null,
    };
  });

  // «Ha funcionado»: reels de prueba muy por encima de tus otros reels de prueba
  const trials = items.filter((i) => i.trial);
  for (const t of trials) t.winner = isTrialWinner(t.trialViews, trials.filter((o) => o !== t).map((o) => o.trialViews));

  items.sort((a, b) =>
    (Number(b.winner) - Number(a.winner)) ||
    ((b.totals.views ?? -1) - (a.totals.views ?? -1)) ||
    ((b.totals.likes ?? -1) - (a.totals.likes ?? -1)) ||
    String(b.publishedAt).localeCompare(String(a.publishedAt)));

  return { items, running, lastRunAt, rule: TRIAL_WINNER_RULE, platformErrors: { ...platformErrors } };
}

/* ---------- Rutas y arranque ---------- */

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  if (!e.status || e.status >= 500) console.error("[insights]", scrub(e?.message || e));
  res.status(e.status || 500).json({ error: scrub(e.message || String(e)) });
});

export function registerInsightsRoutes(app) {
  app.get("/api/insights", wrap((req, res) => {
    res.json(listInsights());
  }));

  // «Actualizar ahora» de la página: todo lo de los últimos 30 días, en segundo plano
  app.post("/api/insights/refresh", wrap((req, res) => {
    const started = !running;
    if (started) pollInsights({ force: true }).catch(() => {});
    res.json({ started, running: true });
  }));

  // Una sola publicación, esperando al resultado
  app.post("/api/insights/:id/refresh", wrap(async (req, res) => {
    const post = await refreshPost(req.params.id);
    if (!post) throw Object.assign(new Error("No encontrado"), { status: 404 });
    res.json({ ok: true, item: listInsights().items.find((i) => i.id === post.id) ?? null });
  }));
}

let started = false;
export function startInsightsPoller() {
  if (started) return;
  started = true;
  const tick = () => { pollInsights().catch((e) => console.error("[insights]", scrub(e?.message || e))); };
  setTimeout(tick, 90_000).unref?.();
  setInterval(tick, HOUR).unref?.();
}
