// Cada 30 s publica las publicaciones cuya hora ya ha llegado.
import { join } from "node:path";
import { existsSync } from "node:fs";
import { db, DIRS, now, row } from "./db.js";
import { publish } from "./platforms.js";

const busy = new Set();

export async function runPost(id) {
  if (busy.has(id)) return;
  const post = row(db.prepare("SELECT * FROM posts WHERE id = ?").get(id));
  if (!post) return;
  busy.add(id);
  try {
    db.prepare("UPDATE posts SET status = 'publishing', updated_at = ? WHERE id = ?").run(now(), id);
    const exp = db.prepare("SELECT * FROM exports WHERE id = ?").get(post.export_id);
    const file = exp?.file ? join(DIRS.exports, exp.file) : null;
    const results = { ...(post.results || {}) };
    for (const p of post.platforms) {
      if (results[p]?.status === "ok") continue; // ya publicado en un intento anterior
      try {
        if (!file || !existsSync(file)) throw new Error("No encuentro el vídeo exportado.");
        const r = await publish(p, post, file);
        results[p] = { status: "ok", at: now(), ...r };
      } catch (e) {
        results[p] = { status: "error", at: now(), error: String(e.message || e).slice(0, 500) };
      }
      db.prepare("UPDATE posts SET results = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(results), now(), id);
    }
    const oks = post.platforms.filter((p) => results[p]?.status === "ok").length;
    const status = oks === post.platforms.length ? "published" : oks > 0 ? "partial" : "failed";
    db.prepare("UPDATE posts SET status = ?, results = ?, updated_at = ? WHERE id = ?").run(status, JSON.stringify(results), now(), id);
  } finally {
    busy.delete(id);
  }
}

export function startScheduler() {
  // Si el programa se cerró a mitad de una publicación, se reintenta
  db.prepare("UPDATE posts SET status = 'scheduled' WHERE status = 'publishing'").run();
  const tick = () => {
    const due = db.prepare("SELECT id FROM posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 5").all(now());
    for (const { id } of due) runPost(id).catch((e) => console.error("[scheduler]", e));
  };
  tick();
  setInterval(tick, 30_000);
}
