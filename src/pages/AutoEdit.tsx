// Auto-edición: sube un vídeo hablado y salen 5 versiones editadas (o shorts de un vídeo largo),
// cada una en cuanto está lista. Tú las revisas antes de publicar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarPlus, Check, CheckCircle2, ChevronDown, ChevronUp, Download, Eraser, Film, FlaskConical, Loader2, MessageSquareText, RotateCcw, Scissors, ShieldCheck, Sparkles, Terminal, Trash2, Upload, X } from "lucide-react";
import { api, fmtSize, fmtTime, type Media } from "../api";
import { autoApi, setPrefill, type AutoItem, type AutoJob, type AutoVariant } from "../autoedit-api";
import { styleApi } from "../style-api";
import UploadWizard from "./UploadWizard";
import { Field, Modal, navigate, useToast } from "../ui";
import { ACCEPT, useUploader } from "../editor/MediaPanel";
import "./autoedit.css";

const LAYOUT_SHAPE: Record<string, [number, number]> = { reference: [9, 16], headline: [9, 16], minimal: [9, 16], horizontal: [16, 9], framed: [4, 5] };
type AutoInfo = { claude: boolean; provider: "claude" | "deepseek" | null; variants: AutoVariant[]; worker?: { online: boolean; claude: boolean; lastSeen: number | null; busy: string | null } | null };
const FRAMING_LABEL: Record<string, string> = { wide: "Plano abierto", medium: "Plano medio", close: "Primer plano" };
const GRADE_LABEL: Record<string, string> = { warm: "Color cálido", cool: "Color frío", punchy: "Color intenso", soft: "Color suave" };
const STEP_LABEL: Record<AutoItem["status"], string> = { queued: "En cola", rendering: "Renderizando", mixing: "Sonido", qa: "Revisando", done: "Lista", error: "Error" };

export default function AutoEdit() {
  const toast = useToast();
  const [info, setInfo] = useState<AutoInfo | null>(null);
  const [jobs, setJobs] = useState<AutoJob[] | null>(null);
  const [media, setMedia] = useState<Media[]>([]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => autoApi.jobs().then(setJobs).catch((e) => { setJobs([]); toast(e.message, "bad"); }), [toast]);
  useEffect(() => {
    load();
    autoApi.info().then(setInfo).catch(() => {});
    api.media().then(setMedia).catch(() => {});
  }, [load]);

  // El PC se acaba de conectar solo: se vuelve a mirar su estado
  useEffect(() => {
    const on = () => { autoApi.info().then(setInfo).catch(() => {}); };
    window.addEventListener("ps:pc", on);
    return () => window.removeEventListener("ps:pc", on);
  }, []);

  // Mientras haya algo en marcha, se refresca solo (así cada versión aparece en cuanto acaba)
  const active = jobs?.some((j) => j.status === "running" || j.status === "queued" || j.items.some((i) => !["done", "error"].includes(i.status)));
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [active, load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Auto-edición</h1>
          <p>Sube un vídeo tuyo hablando y te devuelve 5 versiones editadas a la perfección (cortes, subtítulos, gráficos, zooms, efectos y música), o varios shorts de un vídeo largo. Cada versión te llega en cuanto está lista; tú decides cuál se publica.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => setCreating(true)}><Sparkles size={16} /> Nueva edición</button>
        </div>
      </div>

      {info && !info.claude && <ClaudeLoginNote worker={info.worker} onReady={(i) => setInfo(i)} />}
      {info && <DropToEdit variants={info.variants.map((v) => v.key)} onStarted={load} />}

      {jobs === null ? <p className="muted">Cargando…</p> : jobs.length === 0 ? (
        <div className="empty">
          <div className="empty__icon"><Sparkles size={24} /></div>
          <h3>Todavía no has editado nada</h3>
          <p>Elige un vídeo en el que hables a cámara. Lo ideal: buena luz, sonido limpio y que se te vea de cintura para arriba.</p>
          <button className="btn btn--primary" onClick={() => setCreating(true)}><Sparkles size={16} /> Nueva edición</button>
        </div>
      ) : (
        <div className="ae-jobs">{jobs.map((j) => <JobCard key={j.id} job={j} onChange={load} />)}</div>
      )}

      {creating && info && (
        <NewJob info={info} media={media} onMedia={(m) => setMedia((l) => [...m, ...l])} onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); toast("¡En marcha! Cada versión aparecerá aquí en cuanto esté lista."); }} />
      )}
    </div>
  );
}

function ClaudeLoginNote({ worker, onReady }: { worker?: AutoInfo["worker"]; onReady: (i: AutoInfo) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function check() {
    setBusy(true);
    try {
      await autoApi.recheck();
      const i = await autoApi.info();
      onReady(i);
      toast(i.claude ? "Claude está listo: editará él" : i.worker && !i.worker.online ? "Tu PC todavía no está conectado" : "Claude sigue sin sesión en este ordenador", i.claude ? undefined : "bad");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }
  async function pair() {
    try {
      const r = await fetch("/api/pc/pair", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "No se pudo crear la conexión");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = "worker.json";
      a.click();
      toast("Guarda worker.json en la carpeta pulso-studio/data y abre «Editor Pulso Studio.cmd»");
    } catch (e) { toast((e as Error).message, "bad"); }
  }
  return (
    <div className="note note--warn ae-login">
      <Terminal size={18} />
      <div>
        {worker && !worker.online ? (
          <><b>Tu PC no está conectado.</b> Los vídeos que subas esperan en cola: tu PC los edita en cuanto esté encendido. El editor arranca solo al encender el ordenador (o abre «Editor Pulso Studio.cmd» en la carpeta pulso-studio). Si hace falta conectarlo, se abre esta web con un botón «Conectar este PC»: un clic y listo.</>
        ) : (
          <><b>Claude no tiene la sesión iniciada{worker ? " en tu PC" : " en este ordenador"}.</b> Es quien decide los cortes, las palabras clave, los ángulos de cada short y qué gráfico va en cada frase. Inicia sesión en Claude y pulsa «Comprobar».</>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn--sm btn--primary" disabled={busy} onClick={check}>{busy ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />} Comprobar</button>
          {worker && !worker.online && <button className="btn btn--sm" onClick={pair}><Download size={14} /> Conectar mi PC</button>}
        </div>
      </div>
    </div>
  );
}

/* ---------- Soltar un vídeo y que empiece solo ---------- */

const NOTES_KEY = "ps:aeNotes";
type RefChoice = { media?: string | null; asset?: string | null } | null;

/** Elegir un vídeo de referencia para ESTE vídeo: de la Biblioteca o de tus referencias del Estilo. */
function RefPicker({ value, onChange }: { value: RefChoice; onChange: (v: RefChoice) => void }) {
  type Opt = { key: string; label: string; group: string; thumb: string | null; video: string | null; v: RefChoice };
  const [opts, setOpts] = useState<Opt[] | null>(null);
  useEffect(() => {
    Promise.all([api.media().catch(() => [] as Media[]), styleApi.get().catch(() => null)]).then(([media, st]) => {
      const refs: Opt[] = (st?.assets || []).filter((a) => a.kind === "reference" && /\.(mp4|mov|m4v|webm)$/i.test(a.file))
        .map((a) => ({ key: "a:" + a.id, label: a.name, group: "Referencia", thumb: null, video: a.url, v: { asset: a.id } }));
      const vids: Opt[] = media.filter((m) => m.kind === "video")
        .map((m) => ({ key: "m:" + m.id, label: m.name, group: "Biblioteca", thumb: m.thumbUrl, video: m.thumbUrl ? null : m.url, v: { media: m.id } }));
      setOpts([...refs, ...vids]);
    });
  }, []);
  const cur = value?.media ? "m:" + value.media : value?.asset ? "a:" + value.asset : "";
  if (opts === null) return <p className="muted" style={{ margin: 0, fontSize: 12.5 }}><Loader2 size={12} className="spin" /> Cargando tus vídeos…</p>;
  return (
    <div className="ae-refs">
      <button type="button" className={"ae-ref ae-ref--none" + (cur === "" ? " is-on" : "")} onClick={() => onChange(null)}>
        <span className="ae-ref__img"><X size={20} /></span>
        <span className="ae-ref__name">Sin referencia<small>usa mi estilo</small></span>
      </button>
      {opts.map((o) => (
        <button key={o.key} type="button" className={"ae-ref" + (cur === o.key ? " is-on" : "")} title={o.label} onClick={() => onChange(cur === o.key ? null : o.v)}>
          <span className="ae-ref__img" style={o.thumb ? { backgroundImage: `url(${o.thumb})` } : undefined}>
            {!o.thumb && o.video && <video src={o.video + "#t=1"} muted playsInline preload="metadata"
              onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => { e.currentTarget.pause(); }} />}
            {cur === o.key && <span className="ae-ref__ok"><Check size={14} /></span>}
          </span>
          <span className="ae-ref__name">{o.label}<small>{o.group}</small></span>
        </button>
      ))}
    </div>
  );
}
const readNotes = () => { try { return localStorage.getItem(NOTES_KEY) || ""; } catch { return ""; } };

function DropToEdit({ variants, onStarted }: { variants: string[]; onStarted: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [notes, setNotesRaw] = useState(readNotes);
  const [ref, setRef] = useState<RefChoice>(null);
  const [queue, setQueue] = useState<Media[]>([]);
  const setNotes = (v: string) => { setNotesRaw(v); try { localStorage.setItem(NOTES_KEY, v); } catch { /* sin almacenamiento */ } };
  async function go(files: File[]) {
    const vids = files.filter((f) => f.type.startsWith("video/") || /.(mp4|mov|m4v|webm|mkv)$/i.test(f.name));
    if (!vids.length) return toast("Suelta un vídeo (MP4, MOV…).", "bad");
    setBusy(vids.length);
    try {
      const up = await api.upload(vids);
      const ok = up.filter((x) => x.kind === "video" && (x.has_audio || (toast(`«${x.name}» no tiene sonido: la auto-edición necesita que hables.`, "bad"), false)));
      // Preguntas rápidas: una pantalla por vídeo subido
      setQueue(ok);
      void variants;
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(0); }
  }
  return (
    <div className="ae-dropwrap">
    <button type="button" className={"ae-drop" + (over ? " is-over" : "")} onClick={() => input.current?.click()} disabled={!!busy}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); go([...e.dataTransfer.files]); }}>
      <span className="ae-drop__icon">{busy ? <Loader2 size={24} className="spin" /> : <Upload size={24} />}</span>
      <span>
        <b>{busy ? "Subiendo…" : "Suelta aquí tu vídeo y se edita solo"}</b>
        <small>Se cortan los silencios, se ponen subtítulos, gráficos, zooms, efectos y música con tu estilo de edición. Si dura más de 2,5 minutos, Claude saca todos los shorts que den de sí (hasta 20), cada uno con su enfoque y su look.</small>
      </span>
      <input ref={input} type="file" hidden accept="video/*" multiple onChange={(e) => { go([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </button>
    <label className="ae-notes">
      <span><MessageSquareText size={14} /> Indicaciones para la IA <small>(opcional: se aplican al próximo vídeo que sueltes)</small></span>
      <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Ej.: corte rápido, sin gráficos al principio, una animación a pantalla completa cuando explico los 3 pasos, la palabra clave en amarillo…" />
    </label>
    {queue[0] && <UploadWizard key={queue[0].id} media={queue[0]} notes={notes} refChoice={ref} RefPicker={RefPicker}
      onClose={() => setQueue((q) => q.slice(1))} onStarted={() => { setQueue((q) => q.slice(1)); onStarted(); }} />}
    <label className="ae-notes">
      <span><Film size={14} /> Vídeo de referencia <small>(opcional: lo edita como ese vídeo, con sus mismos colores — LUT medida)</small></span>
      <RefPicker value={ref} onChange={setRef} />
    </label>
    </div>
  );
}

/* ---------- Nueva edición ---------- */

function NewJob({ info, media, onMedia, onClose, onCreated }: {
  info: AutoInfo; media: Media[]; onMedia: (m: Media[]) => void; onClose: () => void; onCreated: () => void;
}) {
  const toast = useToast();
  const videos = media.filter((m) => m.kind === "video");
  const [mediaId, setMediaId] = useState(videos[0]?.id ?? "");
  const [kind, setKind] = useState<"variants" | "shorts">("variants");
  const [variants, setVariants] = useState(info.variants.map((v) => v.key));
  const [shorts, setShorts] = useState<number | "auto">("auto");
  const [vocab, setVocab] = useState("");
  const [notes, setNotes] = useState(readNotes);
  const [ref, setRef] = useState<RefChoice>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { upload, busy: uploading } = useUploader((m) => { onMedia(m); const v = m.find((x) => x.kind === "video"); if (v) setMediaId(v.id); });
  const sel = videos.find((v) => v.id === mediaId);
  const long = (sel?.duration ?? 0) > 120;

  useEffect(() => { if (long) setKind("shorts"); }, [long]);

  async function start(allowRules = false) {
    if (!mediaId) return toast("Elige o sube un vídeo.", "bad");
    setBusy(true);
    try {
      await autoApi.create({ mediaId, kind, variants, shorts, vocab, allowRules, notes, ref });
      onCreated();
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }

  return (
    <Modal wide title="Nueva edición automática" icon={<Sparkles size={18} color="var(--accent-2)" />} onClose={onClose}
      foot={<>
        <span className="muted" style={{ fontSize: 12.5 }}>{info.provider === "claude" ? "Edita Claude." : info.provider === "deepseek" ? "Edita la IA (DeepSeek)." : "Claude no tiene sesión: pulsa Empezar y se quedará esperando."}</span>
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn--primary" disabled={busy || !mediaId || (kind === "variants" && !variants.length)} onClick={() => start()}>
          {busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Empezar
        </button>
      </>}>
      <Field label="Vídeo" right={<button className="btn btn--ghost btn--sm" onClick={() => input.current?.click()} disabled={!!uploading}>{uploading ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} Subir otro</button>}>
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
        {videos.length === 0 ? (
          <button className="mp__drop" onClick={() => input.current?.click()}><Upload size={22} /><span>Sube el vídeo en el que hablas</span></button>
        ) : (
          <div className="ae-pick">
            {videos.map((v) => (
              <button key={v.id} type="button" className={"ae-pick__item" + (v.id === mediaId ? " is-on" : "")} onClick={() => setMediaId(v.id)} title={v.name}>
                <span className="ae-pick__thumb" style={v.thumbUrl ? { backgroundImage: `url(${v.thumbUrl})` } : undefined}><span className="mono">{fmtTime(v.duration)}</span></span>
                <span className="ae-pick__name">{v.name}</span>
              </button>
            ))}
          </div>
        )}
      </Field>

      <Field label="Indicaciones para la IA (opcional)" hint="Cómo quieres este vídeo. Mandan sobre tu estilo general.">
        <textarea className="textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej.: más ritmo, nada de gráficos en los primeros 5 s, una animación a pantalla completa con los 3 pasos, termina con «Escríbeme INFO»…" />
      </Field>

      <Field label="Vídeo de referencia (opcional)" hint="Lo edita como ese vídeo: mismo ritmo, subtítulos, gráficos y los mismos colores (LUT medida).">
        <RefPicker value={ref} onChange={setRef} />
      </Field>

      <Field label="Qué quieres">
        <div className="ae-modes">
          <button type="button" className={"ae-mode" + (kind === "variants" ? " is-on" : "")} onClick={() => setKind("variants")}>
            <b>Versiones de este vídeo</b><small>El mismo vídeo editado de 5 formas distintas para ver cuál funciona mejor.</small>
          </button>
          <button type="button" className={"ae-mode" + (kind === "shorts" ? " is-on" : "")} onClick={() => setKind("shorts")}>
            <b>Shorts de un vídeo largo</b><small>Claude saca hasta 20 shorts distintos: cada uno con su enfoque (consejo, historia, error, lista…), su gancho, su encuadre, su color y su música.</small>
          </button>
        </div>
      </Field>

      {kind === "variants" ? (
        <Field label="Versiones" hint="Se entregan en este orden; puedes ver cada una en cuanto acaba.">
          <div className="ae-vars">
            {info.variants.map((v) => {
              const on = variants.includes(v.key);
              const [w, h] = LAYOUT_SHAPE[v.layout] ?? [9, 16];
              return (
                <button key={v.key} type="button" className={"ae-var" + (on ? " is-on" : "")} onClick={() => setVariants((l) => (on ? l.filter((k) => k !== v.key) : [...l, v.key]))}>
                  <span className="ae-var__shape" style={{ width: (w / Math.max(w, h)) * 30, height: (h / Math.max(w, h)) * 30 }} />
                  <span><b>{v.label}</b><small>{v.width}×{v.height}</small></span>
                  <span className="ae-var__check">{on && <Check size={13} />}</span>
                </button>
              );
            })}
          </div>
        </Field>
      ) : (
        <Field label="Cuántos shorts" hint={shorts === "auto" ? "Claude saca uno por cada momento bueno (más o menos uno por minuto de vídeo, hasta 20)." : long ? "Si no hay material para tantos, saca los que den de sí sin repetirse." : "Funciona mejor con vídeos de más de 2 minutos."}>
          <div className="seg">{(["auto", 3, 5, 10, 15, 20] as const).map((n) => <button key={n} className={shorts === n ? "is-on" : ""} onClick={() => setShorts(n)}>{n === "auto" ? "Los que den de sí" : n}</button>)}</div>
        </Field>
      )}

      <Field label="Nombres y marcas que salen (opcional)" hint="Para que Whisper los escriba bien en los subtítulos. Ej.: OnePulso, cold email, LinkedIn.">
        <input className="input" value={vocab} onChange={(e) => setVocab(e.target.value)} placeholder="OnePulso, cold email, LinkedIn…" />
      </Field>
    </Modal>
  );
}

/* ---------- Trabajo ---------- */

function JobCard({ job, onChange }: { job: AutoJob; onChange: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const [askDel, setAskDel] = useState(false);
  const running = job.status === "running" || job.status === "queued";
  const ready = job.items.filter((i) => i.status === "done").length;

  return (
    <section className="card ae-job">
      <header className="ae-job__head">
        <span className="ae-job__thumb" style={job.media?.thumbUrl ? { backgroundImage: `url(${job.media.thumbUrl})` } : undefined} />
        <div className="ae-job__title">
          <h3>{job.plan?.topic || job.name}</h3>
          <div className="ae-job__meta">
            <span className="pill">{job.kind === "shorts" ? <><Scissors size={12} /> Shorts</> : <><Sparkles size={12} /> {job.items.length || job.options?.variants.length} versiones</>}</span>
            {job.brain && <span className={"pill " + (job.brain === "reglas" ? "pill--warn" : "pill--accent")}>{job.brain === "claude" ? "Editado por Claude" : job.brain === "deepseek" ? "Editado por la IA (DeepSeek)" : "Reglas fijas"}</span>}
            {job.items.length > 0 && <span className="muted">{ready} de {job.items.length} listas</span>}
            <span className="muted">{new Date(job.created_at).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>
        <span className="spacer" />
        {askDel ? (
          <><span className="muted">¿Quitar de la lista?</span><button className="btn btn--sm btn--danger" onClick={async () => { await autoApi.remove(job.id); onChange(); }}>Sí</button><button className="btn btn--sm" onClick={() => setAskDel(false)}>No</button></>
        ) : !running && <button className="btn btn--ghost btn--icon btn--sm" title="Quitar de la lista (los vídeos se quedan en «Vídeos exportados»)" onClick={() => setAskDel(true)}><Trash2 size={15} /></button>}
        <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setOpen((o) => !o)} aria-label={open ? "Plegar" : "Desplegar"}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </header>

      {open && (
        <>
          {running && (
            <div className="ae-progress">
              <div className="row"><Loader2 size={15} className="spin" /> <span>{job.step || "Trabajando…"}</span><span className="spacer" /><span className="mono">{Math.round(job.progress * 100)} %</span></div>
              <div className="progress"><span style={{ width: `${Math.max(3, job.progress * 100)}%` }} /></div>
            </div>
          )}
          {job.status === "needs_login" && (
            <div className="note note--warn ae-job__note">
              <div><b>Esperando a Claude.</b> No tiene la sesión iniciada en este ordenador. Inicia sesión y pulsa «Reintentar», o sigue con reglas fijas (queda peor).</div>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn--sm btn--primary" onClick={async () => { await autoApi.retry(job.id); onChange(); }}><RotateCcw size={14} /> Reintentar</button>
                <button className="btn btn--sm" onClick={async () => { await autoApi.useRules(job.id); onChange(); toast("Editando con reglas fijas"); }}>Seguir sin IA</button>
              </div>
            </div>
          )}
          {job.status === "error" && (
            <div className="note note--bad ae-job__note">
              <div><b>Se paró:</b> {job.error}</div>
              <button className="btn btn--sm" style={{ marginTop: 10 }} onClick={async () => { await autoApi.retry(job.id); onChange(); }}><RotateCcw size={14} /> Reintentar</button>
            </div>
          )}
          {job.summary && <p className="ae-job__summary"><Scissors size={13} /> {job.summary}</p>}
          {job.items.length > 0 && <div className="ae-items">{job.items.map((it) => <ItemCard key={it.id} item={it} onChange={onChange} />)}</div>}
        </>
      )}
    </section>
  );
}

/* ---------- Versión ---------- */

function ItemCard({ item, onChange }: { item: AutoItem; onChange: () => void }) {
  const toast = useToast();
  const [changes, setChanges] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [w, h] = LAYOUT_SHAPE[item.layout] ?? [9, 16];
  const working = !["done", "error"].includes(item.status);
  const qa = item.qa;
  const qaTone = !qa?.checked ? "muted" : qa.ok ? "ok" : "warn";

  const review = async (r: AutoItem["review"]) => { await autoApi.review(item.id, r); onChange(); };
  const schedule = (trial: boolean) => {
    if (!item.video) return;
    setPrefill({ exportId: item.video.id, caption: item.post?.caption, title: item.post?.youtubeTitle, trial });
    navigate(`/calendario?nuevo=${item.video.id}`);
  };

  const shape = useMemo(() => ({ aspectRatio: `${w} / ${h}` }), [w, h]);

  return (
    <article className={"ae-item" + (item.review === "approved" ? " is-approved" : item.review === "rejected" ? " is-rejected" : "")}>
      <div className="ae-item__media" style={shape}>
        {item.status === "done" && item.video ? (
          <video src={item.video.url} poster={item.video.thumbUrl ?? undefined} controls preload="metadata" />
        ) : item.status === "error" ? (
          <div className="ae-item__state ae-item__state--bad"><AlertTriangle size={22} /><span>No salió</span></div>
        ) : (
          <div className="ae-item__state">
            <Loader2 size={22} className="spin" />
            <span>{item.step || STEP_LABEL[item.status]}</span>
            {item.status !== "queued" && <div className="progress" style={{ width: "70%" }}><span style={{ width: `${Math.max(4, item.progress * 100)}%` }} /></div>}
          </div>
        )}
        {item.review === "approved" && <span className="ae-item__badge pill pill--ok"><Check size={12} /> Aprobada</span>}
        {item.review === "rejected" && <span className="ae-item__badge pill pill--bad"><X size={12} /> Descartada</span>}
      </div>

      <div className="ae-item__body">
        <div className="ae-item__head">
          <b>{item.label}</b>
          <span className="pill">{item.layout === "horizontal" ? "16:9" : item.layout === "framed" ? "4:5" : "9:16"}</span>
        </div>
        {item.short && (item.short.angle || item.short.look) && (
          <div className="ae-item__tags">
            {item.short.angle && <span className="pill pill--accent">{item.short.angle}</span>}
            {item.short.look && <span className="pill">{FRAMING_LABEL[item.short.look.framing] ?? item.short.look.framing}</span>}
            {item.short.look && item.short.look.grade !== "neutral" && <span className="pill">{GRADE_LABEL[item.short.look.grade] ?? item.short.look.grade}</span>}
          </div>
        )}
        {item.short?.hook && <p className="ae-item__why"><b>Gancho:</b> «{item.short.hook}»</p>}
        {item.short?.why && <p className="ae-item__why">{item.short.why}</p>}
        {item.status === "error" && <p className="ae-item__err">{item.error}</p>}
        {item.status === "done" && item.video && <span className="muted mono" style={{ fontSize: 12 }}>{fmtTime(item.video.duration, true)} · {fmtSize(item.video.size)}</span>}

        {item.status === "done" && qa && (
          <button className={"ae-qa ae-qa--" + qaTone} onClick={() => setQaOpen((o) => !o)}>
            {qaTone === "ok" ? <ShieldCheck size={14} /> : qaTone === "warn" ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
            {!qa.checked ? "Sin revisión automática" : qa.ok ? `Revisada: sin fallos${qa.score ? ` · ${qa.score}/10` : ""}` : `${qa.issues.length} aviso(s) de la revisión`}
            {(qa.issues.length > 0 || qa.note) && (qaOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
          </button>
        )}
        {qaOpen && qa && (
          <div className="ae-qa__list">
            {qa.note && <p>{qa.note}</p>}
            {qa.issues.map((i, k) => <p key={k}>{i.t != null && <span className="mono">{fmtTime(i.t, true)} · </span>}{i.problem}{i.fix && <span className="muted"> → {i.fix}</span>}</p>)}
          </div>
        )}
        {item.notes && <p className="ae-item__notes"><MessageSquareText size={13} /> Tus cambios: {item.notes}</p>}

        {item.status === "done" && item.video && (
          <div className="ae-item__actions">
            {item.review !== "approved" ? (
              <button className="btn btn--sm btn--primary" onClick={() => review("approved")}><CheckCircle2 size={14} /> Aprobar</button>
            ) : (
              <>
                <button className="btn btn--sm btn--primary" onClick={() => schedule(true)} title="Instagram la enseña primero a gente que no te sigue; mides las visitas antes de publicarla de verdad"><FlaskConical size={14} /> Probar como reel de prueba</button>
                <button className="btn btn--sm" onClick={() => schedule(false)}><CalendarPlus size={14} /> Programar normal</button>
              </>
            )}
            <button className="btn btn--sm" onClick={() => setChanges(true)} disabled={working}><MessageSquareText size={14} /> Pedir cambios</button>
            <button className="btn btn--sm" onClick={() => setRemoving(true)} disabled={working}><Eraser size={14} /> Quitar cosas</button>
            {item.review !== "rejected" && <button className="btn btn--sm btn--ghost btn--danger" onClick={() => review("rejected")}>Descartar</button>}
            <a className="btn btn--sm btn--ghost btn--icon" href={item.video.url} download={`${item.video.name}.mp4`} title="Descargar"><Download size={14} /></a>
          </div>
        )}
        {item.status === "error" && (
          <div className="ae-item__actions"><button className="btn btn--sm" onClick={async () => { await autoApi.retry(item.job_id); onChange(); }}><RotateCcw size={14} /> Volver a intentarlo</button></div>
        )}
      </div>

      {removing && <RemoveElements item={item} onClose={() => setRemoving(false)} onDone={() => { setRemoving(false); onChange(); }} />}

      {changes && (
        <Modal title={`Cambios en «${item.label}»`} onClose={() => setChanges(false)}
          foot={<><span className="spacer" /><button className="btn" onClick={() => setChanges(false)}>Cancelar</button>
            <button className="btn btn--primary" disabled={busy || notes.trim().length < 3} onClick={async () => {
              setBusy(true);
              try { await autoApi.changes(item.id, notes); toast("Rehaciendo esta versión con tus cambios"); setChanges(false); onChange(); }
              catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
            }}>{busy ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} Rehacer</button></>}>
          <Field label="¿Qué cambiarías?" hint="Como se lo dirías a un editor. Cada nota se aplica a todo el vídeo, no solo a un momento.">
            <textarea className="textarea" rows={5} autoFocus value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={"Ej.: los subtítulos más pequeños, quita el gráfico del segundo 12, la palabra clave en azul, más zooms al principio…"} />
          </Field>
        </Modal>
      )}
    </article>
  );
}

/** Quitar gráficos, animaciones, palabras o el titular de una versión y volver a editarla. */
function RemoveElements({ item, onClose, onDone }: { item: AutoItem; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<{ key: string; kind: string; label: string }[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { autoApi.elements(item.id).then(setList).catch((e) => { setList([]); toast((e as Error).message, "bad"); }); }, [item.id, toast]);
  async function go() {
    setBusy(true);
    try { await autoApi.removeElements(item.id, sel, notes); toast("Rehaciendo esta versión sin lo que has quitado"); onDone(); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Quitar cosas de «${item.label}»`} icon={<Eraser size={18} />} onClose={onClose}
      foot={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn--primary" disabled={busy || (!sel.length && notes.trim().length < 3)} onClick={go}>{busy ? <Loader2 size={15} className="spin" /> : <RotateCcw size={15} />} Volver a editar</button></>}>
      {list === null ? <p className="muted"><Loader2 size={13} className="spin" /> Cargando…</p> : list.length === 0 ? <p className="muted">Esta versión no lleva gráficos ni animaciones que quitar: puedes pedir cambios abajo.</p> : (
        <ul className="ae-rm">
          {list.map((e) => (
            <li key={e.key}><label>
              <input type="checkbox" checked={sel.includes(e.key)} onChange={(x) => setSel((l) => (x.target.checked ? [...l, e.key] : l.filter((k) => k !== e.key)))} />
              <span><b>{e.kind}</b>{e.label ? <small>{e.label}</small> : null}</span>
            </label></li>
          ))}
        </ul>
      )}
      <Field label="Y además (opcional)" hint="Se lo dices a la IA y lo aplica al rehacer esta versión.">
        <textarea className="textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: pon la animación más tarde, subtítulos más pequeños…" />
      </Field>
    </Modal>
  );
}
