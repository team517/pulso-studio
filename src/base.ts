// Dónde vive la web: en local, en la raíz; dentro del panel de ChipsFinder, bajo /studio.
// También gestiona la entrada con la sesión del panel (solo administradores).

/** "" en local, "/studio" en el panel. */
export const BASE = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
/** ¿Va dentro del panel (pide sesión de ChipsFinder)? */
export const IN_PANEL = import.meta.env.VITE_STUDIO_AUTH === "1";
export const insideFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();

const nativeFetch = window.fetch.bind(window);

/** Token de la sesión del panel (ChipsFinder la guarda como "chf-auth"). */
function panelToken(): string | null {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem("chf-auth");
      if (!raw) continue;
      const s = JSON.parse(raw);
      const t = s?.access_token || s?.currentSession?.access_token;
      if (t) return String(t);
    } catch { /* bloqueado o mal formado */ }
  }
  return null;
}

export class NoAccess extends Error {
  constructor(msg: string, public kind: "login" | "forbidden" | "error") { super(msg); }
}

let starting: Promise<void> | null = null;
/** Cambia la sesión del panel por la de Pulso Studio (cookie de 12 h). */
export function startSession(): Promise<void> {
  if (!IN_PANEL) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    // ¿Sigue valiendo la cookie de antes? (p. ej. al abrir Pulso Studio en otra pestaña)
    const me = await nativeFetch(`${BASE}/api/me`, { credentials: "same-origin" }).catch(() => null);
    if (me?.ok) return;
    const token = panelToken();
    if (!token) throw new NoAccess("Entra en el panel de ChipsFinder con tu cuenta de administrador para usar Pulso Studio.", "login");
    const r = await nativeFetch(`${BASE}/api/session`, { method: "POST", headers: { authorization: `Bearer ${token}` }, credentials: "same-origin" });
    if (r.ok) return;
    const data = await r.json().catch(() => null);
    throw new NoAccess(data?.error || `Error ${r.status}`, r.status === 403 ? "forbidden" : r.status === 401 ? "login" : "error");
  })().finally(() => { starting = null; });
  return starting;
}

const withBase = (u: string) => (BASE && /^\/(api|files)\//.test(u) ? BASE + u : u);

/** Todas las llamadas a /api y /files van bajo BASE y, si la sesión caduca, se renueva sola una vez. */
export function installFetch() {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? withBase(input) : input instanceof URL ? input : input;
    const res = await nativeFetch(url as RequestInfo, init);
    if (IN_PANEL && res.status === 401 && typeof input === "string" && input.startsWith("/api/") && input !== "/api/session") {
      try { await startSession(); } catch { return res; }
      return nativeFetch(url as RequestInfo, init);
    }
    return res;
  };
}

/** Enlaces que no pasan por fetch (descargas, OAuth). */
export const url = withBase;
