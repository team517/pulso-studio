// Cambiar la contraseña de Pulso Studio desde tu PC (por si la olvidas o no te deja entrar).
// Usa la clave con la que este PC está conectado al panel: no hace falta entrar en la web.
//   node server/cambiar-contrasena.js      (o doble clic en «Cambiar contraseña.cmd»)
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

process.env.STUDIO_MODE = "worker";
const { DATA } = await import("./data-dir.js");
const cfgFile = join(DATA, "worker.json");
if (!existsSync(cfgFile)) { console.log("Este PC todavía no está conectado al panel. Abre antes el editor de Pulso Studio."); process.exit(1); }
const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));

/** Pregunta sin mostrar lo que escribes. */
function ask(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); else if (!/[\r\n]/.test(s)) process.stdout.write("*"); };
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
  });
}

console.log(`\nCambiar la contraseña de Pulso Studio (${cfg.server})\n`);
for (;;) {
  const a = await ask("Contraseña nueva (mínimo 8 caracteres): ");
  if (a.length < 8) { console.log("Tiene que tener al menos 8 caracteres.\n"); continue; }
  const b = await ask("Repítela: ");
  if (a !== b) { console.log("No coinciden. Otra vez.\n"); continue; }
  const r = await fetch(`${cfg.server}/api/worker/owner/password`, {
    method: "POST", headers: { "x-worker-token": cfg.token, "content-type": "application/json" }, body: JSON.stringify({ password: a }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.log(`\nNo se pudo cambiar: ${j.error || r.status}\n`); process.exit(1); }
  console.log(`\nListo. Entra en la web con ${j.email} y la contraseña nueva (marca «Mantener la sesión iniciada»).`);
  break;
}
