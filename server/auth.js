// Acceso en modo servidor: una sola cuenta, la del dueño (STUDIO_OWNER, por defecto team@onepulso.online).
// La contraseña la crea el propio dueño la primera vez que abre la web (nunca está en el código ni en EasyPanel):
// se guarda cifrada (scrypt) en la base de datos. La sesión dura 180 días si marcas «Mantener la sesión».
import { scryptSync, randomBytes } from "node:crypto";
import { IS_SERVER, BASE, WORKER_TOKEN, sign, safeEqual, checkSignedPath, restoreSecret } from "./config.js";
import { getSetting, setSetting, PERSISTENT } from "./db.js";

const COOKIE = "ps_s";
export const OWNER = String(process.env.STUDIO_OWNER || "team@onepulso.online").trim().toLowerCase();
const LONG_DAYS = 180;

function readCookie(req) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === COOKIE) return decodeURIComponent(part.slice(i + 1));
  }
  return "";
}

const owner = () => getSetting("auth:owner", null);

export function sessionOf(req) {
  const v = readCookie(req);
  const [payload, sig] = v.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const o = owner();
    // Al cambiar la contraseña se cierran todas las sesiones anteriores
    return s.exp > Date.now() / 1000 && o && s.email === o.email && s.ver === o.ver ? s : null;
  } catch { return null; }
}

function setSession(res, o, remember) {
  const secs = remember ? LONG_DAYS * 86400 : 12 * 3600;
  const payload = Buffer.from(JSON.stringify({ email: o.email, ver: o.ver, exp: Math.floor(Date.now() / 1000) + secs })).toString("base64url");
  // Sin «mantener», cookie de sesión (se borra al cerrar el navegador)
  res.setHeader("Set-Cookie", `${COOKIE}=${payload}.${sign(payload)}; Path=${BASE || "/"}${remember ? `; Max-Age=${secs}` : ""}; HttpOnly; Secure; SameSite=Lax`);
}

const hashOf = (password, salt) => scryptSync(password, salt, 64).toString("base64url");

/** El PC se identifica con STUDIO_WORKER_TOKEN (EasyPanel) o con la clave que se crea al conectarlo con tu cuenta. */
export const isWorker = (req) => {
  const got = String(req.headers["x-worker-token"] || "");
  if (!got) return false;
  const paired = getSetting("worker:token", "");
  return (!!WORKER_TOKEN && safeEqual(got, WORKER_TOKEN)) || (!!paired && safeEqual(got, paired));
};

/** Rutas que no piden sesión: la propia entrada, el PC que edita (lleva su token) y la vuelta de las redes. */
const OPEN = [/^\/api\/(auth-state|setup|login|logout)$/, /^\/api\/worker\//, /^\/api\/auth\/[a-z]+\/callback$/];

export function registerAuth(app) {
  if (!IS_SERVER) return;

  // ¿Puede tu PC devolver la cuenta? «none» = tu PC ha dicho que no tiene copia de ella (hay que crearla)
  let noBackupAt = 0;
  app.get("/api/auth-state", (req, res) => res.json({
    email: OWNER, needsSetup: !owner(), loggedIn: !!sessionOf(req), persistent: PERSISTENT,
    recover: !owner() && Date.now() - noBackupAt < 30 * 60e3 ? "none" : null,
  }));

  // Servidor recién borrado: tu PC le devuelve tu cuenta (la misma contraseña), su clave y la de las sesiones,
  // para que solo tengas que entrar (o ni eso: la sesión abierta vuelve a valer). Solo mientras no haya cuenta,
  // igual que la pantalla de «primera vez».
  app.post("/api/worker/claim", (req, res) => {
    if (owner()) return res.status(409).json({ error: "El servidor ya tiene cuenta." });
    if (req.body?.none) { noBackupAt = Date.now(); return res.json({ ok: true, noted: true }); }
    const o = req.body?.owner, token = String(req.body?.token || "");
    if (!o || o.email !== OWNER || typeof o.salt !== "string" || typeof o.hash !== "string" || token.length < 20) return res.status(400).json({ error: "Copia incompleta." });
    setSetting("auth:owner", { email: o.email, salt: o.salt, hash: o.hash, ver: Number(o.ver) || 1, at: o.at || new Date().toISOString() });
    setSetting("worker:token", token);
    restoreSecret(req.body?.secret);
    console.log("[auth] Cuenta recuperada desde tu PC");
    res.json({ ok: true });
  });

  // Primera vez: el dueño crea su contraseña (solo se puede mientras no exista ninguna)
  app.post("/api/setup", (req, res) => {
    if (owner()) return res.status(409).json({ error: "La cuenta ya tiene contraseña. Entra con ella." });
    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(400).json({ error: "La contraseña tiene que tener al menos 8 caracteres." });
    const salt = randomBytes(16).toString("base64url");
    const o = { email: OWNER, salt, hash: hashOf(password, salt), ver: 1, at: new Date().toISOString() };
    setSetting("auth:owner", o);
    console.log(`[auth] Contraseña creada para ${OWNER}`);
    setSession(res, o, req.body?.remember !== false);
    res.json({ ok: true, email: OWNER });
  });

  const tries = new Map();
  app.post("/api/login", (req, res) => {
    const ip = String(req.ip || "");
    const t = tries.get(ip) || { n: 0, at: Date.now() };
    if (Date.now() - t.at > 15 * 60e3) { t.n = 0; t.at = Date.now(); }
    if (t.n >= 10) return res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
    const o = owner();
    if (!o) return res.status(409).json({ error: "Primero crea la contraseña.", code: "needs_setup" });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (email !== o.email || !safeEqual(hashOf(password, o.salt), o.hash)) {
      t.n++; tries.set(ip, t);
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }
    tries.delete(ip);
    setSession(res, o, req.body?.remember !== false);
    res.json({ ok: true, email: o.email });
  });

  app.post("/api/logout", (req, res) => {
    res.setHeader("Set-Cookie", `${COOKIE}=; Path=${BASE || "/"}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    res.json({ ok: true });
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
