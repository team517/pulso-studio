// Ideas de contenido y plan de la semana: tipos y llamadas.
import { useCallback, useEffect, useState } from "react";

export type IdeaFormat = "camara" | "pantalla";
export type IdeaStatus = "idea" | "plan" | "grabada" | "editada" | "publicada" | "descartada";
export type ScriptPart = { part: string; time: string; say: string; show: string };
export type Idea = {
  id: string; title: string; format: IdeaFormat; status: IdeaStatus; date: string | null; favorite: boolean; notes: string;
  pillar?: string; angle?: string; hook?: string; hookVisual?: string; duration?: number; script?: ScriptPart[];
  screen?: string[]; prep?: string[]; howTo?: string; cover?: string; caption?: string; hashtags?: string[];
  inspiration?: { creator: string | null; post: string | null; why: string };
  needsScript?: boolean; created_at: string; updated_at: string;
};
export type IgPost = {
  id: string; type: "reel" | "video" | "imagen" | "carrusel"; caption: string; likes: number | null; comments: number | null;
  views: number | null; engagement: number | null; url: string; at: string; img: string | null; video: string | null;
};
export type CreatorAnalysis = { summary: string; hooks: string[]; structures: string[]; topics: string[]; formats: string; copy: string[]; avoid: string[]; at: string };
export type Creator = {
  id: string; username: string; status: "loading" | "ready" | "error"; error: string | null; fetched_at: string | null;
  profile: { username: string; name: string | null; bio: string; followers: number | null; posts: number | null; pic: string | null; website: string | null } | null;
  analysis: CreatorAnalysis | null; transcripts: { id: string; url: string; text: string }[];
  postCount: number; reelCount?: number; posts?: IgPost[]; preview?: IgPost[];
};
export type IdeasJob = {
  id: string; kind: "ideas" | "plan" | "script" | "creator" | "fetch"; label: string; status: "queued" | "running" | "done" | "error" | "needs_login" | "cancelled";
  step: string | null; progress: number; error: string | null; ref: string | null; created_at: string; updated_at: string;
};
export type Profile = { about: string; audience: string; offer: string; tone: string; goals: string; avoid: string };
export type WeekDay = { dow: number; type: IdeaFormat | "off"; label: string };
export type Week = { days: WeekDay[]; time: string };
export type MonthPlan = { summary: string; weeks: { week: number; theme: string; goal: string }[]; at: string };
export type IdeasState = {
  profile: Profile; week: Week; formats: Record<IdeaFormat, string>;
  ig: { ready: boolean; via: "facebook" | "composio"; account: string | null; why: string | null };
  creators: Creator[]; ideas: Idea[]; jobs: IdeasJob[]; plans: Record<string, MonthPlan>;
};

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { if (res.ok) throw new Error("Respuesta rara del servidor: vuelve a intentarlo"); }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data as T;
}

export const ideasApi = {
  state: () => req<IdeasState>("GET", "/api/ideas/state"),
  saveProfile: (p: Partial<Profile>) => req<Profile>("PUT", "/api/ideas/profile", p),
  saveWeek: (w: Week) => req<Week>("PUT", "/api/ideas/week", w),
  addCreators: (usernames: string) => req<Creator[]>("POST", "/api/ideas/creators", { usernames }),
  creator: (id: string) => req<Creator>("GET", `/api/ideas/creators/${id}`),
  refreshCreator: (id: string) => req<Creator>("POST", `/api/ideas/creators/${id}/refresh`),
  removeCreator: (id: string) => req<{ ok: true }>("DELETE", `/api/ideas/creators/${id}`),
  analyzeCreator: (id: string) => req<IdeasJob>("POST", `/api/ideas/creators/${id}/analyze`),
  generate: (o: { count: number; format: IdeaFormat | "mix"; focus?: string; creatorIds?: string[]; post?: { creatorId: string; postId: string } }) =>
    req<IdeasJob>("POST", "/api/ideas/generate", o),
  update: (id: string, f: Partial<Pick<Idea, "status" | "date" | "favorite" | "notes" | "title">> & { data?: Partial<Idea> }) => req<Idea>("PATCH", `/api/ideas/${id}`, f),
  remove: (id: string) => req<{ ok: true }>("DELETE", `/api/ideas/${id}`),
  schedule: (id: string) => req<Idea>("POST", `/api/ideas/${id}/schedule`),
  scheduleAll: () => req<{ scheduled: { id: string; title: string; date: string }[] }>("POST", "/api/ideas/schedule-all"),
  rewrite: (id: string, request: string) => req<IdeasJob>("POST", `/api/ideas/${id}/rewrite`, { request }),
  plan: (month: string, replace: boolean) => req<IdeasJob>("POST", "/api/ideas/plan", { month, replace }),
  cancelJob: (id: string) => req<{ ok: true }>("DELETE", `/api/ideas/jobs/${id}`),
  retryJob: (id: string) => req<{ ok: true }>("POST", `/api/ideas/jobs/${id}/retry`),
};

/** Estado de la sección; se refresca solo mientras Claude trabaja o se cargan creadores. */
export function useIdeas() {
  const [state, setState] = useState<IdeasState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => ideasApi.state().then((s) => { setState(s); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const busy = !!state && (state.jobs.some((j) => j.status === "queued" || j.status === "running") || state.creators.some((c) => c.status === "loading"));
  // Mientras tu PC trabaja, cada 2,5 s; si no, cada 15 s (para ver lo que termina o cambia en otra pestaña)
  useEffect(() => {
    const t = setInterval(load, busy ? 2500 : 15000);
    return () => clearInterval(t);
  }, [busy, load]);
  return { state, error, reload: load, setState };
}

export const FORMAT_LABEL: Record<IdeaFormat, string> = { camara: "Hablando a cámara", pantalla: "Formación · pantalla" };
export const STATUS_LABEL: Record<IdeaStatus, string> = { idea: "Idea", plan: "Planificada", grabada: "Grabada", editada: "Editada", publicada: "Publicada", descartada: "Descartada" };
export const PILLAR_LABEL: Record<string, string> = { educar: "Educar", autoridad: "Autoridad", caso: "Caso real", venta: "Venta", personal: "Personal" };
export const ANGLE_LABEL: Record<string, string> = { tutorial: "Tutorial", lista: "Lista", error: "Error", mito: "Mito", historia: "Historia", comparativa: "Comparativa", opinion: "Opinión", caso: "Caso" };
/** El gancho sin comillas alrededor (la interfaz pone las suyas). */
export const hookOf = (i: Pick<Idea, "hook">) => String(i.hook || "").replace(/^[s«"“'»]+|[s»"”'«]+$/g, "").trim();
export const WEEKDAY = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1e6 ? (n / 1e6).toFixed(1).replace(".0", "") + " M" : n >= 1e4 ? Math.round(n / 1e3) + " mil" : n.toLocaleString("es-ES");
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** El guion como texto (para copiarlo o leerlo mientras grabas). */
export function scriptText(i: Idea) {
  const parts = (i.script || []).map((p) => `[${p.part}${p.time ? " · " + p.time : ""}]\n${p.say}${p.show ? `\n(En pantalla: ${p.show})` : ""}`).join("\n\n");
  const screen = i.screen?.length ? `\n\nGRABACIÓN DE PANTALLA\n${i.screen.map((s, k) => `${k + 1}. ${s}`).join("\n")}` : "";
  return `${i.title}\n\nGANCHO: ${i.hook || ""}\n\n${parts}${screen}\n\nDESCRIPCIÓN\n${i.caption || ""}\n${(i.hashtags || []).map((h) => "#" + h).join(" ")}`;
}

/** «miércoles 3 dic» */
export const dayLabel = (iso: string) => new Date(iso + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" });
