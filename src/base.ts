// Dónde vive la web y la entrada con la cuenta del dueño (modo servidor).

/** "" en la raíz del dominio; "/studio" si va bajo una ruta. */
export const BASE = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
/** ¿Pide entrar con cuenta? (la versión del servidor) */
export const IN_PANEL = import.meta.env.VITE_STUDIO_AUTH === "1";
export const insideFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();

const nativeFetch = window.fetch.bind(window);

export type AuthState = { email: string; needsSetup: boolean; loggedIn: boolean; persistent?: boolean | null; recover?: "none" | null };

export async function authState(): Promise<AuthState> {
  const r = await nativeFetch(`${BASE}/api/auth-state`, { credentials: "same-origin", cache: "no-store" });
  if (!r.ok) throw new Error(`El servidor no responde (${r.status}).`);
  return r.json();
}

async function post(path: string, body: unknown) {
  const r = await nativeFetch(`${BASE}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
  return data;
}

/** Entrar con la cuenta del dueño. */
export const login = (email: string, password: string, remember: boolean) => post("/api/login", { email, password, remember });
/** Primera vez: crear la contraseña. */
export const setup = (password: string, remember: boolean) => post("/api/setup", { password, remember });

export async function logout(): Promise<void> {
  await nativeFetch(`${BASE}/api/logout`, { method: "POST", credentials: "same-origin" }).catch(() => null);
  window.location.reload();
}

const withBase = (u: string) => (BASE && /^\/(api|files)\//.test(u) ? BASE + u : u);

/** Todas las llamadas a /api y /files van bajo BASE; si la sesión caduca, se vuelve a la pantalla de entrada. */
export function installFetch() {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === "string" ? withBase(input) : input;
    const res = await nativeFetch(target as RequestInfo, init);
    if (IN_PANEL && res.status === 401 && typeof input === "string" && input.startsWith("/api/")) {
      const st = await authState().catch(() => null);
      if (st && !st.loggedIn) window.location.reload();
    }
    return res;
  };
}

/** Enlaces que no pasan por fetch (descargas, OAuth). */
export const url = withBase;
