// Piezas de interfaz compartidas: modal, avisos, interruptor y navegación.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

/* ---------- Navegación sencilla con la URL ---------- */

export function usePath(): [string, (to: string, replace?: boolean) => void] {
  const [path, setPath] = useState(window.location.pathname + window.location.search);
  useEffect(() => {
    const on = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", on);
    window.addEventListener("app:navigate", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("app:navigate", on);
    };
  }, []);
  return [path, navigate];
}

export function navigate(to: string, replace = false) {
  if (to === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.dispatchEvent(new Event("app:navigate"));
}

/* ---------- Avisos ---------- */

type Toast = { id: number; tone: "ok" | "bad" | "info"; text: string };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, tone, text }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), tone === "bad" ? 7000 : 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={"toast toast--" + t.tone}>
            {t.tone === "ok" ? <CheckCircle2 size={18} color="var(--ok)" /> : t.tone === "bad" ? <AlertCircle size={18} color="var(--bad)" /> : <Info size={18} color="var(--info)" />}
            <span style={{ flex: 1 }}>{t.text}</span>
            <button className="btn btn--ghost btn--icon btn--sm" style={{ width: 22, height: 22 }} onClick={() => setList((l) => l.filter((x) => x.id !== t.id))} aria-label="Cerrar"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Modal ---------- */

export function Modal({ title, icon, onClose, children, foot, wide }: {
  title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__scrim" onClick={onClose} />
      <div className={"modal__panel" + (wide ? " modal__panel--wide" : "")}>
        <div className="modal__head">
          {icon}
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="modal__body">{children}</div>
        {foot && <div className="modal__foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
      {label}
    </label>
  );
}

export function Field({ label, hint, children, right }: { label: ReactNode; hint?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="field">
      <span className="field__label"><span>{label}</span>{right}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

/** Repite una función cada `ms` mientras `active` sea true. */
export function usePoll(fn: () => void, ms: number, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const t = setInterval(fn, ms);
    return () => clearInterval(t);
  }, [fn, ms, active]);
}
