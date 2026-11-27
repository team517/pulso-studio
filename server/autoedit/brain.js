// El «cerebro» de la auto-edición: Claude Code en modo no interactivo (`claude -p`), con la sesión del usuario.
// Si no hay sesión iniciada, quien llama usa las reglas fijas (plan.js) y se avisa en la interfaz.
import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getSetting } from "../db.js";
import { IS_SERVER } from "../config.js";

export class NeedLogin extends Error {
  constructor() { super("Claude no tiene la sesión iniciada en este ordenador."); }
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
    // En Windows, con shell, matar solo el proceso dejaría claude.exe vivo: se cierra el árbol entero
    const killTree = () => { try { if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true }); else p.kill(); } catch { /* ya terminó */ } };
    const timer = setTimeout(() => { killTree(); reject(new Error("Claude tardó demasiado en responder.")); }, timeoutMs);
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
const isAuthError = (t) => /log ?in|login|authenticate|oauth/i.test(String(t || ""));

/** ¿Tiene Claude la sesión iniciada? (se guarda 5 min) */
async function claudeLoggedIn() {
  if (IS_SERVER) return false; // en EasyPanel no hay Claude: edita el PC
  // Con sesión se vuelve a mirar cada 5 min; sin sesión, cada 30 min (la comprobación tarda)
  if (loginCache.ok !== null && Date.now() - loginCache.at < (loginCache.ok ? 5 : 30) * 60e3) return loginCache.ok;
  try {
    const r = await runClaude(["-p", "--output-format", "json", "--max-turns", "1"], "Responde solo: ok", 25_000);
    const j = JSON.parse(r.stdout);
    loginCache = { ok: !j.is_error, at: Date.now() };
  } catch {
    loginCache = { ok: false, at: Date.now() };
  }
  return loginCache.ok;
}

async function askClaudeCli(prompt, { images = [], dir = null, timeoutMs = 8 * 60e3, maxTurns = 15 } = {}) {
  const args = ["-p", "--output-format", "json"];
  if (images.length && dir) args.push("--allowedTools", "Read", "--add-dir", `"${dir}"`, "--max-turns", String(Math.max(15, maxTurns)));
  // Sin imágenes no necesita herramientas; si aun así intenta usar alguna, se le deniega y contesta en el turno siguiente
  else args.push("--max-turns", "4");
  const full = images.length
    ? prompt + "\n\nMira estas imágenes con la herramienta Read antes de contestar:\n" + images.map((i) => "- " + i).join("\n")
    : prompt + "\n\n(Contesta directamente con el JSON, sin usar herramientas ni leer archivos: todo lo que necesitas está arriba.)";
  const r = await runClaude(args, full, timeoutMs);
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new Error("Claude no respondió bien: " + (r.stderr || r.stdout).slice(0, 300)); }
  if (j.is_error) {
    if (isAuthError(j.result)) { loginCache = { ok: false, at: Date.now() }; throw new NeedLogin(); }
    throw new Error("Claude: " + String(j.result || j.subtype).slice(0, 300));
  }
  loginCache = { ok: true, at: Date.now() };
  return extractJson(j.result);
}

/**
 * Claude con herramientas concretas de tus conectores (p. ej. Composio) permitidas sin preguntar.
 * Solo en tu PC o en local. Devuelve el JSON de la respuesta.
 */
export async function askClaudeTools(prompt, { tools = [], timeoutMs = 6 * 60e3, maxTurns = 10 } = {}) {
  if (IS_SERVER) throw new NeedLogin();
  const args = ["-p", "--output-format", "json", "--max-turns", String(maxTurns)];
  if (tools.length) args.push("--allowedTools", tools.join(","));
  const r = await runClaude(args, prompt, timeoutMs);
  let j;
  try { j = JSON.parse(r.stdout); } catch { throw new Error("Claude no respondió bien: " + (r.stderr || r.stdout).slice(0, 300)); }
  if (j.is_error) {
    if (isAuthError(j.result)) { loginCache = { ok: false, at: Date.now() }; throw new NeedLogin(); }
    throw new Error("Claude: " + String(j.result || j.subtype).slice(0, 300));
  }
  return extractJson(j.result);
}

/* ---------- DeepSeek (sin iniciar sesión: con la clave guardada en la base de datos local) ---------- */

const deepseekKey = () => getSetting("ai:deepseek", null)?.key || process.env.DEEPSEEK_API_KEY || null;

async function askDeepSeek(prompt, { timeoutMs = 8 * 60e3 } = {}) {
  const key = deepseekKey();
  if (!key) throw new NeedLogin();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "deepseek-chat", temperature: 0.3, max_tokens: 8000, response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Eres un editor de vídeo profesional de reels en español. Respondes SIEMPRE solo con un objeto JSON válido, sin texto alrededor." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 300)}`);
    const j = JSON.parse(text);
    return extractJson(j.choices?.[0]?.message?.content ?? "");
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Lo que usa el resto del programa ---------- */

/** Qué cerebro hay disponible: Claude (si tiene sesión) → DeepSeek (si hay clave) → ninguno. */
export async function aiProvider() {
  if (await claudeLoggedIn()) return "claude";
  // El usuario quiere que edite SOLO Claude: DeepSeek solo si se activa a propósito (ajuste "ai:allowDeepseek")
  if (getSetting("ai:allowDeepseek", false) && deepseekKey()) return "deepseek";
  return null;
}

/** Olvida lo que se sabía de la sesión de Claude (para volver a comprobarla ya). */
export function resetClaudeCheck() {
  loginCache = { ok: null, at: 0 };
}

/** ¿Hay algún cerebro disponible? */
export async function claudeReady() {
  return !!(await aiProvider());
}

/** ¿Puede mirar imágenes? (solo Claude) */
export async function canSeeImages() {
  return (await aiProvider()) === "claude";
}

/** Pide algo al cerebro disponible y devuelve el JSON que conteste. */
let last = null;
/** Qué cerebro respondió la última vez ("claude" | "deepseek"). */
export const lastProvider = () => last;

export async function askClaude(prompt, opts = {}) {
  const p = await aiProvider();
  if (p === "claude") { const r = await askClaudeCli(prompt, opts); last = "claude"; return r; }
  if (p === "deepseek") {
    if (opts.images?.length) throw new Error("DeepSeek no puede mirar imágenes.");
    const r = await askDeepSeek(prompt, opts); last = "deepseek"; return r;
  }
  throw new NeedLogin();
}
