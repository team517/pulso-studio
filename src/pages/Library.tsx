import { useEffect, useRef, useState } from "react";
import { Captions, FileAudio, Image as ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { api, fmtSize, fmtTime, type Media } from "../api";
import { Modal, useToast } from "../ui";
import { ACCEPT, useUploader } from "../editor/MediaPanel";

export default function Library() {
  const toast = useToast();
  const [list, setList] = useState<Media[] | null>(null);
  const [del, setDel] = useState<Media | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { upload, busy } = useUploader((m) => setList((l) => [...m, ...(l ?? [])]), { auto: true });

  const load = () => api.media().then(setList).catch((e) => { setList([]); toast(e.message, "bad"); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Si algo se está transcribiendo, se refresca solo
  const running = list?.some((m) => m.transcript_status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}>
      <div className="page-head">
        <div>
          <h1>Biblioteca</h1>
          <p>Todo lo que subes: tomas de vídeo, música e imágenes. Se guarda en tu ordenador, en la carpeta <span className="mono">data/</span> del proyecto.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => input.current?.click()} disabled={!!busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} {busy ? `Subiendo ${busy}…` : "Subir archivos"}
          </button>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
      </div>

      {over && <div className="note" style={{ marginBottom: 16, borderStyle: "dashed", borderColor: "var(--accent)" }}>Suelta los archivos para subirlos</div>}

      {list === null ? <p className="muted">Cargando…</p> : list.length === 0 ? (
        <div className="empty">
          <div className="empty__icon"><Upload size={24} /></div>
          <h3>Aún no hay nada</h3>
          <p>Arrastra aquí tus vídeos (MP4, MOV…), canciones (MP3, WAV…) o imágenes, o pulsa «Subir archivos».</p>
          <button className="btn btn--primary" onClick={() => input.current?.click()}><Upload size={16} /> Subir archivos</button>
        </div>
      ) : (
        <div className="cards">
          {list.map((m) => (
            <div key={m.id} className="pcard" style={{ cursor: "default" }}>
              <div className="pcard__thumb" style={m.thumbUrl ? { backgroundImage: `url(${m.thumbUrl})` } : undefined}>
                {m.kind === "audio" && <FileAudio size={30} />}
                {m.kind === "image" && !m.thumbUrl && <ImageIcon size={30} />}
                <span className="pcard__badge pill">{m.kind === "video" ? "Vídeo" : m.kind === "audio" ? "Audio" : "Imagen"}</span>
              </div>
              <div className="pcard__menu">
                <button className="btn btn--icon btn--sm btn--danger" title="Borrar" onClick={() => setDel(m)}><Trash2 size={14} /></button>
              </div>
              <div className="pcard__body">
                <span className="pcard__name" title={m.name}>{m.name}</span>
                <span className="pcard__meta">
                  {m.kind !== "image" && <span className="mono">{fmtTime(m.duration)}</span>}
                  {m.width && <span>{m.width}×{m.height}</span>}
                  <span>{fmtSize(m.size)}</span>
                </span>
                {m.kind === "video" && m.has_audio && (
                  <span className="pcard__meta">
                    <Captions size={13} />
                    {m.transcript_status === "done" ? <span style={{ color: "var(--ok)" }}>Voz transcrita · {m.transcript?.length ?? 0} palabras</span>
                      : m.transcript_status === "running" ? <span><Loader2 size={12} className="spin" /> Transcribiendo…</span>
                      : m.transcript_status?.startsWith("error") ? <span style={{ color: "var(--bad)" }}>Error al transcribir</span>
                      : <button className="btn btn--ghost btn--sm" style={{ height: 22, padding: "0 6px" }} onClick={async () => { await api.transcribe(m.id); load(); }}>Transcribir la voz</button>}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {del && (
        <Modal title="Borrar archivo" onClose={() => setDel(null)}
          foot={<><span className="spacer" /><button className="btn" onClick={() => setDel(null)}>Cancelar</button>
            <button className="btn btn--primary" style={{ background: "var(--bad)", borderColor: "var(--bad)" }} onClick={async () => {
              try { await api.deleteMedia(del.id); setList((l) => l?.filter((x) => x.id !== del.id) ?? null); toast("Archivo borrado"); } catch (e) { toast((e as Error).message, "bad"); }
              setDel(null);
            }}>Borrar</button></>}>
          <p style={{ margin: 0 }}>Se borrará <b>{del.name}</b> de tu ordenador. Si algún proyecto lo usa, ese clip aparecerá vacío. Los vídeos ya exportados no se tocan.</p>
        </Modal>
      )}
    </div>
  );
}
