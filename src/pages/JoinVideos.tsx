import { useState } from "react";
import { Columns2, Loader2, Rows2 } from "lucide-react";
import { api, type Media } from "../api";
import { Modal, useToast } from "../ui";

/** Juntar dos vídeos: arriba y abajo (reel) o lado a lado (horizontal), con vista previa. */
export default function JoinVideos({ videos, folder, onClose, onDone }: { videos: Media[]; folder?: string | null; onClose: () => void; onDone: (m: Media) => void }) {
  const toast = useToast();
  const [a, setA] = useState<string>(videos[0]?.id ?? "");
  const [b, setB] = useState<string>(videos[1]?.id ?? "");
  const [layout, setLayout] = useState<"stack" | "side">("stack");
  const [audio, setAudio] = useState<"a" | "b" | "mix">("a");
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const A = videos.find((v) => v.id === a), B = videos.find((v) => v.id === b);
  const first = layout === "stack" ? "de arriba" : "de la izquierda", second = layout === "stack" ? "de abajo" : "de la derecha";

  async function go() {
    if (!A || !B || a === b) return toast("Elige dos vídeos distintos.", "bad");
    setBusy(true);
    try {
      const m = await api.compose({ a, b, layout, audio, auto, folder: folder ?? null });
      toast(m.autoeditJob ? "Vídeo junto: ya se está editando solo" : "Vídeo junto guardado en la Biblioteca");
      onDone(m);
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }

  const Pick = ({ value, onPick, label }: { value: string; onPick: (id: string) => void; label: string }) => (
    <div className="jv-pick">
      <span className="field__label">{label}</span>
      <div className="jv-list">
        {videos.map((v) => (
          <button key={v.id} type="button" className={"jv-thumb" + (value === v.id ? " is-on" : "")} title={v.name} onClick={() => onPick(v.id)}
            style={v.thumbUrl ? { backgroundImage: `url(${v.thumbUrl})` } : undefined}>
            <span>{v.name}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Modal wide title="Juntar dos vídeos" icon={layout === "stack" ? <Rows2 size={18} /> : <Columns2 size={18} />} onClose={onClose}
      foot={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn--primary" disabled={busy || !A || !B || a === b} onClick={go}>{busy ? <Loader2 size={15} className="spin" /> : layout === "stack" ? <Rows2 size={15} /> : <Columns2 size={15} />} {busy ? "Juntando… (unos segundos)" : "Juntar"}</button></>}>
      <div className="jv">
        <div className="jv-form">
          <div className="seg">
            <button type="button" className={layout === "stack" ? "is-on" : ""} onClick={() => setLayout("stack")}><Rows2 size={13} /> Arriba y abajo (reel)</button>
            <button type="button" className={layout === "side" ? "is-on" : ""} onClick={() => setLayout("side")}><Columns2 size={13} /> Lado a lado (horizontal)</button>
          </div>
          <Pick value={a} onPick={setA} label={`Vídeo ${first}`} />
          <Pick value={b} onPick={setB} label={`Vídeo ${second}`} />
          <label className="field"><span className="field__label">Sonido</span>
            <div className="seg">
              <button type="button" className={audio === "a" ? "is-on" : ""} onClick={() => setAudio("a")}>La voz {first}</button>
              <button type="button" className={audio === "b" ? "is-on" : ""} onClick={() => setAudio("b")}>La {second}</button>
              <button type="button" className={audio === "mix" ? "is-on" : ""} onClick={() => setAudio("mix")}>Las dos</button>
            </div>
          </label>
          <label className="jv-auto"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Editarlo solo al terminar (subtítulos en la línea del medio, sin tapar caras)</label>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>Dura lo que el vídeo más corto. Cada vídeo llena su mitad sin deformarse.</p>
        </div>
        <div className={"jv-preview jv-preview--" + layout}>
          <div style={A?.thumbUrl ? { backgroundImage: `url(${A.thumbUrl})` } : undefined} />
          <div style={B?.thumbUrl ? { backgroundImage: `url(${B.thumbUrl})` } : undefined} />
          {layout === "stack" && <span className="jv-cap">así van los subtítulos</span>}
        </div>
      </div>
    </Modal>
  );
}
