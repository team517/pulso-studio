// El «cerebro» de la auto-edición: Claude Code en modo no interactivo (`claude -p`), con la sesión del usuario.
// Si no hay sesión iniciada, quien llama usa las reglas fijas (plan.js) y se avisa en la interfaz.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export class NeedLogin extends Error {
  constructor() { super("Claude no tiene la sesión iniciada en este ordenador. Abre una terminal, escribe «claude» y luego /login."); }
}

/**
 * Qué `claude` usar: STUDIO_CLAUDE_BIN si está; si no, la versión más nueva que trae la app de escritorio
 * (la de npm puede ser antigua y no leer la sesión); si no, la del PATH.
 */
function claudeBin() {
  if (process.env.STUDIO_CLAUDE_BIN && existsSync(process.env.STUDIO_CLAUDE_BIN)) return process.env.STUDIO_CLAUDE_BIN;
  const base = join(process.env.LOCALAPPDATA || "", "Claude-Data");
  const found = [];
  try {
    for (const a of readdirSync(base)) {
      const cc = join(base, a, "claude-code");
      if (!existsSync(cc)) continue;
      for (const ver of readdirSync(cc)) for (const h of readdirSync(join(cc, ver))) {
        const exe = join(cc, ver, h, "claude.exe");
        if (existsSync(exe)) found.push({ exe, ver: ver.split(".").map(Number) });
      }
    }
  } catch { /* sin app de escritorio */ }
  found.sort((x, y) => { for (let i = 0; i < 3; i++) if ((x.ver[i] || 0) !== (y.ver[i] || 0)) return (y.ver[i] || 0) - (x.ver[i] || 0); return 0; });
  return found[0]?.exe || "claude";
}

/** Entorno limpio: sin las variables internas de la app de escritorio (harían que Claude busque otra sesión). */
function cleanEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|CLAUDECODE|ANTHROPIC_)/i.test(k)) env[k] = v;
  return env;
}

function runClaude(args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const bin = claudeBin();
    const p = spawn(bin === "claude" ? "claude" : `"${bin}"`, args, { windowsHide: true, shell: true, env: cleanEnv() });
    const out = [], err = [];
    const timer = setTimeout(() => { p.kill(); reject(new Error("Claude tardó demasiado en responder.")); }, timeoutMs);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") });
    });
    p.stdin.end(input, "utf8");
  });
}

/** Saca el primer objeto JSON de un texto (Claude a veces lo envuelve en ```json). */
export function extractJson(text) {
  const t = String(text).replace(/```(?:json)?/g, "");
  const start = t.indexOf("{");
  if (start < 0) throw new Error("La respuesta no trae JSON.");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("JSON incompleto en la respuesta.");
}

let loginCache = { ok: null, at: 0 };

/** ¿Tiene Claude la sesión iniciada? (se guarda 5 min) */
export async function claudeReady() {
  if (loginCache.ok !== null && Date.now() - loginCache.at < 5 * 60e3) return loginCache.ok;
  try {
    const r = await runClaude(["-p", "--output-format", "json", "--max-turns", "1"], "Responde solo: ok", 60_000);
    const j = JSON.parse(r.stdout);
    loginCache = { ok: !(j.is_error && /log/i.test(j.result || "")), at: Date.now() };
  } catch {
    loginCache = { ok: false, at: Date.now() };
  }
  return loginCache.ok;
}

/**
 * Pide algo a Claude y devuelve el JSON que conteste.
 * images: rutas de imágenes que Claude puede mirar (se le permite solo leer esa carpeta).
 */
export async function askClaude(prompt, { images = [], dir = null, timeoutMs = 8 * 60e3 } = {}) {
  const args = ["-p", "--output-format", "json"];
  if (images.length && dir) args.push("--allowedTools", "Read", "--add-dir", `"${dir}"`, "--max-turns", "15");
  else args.push("--max-turns", "1");
  const full = images.length
    ? `${prompt}\n\nMira estas imágenes con la herramienta Read antes de contestar:\n${images.map((i) => "- " + i).join("\n")}`
    : prompt;
  const r = await runClaude(args, full, timeoutMs);
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new Error("Claude no respondió bien: " + (r.stderr || r.stdout).slice(0, 300)); }
  if (j.is_error) {
    if (/log/i.test(j.result || "")) { loginCache = { ok: false, at: Date.now() }; throw new NeedLogin(); }
    throw new Error("Claude: " + String(j.result || j.subtype).slice(0, 300));
  }
  loginCache = { ok: true, at: Date.now() };
  return extractJson(j.result);
}
