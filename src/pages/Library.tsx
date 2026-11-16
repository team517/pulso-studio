import { useEffect, useRef, useState } from "react";
import { Captions, FileAudio, Folder as FolderIcon, FolderPlus, Image as ImageIcon, Loader2, Pencil, Rows2, Trash2, Upload } from "lucide-react";
import { api, fmtSize, fmtTime, type Folder, type Media } from "../api";
import { IN_PANEL } from "../base";
import { Modal, useToast } from "../ui";
import { ACCEPT, useUploader } from "../editor/MediaPanel";
import JoinVideos from "./JoinVideos";

const ALL = "__all", NONE = "__none";
const readView = () => { try { return localStorage.getItem("ps:folder") || ALL; } catch { return ALL; } };

export default function Library() {
  const toast = useToast();
  const [list, setList] = useState<Media[] | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [view, setViewRaw] = useState<string>(readView);
  const [del, setDel] = useState<Media | null>(null);
  const [over, setOver] = useState(false);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [nameModal, setNameModal] = useState<{ folder?: Folder } | null>(null);
  const [delFolder, setDelFolder] = useState<Folder | null>(null);
  const [joining, setJoining] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFolder = view !== ALL && view !== NONE ? view : null;
  const { upload, busy } = useUploader((m) => { setList((l) => [...m, ...(l ?? [])]); loadFolders(); }, { auto: true, folder: inFolder });

  const setView = (v: string) => { setViewRaw(v); try { localStorage.setItem("ps:folder", v); } catch { /* sin almacenamiento */ } };
  const load = () => api.media().then(setList).catch((e) => { setList([]); toast(e.message, "bad"); });
  const loadFolders = () => api.folders().then((f) => {
    setFolders(f);
    setViewRaw((v) => (v === ALL || v === NONE || f.some((x) => x.id === v) ? v : ALL));
  }).catch(() => {});
  useEffect(() => { load(); loadFolders(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Si algo se está transcribiendo, se refresca solo
  const running = list?.some((m) => m.transcript_status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function move(m: Media, folder: string | null) {
    if ((m.folder_id ?? null) === folder) return;
    try {
      await api.moveMedia(m.id, folder);
      setList((l) => l?.map((x) => (x.id === m.id ? { ...x, folder_id: folder } : x)) ?? null);
      loadFolders();
      toast(folder ? `«${m.name}» → ${folders.find((f) => f.id === folder)?.name}` : `«${m.name}» sin carpeta`);
    } catch (e) { toast((e as Error).message, "bad"); }
  }

  const shown = (list ?? []).filter((m) => view === ALL || (view === NONE ? !m.folder_id : m.folder_id === view));
  const loose = (list ?? []).filter((m) => !m.folder_id).length;
  const current = folders.find((f) => f.id === view);

  const chip = (id: string, label: string, count: number, icon?: boolean) => (
    <button key={id} className={"lib-folder" + (view === id ? " is-on" : "") + (dropOn === id ? " is-drop" : "")}
      onClick={() => setView(id)}
      onDragOver={(e) => { if (id !== ALL && e.dataTransfer.types.includes("text/x-media")) { e.preventDefault(); setDropOn(id); } }}
      onDragLeave={() => setDropOn(null)}
      onDrop={(e) => {
        const mid = e.dataTransfer.getData("text/x-media");
        setDropOn(null);
        const m = list?.find((x) => x.id === mid);
        if (m && id !== ALL) { e.preventDefault(); e.stopPropagation(); move(m, id === NONE ? null : id); }
      }}>
      {icon && <FolderIcon size={14} />} {label} <span className="lib-folder__n">{count}</span>
    </button>
  );

  return (
    <div className="page"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setOver(false); upload([...e.dataTransfer.files]); }}>
      <div className="page-head">
        <div>
          <h1>Biblioteca</h1>
          <p>{IN_PANEL
            ? "Tus tomas de vídeo, música e imágenes, ordenadas en carpetas. Se guardan en el servidor y tu PC guarda una copia de todo."
            : <>Todo lo que subes: tomas de vídeo, música e imágenes. Se guarda en tu ordenador, en la carpeta <span className="mono">data/</span> del proyecto.</>}</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => setNameModal({})}><FolderPlus size={16} /> Nueva carpeta</button>
          <button className="btn" disabled={(list ?? []).filter((m) => m.kind === "video").length < 2} title="Arriba y abajo (reel) o lado a lado (horizontal)" onClick={() => setJoining(true)}><Rows2 size={16} /> Juntar dos vídeos</button>
          <button className="btn btn--primary" onClick={() => input.current?.click()} disabled={!!busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Upload size={16} />} {busy ? `Subiendo ${busy}…` : current ? `Subir a «${current.name}»` : "Subir archivos"}
          </button>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>
      </div>

      <div className="lib-folders">
        {chip(ALL, "Todo", list?.length ?? 0)}
        {folders.map((f) => chip(f.id, f.name, f.count, true))}
        {folders.length > 0 && chip(NONE, "Sin carpeta", loose)}
        {current && (
          <span className="lib-folders__tools">
            <button className="btn btn--ghost btn--sm" onClick={() => setNameModal({ folder: current })}><Pencil size={13} /> Renombrar</button>
            <button className="btn btn--ghost btn--sm" onClick={() => setDelFolder(current)}><Trash2 size={13} /> Borrar carpeta</button>
          </span>
        )}
      </div>
      {folders.length > 0 && list && list.length > 0 && <p className="muted" style={{ margin: "-6px 0 14px", fontSize: 12.5 }}>Arrastra un vídeo encima de una carpeta para moverlo, o usa el menú de cada vídeo.</p>}

      {over && <div className="note" style={{ marginBottom: 16, borderStyle: "dashed", borderColor: "var(--accent)" }}>Suelta los archivos para subirlos{current ? ` a «${current.name}»` : ""}</div>}

      {list === null ? <p className="muted">Cargando…</p> : shown.length === 0 ? (
        <div className="empty">
          <div className="empty__icon">{current ? <FolderIcon size={24} /> : <Upload size={24} />}</div>
          <h3>{current ? `«${current.name}» está vacía` : list.length === 0 ? "Aún no hay nada" : "Aquí no hay nada"}</h3>
          <p>{current ? "Sube vídeos aquí o arrastra encima de la carpeta los que ya tienes." : "Arrastra aquí tus vídeos (MP4, MOV…), canciones (MP3, WAV…) o imágenes, o pulsa «Subir archivos»."}</p>
          <button className="btn btn--primary" onClick={() => input.current?.click()}><Upload size={16} /> {current ? `Subir a «${current.name}»` : "Subir archivos"}</button>
        </div>
      ) : (
        <div className="cards">
          {shown.map((m) => (
            <div key={m.id} className="pcard" style={{ cursor: "grab" }} draggable
              onDragStart={(e) => { e.dataTransfer.setData("text/x-media", m.id); e.dataTransfer.effectAllowed = "move"; }}>
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
                {folders.length > 0 && (
                  <label className="lib-move">
                    <FolderIcon size={13} />
                    <select value={m.folder_id ?? ""} onChange={(e) => move(m, e.target.value || null)}>
                      <option value="">Sin carpeta</option>
                      {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {joining && <JoinVideos videos={(list ?? []).filter((m) => m.kind === "video")} folder={inFolder} onClose={() => setJoining(false)} onDone={(m) => { setJoining(false); setList((l) => [m, ...(l ?? [])]); loadFolders(); }} />}

      {nameModal && <FolderName folder={nameModal.folder} onClose={() => setNameModal(null)} onSaved={(f) => {
        setNameModal(null);
        loadFolders();
        if (f) setView(f.id);
      }} />}

      {delFolder && (
        <Modal title="Borrar carpeta" onClose={() => setDelFolder(null)}
          foot={<><span className="spacer" /><button className="btn" onClick={() => setDelFolder(null)}>Cancelar</button>
            <button className="btn btn--primary" style={{ background: "var(--bad)", borderColor: "var(--bad)" }} onClick={async () => {
              try {
                await api.deleteFolder(delFolder.id);
                setList((l) => l?.map((x) => (x.folder_id === delFolder.id ? { ...x, folder_id: null } : x)) ?? null);
                setView(ALL); loadFolders(); toast("Carpeta borrada");
              } catch (e) { toast((e as Error).message, "bad"); }
              setDelFolder(null);
            }}>Borrar carpeta</button></>}>
          <p style={{ margin: 0 }}>Se borra la carpeta <b>{delFolder.name}</b>. Sus {delFolder.count} archivos <b>no se borran</b>: pasan a «Sin carpeta».</p>
        </Modal>
      )}

      {del && (
        <Modal title="Borrar archivo" onClose={() => setDel(null)}
          foot={<><span className="spacer" /><button className="btn" onClick={() => setDel(null)}>Cancelar</button>
            <button className="btn btn--primary" style={{ background: "var(--bad)", borderColor: "var(--bad)" }} onClick={async () => {
              try { await api.deleteMedia(del.id); setList((l) => l?.filter((x) => x.id !== del.id) ?? null); loadFolders(); toast("Archivo borrado"); } catch (e) { toast((e as Error).message, "bad"); }
              setDel(null);
            }}>Borrar</button></>}>
          <p style={{ margin: 0 }}>Se borrará <b>{del.name}</b>{IN_PANEL ? " del servidor y de la copia de tu PC" : " de tu ordenador"}. Si algún proyecto lo usa, ese clip aparecerá vacío. Los vídeos ya exportados no se tocan.</p>
        </Modal>
      )}
    </div>
  );
}

function FolderName({ folder, onClose, onSaved }: { folder?: Folder; onClose: () => void; onSaved: (f?: Folder) => void }) {
  const toast = useToast();
  const [name, setName] = useState(folder?.name ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (folder) { await api.renameFolder(folder.id, name.trim()); onSaved(); }
      else onSaved(await api.createFolder(name.trim()));
    } catch (e) { toast((e as Error).message, "bad"); setBusy(false); }
  }
  return (
    <Modal title={folder ? "Renombrar carpeta" : "Nueva carpeta"} icon={<FolderPlus size={16} />} onClose={onClose}
      foot={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn--primary" disabled={!name.trim() || busy} onClick={save}>{folder ? "Guardar" : "Crear carpeta"}</button></>}>
      <input className="input" autoFocus value={name} placeholder="Por ejemplo: Tomas de noviembre" maxLength={80}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} style={{ width: "100%" }} />
    </Modal>
  );
}
