import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clapperboard, Columns2, Film, Loader2, Plus, Rows2, Scissors, Sparkles, Upload, X } from "lucide-react";
import { api, fmtTime, type Media } from "../api";
import { autoApi } from "../autoedit-api";
import { Modal, useToast } from "../ui";

type RefChoice = { media?: string | null; asset?: string | null } | null;

/** Preguntas rápidas al subir un vídeo: ¿juntarlo con otro?, ¿vídeo completo o shorts?, formatos e indicaciones. */
export default function UploadWizard({ media, notes: notes0, refChoice, RefPicker, onClose, onStarted }: {
  media: Media; notes: string; refChoice: RefChoice;
  RefPicker: (p: { value: RefChoice; onChange: (v: RefChoice) => void }) => ReactNode;
  onClose: () => void; onStarted: () => void;
}) {
  const toast = useToast();
  const long = media.duration > 120;
  const [kind, setKind] = useState<"full" | "shorts">(long ? "shorts" : "full");
  const [shorts, setShorts] = useState<number | "auto">("auto");
  const [formats, setFormats] = useState<string[]>(["reference"]);
  const [notes, setNotes] = useState(notes0);
  const [ref, setRef] = useState<RefChoice>(refChoice);
  const [join, setJoin] = useState(false);
  const [other, setOther] = useState<Media | null>(null);
  const [layout, setLayout] = useState<"stack" | "side">("stack");
  const [audio, setAudio] = useState<"auto" | "a" | "b" | "mix">("auto");
  const [library, setLibrary] = useState<Media[]>([]);
  const [busy, setBusy] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { api.media().then((l) => setLibrary(l.filter((m) => m.kind === "video" && m.id !== media.id))).catch(() => {}); }, [media.id]);

  async function uploadOther(files: File[]) {
    if (!files.length) return;
    setBusy("Subiendo el otro vídeo…");
    try {
      const up = await api.upload(files);
      const v = up.find((m) => m.kind === "video");
      if (v) { setOther(v); setLibrary((l) => [v, ...l]); }
      else toast("Ese archivo no es un vídeo.", "bad");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(""); }
  }

  async function start() {
    try {
      let target = media;
      if (join && other) {
        setBusy("Juntando los dos vídeos…");
        target = await api.compose({ a: media.id, b: other.id, layout, audio, auto: false, folder: null });
      }
      setBusy("Empezando la edición…");
      const isShorts = kind === "shorts";
      await autoApi.create({
        mediaId: target.id, kind: isShorts ? "shorts" : "variants",
        variants: isShorts ? undefined : formats, shorts, notes, ref,
      });
      toast(isShorts ? "Claude está buscando los mejores momentos para los shorts" : "Editando tu vídeo completo");
      onStarted();
    } catch (e) { toast((e as Error).message, "bad"); setBusy(""); }
  }

  const FORMATS: [string, string][] = [["reference", "Reel 9:16"], ["headline", "Reel con titular"], ["framed", "4:5 (feed)"], ["horizontal", "Horizontal 16:9"], ["minimal", "Minimal"]];
  const Option = ({ on, onClick, icon, title, text }: { on: boolean; onClick: () => void; icon: ReactNode; title: string; text: string }) => (
    <button type="button" className={"uw-opt" + (on ? " is-on" : "")} onClick={onClick}>
      <span className="uw-opt__ic">{icon}</span><b>{title}</b><small>{text}</small>
    </button>
  );

  return (
    <Modal wide title="¿Qué hacemos con este vídeo?" icon={<Sparkles size={18} color="var(--accent-2)" />} onClose={busy ? () => {} : onClose}
      foot={<><span className="muted" style={{ fontSize: 12.5 }}>{media.name} · {fmtTime(media.duration)}</span><span className="spacer" />
        <button className="btn" onClick={onClose} disabled={!!busy}>Ahora no</button>
        <button className="btn btn--primary" onClick={start} disabled={!!busy || (join && !other) || (kind === "full" && !formats.length)}>
          {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {busy || "Empezar"}</button></>}>
      <div className="uw">
        <section>
          <h4>1 · ¿Lo juntas con otro vídeo?</h4>
          <div className="uw-row">
            <Option on={!join} onClick={() => setJoin(false)} icon={<Film size={20} />} title="Solo este" text="Edito este vídeo tal cual" />
            <Option on={join} onClick={() => setJoin(true)} icon={<Plus size={20} />} title="Juntar con otro" text="Uno arriba y otro abajo, o lado a lado" />
          </div>
          {join && (
            <div className="uw-join">
              <div className="uw-row">
                <Option on={layout === "stack"} onClick={() => setLayout("stack")} icon={<Rows2 size={18} />} title="Arriba y abajo" text="Reel 9:16" />
                <Option on={layout === "side"} onClick={() => setLayout("side")} icon={<Columns2 size={18} />} title="Lado a lado" text="Horizontal 16:9" />
              </div>
              <div className="uw-pick">
                <button type="button" className="uw-thumb uw-thumb--up" onClick={() => input.current?.click()}><Upload size={18} /><span>Subir otro</span></button>
                <input ref={input} type="file" accept="video/*" hidden onChange={(e) => { uploadOther([...(e.target.files ?? [])]); e.target.value = ""; }} />
                {library.map((m) => (
                  <button key={m.id} type="button" className={"uw-thumb" + (other?.id === m.id ? " is-on" : "")} title={m.name} onClick={() => setOther(m)}
                    style={m.thumbUrl ? { backgroundImage: `url(${m.thumbUrl})` } : undefined}><span>{m.name}</span></button>
                ))}
              </div>
              <div className="seg">
                {([["auto", "Voz: automático"], ["a", "Solo la de este"], ["b", "Solo la del otro"], ["mix", "Las dos"]] as const).map(([k, l]) => (
                  <button key={k} type="button" className={audio === k ? "is-on" : ""} onClick={() => setAudio(k)}>{l}</button>
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <h4>2 · ¿Vídeo completo o shorts?</h4>
          <div className="uw-row">
            <Option on={kind === "full"} onClick={() => setKind("full")} icon={<Clapperboard size={20} />} title="Vídeo completo" text="Todo el vídeo editado, de principio a fin" />
            <Option on={kind === "shorts"} onClick={() => setKind("shorts")} icon={<Scissors size={20} />} title="Shorts" text="Claude elige los mejores momentos y edita cada uno" />
          </div>
          {kind === "full" ? (
            <div className="uw-chips"><span>Formatos:</span>
              {FORMATS.map(([k, l]) => (
                <button key={k} type="button" className={"pill" + (formats.includes(k) ? " pill--accent" : "")} onClick={() => setFormats((f) => (f.includes(k) ? f.filter((x) => x !== k) : [...f, k]))}>{l}</button>
              ))}
            </div>
          ) : (
            <div className="uw-chips"><span>¿Cuántos?</span>
              {(["auto", 3, 5, 10] as const).map((n) => (
                <button key={String(n)} type="button" className={"pill" + (shorts === n ? " pill--accent" : "")} onClick={() => setShorts(n)}>{n === "auto" ? "Los que den de sí" : n}</button>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4>3 · ¿Cómo lo quieres? <small>(opcional)</small></h4>
          <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Ej.: ritmo rápido, una animación a pantalla completa con los 3 pasos, sin gráficos al principio…" />
          <div className="uw-ref"><span>Vídeo de referencia (mismos colores y estilo):</span>{RefPicker({ value: ref, onChange: setRef })}</div>
        </section>
      </div>
      {busy && <div className="uw-busy"><Loader2 size={16} className="spin" /> {busy}</div>}
      <button type="button" className="uw-x" onClick={onClose} aria-label="Cerrar" hidden><X size={14} /></button>
    </Modal>
  );
}
