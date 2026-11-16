// Conexión y publicación en YouTube, TikTok e Instagram.
// Las credenciales y tokens se guardan solo en la base de datos local (data/studio.db).
import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { basename } from "node:path";
import { getSetting, setSetting } from "./db.js";
import { IS_SERVER, BASE, signedPath } from "./config.js";

export const PORT = Number(process.env.STUDIO_PORT || 4321);
const LOCAL = `http://localhost:${PORT}`;
// Versión actual de la API de Meta (nov. 2026)
const META_V = "v27.0";
const IG = `https://graph.instagram.com/${META_V}`;
const FB = `https://graph.facebook.com/${META_V}`;

export const PLATFORMS = ["youtube", "tiktok", "instagram"];
const key = (p) => "platform:" + p;
export const getConf = (p) => getSetting(key(p), {});
const saveConf = (p, c) => setSetting(key(p), c);

/** Dirección pública para las vueltas de OAuth (TikTok exige https: se puede poner un túnel). */
// En el servidor, la dirección pública es la del panel (PUBLIC_URL, p. ej. https://…easypanel.host/studio)
export const publicUrl = () => (getSetting("public_url", "") || (IS_SERVER ? process.env.PUBLIC_URL || "" : "") || LOCAL).replace(/\/$/, "");
export const redirectUri = (p) => `${p === "youtube" && !IS_SERVER ? LOCAL : publicUrl()}/api/auth/${p}/callback`;

async function asJson(res, what) {
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!res.ok) throw new Error(`${what}: ${res.status} ${j.error?.message || j.error_description || j.error?.code || j.raw || text}`.slice(0, 600));
  return j;
}

/** Estado de cada red para la pantalla de Conexiones (sin secretos). */
export function status() {
  return PLATFORMS.map((p) => {
    const c = getConf(p);
    return {
      id: p,
      configured: p === "instagram" ? !!c.accessToken : !!(c.clientId && c.clientSecret),
      connected: p === "instagram" ? !!(c.accessToken && c.account) : !!c.tokens?.refresh_token || !!c.tokens?.access_token,
      account: c.account?.name ?? null,
      expiresAt: p === "instagram" ? c.expiresAt ?? null : null,
      mode: p === "instagram" ? c.mode ?? null : null,
      hasApp: p === "instagram" ? !!(c.appId && c.appSecret) : null,
      clientId: (p === "instagram" ? c.appId : c.clientId) ?? null,
      privacy: c.privacy ?? (p === "tiktok" ? "SELF_ONLY" : "public"),
      redirectUri: p === "instagram" ? null : redirectUri(p),
      error: c.lastError ?? null,
    };
  });
}

export async function configure(p, body) {
  const c = getConf(p);
  if (p === "instagram") {
    if (body.appId !== undefined) c.appId = String(body.appId).trim();
    if (body.appSecret) c.appSecret = String(body.appSecret).trim();
    if (body.accessToken !== undefined) {
      const token = String(body.accessToken).trim();
      if (!token) { saveConf(p, { appId: c.appId, appSecret: c.appSecret }); return; }
      saveConf(p, await connectInstagram(c, token, body.pageId));
      return;
    }
  } else {
    if (body.clientId !== undefined) c.clientId = String(body.clientId).trim();
    if (body.clientSecret) c.clientSecret = String(body.clientSecret).trim();
  }
  if (body.privacy) c.privacy = body.privacy;
  saveConf(p, c);
}

export function disconnect(p) {
  const c = getConf(p);
  delete c.tokens; delete c.account; delete c.lastError;
  if (p === "instagram") delete c.accessToken;
  saveConf(p, c);
}

/* ---------- OAuth ---------- */

export function authUrl(p, state) {
  const c = getConf(p);
  if (!c.clientId) throw new Error("Falta el Client ID.");
  if (p === "youtube") {
    const q = new URLSearchParams({
      client_id: c.clientId, redirect_uri: redirectUri(p), response_type: "code", access_type: "offline", prompt: "consent", state,
      scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    });
    return "https://accounts.google.com/o/oauth2/v2/auth?" + q;
  }
  if (p === "tiktok") {
    const q = new URLSearchParams({ client_key: c.clientId, redirect_uri: redirectUri(p), response_type: "code", state, scope: "user.info.basic,video.publish,video.upload" });
    return "https://www.tiktok.com/v2/auth/authorize/?" + q;
  }
  throw new Error("Esta red no usa este inicio de sesión.");
}

export async function handleCallback(p, code) {
  const c = getConf(p);
  if (p === "youtube") {
    const t = await asJson(await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri(p), grant_type: "authorization_code" }),
    }), "Google");
    c.tokens = { access_token: t.access_token, refresh_token: t.refresh_token || c.tokens?.refresh_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 };
    saveConf(p, c);
    const ch = await asJson(await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: "Bearer " + c.tokens.access_token } }), "YouTube");
    c.account = { id: ch.items?.[0]?.id, name: ch.items?.[0]?.snippet?.title ?? "Canal de YouTube" };
  } else if (p === "tiktok") {
    const t = await asJson(await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: c.clientId, client_secret: c.clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri(p) }),
    }), "TikTok");
    c.tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in - 60) * 1000, open_id: t.open_id, scope: t.scope ?? null };
    saveConf(p, c);
    const u = await asJson(await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name", { headers: { authorization: "Bearer " + t.access_token } }), "TikTok");
    c.account = { id: t.open_id, name: u.data?.user?.display_name ?? "Cuenta de TikTok" };
  }
  c.lastError = null;
  saveConf(p, c);
}

export async function accessToken(p) {
  const c = getConf(p);
  if (!c.tokens) throw new Error("La cuenta no está conectada.");
  if (c.tokens.expires_at && Date.now() < c.tokens.expires_at) return c.tokens.access_token;
  if (!c.tokens.refresh_token) throw new Error("La sesión caducó: vuelve a conectar la cuenta.");
  const url = p === "youtube" ? "https://oauth2.googleapis.com/token" : "https://open.tiktokapis.com/v2/oauth/token/";
  const body = p === "youtube"
    ? { client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.tokens.refresh_token, grant_type: "refresh_token" }
    : { client_key: c.clientId, client_secret: c.clientSecret, refresh_token: c.tokens.refresh_token, grant_type: "refresh_token" };
  const t = await asJson(await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }), p);
  c.tokens = { ...c.tokens, access_token: t.access_token, refresh_token: t.refresh_token || c.tokens.refresh_token, expires_at: Date.now() + (t.expires_in - 60) * 1000 };
  saveConf(p, c);
  return c.tokens.access_token;
}

/* ---------- Publicar ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function publishYouTube(post, file) {
  const token = await accessToken("youtube");
  const c = getConf("youtube");
  const size = statSync(file).size;
  let title = (post.title || post.caption || "Short").replace(/\s+/g, " ").trim();
  if (!/#shorts/i.test(title) && title.length < 90) title += " #Shorts";
  const meta = {
    snippet: { title: title.slice(0, 100), description: post.caption || "", categoryId: "22" },
    status: { privacyStatus: post.options?.youtubePrivacy || c.privacy || "public", selfDeclaredMadeForKids: false },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(size), "x-upload-content-type": "video/mp4" },
    body: JSON.stringify(meta),
  });
  if (!init.ok) await asJson(init, "YouTube");
  const loc = init.headers.get("location");
  const up = await fetch(loc, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": String(size) }, body: readFileSync(file) });
  const v = await asJson(up, "YouTube");
  return { id: v.id, url: `https://youtube.com/shorts/${v.id}` };
}

async function publishTikTok(post, file) {
  const token = await accessToken("tiktok");
  const c = getConf("tiktok");
  const auth = { authorization: "Bearer " + token, "content-type": "application/json; charset=UTF-8" };
  const size = statSync(file).size;
  const MB = 1024 * 1024;
  const chunk = size <= 64 * MB ? size : 10 * MB;
  const count = size <= 64 * MB ? 1 : Math.floor(size / chunk);
  const init = await asJson(await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST", headers: auth,
    body: JSON.stringify({
      post_info: { title: (post.caption || post.title || "").slice(0, 2200), privacy_level: post.options?.tiktokPrivacy || c.privacy || "SELF_ONLY", disable_comment: false, disable_duet: false, disable_stitch: false },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count },
    }),
  }), "TikTok");
  const { upload_url, publish_id } = init.data;
  const fd = openSync(file, "r");
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunk;
      const end = i === count - 1 ? size - 1 : start + chunk - 1;
      const buf = Buffer.alloc(end - start + 1);
      readSync(fd, buf, 0, buf.length, start);
      const r = await fetch(upload_url, { method: "PUT", headers: { "content-type": "video/mp4", "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(buf.length) }, body: buf });
      if (!r.ok && r.status !== 206) throw new Error("TikTok: error subiendo el vídeo (" + r.status + ")");
    }
  } finally { closeSync(fd); }
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const s = await asJson(await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", { method: "POST", headers: auth, body: JSON.stringify({ publish_id }) }), "TikTok");
    const st = s.data?.status;
    const videoId = s.data?.publicaly_available_post_id?.[0] ? String(s.data.publicaly_available_post_id[0]) : null;
    if (st === "PUBLISH_COMPLETE") return { id: publish_id, videoId, url: videoId ? `https://www.tiktok.com/video/${videoId}` : null };
    if (st === "SEND_TO_USER_INBOX") return { id: publish_id, url: null, note: "Enviado a tu bandeja de TikTok para terminar de publicarlo." };
    if (st === "FAILED") throw new Error("TikTok rechazó el vídeo: " + (s.data?.fail_reason || "sin motivo"));
  }
  return { id: publish_id, url: null, note: "TikTok sigue procesando el vídeo." };
}

/* ---------- Instagram ----------
 * Dos formas de conectar:
 *  · "facebook" (recomendada): Instagram profesional vinculado a una página de Facebook. Permite subir
 *    el vídeo directamente desde el ordenador (subida "resumable"), sin túneles.
 *  · "instagram": token de «Inicio de sesión con Instagram» (empieza por IG). Meta solo acepta un enlace
 *    público al vídeo, así que necesita la «Dirección pública» (un túnel abierto a la hora de publicar).
 */

const tq = (t) => "access_token=" + encodeURIComponent(t);

async function connectInstagram(c, token, pageId) {
  const base = { appId: c.appId, appSecret: c.appSecret, lastError: null };
  if (/^IG/.test(token)) {
    const me = await asJson(await fetch(`${IG}/me?fields=user_id,username&${tq(token)}`), "Instagram");
    return { ...base, mode: "instagram", accessToken: token, refreshedAt: Date.now(), expiresAt: Date.now() + 60 * 86400e3, account: { id: me.user_id || me.id, name: "@" + me.username } };
  }
  // Token de Facebook: si hay app, se cambia por uno de larga duración (así el de la página no caduca)
  let user = token;
  if (c.appId && c.appSecret) {
    try {
      const ex = await asJson(await fetch(`${FB}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(c.appId)}&client_secret=${encodeURIComponent(c.appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`), "Facebook");
      user = ex.access_token;
    } catch (e) {
      throw new Error("No se pudo alargar el token con el App ID y la clave secreta: " + e.message);
    }
  }
  // Páginas del usuario con su cuenta de Instagram vinculada
  let pages = [];
  const r = await fetch(`${FB}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100&${tq(user)}`);
  if (r.ok) pages = (await r.json()).data ?? [];
  else {
    // Puede que ya sea un token de página
    const me = await asJson(await fetch(`${FB}/me?fields=id,name,instagram_business_account{id,username}&${tq(user)}`), "Facebook");
    if (me.instagram_business_account) pages = [{ ...me, access_token: user }];
  }
  const withIg = pages.filter((p) => p.instagram_business_account);
  if (!withIg.length) {
    throw new Error(pages.length
      ? "Ninguna de tus páginas de Facebook tiene una cuenta de Instagram profesional vinculada."
      : "El token no da acceso a ninguna página. Al generarlo, marca los permisos pages_show_list, pages_read_engagement, instagram_basic e instagram_content_publish y elige tu página.");
  }
  const page = withIg.find((p) => p.id === pageId) ?? withIg[0];
  const ig = page.instagram_business_account;
  // ¿Cuándo caduca el token de la página? (0 = nunca)
  let expiresAt = null;
  try {
    const dbg = await (await fetch(`${FB}/debug_token?input_token=${encodeURIComponent(page.access_token)}&${tq(page.access_token)}`)).json();
    const exp = dbg.data?.expires_at;
    expiresAt = exp ? exp * 1000 : 0;
  } catch { /* desconocido */ }
  return {
    ...base, mode: "facebook", accessToken: page.access_token, expiresAt,
    account: { id: ig.id, name: "@" + (ig.username ?? "instagram") + " · " + page.name, pageId: page.id },
    pages: withIg.map((p) => ({ id: p.id, name: p.name, ig: "@" + p.instagram_business_account.username })),
  };
}

async function instagramConf() {
  const c = getConf("instagram");
  if (!c.accessToken || !c.account) throw new Error("Instagram no está conectado.");
  if (c.expiresAt && Date.now() > c.expiresAt) throw new Error("El token de Instagram ha caducado: pega uno nuevo en Conexiones.");
  // Los tokens de «Inicio de sesión con Instagram» duran 60 días: se renuevan cada ~20
  if (c.mode === "instagram" && (!c.refreshedAt || Date.now() - c.refreshedAt > 20 * 86400e3)) {
    try {
      const r = await asJson(await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&${tq(c.accessToken)}`), "Instagram");
      c.accessToken = r.access_token; c.refreshedAt = Date.now(); c.expiresAt = Date.now() + (r.expires_in || 60 * 86400) * 1000;
      saveConf("instagram", c);
    } catch { /* se intenta con el que hay */ }
  }
  return c;
}

/** Servidor y token de Instagram para leer estadísticas (sin exponer el token fuera del servidor). */
export async function instagramAuth() {
  const c = await instagramConf();
  return { host: c.mode === "instagram" ? IG : FB, token: c.accessToken, mode: c.mode };
}

/** Reel de prueba: solo lo ven quienes no te siguen. MANUAL = lo pasas tú a normal en la app;
 *  SS_PERFORMANCE = Instagram lo comparte con tus seguidores si funciona bien. */
export const TRIAL_GRADUATIONS = ["MANUAL", "SS_PERFORMANCE"];
export const trialGraduation = (post) => {
  const g = post?.options?.trial?.graduation;
  return TRIAL_GRADUATIONS.includes(g) ? g : null;
};

async function publishInstagram(post, file) {
  const c = await instagramConf();
  const host = c.mode === "instagram" ? IG : FB;
  const tk = tq(c.accessToken);
  const trial = trialGraduation(post);
  const body = { media_type: "REELS", caption: post.caption || "" };
  // Un reel de prueba no se comparte en el feed de los seguidores; uno normal, sí
  if (trial) body.trial_params = { graduation_strategy: trial };
  else body.share_to_feed = true;
  if (c.mode === "instagram") {
    const pub = publicUrl();
    if (!/^https:\/\//.test(pub)) throw new Error("Con el token de Instagram, Meta necesita un enlace público al vídeo: pon la «Dirección pública» en Conexiones (o conecta con Facebook).");
    // En el servidor los archivos piden sesión: a Meta se le da un enlace firmado que caduca
    body.video_url = IS_SERVER
      ? `${new URL(pub).origin}${signedPath(`${BASE}/files/exports/${basename(file)}`)}`
      : `${pub}/files/exports/${basename(file)}`;
  } else {
    body.upload_type = "resumable";
  }
  const cont = await asJson(await fetch(`${host}/${c.account.id}/media?${tk}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }), "Instagram");
  if (c.mode !== "instagram") {
    const size = statSync(file).size;
    const up = await fetch(`https://rupload.facebook.com/ig-api-upload/${META_V}/${cont.id}`, {
      method: "POST", headers: { authorization: "OAuth " + c.accessToken, offset: "0", file_size: String(size) }, body: readFileSync(file),
    });
    await asJson(up, "Instagram (subida del vídeo)");
  }
  // Meta procesa el vídeo; se mira cada 10 s durante un máximo de 8 min
  for (let i = 0; ; i++) {
    await sleep(10_000);
    const s = await asJson(await fetch(`${host}/${cont.id}?fields=status_code,status&${tk}`), "Instagram");
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error("Instagram no pudo procesar el vídeo: " + (s.status || s.status_code));
    if (i >= 48) throw new Error("Instagram tarda demasiado en procesar el vídeo.");
  }
  const pub = await asJson(await fetch(`${host}/${c.account.id}/media_publish?creation_id=${cont.id}&${tk}`, { method: "POST" }), "Instagram");
  const info = await fetch(`${host}/${pub.id}?fields=permalink&${tk}`).then((r) => r.json()).catch(() => ({}));
  return { id: pub.id, url: info.permalink ?? null, ...(trial ? { trial } : {}) };
}

/** Comprueba que la conexión de Instagram sigue funcionando (sin publicar nada). */
export async function checkInstagram() {
  const c = await instagramConf();
  const host = c.mode === "instagram" ? IG : FB;
  const fields = c.mode === "instagram" ? "user_id,username" : "id,username,media_count";
  const target = c.mode === "instagram" ? "me" : c.account.id;
  const me = await asJson(await fetch(`${host}/${target}?fields=${fields}&${tq(c.accessToken)}`), "Instagram");
  const lim = c.mode === "instagram" ? null : await fetch(`${FB}/${c.account.id}/content_publishing_limit?fields=quota_usage,config&${tq(c.accessToken)}`).then((r) => r.json()).catch(() => null);
  return { username: me.username, media: me.media_count ?? null, used: lim?.data?.[0]?.quota_usage ?? null, quota: lim?.data?.[0]?.config?.quota_total ?? null };
}

export async function publish(p, post, file) {
  if (p === "youtube") return publishYouTube(post, file);
  if (p === "tiktok") return publishTikTok(post, file);
  if (p === "instagram") return publishInstagram(post, file);
  throw new Error("Red desconocida: " + p);
}
