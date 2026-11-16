// Conexión y publicación en YouTube, TikTok e Instagram.
// Las credenciales y tokens se guardan solo en la base de datos local (data/studio.db).
import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { getSetting, setSetting } from "./db.js";

export const PORT = Number(process.env.STUDIO_PORT || 4321);
const LOCAL = `http://localhost:${PORT}`;
const IG = "https://graph.instagram.com/v21.0";

export const PLATFORMS = ["youtube", "tiktok", "instagram"];
const key = (p) => "platform:" + p;
export const getConf = (p) => getSetting(key(p), {});
const saveConf = (p, c) => setSetting(key(p), c);

/** Dirección pública para las vueltas de OAuth (TikTok exige https: se puede poner un túnel). */
export const publicUrl = () => (getSetting("public_url", "") || LOCAL).replace(/\/$/, "");
export const redirectUri = (p) => `${p === "youtube" ? LOCAL : publicUrl()}/api/auth/${p}/callback`;

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
      clientId: c.clientId ?? null,
      privacy: c.privacy ?? (p === "tiktok" ? "SELF_ONLY" : "public"),
      redirectUri: p === "instagram" ? null : redirectUri(p),
      error: c.lastError ?? null,
    };
  });
}

export async function configure(p, body) {
  const c = getConf(p);
  if (p === "instagram") {
    if (body.accessToken !== undefined) {
      const token = String(body.accessToken).trim();
      if (!token) { saveConf(p, {}); return; }
      const me = await asJson(await fetch(`${IG}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`), "Instagram");
      saveConf(p, { ...c, accessToken: token, refreshedAt: Date.now(), account: { id: me.user_id || me.id, name: "@" + me.username }, lastError: null });
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
    c.tokens = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in - 60) * 1000, open_id: t.open_id };
    saveConf(p, c);
    const u = await asJson(await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name", { headers: { authorization: "Bearer " + t.access_token } }), "TikTok");
    c.account = { id: t.open_id, name: u.data?.user?.display_name ?? "Cuenta de TikTok" };
  }
  c.lastError = null;
  saveConf(p, c);
}

async function accessToken(p) {
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
    if (st === "PUBLISH_COMPLETE") return { id: publish_id, url: s.data?.publicaly_available_post_id?.[0] ? `https://www.tiktok.com/video/${s.data.publicaly_available_post_id[0]}` : null };
    if (st === "SEND_TO_USER_INBOX") return { id: publish_id, url: null, note: "Enviado a tu bandeja de TikTok para terminar de publicarlo." };
    if (st === "FAILED") throw new Error("TikTok rechazó el vídeo: " + (s.data?.fail_reason || "sin motivo"));
  }
  return { id: publish_id, url: null, note: "TikTok sigue procesando el vídeo." };
}

async function instagramToken() {
  const c = getConf("instagram");
  if (!c.accessToken || !c.account) throw new Error("Instagram no está conectado.");
  // Los tokens de larga duración caducan a los 60 días: se renuevan cada ~20
  if (!c.refreshedAt || Date.now() - c.refreshedAt > 20 * 86400e3) {
    try {
      const r = await asJson(await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(c.accessToken)}`), "Instagram");
      c.accessToken = r.access_token; c.refreshedAt = Date.now(); saveConf("instagram", c);
    } catch { /* se intenta con el que hay */ }
  }
  return c;
}

async function publishInstagram(post, file) {
  const c = await instagramToken();
  const tk = encodeURIComponent(c.accessToken);
  const size = statSync(file).size;
  const cont = await asJson(await fetch(`${IG}/${c.account.id}/media?access_token=${tk}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ media_type: "REELS", upload_type: "resumable", caption: post.caption || "", share_to_feed: true }),
  }), "Instagram");
  const up = await fetch(`https://rupload.facebook.com/ig-api-upload/v21.0/${cont.id}`, {
    method: "POST", headers: { authorization: "OAuth " + c.accessToken, offset: "0", file_size: String(size) }, body: readFileSync(file),
  });
  await asJson(up, "Instagram (subida)");
  for (let i = 0; i < 90; i++) {
    await sleep(4000);
    const s = await asJson(await fetch(`${IG}/${cont.id}?fields=status_code,status&access_token=${tk}`), "Instagram");
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error("Instagram no pudo procesar el vídeo: " + (s.status || s.status_code));
    if (i === 89) throw new Error("Instagram tarda demasiado en procesar el vídeo.");
  }
  const pub = await asJson(await fetch(`${IG}/${c.account.id}/media_publish?creation_id=${cont.id}&access_token=${tk}`, { method: "POST" }), "Instagram");
  const info = await fetch(`${IG}/${pub.id}?fields=permalink&access_token=${tk}`).then((r) => r.json()).catch(() => ({}));
  return { id: pub.id, url: info.permalink ?? null };
}

export async function publish(p, post, file) {
  if (p === "youtube") return publishYouTube(post, file);
  if (p === "tiktok") return publishTikTok(post, file);
  if (p === "instagram") return publishInstagram(post, file);
  throw new Error("Red desconocida: " + p);
}
