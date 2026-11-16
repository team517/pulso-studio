// Cómo funciona este proceso:
//  - "local"  (por defecto): todo en este ordenador (web + edición), como hasta ahora.
//  - "server": en EasyPanel, dentro del panel de ChipsFinder. Guarda vídeos, programa y publica; NO edita.
//  - "worker": en tu PC. Recoge del servidor los vídeos por editar, los edita con la tarjeta gráfica y Claude, y los devuelve.
import { createHmac, timingSafeEqual } from "node:crypto";

export const MODE = ["server", "worker"].includes(process.env.STUDIO_MODE) ? process.env.STUDIO_MODE : "local";
export const IS_SERVER = MODE === "server";
export const IS_WORKER = MODE === "worker";
/** Ruta bajo la que se sirve todo en modo servidor (p. ej. "/studio"). */
export const BASE = IS_SERVER ? String(process.env.STUDIO_BASE || "/studio").replace(/\/+$/, "") : "";

export const SECRET = process.env.STUDIO_SECRET || "";
export const WORKER_TOKEN = process.env.STUDIO_WORKER_TOKEN || "";
export const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
export const SUPABASE_KEY = process.env.SUPABASE_KEY || "";

if (IS_SERVER) {
  const missing = ["STUDIO_SECRET", "STUDIO_WORKER_TOKEN", "SUPABASE_URL", "SUPABASE_KEY"].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[config] Faltan variables de entorno para el modo servidor: ${missing.join(", ")}`);
    process.exit(1);
  }
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
