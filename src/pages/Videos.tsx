import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarPlus, Download, Film, Loader2, Trash2 } from "lucide-react";
import { api, fmtSize, fmtTime, type ExportJob } from "../api";
import { Modal, navigate, useToast } from "../ui";

export default function Videos() {
  const toast = useToast();
  const [list, setList] = useState<ExportJob[] | null>(null);
  const [play, setPlay] = useState<ExportJob | null>(null);
  const [del, setDel] = useState<ExportJob | null>(null);

  const load = useCallback(() => api.exports().then(setList).catch((e) => { setList([]); toast(e.message, "bad"); }), [toast]);
  useEffect(() => { load(); }, [load]);
  const running = list?.some((e) => e.status === "running" || e.status === "queued");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [running, load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Vídeos exportados</h1>
          <p>Los MP4 terminados. Descárgalos o programa cuándo se publican en Instagram, TikTok y YouTube.</p>
        </div>
      </div>

      {list === null ? <p className="muted">Cargando…</p> : list.length === 0 ? (
        <div className="empty">
          <div className="empty__icon"><Film size={24} /></div>
          <h3>Todavía no has exportado ningún vídeo</h3>
          <p>Abre un proyecto y pulsa «Exportar» arriba a la derecha.</p>
          <button className="btn btn--primary" onClick={() => navigate("/")}>Ir a proyectos</button>
        </div>
      ) : (
        <div className="cards">
          {list.map((e) => (
            <div key={e.id} className="pcard" onClick={() => e.status === "done" && setPlay(e)} style={{ cursor: e.status === "done" ? "pointer" : "default" }}>
              <div className="pcard__thumb" style={e.thumbUrl ? { backgroundImage: `url(${e.thumbUrl})`, backgroundSize: "contain", backgroundColor: "#000" } : undefined}>
                {e.status === "running" || e.status === "queued" ? <Loader2 className="spin" /> : e.status === "error" ? <AlertCircle color="var(--bad)" /> : !e.thumbUrl && <Film />}
                <span className="pcard__badge">
                  {e.status === "done" ? <span className="pill pill--ok">Listo</span> : e.status === "error" ? <span className="pill pill--bad">Error</span> : <span className="pill pill--info">Exportando {Math.round(e.progress * 100)} %</span>}
                </span>
              </div>
              <div className="pcard__menu" onClick={(ev) => ev.stopPropagation()}>
                {e.status === "done" && <a className="btn btn--icon btn--sm" title="Descargar" href={e.url!} download={`${e.name}.mp4`}><Download size={14} /></a>}
                {e.status !== "running" && <button className="btn btn--icon btn--sm btn--danger" title="Borrar" onClick={() => setDel(e)}><Trash2 size={14} /></button>}
              </div>
              <div className="pcard__body">
                <span className="pcard__name">{e.name}</span>
                {e.status === "running" || e.status === "queued" ? (
                  <div className="progress" style={{ marginTop: 6 }}><span style={{ width: `${Math.max(3, e.progress * 100)}%` }} /></div>
                ) : e.status === "error" ? (
                  <span className="pcard__meta" style={{ color: "var(--bad)" }} title={e.error ?? ""}>No se pudo exportar</span>
                ) : (
                  <>
                    <span className="pcard__meta"><span className="mono">{fmtTime(e.duration ?? 0)}</span>·<span>{e.width}×{e.height}</span>·<span>{fmtSize(e.size)}</span></span>
                    <button className="btn btn--sm" style={{ marginTop: 8 }} onClick={(ev) => { ev.stopPropagation(); navigate(`/calendario?nuevo=${e.id}`); }}><CalendarPlus size={14} /> Programar</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {play && (
        <Modal title={play.name} onClose={() => setPlay(null)}
          foot={<><a className="btn" href={play.url!} download={`${play.name}.mp4`}><Download size={15} /> Descargar</a><span className="spacer" /><button className="btn btn--primary" onClick={() => navigate(`/calendario?nuevo=${play.id}`)}><CalendarPlus size={15} /> Programar publicación</button></>}>
          <video src={play.url!} controls autoPlay style={{ width: "100%", maxHeight: "62vh", background: "#000", borderRadius: 10 }} />
        </Modal>
      )}
      {del && (
        <Modal title="Borrar vídeo" onClose={() => setDel(null)}
          foot={<><span className="spacer" /><button className="btn" onClick={() => setDel(null)}>Cancelar</button>
            <button className="btn btn--primary" style={{ background: "var(--bad)", borderColor: "var(--bad)" }} onClick={async () => {
              try { await api.deleteExport(del.id); load(); toast("Vídeo borrado"); } catch (err) { toast((err as Error).message, "bad"); }
              setDel(null);
            }}>Borrar</button></>}>
          <p style={{ margin: 0 }}>Se borrará el MP4 <b>{del.name}</b>. El proyecto se queda y lo puedes volver a exportar.</p>
        </Modal>
      )}
    </div>
  );
}
