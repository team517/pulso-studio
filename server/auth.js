// Acceso en modo servidor: una sola cuenta, la del dueño (STUDIO_OWNER, por defecto team@onepulso.online).
// La contraseña la crea el propio dueño la primera vez que abre la web (nunca está en el código ni en EasyPanel):
// se guarda cifrada (scrypt) en la base de datos. Con «Mantener la sesión» dura 180 días y se renueva sola
// cada vez que entras, así que no caduca mientras la uses.
// La sesión se firma con una clave que sale de tu cuenta (no de un archivo del servidor): si el panel se vacía al
// implementar y tu PC le devuelve la cuenta, la sesión que tenías abierta vuelve a valer sola.
import { scryptSync, randomBytes, createHash, createHmac } from "node:crypto";
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
  const o = owner();
  if (!payload || !sig || !o) return null;
  // Firma con la clave de tu cuenta (la nueva) o con la del servidor (sesiones de antes de este cambio)
  const legacy = !safeEqual(sig, signFor(o, payload));
  if (legacy && !safeEqual(sig, sign(payload))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    // Al cambiar la contraseña se cierran todas las sesiones anteriores
    return s.exp > Date.now() / 1000 && s.email === o.email && s.ver === o.ver ? { ...s, legacy } : null;
  } catch { return null; }
}

/** Clave de las sesiones: sale de tu cuenta (sal + contraseña cifrada + versión), igual en cualquier servidor que la tenga. */
const accountKey = (o) => createHash("sha256").update(`pulso-sesion|${o.email}|${o.salt}|${o.hash}|${o.ver}`).digest();
const signFor = (o, payload) => createHmac("sha256", accountKey(o)).update(payload).digest("base64url");

function setSession(res, o, remember) {
  const secs = remember ? LONG_DAYS * 86400 : 12 * 3600;
  const payload = Buffer.from(JSON.stringify({ email: o.email, ver: o.ver, exp: Math.floor(Date.now() / 1000) + secs, keep: !!remember })).toString("base64url");
  // Sin «mantener», cookie de sesión (se borra al cerrar el navegador)
  res.setHeader("Set-Cookie", `${COOKIE}=${payload}.${signFor(o, payload)}; Path=${BASE || "/"}${remember ? `; Max-Age=${secs}` : ""}; HttpOnly; Secure; SameSite=Lax`);
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

  // Cambiar la contraseña desde tu PC («Cambiar contraseña.cmd»): lo pide el editor con su clave de PC.
  // Cierra las demás sesiones (cambia la versión) y tu PC guarda la cuenta nueva en su copia.
  app.post("/api/worker/owner/password", (req, res) => {
    if (!isWorker(req)) return res.status(401).json({ error: "Token del PC incorrecto." });
    const password = String(req.body?.password || "");
    if (password.length < 8) return res.status(400).json({ error: "La contraseña tiene que tener al menos 8 caracteres." });
    const cur = owner();
    const salt = randomBytes(16).toString("base64url");
    const o = { email: OWNER, salt, hash: hashOf(password, salt), ver: (Number(cur?.ver) || 0) + 1, at: new Date().toISOString() };
    setSetting("auth:owner", o);
    console.log(`[auth] Contraseña cambiada desde tu PC para ${OWNER}`);
    res.json({ ok: true, email: OWNER });
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
    const ses = sessionOf(req);
    if (ses) {
      // «Mantener la sesión»: se renueva sola (como mucho una vez al día) y nunca caduca mientras la uses
      const keep = ses.keep !== false && ses.exp - Date.now() / 1000 > 13 * 3600;
      if (keep && (ses.legacy || ses.exp - Date.now() / 1000 < (LONG_DAYS - 1) * 86400)) setSession(res, owner(), true);
      return next();
    }
    if (isWorker(req)) return next();
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
