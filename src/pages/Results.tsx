import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BarChart3, CalendarDays, ExternalLink, Film, Loader2, RefreshCw, Rocket, Send, Trophy } from "lucide-react";
import {
  api, insightsApi, PLATFORM_INFO,
  type InsightItem, type InsightMetrics, type InsightPlatform, type InsightsList, type PlatformId, type PlatformStatus, type PostOptions,
} from "../api";
import { Field, Modal, navigate, useToast } from "../ui";
import { PlatformBadge, TrialBadge } from "./Calendar";

/* ---------- Formato ---------- */

const nf = new Intl.NumberFormat("es-ES");
const nfCompact = new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (v: number | null | undefined) => (v == null ? "—" : v >= 100_000 ? nfCompact.format(v) : nf.format(v));
const fmtWatch = (ms: number | null | undefined) => (ms == null ? "—" : ms < 60_000 ? `${(ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const fmtDate = (iso: string) => new Date(iso).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function ago(iso: string | null) {
  if (!iso) return null;
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "ahora mismo";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
const pad = (n: number) => String(n).padStart(2, "0");
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Qué cifras da cada red. */
const METRIC_LABELS: { key: keyof InsightMetrics; label: string; fmt?: (v: number | null) => string }[] = [
  { key: "views", label: "Visualizaciones" },
  { key: "reach", label: "Alcance" },
  { key: "likes", label: "Me gusta" },
  { key: "comments", label: "Comentarios" },
  { key: "shares", label: "Compartidos" },
  { key: "saves", label: "Guardados" },
  { key: "avg_watch_ms", label: "Tiempo medio", fmt: fmtWatch },
];
const PLATFORM_METRICS: Record<PlatformId, (keyof InsightMetrics)[]> = {
  instagram: ["views", "reach", "likes", "comments", "shares", "saves", "avg_watch_ms"],
  youtube: ["views", "likes", "comments"],
  tiktok: ["views", "likes", "comments", "shares"],
};

const CSS = `
.res-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.res-list { display: flex; flex-direction: column; gap: 14px; }
.res-card { display: grid; grid-template-columns: 84px minmax(0, 1fr); gap: 16px; padding: 14px; }
.res-card.is-winner { border-color: rgba(52, 211, 153, 0.45); box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.15) inset; }
.res-thumb { width: 84px; aspect-ratio: 9 / 16; border-radius: 10px; background: #000 center / cover no-repeat; border: 1px solid var(--line); display: grid; place-items: center; color: var(--ink-4); cursor: pointer; padding: 0; }
.res-thumb:disabled { cursor: default; }
.res-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.res-head { display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.res-title { font-weight: 700; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.res-sub { font-size: 12.5px; color: var(--ink-3); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.res-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; }
.res-pf { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 11px; background: var(--bg); border: 1px solid var(--line); }
.res-metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px 14px; }
.res-metric small { display: block; font-size: 11px; color: var(--ink-3); }
.res-metric b { font-size: 15px; font-variant-numeric: tabular-nums; }
.res-metric.is-main b { font-size: 17px; }
.res-pf__msg { font-size: 12.5px; color: var(--ink-3); }
.res-pf__side { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 11.5px; color: var(--ink-3); white-space: nowrap; }
.res-spark { display: block; }
@media (max-width: 720px) {
  .res-card { grid-template-columns: 64px minmax(0, 1fr); gap: 12px; }
  .res-thumb { width: 64px; }
  .res-pf { grid-template-columns: 24px minmax(0, 1fr); }
  .res-pf__side { grid-column: 2; align-items: flex-start; }
}
`;

/* ---------- Página ---------- */

export default function Results() {
  const toast = useToast();
  const [data, setData] = useState<InsightsList | null>(null);
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [onlyTrials, setOnlyTrials] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [play, setPlay] = useState<InsightItem | null>(null);
  const [promote, setPromote] = useState<InsightItem | null>(null);

  const load = useCallback(() => insightsApi.list().then(setData).catch((e) => { toast(e.message, "bad"); setData((d) => d ?? { items: [], running: false, lastRunAt: null, rule: { factor: 1.5, minOthers: 3, minViewsIfFew: 1000 }, platformErrors: {} }); }), [toast]);
  useEffect(() => { load(); api.platforms().then((r) => setPlatforms(r.platforms)).catch(() => {}); }, [load]);
  // Mientras se actualiza todo en segundo plano, se refresca la lista
  useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.running, load]);

  async function refreshAll() {
    try {
      await insightsApi.refreshAll();
      setData((d) => (d ? { ...d, running: true } : d));
      toast("Consultando las redes… las cifras se van actualizando solas.", "info");
    } catch (e) { toast((e as Error).message, "bad"); }
  }
  async function refreshOne(id: string) {
    setBusyId(id);
    try {
      const r = await insightsApi.refreshPost(id);
      await load();
      const errs = r.item?.platforms.filter((p) => p.status === "error" || p.status === "stale").length ?? 0;
      toast(errs ? "Actualizado, pero alguna red no respondió (mira el aviso en la tarjeta)." : "Cifras actualizadas", errs ? "info" : "ok");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusyId(null); }
  }

  const items = (data?.items ?? []).filter((i) => !onlyTrials || i.trial);
  const trialCount = data?.items.filter((i) => i.trial).length ?? 0;
  const rule = data?.rule;
  const errs = Object.entries(data?.platformErrors ?? {}) as [PlatformId, string][];
  const igConnected = platforms.find((p) => p.id === "instagram")?.connected ?? null;

  return (
    <div className="page">
      <style>{CSS}</style>
      <div className="page-head">
        <div>
          <h1>Resultados</h1>
          <p>Cómo van tus vídeos publicados: visualizaciones, alcance, me gusta y más. Se actualiza solo cada hora (los últimos 30 días). <b>Meta puede tardar hasta 48 h</b> en dar los datos de un reel; hasta entonces verás «Esperando datos».</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={refreshAll} disabled={!!data?.running}>
            {data?.running ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} {data?.running ? "Actualizando…" : "Actualizar ahora"}
          </button>
        </div>
      </div>

      {errs.map(([p, msg]) => (
        <div key={p} className="note note--warn row" style={{ alignItems: "flex-start", marginBottom: 12 }}>
          <AlertTriangle size={16} style={{ flex: "none", marginTop: 1 }} />
          <span><b>{PLATFORM_INFO[p].name}:</b> {msg} <a href="/conexiones" onClick={(e) => { e.preventDefault(); navigate("/conexiones"); }}>Conexiones →</a></span>
        </div>
      ))}

      {data === null ? <p className="muted">Cargando…</p> : data.items.length === 0 ? (
        <div className="empty">
          <div className="empty__icon"><BarChart3 size={24} /></div>
          <h3>Todavía no hay nada publicado</h3>
          <p>Cuando se publique un vídeo desde el Calendario, aquí verás cómo funciona en cada red. Prueba a publicarlo como «reel de prueba» en Instagram para ver si gusta antes de enseñárselo a tus seguidores.</p>
          <button className="btn btn--primary" onClick={() => navigate("/calendario")}><CalendarDays size={15} /> Ir al calendario</button>
        </div>
      ) : (
        <>
          <div className="res-toolbar">
            <div className="seg">
              <button className={!onlyTrials ? "is-on" : ""} onClick={() => setOnlyTrials(false)}>Todo ({data.items.length})</button>
              <button className={onlyTrials ? "is-on" : ""} onClick={() => setOnlyTrials(true)}>Reels de prueba ({trialCount})</button>
            </div>
            {rule && trialCount > 0 && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                <span className="pill pill--ok" style={{ height: 18, fontSize: 10.5, marginRight: 6 }}><Trophy size={11} /> Ha funcionado</span>
                = reel de prueba con al menos {nf.format(rule.factor)}× las visualizaciones de la mediana de tus otros reels de prueba (o {nf.format(rule.minViewsIfFew)} si tienes menos de {rule.minOthers} con datos).
              </span>
            )}
            {data.lastRunAt && <span className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>Última consulta general {ago(data.lastRunAt)}</span>}
          </div>
          {items.length === 0 ? <p className="muted">No hay reels de prueba publicados todavía.</p> : (
            <div className="res-list">
              {items.map((it) => (
                <ResultCard key={it.id} item={it} busy={busyId === it.id} onRefresh={() => refreshOne(it.id)} onPlay={() => setPlay(it)} onPromote={() => setPromote(it)} />
              ))}
            </div>
          )}
        </>
      )}

      {play?.video?.url && (
        <Modal title={play.video.name} onClose={() => setPlay(null)}>
          <video src={play.video.url} controls autoPlay style={{ width: "100%", maxHeight: "62vh", background: "#000", borderRadius: 10 }} />
        </Modal>
      )}
      {promote && <PromoteModal item={promote} igConnected={igConnected} onClose={() => setPromote(null)} onDone={() => { setPromote(null); load(); }} />}
    </div>
  );
}

/* ---------- Tarjeta de una publicación ---------- */

const PROMO_STATUS: Record<InsightItem["status"], string> = { scheduled: "programado", publishing: "publicándose", published: "publicado", partial: "publicado a medias", failed: "falló al publicar" };

function ResultCard({ item, busy, onRefresh, onPlay, onPromote }: { item: InsightItem; busy: boolean; onRefresh: () => void; onPlay: () => void; onPromote: () => void }) {
  const name = item.video?.name || item.title || item.caption.split("\n")[0] || "Publicación";
  const ig = item.platforms.find((p) => p.platform === "instagram");
  return (
    <div className={"card res-card" + (item.winner ? " is-winner" : "")}>
      <button className="res-thumb" onClick={onPlay} disabled={!item.video?.url} style={item.video?.thumbUrl ? { backgroundImage: `url(${item.video.thumbUrl})` } : undefined} aria-label="Ver el vídeo">
        {!item.video?.thumbUrl && <Film size={20} />}
      </button>
      <div className="res-main">
        <div className="res-head">
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {item.winner && <span className="pill pill--ok"><Trophy size={12} /> Ha funcionado</span>}
              {item.trial && <TrialBadge />}
              {item.promotedFrom && <span className="pill pill--accent">Creado desde un reel de prueba</span>}
              <span className="res-title">{name}</span>
            </span>
            <span className="res-sub">
              <span>{fmtDate(item.publishedAt)}</span>
              {item.totals.views != null && <><span>·</span><span><b style={{ color: "var(--ink)" }}>{fmtNum(item.totals.views)}</b> visualizaciones en total</span></>}
              {item.trial && <><span>·</span><span>{item.trial === "MANUAL" ? "Lo pasas tú a normal" : "Instagram lo comparte solo si funciona"}</span></>}
            </span>
            {item.promotedTo.length > 0 && (
              <span className="res-sub" style={{ color: "var(--ok)" }}>
                Ya creaste un reel normal con este vídeo ({item.promotedTo.map((p) => p.status === "scheduled" ? `programado para el ${fmtDate(p.scheduled_at)}` : PROMO_STATUS[p.status]).join(", ")}).
                {item.promotedTo.find((p) => p.url) && <a href={item.promotedTo.find((p) => p.url)!.url!} target="_blank" rel="noreferrer">Ver <ExternalLink size={11} /></a>}
              </span>
            )}
          </div>
          <div className="res-actions">
            <button className="btn btn--sm" onClick={onRefresh} disabled={busy} title="Consultar ahora las cifras de esta publicación">
              {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Actualizar
            </button>
            {item.trial && ig?.status !== "not_published" && (
              <button className={"btn btn--sm" + (item.winner ? " btn--primary" : "")} onClick={onPromote}><Rocket size={14} /> Publicar como reel normal</button>
            )}
          </div>
        </div>
        {item.platforms.map((p) => <PlatformRow key={p.platform} p={p} />)}
      </div>
    </div>
  );
}

function PlatformRow({ p }: { p: InsightPlatform }) {
  const keys = PLATFORM_METRICS[p.platform];
  const waiting = p.platform === "instagram" ? "Esperando datos: Meta puede tardar hasta 48 h en darlos." : "Esperando datos: aún no hay cifras.";
  let body: React.ReactNode;
  if (p.status === "not_published") body = <span className="res-pf__msg" style={{ color: "var(--bad)" }}>No se publicó{p.error ? `: ${p.error}` : "."}</span>;
  else if (!p.latest) {
    body = p.status === "unavailable" ? <span className="res-pf__msg">{p.error?.startsWith("No disponible") ? p.error : `No disponible${p.error ? `: ${p.error}` : "."}`}</span>
      : p.status === "error" ? <span className="res-pf__msg" style={{ color: "var(--warn)" }}>No se pudieron leer las cifras: {p.error}</span>
      : <span className="res-pf__msg">{waiting}</span>;
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div className="res-metrics">
          {METRIC_LABELS.filter((m) => keys.includes(m.key)).map((m) => (
            <div key={m.key} className={"res-metric" + (m.key === "views" ? " is-main" : "")}>
              <small>{m.label}</small>
              <b>{m.fmt ? m.fmt(p.latest![m.key]) : fmtNum(p.latest![m.key])}</b>
            </div>
          ))}
        </div>
        {p.status === "stale" && <span className="res-pf__msg" style={{ color: "var(--warn)" }}>Cifras de la última vez que se pudo; la consulta más reciente falló: {p.error}</span>}
      </div>
    );
  }
  const hist = p.history.filter((h) => h.views != null);
  const growth = hist.length >= 2 ? (hist.at(-1)!.views! - hist[0].views!) : null;
  return (
    <div className="res-pf">
      <PlatformBadge p={p.platform} />
      {body}
      <div className="res-pf__side">
        {hist.length >= 2 && <Sparkline values={hist.map((h) => h.views!)} />}
        {growth != null && growth > 0 && <span style={{ color: "var(--ok)" }}>+{fmtNum(growth)} desde el {new Date(hist[0].at).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>}
        {p.okAt && <span>Comprobado {ago(p.okAt)}</span>}
        {p.url && <a href={p.url} target="_blank" rel="noreferrer">Abrir <ExternalLink size={11} /></a>}
      </div>
    </div>
  );
}

function Sparkline({ values, w = 96, h = 26 }: { values: number[]; w?: number; h?: number }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`);
  return (
    <svg className="res-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="Evolución de las visualizaciones">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--accent-2)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.at(-1)!.split(",")[0]} cy={pts.at(-1)!.split(",")[1]} r={2.4} fill="var(--accent-2)" />
    </svg>
  );
}

/* ---------- Publicar un reel de prueba como reel normal ---------- */

function PromoteModal({ item, igConnected, onClose, onDone }: { item: InsightItem; igConnected: boolean | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const soon = new Date(Date.now() + 3600e3); soon.setMinutes(0, 0, 0);
  const [caption, setCaption] = useState(item.caption);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [day, setDay] = useState(dateInput(soon));
  const [hour, setHour] = useState(timeInput(soon));
  const [busy, setBusy] = useState(false);
  const ig = item.platforms.find((p) => p.platform === "instagram");
  const when = new Date(`${day}T${hour}`);
  const noVideo = !item.video;

  async function confirm() {
    if (noVideo) return;
    if (mode === "later" && Number.isNaN(when.getTime())) return toast("Fecha u hora no válida.", "bad");
    setBusy(true);
    try {
      const options: PostOptions = { promotedFrom: item.id };
      const post = await api.createPost({
        export_id: item.export_id, platforms: ["instagram"], title: item.title, caption,
        scheduled_at: (mode === "now" ? new Date() : when).toISOString(), options,
      });
      if (mode === "now") { await api.publishNow(post.id); toast("Publicando el reel normal… lo verás en el Calendario.", "info"); }
      else toast(`Reel normal programado para el ${fmtDate(when.toISOString())}`);
      onDone();
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }

  return (
    <Modal wide title="Publicar como reel normal" icon={<Rocket size={18} color="var(--accent-2)" />} onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={() => navigate("/calendario")}><CalendarDays size={15} /> Ver calendario</button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" onClick={confirm} disabled={busy || noVideo}>
            {busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} {mode === "now" ? "Sí, publicar reel nuevo ahora" : "Sí, programar reel nuevo"}
          </button>
        </>
      }>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="note">
          <b>Ojo: esto crea un reel NUEVO.</b> Instagram no deja pasar un reel de prueba a normal desde fuera de su app, así que se publica otra vez el mismo vídeo con el mismo texto como reel normal: lo verán tus seguidores, empieza desde cero visualizaciones y el reel de prueba sigue existiendo aparte.
        </div>
        <div className="note note--ok">
          <b>Alternativa que conserva las visualizaciones:</b> abre el reel de prueba en la app de Instagram y compártelo con tus seguidores desde allí. Así no hay dos reels iguales.
          {ig?.url && <> <a href={ig.url} target="_blank" rel="noreferrer">Abrir el reel de prueba <ExternalLink size={11} /></a></>}
        </div>
        {item.promotedTo.length > 0 && (
          <div className="note note--warn row" style={{ alignItems: "flex-start" }}>
            <AlertTriangle size={16} style={{ flex: "none", marginTop: 1 }} />
            <span>Ya creaste {item.promotedTo.length === 1 ? "un reel normal" : `${item.promotedTo.length} reels normales`} con este vídeo. Si sigues, habrá otro más.</span>
          </div>
        )}
        {igConnected === false && (
          <div className="note note--warn">Instagram no está conectado ahora mismo: la publicación fallará. <a href="/conexiones" onClick={(e) => { e.preventDefault(); navigate("/conexiones"); }}>Conectarlo</a></div>
        )}
        {noVideo && <div className="note note--bad">El vídeo exportado de esta publicación se ha borrado: vuelve a exportarlo y prográmalo desde el Calendario.</div>}
        <Field label="Texto de la publicación" right={<span className="mono">{caption.length}/2200</span>}>
          <textarea className="textarea" rows={4} value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} />
        </Field>
        <Field label="Cuándo">
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            <button className={mode === "now" ? "is-on" : ""} onClick={() => setMode("now")}>Ahora</button>
            <button className={mode === "later" ? "is-on" : ""} onClick={() => setMode("later")}>Elegir día y hora</button>
          </div>
        </Field>
        {mode === "later" && (
          <div className="grid2">
            <Field label="Día"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
            <Field label="Hora"><input className="input" type="time" value={hour} onChange={(e) => setHour(e.target.value)} /></Field>
          </div>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Solo se publica en Instagram, como reel normal (no de prueba).</p>
      </div>
    </Modal>
  );
}
