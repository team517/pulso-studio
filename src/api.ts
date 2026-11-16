// Tipos y llamadas al servidor local.

export type MediaKind = "video" | "audio" | "image";
export type Word = { w: string; s: number; e: number };

export type Media = {
  id: string; name: string; kind: MediaKind; file: string; url: string; thumbUrl: string | null;
  duration: number; width: number | null; height: number | null; has_audio: boolean; size: number;
  transcript: Word[] | null; transcript_status: string | null; created_at: string;
};

export type Format = "9:16" | "1:1" | "4:5" | "16:9";
export const FORMATS: { id: Format; w: number; h: number; label: string; hint: string }[] = [
  { id: "9:16", w: 1080, h: 1920, label: "Vertical 9:16", hint: "Reels · TikTok · Shorts" },
  { id: "4:5", w: 1080, h: 1350, label: "Retrato 4:5", hint: "Feed de Instagram" },
  { id: "1:1", w: 1080, h: 1080, label: "Cuadrado 1:1", hint: "Feed" },
  { id: "16:9", w: 1920, h: 1080, label: "Horizontal 16:9", hint: "YouTube" },
];

export type Clip = { id: string; mediaId: string; in: number; out: number; volume: number; muted?: boolean; fit: "cover" | "contain" };
export type TextItem = {
  id: string; text: string; start: number; end: number; x: number; y: number; size: number;
  color: string; font: string; box: boolean; boxColor: string; boxOpacity: number;
};
export type Caption = { id: string; start: number; end: number; text: string; words: Word[] };
export type CaptionStyle = {
  font: string; size: number; color: string; highlight: string | null; y: number; uppercase: boolean;
  box: boolean; wordsPerLine: number;
};
export type Music = { mediaId: string; volume: number; fadeIn: number; fadeOut: number; offset: number };

export type ProjectData = {
  format: Format; width: number; height: number; fps: number; background: string;
  clips: Clip[]; texts: TextItem[];
  captions: { enabled: boolean; items: Caption[]; style: Partial<CaptionStyle> };
  music: Music | null;
};
export type Project = { id: string; name: string; data: ProjectData; thumbUrl: string | null; created_at: string; updated_at: string };

export type ExportJob = {
  id: string; project_id: string | null; name: string; status: "queued" | "running" | "done" | "error";
  progress: number; error: string | null; duration: number | null; width: number | null; height: number | null;
  size: number | null; url: string | null; thumbUrl: string | null; created_at: string;
};

export type PlatformId = "youtube" | "tiktok" | "instagram";
export type PostResult = { status: "ok" | "error"; at: string; url?: string | null; error?: string; note?: string };
export type Post = {
  id: string; export_id: string; title: string; caption: string; platforms: PlatformId[];
  options: { youtubePrivacy?: string; tiktokPrivacy?: string };
  scheduled_at: string; status: "scheduled" | "publishing" | "published" | "partial" | "failed";
  results: Partial<Record<PlatformId, PostResult>>;
  video: { id: string; name: string; url: string | null; thumbUrl: string | null; duration: number | null } | null;
  created_at: string; updated_at: string;
};
export type PlatformStatus = {
  id: PlatformId; configured: boolean; connected: boolean; account: string | null; clientId: string | null;
  privacy: string; redirectUri: string | null; error: string | null;
  expiresAt?: number | null; mode?: "facebook" | "instagram" | null; hasApp?: boolean | null;
};

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body instanceof FormData || body === undefined ? undefined : { "content-type": "application/json" },
    body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data as T;
}

export const api = {
  media: () => req<Media[]>("GET", "/api/media"),
  mediaOne: (id: string) => req<Media>("GET", `/api/media/${id}`),
  upload: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return req<Media[]>("POST", "/api/media", fd);
  },
  deleteMedia: (id: string) => req("DELETE", `/api/media/${id}`),
  transcribe: (id: string, language = "es") => req("POST", `/api/media/${id}/transcribe`, { language }),

  projects: () => req<Project[]>("GET", "/api/projects"),
  project: (id: string) => req<Project>("GET", `/api/projects/${id}`),
  createProject: (name: string, format: Format) => req<Project>("POST", "/api/projects", { name, format }),
  saveProject: (id: string, patch: { name?: string; data?: ProjectData }) => req<Project>("PUT", `/api/projects/${id}`, patch),
  duplicateProject: (id: string) => req<Project>("POST", `/api/projects/${id}/duplicate`),
  deleteProject: (id: string) => req("DELETE", `/api/projects/${id}`),

  exportProject: (id: string, name: string, data: ProjectData) => req<ExportJob>("POST", `/api/projects/${id}/export`, { name, data }),
  exports: () => req<ExportJob[]>("GET", "/api/exports"),
  exportOne: (id: string) => req<ExportJob>("GET", `/api/exports/${id}`),
  renameExport: (id: string, name: string) => req<ExportJob>("PATCH", `/api/exports/${id}`, { name }),
  deleteExport: (id: string) => req("DELETE", `/api/exports/${id}`),

  posts: (from?: Date, to?: Date) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from.toISOString());
    if (to) q.set("to", to.toISOString());
    return req<Post[]>("GET", "/api/posts?" + q);
  },
  createPost: (p: Partial<Post>) => req<Post>("POST", "/api/posts", p),
  updatePost: (id: string, p: Partial<Post>) => req<Post>("PUT", `/api/posts/${id}`, p),
  deletePost: (id: string) => req("DELETE", `/api/posts/${id}`),
  publishNow: (id: string) => req("POST", `/api/posts/${id}/publish-now`),

  platforms: () => req<{ platforms: PlatformStatus[]; publicUrl: string; localUrl: string }>("GET", "/api/platforms"),
  configurePlatform: (p: PlatformId, body: Record<string, string>) => req<PlatformStatus>("PUT", `/api/platforms/${p}`, body),
  setPublicUrl: (publicUrl: string) => req("PUT", "/api/platforms/public-url", { publicUrl }),
  disconnectPlatform: (p: PlatformId) => req("POST", `/api/platforms/${p}/disconnect`),
  checkInstagram: () => req<{ username: string; media: number | null; used: number | null; quota: number | null }>("GET", "/api/platforms/instagram/check"),
};

/* ---------- Utilidades ---------- */

export const newId = () => Math.random().toString(36).slice(2, 10);

export function fmtTime(t: number, withFrames = false) {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const base = `${m}:${String(sec).padStart(2, "0")}`;
  return withFrames ? `${base}.${String(Math.floor((s % 1) * 10))}` : base;
}

export function fmtSize(b: number | null) {
  if (!b) return "—";
  return b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.round(b / 1e3) + " KB";
}

export const PLATFORM_INFO: Record<PlatformId, { name: string; color: string; short: string }> = {
  instagram: { name: "Instagram Reels", color: "#e1306c", short: "IG" },
  tiktok: { name: "TikTok", color: "#25f4ee", short: "TT" },
  youtube: { name: "YouTube Shorts", color: "#ff0033", short: "YT" },
};

/* ---------- Reels de prueba y resultados ---------- */

export type TrialGraduation = "MANUAL" | "SS_PERFORMANCE";
/** Opciones de una publicación (incluye las de reel de prueba y «creado a partir de»). */
export type PostOptions = Post["options"] & { trial?: { graduation: TrialGraduation }; promotedFrom?: string };

export type InsightMetrics = {
  views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null;
  saves: number | null; interactions: number | null; avg_watch_ms: number | null;
};
export type InsightPlatform = {
  platform: PlatformId;
  status: "ok" | "pending" | "error" | "stale" | "unavailable" | "not_published";
  url: string | null; mediaId: string | null; publishedAt: string | null; latest: InsightMetrics | null;
  history: { at: string; views: number | null; likes: number | null; reach: number | null }[];
  checkedAt: string | null; okAt: string | null; error: string | null;
};
export type InsightItem = {
  id: string; title: string; caption: string; export_id: string; status: Post["status"]; publishedAt: string;
  video: { id: string; name: string; url: string | null; thumbUrl: string | null; duration: number | null } | null;
  trial: TrialGraduation | null; promotedFrom: string | null;
  promotedTo: { id: string; status: Post["status"]; scheduled_at: string; url: string | null }[];
  platforms: InsightPlatform[];
  totals: { views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null };
  winner: boolean; trialViews: number | null;
};
export type InsightsList = {
  items: InsightItem[]; running: boolean; lastRunAt: string | null;
  rule: { factor: number; minOthers: number; minViewsIfFew: number };
  platformErrors: Partial<Record<PlatformId, string>>;
};

export const insightsApi = {
  list: () => req<InsightsList>("GET", "/api/insights"),
  refreshAll: () => req<{ started: boolean; running: boolean }>("POST", "/api/insights/refresh"),
  refreshPost: (id: string) => req<{ ok: boolean; item: InsightItem | null }>("POST", `/api/insights/${id}/refresh`),
};
