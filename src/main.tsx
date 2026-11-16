import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./editor/editor.css";
import App from "./App";
import { ToastProvider } from "./ui";
import { IN_PANEL, authState, installFetch, login, setup, type AuthState } from "./base";

installFetch();

const Logo = () => <span className="brand__logo"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5.5v13l11-6.5z" fill="#fff" /></svg></span>;

/** En el servidor: primero se entra con la cuenta del dueño (o se crea su contraseña la primera vez). */
function Gate() {
  const [st, setSt] = useState<AuthState | "ok" | null>(IN_PANEL ? null : "ok");
  const [fail, setFail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!IN_PANEL) return;
    authState().then((s) => { if (s.loggedIn) setSt("ok"); else { setSt(s); setEmail(s.email); } }).catch((e) => setFail(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!st || st === "ok") return;
    setErr("");
    if (st.needsSetup) {
      if (password.length < 8) return setErr("Usa al menos 8 caracteres.");
      if (password !== repeat) return setErr("Las dos contraseñas no coinciden.");
    }
    setBusy(true);
    try {
      if (st.needsSetup) await setup(password, remember);
      else await login(email, password, remember);
      setSt("ok");
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }

  if (st === "ok") return <App />;
  return (
    <div className="gate">
      <form className="gate__card" onSubmit={submit}>
        <Logo />
        <h1>Pulso Studio</h1>
        {fail ? <p className="gate__err">{fail}</p> : !st ? <p className="muted">Comprobando tu acceso…</p> : (
          <>
            <p>{st.needsSetup ? <>Primera vez: crea la contraseña de <b>{st.email}</b>. Solo esta cuenta puede entrar.</> : "Entra con tu cuenta."}</p>
            <input className="input" type="email" autoComplete="username" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={st.needsSetup} required />
            <input className="input" type="password" autoComplete={st.needsSetup ? "new-password" : "current-password"} placeholder={st.needsSetup ? "Nueva contraseña" : "Contraseña"} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            {st.needsSetup && <input className="input" type="password" autoComplete="new-password" placeholder="Repite la contraseña" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />}
            <label className="gate__remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Mantener la sesión iniciada</label>
            {err && <p className="gate__err">{err}</p>}
            <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? "Un momento…" : st.needsSetup ? "Crear contraseña y entrar" : "Entrar"}</button>
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
