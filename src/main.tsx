import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./editor/editor.css";
import App from "./App";
import { ToastProvider } from "./ui";
import { IN_PANEL, authState, installFetch, login, setup, type AuthState } from "./base";

installFetch();

const Logo = () => <span className="brand__logo"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5.5v13l11-6.5z" fill="#fff" /></svg></span>;

/** En el servidor: se entra con la cuenta del dueño. Si el servidor acaba de empezar de cero, tu PC le devuelve
 *  la cuenta en unos segundos: aquí solo se espera (y la sesión abierta vuelve a valer sola). */
function Gate() {
  const [st, setSt] = useState<AuthState | "ok" | null>(IN_PANEL ? null : "ok");
  const [fail, setFail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [firstTime, setFirstTime] = useState(false);   // crear la contraseña (solo si de verdad es la primera vez)
  const [waiting, setWaiting] = useState(false);       // entraste mientras tu PC recupera la cuenta
  const [noCopy, setNoCopy] = useState(false);         // tu PC no tenía copia de la cuenta: hay que crearla

  const check = () => authState().then((s) => {
    if (s.loggedIn) { setSt("ok"); return; }
    setSt(s);
    setEmail((e) => e || s.email);
  });

  useEffect(() => {
    if (!IN_PANEL) return;
    check().catch((e) => setFail(e.message));
  }, []);

  // Sin cuenta en el servidor: se mira cada 3 s si tu PC ya la ha devuelto
  const recovering = !!st && st !== "ok" && st.needsSetup;
  useEffect(() => {
    if (!recovering) return;
    const t = setInterval(() => { check().catch(() => {}); }, 3000);
    return () => clearInterval(t);
  }, [recovering]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tu PC no tiene copia de la cuenta (o no responde en 15 s): se pasa a crearla con lo que ya escribiste
  const giveUp = () => { setWaiting(false); setNoCopy(true); setFirstTime(true); setErr(""); };
  useEffect(() => {
    if (waiting && st && st !== "ok" && st.needsSetup && st.recover === "none") giveUp();
  }, [waiting, st]);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(giveUp, 15000);
    return () => clearTimeout(t);
  }, [waiting]);

  // Si pulsaste «Entrar» mientras tanto, se entra solo en cuanto vuelve la cuenta
  useEffect(() => {
    if (!waiting || !st || st === "ok" || st.needsSetup) return;
    setWaiting(false);
    setBusy(true);
    login(email, password, remember).then(() => setSt("ok")).catch((x) => setErr((x as Error).message)).finally(() => setBusy(false));
  }, [waiting, st]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!st || st === "ok") return;
    setErr("");
    const creating = st.needsSetup && firstTime;
    if (creating) {
      if (password.length < 8) return setErr("Usa al menos 8 caracteres.");
      if (password !== repeat) return setErr("Las dos contraseñas no coinciden.");
    }
    if (st.needsSetup && !creating) {
      if (st.recover === "none") { giveUp(); return; }
      setWaiting(true); return;
    }
    setBusy(true);
    try {
      if (creating) await setup(password, remember);
      else await login(email, password, remember);
      setSt("ok");
    } catch (x) {
      if (/primero crea/i.test((x as Error).message)) { setWaiting(true); check().catch(() => {}); }
      else setErr((x as Error).message);
    } finally { setBusy(false); }
  }

  if (st === "ok") return <App />;
  const creating = !!st && st.needsSetup && firstTime;
  return (
    <div className="gate">
      <form className="gate__card" onSubmit={submit}>
        <Logo />
        <h1>Pulso Studio</h1>
        {fail ? <p className="gate__err">{fail}</p> : !st ? <p className="muted">Comprobando tu acceso…</p> : (
          <>
            <p>{creating ? <>Crea la contraseña de <b>{st.email}</b>. Solo esta cuenta puede entrar.</> : "Entra con tu cuenta."}</p>
            {creating && noCopy && <p className="gate__wait">Tu PC no tenía copia de tu cuenta (se perdió antes de que existiera la copia). Repite la contraseña para crearla: <b>será la última vez</b>, a partir de ahora tu PC la guarda.</p>}
            <input className="input" type="email" autoComplete="username" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} readOnly={creating} required />
            <input className="input" type="password" autoComplete={creating ? "new-password" : "current-password"} placeholder={creating ? "Nueva contraseña" : "Contraseña"} value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
            {creating && <input className="input" type="password" autoComplete="new-password" placeholder="Repite la contraseña" value={repeat} onChange={(e) => setRepeat(e.target.value)} required autoFocus={noCopy} />}
            <label className="gate__remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Mantener la sesión iniciada</label>
            {err && <p className="gate__err">{err}</p>}
            {st.needsSetup && !creating && (waiting
              ? <p className="gate__wait">Tu PC está devolviendo tu cuenta al servidor. Entrarás solo en cuanto termine (unos segundos).</p>
              : <p className="gate__wait">El servidor se acaba de reiniciar: tu PC le devuelve tu cuenta. Entra con tu contraseña de siempre.</p>)}
            <button className="btn btn--primary" type="submit" disabled={busy || waiting}>{busy || waiting ? "Un momento…" : creating ? "Crear contraseña y entrar" : "Entrar"}</button>
            {st.needsSetup && (
              <button type="button" className="gate__link" onClick={() => { setFirstTime((v) => !v); setWaiting(false); setNoCopy(false); setErr(""); }}>
                {creating ? "Ya tengo cuenta: entrar" : "¿Es la primera vez que usas Pulso Studio? Crear contraseña"}
              </button>
            )}
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
