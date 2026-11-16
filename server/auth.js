// Acceso en modo servidor: solo los administradores del panel de ChipsFinder.
// La web de Pulso Studio va dentro del panel (mismo dominio) y le pasa al servidor el token de la sesión del panel;
// el servidor lo comprueba con Supabase y, si es admin, le da una cookie propia para 12 horas.
import { IS_SERVER, BASE, SUPABASE_URL, SUPABASE_KEY, WORKER_TOKEN, sign, safeEqual, checkSignedPath } from "./config.js";

const COOKIE = "ps_s";
const HOURS = 12;

function readCookie(req) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === COOKIE) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

export function sessionOf(req) {
  const v = readCookie(req);
  const [payload, sig] = v.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return s.exp > Date.now() / 1000 ? s : null;
  } catch { return null; }
}

function setSession(res, user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + HOURS * 3600 })).toString("base64url");
  res.setHeader("Set-Cookie", `${COOKIE}=${payload}.${sign(payload)}; Path=${BASE || "/"}; Max-Age=${HOURS * 3600}; HttpOnly; Secure; SameSite=Lax`);
}

export const isWorker = (req) => !!WORKER_TOKEN && safeEqual(req.headers["x-worker-token"] || "", WORKER_TOKEN);

/** Rutas que no piden sesión: la propia entrada, el PC que edita (lleva su token) y la vuelta de las redes. */
const OPEN = [/^\/api\/session$/, /^\/api\/worker\//, /^\/api\/auth\/[a-z]+\/callback$/];

export function registerAuth(app) {
  if (!IS_SERVER) return;

  app.post("/api/session", async (req, res) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Entra desde el panel de ChipsFinder." });
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}` } });
      if (!r.ok) return res.status(401).json({ error: "La sesión del panel ha caducado. Vuelve a entrar." });
      const user = await r.json();
      const role = String(user?.app_metadata?.role || "").toUpperCase();
      if (role !== "ADMIN") return res.status(403).json({ error: "Pulso Studio es solo para administradores." });
      setSession(res, user);
      res.json({ ok: true, email: user.email });
    } catch (e) {
      res.status(502).json({ error: "No se pudo comprobar la sesión: " + e.message });
    }
  });

  app.use((req, res, next) => {
    const p = req.path;
    if (!/^\/(api|files)\//.test(p)) return next(); // la web en sí (HTML, JS, CSS) se carga sin sesión
    if (OPEN.some((rx) => rx.test(p))) return next();
    if (sessionOf(req) || isWorker(req)) return next();
    // Enlace firmado (Meta descargando un vídeo para publicarlo)
    if (req.method === "GET" && p.startsWith("/files/") && checkSignedPath(BASE + p, req.query.exp, req.query.sig)) return next();
    res.status(401).json({ error: "Sin sesión", code: "no_session" });
  });

  app.get("/api/me", (req, res) => res.json({ ok: true, email: sessionOf(req)?.email ?? null }));

  // En las respuestas, las rutas de archivos llevan delante la ruta base (/studio/files/…)
  if (BASE) {
    const fix = (v) => {
      if (typeof v === "string") return v.startsWith("/files/") ? BASE + v : v;
      if (Array.isArray(v)) return v.map(fix);
      if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) o[k] = fix(v[k]); return o; }
      return v;
    };
    app.use((req, res, next) => {
      const json = res.json.bind(res);
      res.json = (body) => json(req.path.startsWith("/api/worker/") ? body : fix(body));
      next();
    });
  }
}
