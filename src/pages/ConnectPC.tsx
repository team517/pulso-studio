import { useEffect, useState } from "react";
import { CheckCircle2, Laptop, Loader2 } from "lucide-react";
import { navigate } from "../ui";

export type PairRequest = { code: string; name: string; at: number };

export async function approvePC(code: string) {
  const r = await fetch("/api/pc/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.error || "No se pudo conectar el PC");
  return d as { ok: true; name: string };
}

/** La página que abre el editor de tu PC: un clic y queda conectado. */
export default function ConnectPC() {
  const code = new URLSearchParams(location.search).get("code")?.toUpperCase() || "";
  const [req, setReq] = useState<PairRequest | null | undefined>(undefined);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/pc/pending").then((r) => r.json()).then((l: PairRequest[]) => setReq(l.find((x) => x.code === code) ?? null)).catch(() => setReq(null));
  }, [code]);

  async function go() {
    setState("busy"); setErr("");
    try { await approvePC(code); setState("done"); } catch (e) { setErr((e as Error).message); setState("idle"); }
  }

  return (
    <div className="page" style={{ maxWidth: 560 }}>
      <div className="pc-connect">
        {state === "done" ? (
          <>
            <CheckCircle2 size={40} color="var(--ok)" />
            <h1>PC conectado</h1>
            <p>Tu PC ya edita para Pulso Studio y guarda una copia de todo. No hará falta volver a hacerlo.</p>
            <button className="btn btn--primary" onClick={() => navigate("/autoedicion")}>Ir a Auto-edición</button>
          </>
        ) : req === undefined ? <Loader2 className="spin" /> : req === null ? (
          <>
            <Laptop size={40} />
            <h1>Este enlace ya no vale</h1>
            <p>El código {code ? <b className="mono">{code}</b> : null} ha caducado o ya se usó. Si tu PC sigue sin conectar, cierra la ventana «Editor Pulso Studio» y vuelve a abrirla: se abrirá un enlace nuevo.</p>
            <button className="btn" onClick={() => navigate("/autoedicion")}>Volver</button>
          </>
        ) : (
          <>
            <Laptop size={40} />
            <h1>Conectar este PC</h1>
            <p><b>{req.name}</b> quiere editar para tu Pulso Studio. Comprueba que el código coincide con el de la ventana «Editor Pulso Studio»:</p>
            <div className="pc-connect__code mono">{req.code}</div>
            {err && <div className="note note--bad">{err}</div>}
            <button className="btn btn--primary" style={{ height: 44, fontSize: 15 }} disabled={state === "busy"} onClick={go}>
              {state === "busy" ? <Loader2 size={16} className="spin" /> : <Laptop size={16} />} Conectar este PC
            </button>
          </>
        )}
      </div>
    </div>
  );
}
