// El Python que transcribe (Whisper) y recorta (torch). En este PC torch está en la carpeta de usuario
// (AppData\Roaming\Python\…); si el editor arranca con otro entorno no lo encuentra. Aquí se busca un Python
// que pueda importar torch y whisper y se le pasa, si hace falta, la ruta de esos paquetes.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let cached = null;
const TEST = "import sys, torch, whisper; print(sys.executable)";

function tryPy(cmd, extraPath) {
  const env = { ...process.env, ...(extraPath ? { PYTHONPATH: [extraPath, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":") } : {}) };
  const r = spawnSync(cmd, ["-c", TEST], { encoding: "utf8", windowsHide: true, env, timeout: 60e3 });
  return r.status === 0 ? { cmd, extraPath, exe: String(r.stdout).trim().split(/\r?\n/).pop() } : null;
}

/** Carpetas de paquetes de usuario posibles (Windows y Linux/Mac). */
function userSites() {
  const out = [];
  const roots = [process.env.APPDATA, join(homedir(), "AppData", "Roaming")].filter(Boolean);
  for (const r of roots) {
    const base = join(r, "Python");
    try { for (const v of readdirSync(base)) { const p = join(base, v, "site-packages"); if (existsSync(p)) out.push(p); } } catch { /* nada */ }
  }
  try { for (const v of readdirSync(join(homedir(), ".local", "lib"))) { const p = join(homedir(), ".local", "lib", v, "site-packages"); if (existsSync(p)) out.push(p); } } catch { /* nada */ }
  return [...new Set(out)];
}

/** { cmd, env } para lanzar Python con torch y whisper. */
export function python() {
  if (cached) return cached;
  const cmds = [process.env.STUDIO_PYTHON, "python", "py", "python3", "C:\\Python314\\python.exe", "C:\\Python313\\python.exe", "C:\\Python312\\python.exe", "C:\\Python311\\python.exe"].filter(Boolean);
  let found = null;
  for (const c of cmds) { found = tryPy(c); if (found) break; }
  if (!found) for (const site of userSites()) { for (const c of cmds) { found = tryPy(c, site); if (found) break; } if (found) break; }
  if (!found) { console.warn("[python] No encuentro un Python con torch y whisper: uso «python»."); found = { cmd: process.env.STUDIO_PYTHON || "python", extraPath: null, exe: "python" }; }
  else console.log(`[python] ${found.exe}${found.extraPath ? ` (+ ${found.extraPath})` : ""}`);
  const env = { ...process.env, PYTHONIOENCODING: "utf-8", ...(found.extraPath ? { PYTHONPATH: [found.extraPath, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":") } : {}) };
  cached = { cmd: found.exe && existsSync(found.exe) ? found.exe : found.cmd, env };
  return cached;
}
