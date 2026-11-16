// Base de datos local (SQLite integrado en Node 24). Todo vive en data/.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const DATA = join(process.cwd(), "data");
export const DIRS = {
  media: join(DATA, "media"),
  thumbs: join(DATA, "thumbs"),
  exports: join(DATA, "exports"),
  tmp: join(DATA, "tmp"),
};
for (const d of [DATA, ...Object.values(DIRS)]) mkdirSync(d, { recursive: true });

export const db = new DatabaseSync(join(DATA, "studio.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, file TEXT NOT NULL,
    duration REAL, width INTEGER, height INTEGER, has_audio INTEGER DEFAULT 0, size INTEGER,
    thumb TEXT, transcript TEXT, transcript_status TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, thumb TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY, project_id TEXT, name TEXT NOT NULL, file TEXT, thumb TEXT,
    status TEXT NOT NULL, progress REAL DEFAULT 0, error TEXT, duration REAL,
    width INTEGER, height INTEGER, size INTEGER, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, export_id TEXT, title TEXT, caption TEXT, platforms TEXT NOT NULL,
    options TEXT, scheduled_at TEXT NOT NULL, status TEXT NOT NULL, results TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();

const JSON_COLS = new Set(["transcript", "data", "platforms", "options", "results", "plan", "qa", "post", "short"]);
/** Convierte las columnas JSON de una fila a objetos. */
export function row(r) {
  if (!r) return null;
  const out = { ...r };
  for (const k of Object.keys(out)) if (JSON_COLS.has(k) && typeof out[k] === "string") {
    try { out[k] = JSON.parse(out[k]); } catch { /* se deja tal cual */ }
  }
  return out;
}

export const getSetting = (key, def = null) => {
  const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return r ? JSON.parse(r.value) : def;
};
export const setSetting = (key, value) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));

// Resultados de las publicaciones: una foto ("snapshot") cada vez que se consultan las estadísticas,
// para poder ver cómo crecen. Y el estado de la última consulta por publicación y red.
db.exec(`
  CREATE TABLE IF NOT EXISTS post_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT, post_id TEXT NOT NULL, platform TEXT NOT NULL, media_id TEXT,
    fetched_at TEXT NOT NULL, views INTEGER, reach INTEGER, likes INTEGER, comments INTEGER, shares INTEGER,
    saves INTEGER, interactions INTEGER, avg_watch_ms INTEGER, raw TEXT
  );
  CREATE INDEX IF NOT EXISTS post_insights_post ON post_insights (post_id, platform, fetched_at);
  CREATE TABLE IF NOT EXISTS post_insights_state (
    post_id TEXT NOT NULL, platform TEXT NOT NULL, media_id TEXT, status TEXT NOT NULL,
    error TEXT, last_try_at TEXT, last_ok_at TEXT, PRIMARY KEY (post_id, platform)
  );
`);
