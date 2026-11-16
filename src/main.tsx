import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./editor/editor.css";
import App from "./App";
import { ToastProvider } from "./ui";
import { IN_PANEL, NoAccess, installFetch, login, startSession } from "./base";

installFetch();

const Logo = () => <span className="brand__logo"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5.5v13l11-6.5z" fill="#fff" /></svg></span>;

/** En el servidor: primero se entra con una cuenta de administrador. */
function Gate() {
  const [state, setState] = useState<"checking" | "ok" | NoAccess>(IN_PANEL ? "checking" : "ok");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!IN_PANEL) return;
    startSession().then(() => setState("ok")).catch((e) => setState(e instanceof NoAccess ? e : new NoAccess(String(e?.message || e), "error")));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try { await login(email, password); setState("ok"); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  if (state === "ok") return <App />;
  return (
    <div className="gate">
      <form className="gate__card" onSubmit={submit}>
        <Logo />
        <h1>Pulso Studio</h1>
        {state === "checking" ? <p className="muted">Comprobando tu acceso…</p> : (
          <>
            <p>Entra con tu cuenta de administrador de ChipsFinder.</p>
            <input className="input" type="email" autoComplete="username" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <input className="input" type="password" autoComplete="current-password" placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {(err || (state.kind !== "login" && state.message)) && <p className="gate__err">{err || state.message}</p>}
            <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
          </>
        )}
      </form>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <Gate />
    </ToastProvider>
  </StrictMode>,
);
