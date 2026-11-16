import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./editor/editor.css";
import App from "./App";
import { ToastProvider } from "./ui";
import { IN_PANEL, NoAccess, installFetch, startSession } from "./base";

installFetch();

/** Dentro del panel: primero se comprueba que eres administrador. */
function Gate() {
  const [state, setState] = useState<"checking" | "ok" | NoAccess>(IN_PANEL ? "checking" : "ok");
  useEffect(() => {
    if (!IN_PANEL) return;
    startSession().then(() => setState("ok")).catch((e) => setState(e instanceof NoAccess ? e : new NoAccess(String(e?.message || e), "error")));
  }, []);
  if (state === "ok") return <App />;
  return (
    <div className="gate">
      <div className="gate__card">
        <span className="brand__logo"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5.5v13l11-6.5z" fill="#fff" /></svg></span>
        <h1>Pulso Studio</h1>
        {state === "checking" ? <p className="muted">Comprobando tu acceso…</p> : (
          <>
            <p>{state.message}</p>
            {state.kind !== "forbidden" && <a className="btn btn--primary" href="/panel/studio" target="_top">Ir al panel</a>}
          </>
        )}
      </div>
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
