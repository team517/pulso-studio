// Cómo funciona este proceso:
//  - "local"  (por defecto): todo en este ordenador (web + edición), como hasta ahora.
//  - "server": en EasyPanel. Guarda vídeos, programa y publica; NO edita. Pide entrar con una cuenta de admin.
//  - "worker": en tu PC. Recoge del servidor los vídeos por editar, los edita con la tarjeta gráfica y Claude, y los devuelve.
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const MODE = ["server", "worker"].includes(process.env.STUDIO_MODE) ? process.env.STUDIO_MODE : "local";
export const IS_SERVER = MODE === "server";
export const IS_WORKER = MODE === "worker";
/** Ruta bajo la que se sirve todo en modo servidor ("" = la raíz del dominio; "/studio" si va dentro de otra web). */
export const BASE = IS_SERVER ? String(process.env.STUDIO_BASE || "").replace(/\/+$/, "") : "";

export const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
export const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
export const WORKER_TOKEN = process.env.STUDIO_WORKER_TOKEN || "";

/** Clave para firmar sesiones: STUDIO_SECRET o, si no está, una generada y guardada en data/ (sobrevive a los reinicios). */
function loadSecret() {
  if (process.env.STUDIO_SECRET) return process.env.STUDIO_SECRET;
  if (!IS_SERVER) return "";
  const dir = process.env.STUDIO_DATA || join(process.cwd(), "data");
  const f = join(dir, "secret.key");
  try {
    if (existsSync(f)) return readFileSync(f, "utf8").trim();
    mkdirSync(dir, { recursive: true });
    const s = randomBytes(32).toString("base64url");
    writeFileSync(f, s);
    return s;
  } catch { return randomBytes(32).toString("base64url"); }
}
export const SECRET = loadSecret();

if (IS_SERVER) {
  if (!SUPABASE_URL || !SUPABASE_KEY) console.warn("[config] Faltan SUPABASE_URL / SUPABASE_KEY: nadie podrá entrar.");
  if (!WORKER_TOKEN) console.warn("[config] Falta STUDIO_WORKER_TOKEN: tu PC no podrá recoger vídeos para editar.");
}

export const sign = (text) => createHmac("sha256", SECRET).update(text).digest("base64url");
export function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Enlace firmado a un archivo (para que Meta pueda descargar el vídeo sin iniciar sesión). Caduca en `hours`. */
export function signedPath(path, hours = 48) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  return `${path}?exp=${exp}&sig=${sign(`${path}|${exp}`)}`;
}
export function checkSignedPath(path, exp, sig) {
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, sign(`${path}|${exp}`));
}
