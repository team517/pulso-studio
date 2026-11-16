// Llamadas de la auto-edición (archivo aparte para no pisar api.ts).

export type AutoVariant = { key: string; label: string; layout: string; width: number; height: number };
export type QaIssue = { t?: number; problem: string; fix?: string };
export type AutoItem = {
  id: string; job_id: string; idx: number; label: string; layout: string;
  status: "queued" | "rendering" | "mixing" | "qa" | "done" | "error"; step: string | null; progress: number; error: string | null;
  qa: { checked: boolean; ok: boolean | null; score?: number | null; issues: QaIssue[]; note?: string } | null;
  review: "pending" | "approved" | "rejected"; notes: string | null;
  post: { caption?: string; youtubeTitle?: string; hook?: { title: string; subtitle?: string } | null } | null;
  short: { title: string; why: string } | null;
  video: { id: string; name: string; url: string; thumbUrl: string | null; duration: number; width: number; height: number; size: number } | null;
};
export type AutoJob = {
  id: string; media_id: string; kind: "variants" | "shorts"; name: string;
  status: "queued" | "running" | "done" | "error" | "needs_login"; step: string | null; progress: number; error: string | null;
  brain: "claude" | "deepseek" | "reglas" | null; summary: string | null; created_at: string;
  options: { shorts: number; variants: string[]; vocab: string; allowRules: boolean } | null;
  plan: { topic?: string; hook?: { title: string; subtitle?: string } | null; shorts?: { title: string; why: string }[] } | null;
  media: { id: string; name: string; thumbUrl: string | null; duration: number } | null;
  items: AutoItem[];
};

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data as T;
}

export const autoApi = {
  info: () => req<{ claude: boolean; provider: "claude" | "deepseek" | null; variants: AutoVariant[] }>("GET", "/api/autoedit/info"),
  jobs: () => req<AutoJob[]>("GET", "/api/autoedit/jobs"),
  job: (id: string) => req<AutoJob>("GET", `/api/autoedit/jobs/${id}`),
  create: (b: { mediaId: string; kind: "variants" | "shorts"; variants?: string[]; shorts?: number; vocab?: string; allowRules?: boolean }) => req<AutoJob>("POST", "/api/autoedit/jobs", b),
  retry: (id: string) => req<AutoJob>("POST", `/api/autoedit/jobs/${id}/retry`),
  useRules: (id: string) => req<AutoJob>("POST", `/api/autoedit/jobs/${id}/use-rules`),
  remove: (id: string) => req("DELETE", `/api/autoedit/jobs/${id}`),
  review: (itemId: string, review: AutoItem["review"]) => req("POST", `/api/autoedit/items/${itemId}/review`, { review }),
  changes: (itemId: string, notes: string) => req("POST", `/api/autoedit/items/${itemId}/changes`, { notes }),
};

/** Datos para rellenar la publicación al llegar al calendario desde una versión aprobada. */
export const PREFILL_KEY = "pulso:prefill";
export type Prefill = { exportId: string; caption?: string; title?: string; trial?: boolean };
export function setPrefill(p: Prefill) {
  try { sessionStorage.setItem(PREFILL_KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ }
}
export function takePrefill(): Prefill | null {
  try {
    const v = sessionStorage.getItem(PREFILL_KEY);
    sessionStorage.removeItem(PREFILL_KEY);
    return v ? (JSON.parse(v) as Prefill) : null;
  } catch { return null; }
}
