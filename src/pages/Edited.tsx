// Editados: todos los vídeos que ha sacado la auto-edición, organizados por meses.
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, Download, FlaskConical, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { fmtTime } from "../api";
import { autoApi, setPrefill } from "../autoedit-api";
import { Modal, navigate, useToast } from "../ui";
import "./autoedit.css";

type EditedItem = {
  id: string; jobId: string; label: string; layout: string; review: "pending" | "approved" | "rejected";
  qa: { checked: boolean; ok: boolean | null; issues: unknown[] } | null;
  post: { caption?: string; youtubeTitle?: string } | null; short: { title: string } | null;
  topic: string; kind: "variants" | "shorts"; createdAt: string;
  video: { id: string; name: string; url: string; thumbUrl: string | null; duration: number; width: number; height: number };
  posts: { id: string; status: string; scheduled_at: string; platforms: string[] }[];
};

const FILTERS = [["all", "Todos"], ["pending", "Por revisar"], ["approved", "Aprobados"], ["published", "Publicados"], ["rejected", "Descartados"]] as const;
type Filter = (typeof FILTERS)[number][0];
const ratio = (l: string) => (l === "horizontal" ? "16 / 9" : l === "framed" ? "4 / 5" : "9 / 16");

export default function Edited() {
  const toast = useToast();
  const [list, setList] = useState<EditedItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [play, setPlay] = useState<EditedItem | null>(null);

  const load = useCallback(() => fetch("/api/autoedit/library").then((r) => r.json()).then(setList).catch((e) => { setList([]); toast(String(e), "bad"); }), [toast]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (list ?? []).filter((it) => {
    const published = it.posts.some((p) => p.status === "published" || p.status === "partial");
    if (filter === "pending" && it.review !== "pending") return false;
    if (filter === "approved" && it.review !== "approved") return false;
    if (filter === "rejected" && it.review !== "rejected") return false;
    if (filter === "published" && !published) return false;
    if (filter === "all" && it.review === "rejected") return false;
    const n = q.trim().toLowerCase();
    return !n || `${it.topic} ${it.label} ${it.short?.title ?? ""}`.toLowerCase().includes(n);
  }), [list, filter, q]);

  // Por meses (lo más nuevo arriba)
  const months = useMemo(() => {
    const map = new Map<string, EditedItem[]>();
    for (const it of shown) {
      const d = new Date(it.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [shown]);

  const counts = useMemo(() => ({
    pending: (list ?? []).filter((i) => i.review === "pending").length,
  }), [list]);

  const review = async (it: EditedItem, r: EditedItem["review"]) => { await autoApi.review(it.id, r); load(); };
  const schedule = (it: EditedItem, trial: boolean) => {
    setPrefill({ exportId: it.video.id, caption: it.post?.caption, title: it.post?.youtubeTitle, trial });
    navigate(`/calendario?nuevo=${it.video.id}`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Editados</h1>
          <p>Todo lo que ha editado la auto-edición, por meses. Revísalo, apruébalo y prográmalo desde aquí.{counts.pending > 0 && <> Tienes <b>{counts.pending}</b> por revisar.</>}</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => navigate("/autoedicion")}><Sparkles size={16} /> Editar un vídeo</button>
        </div>
      </div>

      <div className="ed-filters">
        <div className="seg">{FILTERS.map(([k, l]) => <button key={k} className={filter === k ? "is-on" : ""} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <label className="ed-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por tema…" /></label>
      </div>

      {list === null ? <p className="muted">Cargando…</p> : months.length === 0 ? (
        <div className="empty">
          <div className="empty__icon"><Sparkles size={24} /></div>
          <h3>{list.length ? "Nada con este filtro" : "Todavía no hay vídeos editados"}</h3>
          <p>Sube un vídeo en el que hables a cámara y la auto-edición te dará varias versiones listas para publicar.</p>
          <button className="btn btn--primary" onClick={() => navigate("/autoedicion")}><Sparkles size={16} /> Editar un vídeo</button>
        </div>
      ) : months.map(([key, items]) => (
        <section key={key} className="ed-month">
          <h2>{new Date(key + "-01T12:00:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" })}<span>{items.length} {items.length === 1 ? "vídeo" : "vídeos"}</span></h2>
          <div className="ed-grid">
            {items.map((it) => {
              const sched = it.posts.find((p) => p.status === "scheduled");
              const pub = it.posts.find((p) => p.status === "published" || p.status === "partial");
              return (
                <article key={it.id} className={"ed-card" + (it.review === "approved" ? " is-approved" : "")}>
                  <button className="ed-card__media" style={{ aspectRatio: ratio(it.layout) }} onClick={() => setPlay(it)} title="Ver">
                    {it.video.thumbUrl && <img src={it.video.thumbUrl} alt="" />}
                    <span className="ed-card__dur mono">{fmtTime(it.video.duration)}</span>
                    {pub ? <span className="pill pill--ok ed-card__badge">Publicado</span>
                      : sched ? <span className="pill pill--accent ed-card__badge">Programado {new Date(sched.scheduled_at).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>
                      : it.review === "approved" ? <span className="pill pill--ok ed-card__badge"><CheckCircle2 size={11} /> Aprobado</span>
                      : it.review === "rejected" ? <span className="pill pill--bad ed-card__badge">Descartado</span>
                      : <span className="pill pill--warn ed-card__badge">Por revisar</span>}
                  </button>
                  <div className="ed-card__body">
                    <b className="ed-card__title" title={it.topic}>{it.short?.title || it.topic}</b>
                    <span className="ed-card__meta">{it.label}{it.qa?.checked && it.qa.ok && <span title="Pasó la revisión automática"> · <ShieldCheck size={11} /></span>}</span>
                    <div className="ed-card__actions">
                      {it.review !== "approved" ? (
                        <>
                          <button className="btn btn--sm btn--primary" onClick={() => review(it, "approved")}>Aprobar</button>
                          {it.review !== "rejected" && <button className="btn btn--sm btn--ghost btn--icon" title="Descartar" onClick={() => review(it, "rejected")}><X size={14} /></button>}
                        </>
                      ) : !sched && !pub ? (
                        <>
                          <button className="btn btn--sm btn--primary" title="Reel de prueba: lo ven primero quienes no te siguen" onClick={() => schedule(it, true)}><FlaskConical size={13} /> Prueba</button>
                          <button className="btn btn--sm" onClick={() => schedule(it, false)}><CalendarCheck size={13} /> Programar</button>
                        </>
                      ) : (
                        <button className="btn btn--sm" onClick={() => navigate(pub ? "/resultados" : "/calendario")}>{pub ? "Ver resultados" : "Ver en calendario"}</button>
                      )}
                      <a className="btn btn--sm btn--ghost btn--icon" href={it.video.url} download={`${it.video.name}.mp4`} title="Descargar"><Download size={14} /></a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {play && (
        <Modal title={play.short?.title || play.topic} onClose={() => setPlay(null)}
          foot={<><span className="muted">{play.label}</span><span className="spacer" /><a className="btn" href={play.video.url} download={`${play.video.name}.mp4`}><Download size={15} /> Descargar</a></>}>
          <video src={play.video.url} controls autoPlay style={{ width: "100%", maxHeight: "68vh", background: "#000", borderRadius: 10 }} />
          {play.post?.caption && <p className="ed-caption">{play.post.caption}</p>}
        </Modal>
      )}
    </div>
  );
}
