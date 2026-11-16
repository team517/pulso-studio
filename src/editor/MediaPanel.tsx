// Biblioteca dentro del editor: subir archivos y añadirlos al vídeo.
import { useRef, useState } from "react";
import { FileAudio, Image as ImageIcon, Loader2, Music2, Plus, Upload } from "lucide-react";
import { api, fmtTime, type Media, type MediaKind } from "../api";
import { useToast } from "../ui";

export const ACCEPT = "video/*,audio/*,image/jpeg,image/png,image/webp";

export function useUploader(onDone: (m: Media[]) => void, { auto = false }: { auto?: boolean } = {}) {
  const toast = useToast();
  const [busy, setBusy] = useState(0);
  async function upload(files: File[]) {
    if (!files.length) return;
    setBusy(files.length);
    try {
      const out = await api.upload(files, { auto });
      if (out.length < files.length) toast(`${files.length - out.length} archivo(s) no se pudieron leer (¿formato raro?).`, "bad");
      const editing = out.filter((m) => m.autoeditJob).length;
      if (editing) toast(editing === 1 ? `«${out.find((m) => m.autoeditJob)!.name}» subido: ya se está editando solo` : `${editing} vídeos subidos: ya se están editando solos`);
      else if (out.length) toast(out.length === 1 ? `«${out[0].name}» subido` : `${out.length} archivos subidos`);
      onDone(out);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setBusy(0);
    }
  }
  return { upload, busy };
}

export default function MediaPanel({ media, onUploaded, onAdd, onMusic }: {
  media: Media[]; onUploaded: (m: Media[]) => void; onAdd: (m: Media) => void; onMusic: (m: Media) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<MediaKind | "all">("all");
  const [over, setOver] = useState(false);
  const { upload, busy } = useUploader(onUploaded);
  const list = media.filter((m) => tab === "all" || m.kind === tab);

  return (
    <div className={"mp" + (over ? " is-over" : "")}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}>
      <div className="mp__head">
        <b>Biblioteca</b>
        <button className="btn btn--sm btn--primary" onClick={() => input.current?.click()} disabled={!!busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} {busy ? "Subiendo…" : "Subir"}
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      <div className="seg mp__tabs">
        {([["all", "Todo"], ["video", "Vídeo"], ["audio", "Audio"], ["image", "Imágenes"]] as const).map(([k, l]) => (
          <button key={k} className={tab === k ? "is-on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="mp__list">
        {list.length === 0 && (
          <button className="mp__drop" onClick={() => input.current?.click()}>
            <Upload size={22} />
            <span>Arrastra aquí tus vídeos, audios o imágenes</span>
            <small>o pulsa para elegirlos</small>
          </button>
        )}
        {list.map((m) => (
          <div key={m.id} className="mp-item" draggable onDragStart={(e) => e.dataTransfer.setData("application/x-media", m.id)}
            onDoubleClick={() => (m.kind === "audio" ? onMusic(m) : onAdd(m))} title={m.name}>
            <div className="mp-item__thumb" style={m.thumbUrl ? { backgroundImage: `url(${m.thumbUrl})` } : undefined}>
              {m.kind === "audio" && <FileAudio size={22} />}
              {m.kind === "image" && !m.thumbUrl && <ImageIcon size={22} />}
              {m.kind !== "image" && <span className="mp-item__dur mono">{fmtTime(m.duration)}</span>}
              <button className="mp-item__add" title={m.kind === "audio" ? "Usar como música" : "Añadir al final"}
                onClick={(e) => { e.stopPropagation(); m.kind === "audio" ? onMusic(m) : onAdd(m); }}>
                {m.kind === "audio" ? <Music2 size={14} /> : <Plus size={15} />}
              </button>
            </div>
            <span className="mp-item__name">{m.name}</span>
          </div>
        ))}
      </div>
      {over && <div className="mp__overlay"><Upload size={26} /> Suelta para subir</div>}
    </div>
  );
}
