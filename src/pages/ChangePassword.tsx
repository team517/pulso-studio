// Cambiar la contraseña desde la web: la actual, la nueva dos veces, y sigues dentro.
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Field, Modal, useToast } from "../ui";

export default function ChangePassword({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setErr("");
    if (next.length < 8) return setErr("La contraseña nueva tiene que tener al menos 8 caracteres.");
    if (next !== repeat) return setErr("Las dos contraseñas nuevas no coinciden.");
    setBusy(true);
    try {
      const r = await fetch("/api/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current, password: next }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      toast("Contraseña cambiada. A partir de ahora entras con la nueva.");
      onClose();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }

  const type = show ? "text" : "password";
  return (
    <Modal title="Cambiar contraseña" icon={<KeyRound size={18} color="var(--accent-2)" />} onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn--primary" disabled={busy || !current || !next || !repeat} onClick={() => submit()}>{busy ? "Un momento…" : "Cambiar contraseña"}</button></>}>
      <form className="pw-form" onSubmit={submit}>
        <Field label="Contraseña actual">
          <input className="input" type={type} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </Field>
        <Field label="Contraseña nueva" hint="Mínimo 8 caracteres." right={
          <button type="button" className="btn btn--ghost btn--sm pw-eye" onClick={() => setShow((v) => !v)}>{show ? <EyeOff size={13} /> : <Eye size={13} />} {show ? "Ocultar" : "Ver"}</button>}>
          <input className="input" type={type} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Repite la contraseña nueva">
          <input className="input" type={type} autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </Field>
        {err && <p className="gate__err">{err}</p>}
        <p className="muted pw-note">Las demás sesiones abiertas (otros navegadores) se cierran; en este sigues dentro. ¿No recuerdas la actual? En tu PC, abre «Cambiar contraseña» en la carpeta de Pulso Studio.</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
