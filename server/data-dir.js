// Dónde se guardan los datos (base de datos, vídeos, referencias, clave de sesión).
// En EasyPanel solo sobrevive a «Implementar» lo que está en un volumen montado. Si el volumen se montó
// en /app/data, se usa; si se montó en otra ruta (p. ej. /data), se detecta y se usa esa.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SYSTEM = /^\/(proc|sys|dev|etc|run|tmp|var\/run|usr|bin|sbin|lib|lib64|boot)(\/|$)/;
const VIRTUAL = new Set(["proc", "sysfs", "tmpfs", "devpts", "mqueue", "cgroup", "cgroup2", "devtmpfs", "securityfs", "debugfs", "overlay", "nsfs", "fusectl", "tracefs"]);

/** Volúmenes montados en el contenedor (solo Linux/Docker). null si no se puede saber. */
function mounts() {
  try {
    return readFileSync("/proc/self/mountinfo", "utf8").split("\n").filter(Boolean).map((l) => {
      const [a, b] = l.split(" - ");
      const point = a.split(" ")[4].replace(/\\040/g, " ");
      const type = (b || "").split(" ")[0];
      return { point, type };
    });
  } catch { return null; }
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

function pick() {
  if (process.env.STUDIO_DATA) return { dir: process.env.STUDIO_DATA, persistent: null };
  const fallback = join(process.cwd(), "data");
  if (process.env.STUDIO_MODE !== "server") return { dir: fallback, persistent: true };
  const m = mounts();
  if (!m) return { dir: fallback, persistent: null };
  if (m.some((x) => x.point === fallback)) return { dir: fallback, persistent: true };
  // ¿Un volumen en otra ruta? Se usa ese
  const other = m.find((x) => x.point !== "/" && !SYSTEM.test(x.point) && !VIRTUAL.has(x.type) && isDir(x.point));
  if (other) return { dir: other.point, persistent: true };
  return { dir: fallback, persistent: false };
}

const chosen = pick();
export const DATA = chosen.dir;
/** true: sobrevive a «Implementar» · false: se borrará · null: no se sabe (fuera de Docker) */
export const PERSISTENT = chosen.persistent;
if (process.env.STUDIO_MODE === "server") {
  console.log(PERSISTENT === false
    ? `[datos] ⚠ ${DATA} NO está en un volumen: se borrará al implementar. En EasyPanel → Montajes → volumen en /app/data.`
    : `[datos] Guardando en ${DATA}`);
}
