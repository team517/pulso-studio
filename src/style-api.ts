// Estilo de edición: tipos y llamadas.

export type StyleAsset = { id: string; kind: "font" | "logo" | "reference"; name: string; file: string; family: string | null; url: string; created_at: string };
export type PaletteColor = { hex: string; weight: number; sat: number; lum: number };
export type EditStyle = {
  fonts: { caption: string | null; keyword: string | null; title: string | null };
  colors: { accent: string; accent2: string; keyword: string; caption: string; bg: string };
  caption: { size: "s" | "m" | "l"; uppercase: boolean; position: "auto" | "high" | "low"; animation: "soft" | "pop" | "typewriter" | "word"; keywordStyle: "big" | "highlight" | "box" };
  cards: { look: "glass" | "solid" | "light" };
  motion: { intensity: 1 | 2 | 3 };
  logo: { id: string; position: "top-left" | "top-right" | "bottom-left" | "bottom-right"; size: number } | null;
  music: "auto" | "synthwave" | "lofi" | "none";
  graphics: "none" | "few" | "balanced" | "many";
  notes: string;
  aiNotes: string;
  palette: PaletteColor[];
  rhythm?: { cutsPerMin: number; seconds: number } | null;
  aiSuggested?: { caption?: Partial<EditStyle["caption"]>; cards?: Partial<EditStyle["cards"]>; motion?: Partial<EditStyle["motion"]> } | null;
};
export type AutoSettings = { enabled: boolean; kind: "variants" | "shorts"; variants: string[]; shorts?: number };

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body && !(body instanceof FormData) ? { "content-type": "application/json" } : undefined,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data as T;
}

export const styleApi = {
  get: () => req<{ style: EditStyle; auto: AutoSettings; assets: StyleAsset[] }>("GET", "/api/style"),
  save: (style: Partial<EditStyle>, auto?: Partial<AutoSettings>) => req<{ style: EditStyle; auto: AutoSettings }>("PUT", "/api/style", { style, auto }),
  upload: (files: File[], kind: StyleAsset["kind"]) => {
    const fd = new FormData();
    fd.append("kind", kind);
    files.forEach((f) => fd.append("files", f));
    return req<StyleAsset[]>("POST", "/api/style/assets", fd);
  },
  remove: (id: string) => req("DELETE", `/api/style/assets/${id}`),
  analyze: () => req<{ palette: PaletteColor[]; suggestion: Partial<EditStyle["colors"]>; aiNotes: string; seen: boolean; pending?: boolean; rhythm: EditStyle["rhythm"]; aiSuggested: EditStyle["aiSuggested"]; style: EditStyle }>("POST", "/api/style/analyze"),
};

/** Nombre CSS con el que se carga cada fuente subida (para la vista previa). */
export const fontFamily = (a: StyleAsset) => `uf-${a.id}`;

/* ---------- Estilos guardados ---------- */

export type PresetCaption = EditStyle["caption"] & {
  yPct?: number; scale?: number; weight?: number; maxWords?: number; lines?: number;
  stroke?: { color: string; width: number } | null; shadow?: "none" | "soft" | "strong";
  bg?: { color: string; opacity: number; radius: number } | null; letterSpacing?: number;
  keywordColor?: string; keywordScale?: number; keywordFont?: "same" | "keyword";
};
export type StylePreset = {
  id: string; name: string; status: "queued" | "analyzing" | "ready" | "error"; step: string | null; error: string | null;
  created_at: string; updated_at: string; active: boolean;
  videos: { id: string; name: string; url: string; video: boolean }[];
  style: {
    caption: PresetCaption; colors: Partial<EditStyle["colors"]>;
    motion: { intensity: number; zoomStyle?: "smooth" | "punch" | "none"; zoomMax?: number };
    look?: { grain: number; vignette: number; letterbox: boolean }; grade?: string; graphics?: string; music?: string;
    rhythm?: { cutsPerMin: number; seconds: number } | null; rules?: string[];
  } | null;
  analysis: { summary: string; fonts?: Record<string, { families: string[]; seen: string } | null>; frames?: number } | null;
  fonts: { caption: string | null; keyword: string | null } | null;
};

export const presetsApi = {
  list: () => req<StylePreset[]>("GET", "/api/presets"),
  create: (name: string, files: File[], assetIds: string[] = []) => {
    const fd = new FormData();
    fd.append("name", name);
    fd.append("assetIds", JSON.stringify(assetIds));
    files.forEach((f) => fd.append("files", f));
    return req<StylePreset>("POST", "/api/presets", fd);
  },
  use: (id: string) => req("POST", `/api/presets/${id}/use`),
  analyze: (id: string) => req<StylePreset>("POST", `/api/presets/${id}/analyze`),
  rename: (id: string, name: string) => req<StylePreset>("PUT", `/api/presets/${id}`, { name }),
  remove: (id: string) => req("DELETE", `/api/presets/${id}`),
};
