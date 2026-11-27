import { useCallback, useEffect, useMemo, useState } from "react";
import { takePrefill, type Prefill } from "../autoedit-api";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, ExternalLink, Film, FlaskConical, Loader2, Plus, Send, Trash2, XCircle } from "lucide-react";
import { api, PLATFORM_INFO, fmtTime, type ExportJob, type PlatformId, type PlatformStatus, type Post, type PostOptions, type TrialGraduation } from "../api";
import { Field, Modal, Switch, navigate, usePath, useToast } from "../ui";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const PLATFORMS: PlatformId[] = ["instagram", "tiktok", "youtube"];
const STATUS: Record<Post["status"], { label: string; cls: string }> = {
  scheduled: { label: "Programada", cls: "pill--accent" },
  publishing: { label: "Publicando…", cls: "pill--info" },
  published: { label: "Publicada", cls: "pill--ok" },
  partial: { label: "A medias", cls: "pill--warn" },
  failed: { label: "Falló", cls: "pill--bad" },
};

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const pad = (n: number) => String(n).padStart(2, "0");
const dateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

export function PlatformBadge({ p, size = 22 }: { p: PlatformId; size?: number }) {
  const i = PLATFORM_INFO[p];
  return <span className="pf-badge" style={{ width: size, height: size, background: i.color, fontSize: size * 0.42 }} title={i.name}>{i.short}</span>;
}

/** Reel de prueba de Instagram (solo lo ven quienes no te siguen). */
export const trialOf = (p: Pick<Post, "options" | "platforms">): TrialGraduation | null =>
  p.platforms.includes("instagram") ? (p.options as PostOptions | undefined)?.trial?.graduation ?? null : null;

export function TrialBadge({ small }: { small?: boolean }) {
  return (
    <span className="pill pill--info" title="Reel de prueba: Instagram solo se lo enseña a quienes no te siguen"
      style={small ? { height: 16, padding: "0 5px", fontSize: 10, gap: 3, flex: "none" } : { flex: "none" }}>
      <FlaskConical size={small ? 10 : 12} /> Prueba
    </span>
  );
}

export default function Calendar() {
  const toast = useToast();
  const [path] = usePath();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [posts, setPosts] = useState<Post[]>([]);
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [platforms, setPlatforms] = useState<PlatformStatus[]>([]);
  const [editing, setEditing] = useState<{ post: Post | null; date: Date; exportId?: string; prefill?: Prefill | null } | null>(null);

  // Rejilla de 6 semanas empezando en lunes
  const gridStart = useMemo(() => {
    const d = new Date(month);
    d.setDate(1 - ((d.getDay() + 6) % 7));
    return d;
  }, [month]);
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)), [gridStart]);

  const load = useCallback(() => {
    const to = new Date(days[41]); to.setDate(to.getDate() + 1);
    api.posts(days[0], to).then(setPosts).catch((e) => toast(e.message, "bad"));
  }, [days, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.exports().then((l) => setExports(l.filter((e) => e.status === "done"))).catch(() => {});
    api.platforms().then((r) => setPlatforms(r.platforms)).catch(() => {});
  }, []);
  // Mientras algo se publica, se refresca
  const publishing = posts.some((p) => p.status === "publishing");
  useEffect(() => {
    if (!publishing) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [publishing, load]);

  // Llegar desde "Programar" de un vídeo
  useEffect(() => {
    const q = new URLSearchParams(path.split("?")[1] ?? "");
    const nuevo = q.get("nuevo");
    if (nuevo) {
      const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0);
      const pf = takePrefill();
      setEditing({ post: null, date: d, exportId: nuevo, prefill: pf && pf.exportId === nuevo ? pf : null });
      navigate("/calendario?vista=publicaciones", true);
    }
  }, [path]);

  const upcoming = posts.filter((p) => p.status === "scheduled" && new Date(p.scheduled_at) >= new Date()).slice(0, 8);
  const today = new Date();

  const newOn = (d: Date) => {
    const when = new Date(d);
    if (sameDay(d, today)) { when.setHours(today.getHours() + 1, 0, 0, 0); } else when.setHours(10, 0, 0, 0);
    setEditing({ post: null, date: when });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Calendario</h1>
          <p>Programa tus vídeos. A la hora indicada se publican solos en las redes que elijas (el programa tiene que estar abierto en tu ordenador).</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => newOn(today)}><Plus size={16} /> Programar publicación</button>
        </div>
      </div>

      <div className="cal-wrap">
        <div className="card cal">
          <div className="cal__head">
            <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Mes anterior"><ChevronLeft size={18} /></button>
            <h2>{month.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</h2>
            <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Mes siguiente"><ChevronRight size={18} /></button>
            <button className="btn btn--sm" onClick={() => setMonth(startOfMonth(new Date()))}>Hoy</button>
          </div>
          <div className="cal__grid">
            {WEEKDAYS.map((w) => <div key={w} className="cal__wd">{w}</div>)}
            {days.map((d) => {
              const list = posts.filter((p) => sameDay(new Date(p.scheduled_at), d));
              const out = d.getMonth() !== month.getMonth();
              const past = d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
              return (
                <div key={d.toISOString()} className={"cal__day" + (out ? " is-out" : "") + (sameDay(d, today) ? " is-today" : "")}>
                  <div className="cal__num">
                    <span>{d.getDate()}</span>
                    {!past && <button className="cal__add" onClick={() => newOn(d)} title="Programar este día"><Plus size={13} /></button>}
                  </div>
                  {list.map((p) => (
                    <button key={p.id} className={"cal-post cal-post--" + p.status} onClick={() => setEditing({ post: p, date: new Date(p.scheduled_at) })}>
                      <span className="cal-post__time mono">{hhmm(p.scheduled_at)}</span>
                      <span className="cal-post__pf">{p.platforms.map((x) => <PlatformBadge key={x} p={x} size={14} />)}</span>
                      {trialOf(p) && <TrialBadge small />}
                      <span className="cal-post__name">{p.video?.name ?? "Vídeo borrado"}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="card cal-side">
          <h3>Próximas</h3>
          {upcoming.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>No hay nada programado este mes.</p> : upcoming.map((p) => (
            <button key={p.id} className="up-item" onClick={() => setEditing({ post: p, date: new Date(p.scheduled_at) })}>
              <span className="up-item__thumb" style={p.video?.thumbUrl ? { backgroundImage: `url(${p.video.thumbUrl})` } : undefined} />
              <span className="up-item__text">
                <b>{p.video?.name ?? "Vídeo borrado"}</b>
                <small>{new Date(p.scheduled_at).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
                <span className="row" style={{ gap: 4 }}>{p.platforms.map((x) => <PlatformBadge key={x} p={x} size={16} />)}{trialOf(p) && <TrialBadge small />}</span>
              </span>
            </button>
          ))}
          {platforms.length > 0 && !platforms.some((p) => p.connected) && (
            <div className="note note--warn" style={{ marginTop: 12 }}>
              Aún no has conectado ninguna red. <a href="/conexiones" onClick={(e) => { e.preventDefault(); navigate("/conexiones"); }}>Conectar ahora →</a>
            </div>
          )}
        </aside>
      </div>

      {editing && (
        <PostModal post={editing.post} date={editing.date} exportId={editing.exportId} prefill={editing.prefill} exports={exports} platforms={platforms}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function PostModal({ post, date, exportId, prefill, exports, platforms, onClose, onSaved }: {
  post: Post | null; date: Date; exportId?: string; prefill?: Prefill | null; exports: ExportJob[]; platforms: PlatformStatus[]; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [videoId, setVideoId] = useState(post?.export_id ?? exportId ?? exports[0]?.id ?? "");
  const [nets, setNets] = useState<PlatformId[]>(post?.platforms ?? (prefill?.trial ? ["instagram"] : PLATFORMS.filter((p) => platforms.find((x) => x.id === p)?.connected)));
  const [title, setTitle] = useState(post?.title ?? prefill?.title ?? "");
  const [caption, setCaption] = useState(post?.caption ?? prefill?.caption ?? "");
  const [day, setDay] = useState(dateInput(date));
  const [hour, setHour] = useState(timeInput(date));
  const [ytPrivacy, setYtPrivacy] = useState(post?.options.youtubePrivacy ?? platforms.find((p) => p.id === "youtube")?.privacy ?? "public");
  const [ttPrivacy, setTtPrivacy] = useState(post?.options.tiktokPrivacy ?? platforms.find((p) => p.id === "tiktok")?.privacy ?? "SELF_ONLY");
  const prevOptions = (post?.options ?? {}) as PostOptions;
  const [trial, setTrial] = useState(!!prevOptions.trial || (!post && !!prefill?.trial));
  const [graduation, setGraduation] = useState<TrialGraduation>(prevOptions.trial?.graduation ?? "MANUAL");
  const [busy, setBusy] = useState(false);
  const [askDel, setAskDel] = useState(false);
  const locked = post?.status === "publishing";
  const done = post?.status === "published";

  const video = exports.find((e) => e.id === videoId) ?? (post?.video && post.video.id === videoId ? post.video : null);
  const toggle = (p: PlatformId) => setNets((n) => (n.includes(p) ? n.filter((x) => x !== p) : [...n, p]));
  const when = new Date(`${day}T${hour}`);

  async function save(publishNow = false) {
    if (!videoId) return toast("Elige el vídeo.", "bad");
    if (!nets.length) return toast("Elige al menos una red.", "bad");
    if (Number.isNaN(when.getTime())) return toast("Fecha u hora no válida.", "bad");
    setBusy(true);
    try {
      // Se conservan las demás opciones (p. ej. «creado a partir de un reel de prueba»)
      const { trial: _oldTrial, ...keep } = prevOptions;
      const options: PostOptions = { ...keep, youtubePrivacy: ytPrivacy, tiktokPrivacy: ttPrivacy, ...(trial && nets.includes("instagram") ? { trial: { graduation } } : {}) };
      const body = { export_id: videoId, platforms: nets, title, caption, scheduled_at: (publishNow ? new Date() : when).toISOString(), options };
      const saved = post ? await api.updatePost(post.id, body) : await api.createPost(body);
      if (publishNow) { await api.publishNow(saved.id); toast("Publicando ahora…", "info"); }
      else toast(post ? "Publicación actualizada" : `Programada para el ${when.toLocaleString("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`);
      onSaved();
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }

  const maxCap = nets.includes("youtube") && nets.length === 1 ? 5000 : 2200;

  return (
    <Modal wide title={post ? "Publicación" : "Programar publicación"} icon={<CalendarDays size={18} color="var(--accent-2)" />} onClose={onClose}
      foot={
        <>
          {post && !locked && (askDel ? (
            <><span className="muted">¿Borrar?</span><button className="btn btn--sm btn--danger" onClick={async () => { await api.deletePost(post.id); toast("Publicación borrada"); onSaved(); }}>Sí, borrar</button><button className="btn btn--sm" onClick={() => setAskDel(false)}>No</button></>
          ) : <button className="btn btn--danger btn--sm" onClick={() => setAskDel(true)}><Trash2 size={14} /> Borrar</button>)}
          <span className="spacer" />
          {!done && !locked && <button className="btn" onClick={() => save(true)} disabled={busy}><Send size={15} /> Publicar ahora</button>}
          {!locked && <button className="btn btn--primary" onClick={() => save(false)} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <Clock size={15} />} {post ? "Guardar" : "Programar"}</button>}
        </>
      }>
      {post && post.status !== "scheduled" && (
        <div className="pf-results">
          <span className="row" style={{ gap: 6 }}><span className={"pill " + STATUS[post.status].cls}>{STATUS[post.status].label}</span>{trialOf(post) && <TrialBadge />}</span>
          {post.platforms.map((p) => {
            const r = post.results[p];
            return (
              <div key={p} className="pf-res">
                <PlatformBadge p={p} />
                <b>{PLATFORM_INFO[p].name}</b>
                {!r ? <span className="muted">{locked ? "en cola…" : "pendiente"}</span>
                  : r.status === "ok" ? <span className="row" style={{ gap: 6, color: "var(--ok)" }}><CheckCircle2 size={15} /> Publicado {r.url && <a href={r.url} target="_blank" rel="noreferrer">ver <ExternalLink size={12} /></a>} {r.note && <span className="muted">{r.note}</span>}</span>
                  : <span className="row" style={{ gap: 6, color: "var(--bad)", alignItems: "flex-start" }}><XCircle size={15} style={{ flex: "none", marginTop: 2 }} /> {r.error}</span>}
              </div>
            );
          })}
          {post.status === "failed" || post.status === "partial" ? <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Arregla el problema (p. ej. conecta la cuenta) y pulsa «Publicar ahora»: solo se reintentan las redes que fallaron.</p> : null}
        </div>
      )}

      <div className="post-grid">
        <div className="post-video">
          {video?.url ? <video src={video.url} controls className="post-video__player" /> : <div className="post-video__empty"><Film size={26} /></div>}
          <select className="select select--sm" value={videoId} onChange={(e) => setVideoId(e.target.value)} disabled={locked}>
            {!videoId && <option value="">Elige un vídeo…</option>}
            {exports.map((e) => <option key={e.id} value={e.id}>{e.name} · {fmtTime(e.duration ?? 0)}</option>)}
            {post?.video && !exports.some((e) => e.id === post.video!.id) && <option value={post.video.id}>{post.video.name}</option>}
          </select>
          {exports.length === 0 && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Primero exporta un vídeo desde el editor.</p>}
        </div>

        <div className="post-form">
          <Field label="Dónde se publica">
            <div className="pf-picks">
              {PLATFORMS.map((p) => {
                const st = platforms.find((x) => x.id === p);
                const on = nets.includes(p);
                return (
                  <button key={p} type="button" className={"pf-pick" + (on ? " is-on" : "")} onClick={() => toggle(p)} disabled={locked}>
                    <PlatformBadge p={p} size={26} />
                    <span>
                      <b>{PLATFORM_INFO[p].name}</b>
                      <small className={st?.connected ? "" : "is-warn"}>{st?.connected ? st.account ?? "Conectada" : "Sin conectar"}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
          {nets.some((p) => !platforms.find((x) => x.id === p)?.connected) && (
            <div className="note note--warn row" style={{ alignItems: "flex-start" }}>
              <AlertTriangle size={16} style={{ flex: "none", marginTop: 1 }} />
              <span>Alguna red elegida no está conectada: a la hora fallará. <a href="/conexiones" onClick={(e) => { e.preventDefault(); navigate("/conexiones"); }}>Conectarla</a></span>
            </div>
          )}
          {nets.includes("youtube") && (
            <Field label="Título en YouTube" right={<span className="mono">{title.length}/100</span>} hint="Se añade #Shorts solo si cabe.">
              <input className="input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="Cómo editar un reel en 1 minuto" disabled={locked} />
            </Field>
          )}
          <Field label="Texto de la publicación" right={<span className="mono" style={{ color: caption.length > maxCap ? "var(--bad)" : undefined }}>{caption.length}/{maxCap}</span>}>
            <textarea className="textarea" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={"Escribe el texto y los hashtags…\n\n#reels #marketing"} disabled={locked} />
          </Field>
          <div className="grid2">
            <Field label="Día"><input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} disabled={locked} /></Field>
            <Field label="Hora"><input className="input" type="time" value={hour} onChange={(e) => setHour(e.target.value)} disabled={locked} /></Field>
          </div>
          {when < new Date() && !post && <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Esa hora ya ha pasado: se publicará en cuanto lo guardes.</p>}
          {nets.includes("instagram") && !done && !locked && (
            <div className="note" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Switch checked={trial} onChange={setTrial} label={<span>Publicar como reel de prueba <span className="muted">(solo lo ven quienes no te siguen)</span></span>} />
              {trial && (
                <>
                  <Field label="Si funciona bien">
                    <select className="select select--sm" value={graduation} onChange={(e) => setGraduation(e.target.value as TrialGraduation)}>
                      <option value="MANUAL">Lo paso yo a normal desde la app de Instagram</option>
                      <option value="SS_PERFORMANCE">Que Instagram lo comparta solo con mis seguidores</option>
                    </select>
                  </Field>
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    Sirve para probar un vídeo sin que lo vean tus seguidores. Solo afecta a Instagram (TikTok y YouTube lo publican normal). Sus cifras salen en <b>Resultados</b>.
                  </span>
                </>
              )}
            </div>
          )}
          {(nets.includes("youtube") || nets.includes("tiktok")) && (
            <div className="grid2">
              {nets.includes("youtube") && (
                <Field label="Visibilidad en YouTube">
                  <select className="select select--sm" value={ytPrivacy} onChange={(e) => setYtPrivacy(e.target.value)} disabled={locked}>
                    <option value="public">Público</option><option value="unlisted">Oculto (con enlace)</option><option value="private">Privado</option>
                  </select>
                </Field>
              )}
              {nets.includes("tiktok") && (
                <Field label="Visibilidad en TikTok">
                  <select className="select select--sm" value={ttPrivacy} onChange={(e) => setTtPrivacy(e.target.value)} disabled={locked}>
                    <option value="PUBLIC_TO_EVERYONE">Público</option><option value="FOLLOWER_OF_CREATOR">Solo seguidores</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option><option value="SELF_ONLY">Solo yo</option>
                  </select>
                </Field>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
