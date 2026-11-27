// Mi semana: tu semana tipo (qué día hablas a cámara, qué día formación grabando pantalla), lo que toca grabar
// esta semana y el plan del mes día a día, que escribe Claude con guion completo para cada pieza.
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clapperboard, Coffee, Loader2, Monitor, Plus, Sparkles, Video, Wand2 } from "lucide-react";
import { ideasApi, useIdeas, isoDay, hookOf, STATUS_LABEL, WEEKDAY, type Idea, type IdeasState, type Week, type WeekDay } from "../ideas-api";
import IdeaDetail, { FormatBadge, JobsBar } from "./IdeaDetail";
import { Modal, navigate, useToast } from "../ui";
import { IN_PANEL } from "../base";
import "./ideas.css";

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // lunes primero
const TYPE_LABEL: Record<WeekDay["type"], string> = { camara: "Hablando a cámara", pantalla: "Formación · pantalla", off: "Descanso" };
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthName = (key: string) => { const [y, m] = key.split("-").map(Number); const s = new Date(y, m - 1, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" }); return s[0].toUpperCase() + s.slice(1); };
/** Cuándo grabar: el día sugerido si aún no ha pasado esta semana; si ya pasó, hoy. */
function recordWhen(dow: number, n: number) {
  const idx = (d: number) => (d + 6) % 7;
  const one = n === 1;
  if (idx(dow) <= idx(new Date().getDay())) return one ? "Grábala hoy." : "Grábalas hoy, juntas.";
  return `${one ? "Grábala" : "Grábalas juntas"} el ${WEEKDAY[dow].toLowerCase()}.`;
}
const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

export default function Plan() {
  const { state, error, reload, setState } = useIdeas();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = state?.ideas.find((i) => i.id === openId) ?? null;
  if (!state) return <div className="page"><p className="muted">{error ? error : "Cargando…"}</p></div>;
  return (
    <div className="page id-page">
      <div className="page-head">
        <div>
          <h1>Mi semana</h1>
          <p>Tu semana tipo y el plan del mes: qué publicas cada día, en qué formato y qué te toca grabar. Claude escribe el guion de cada pieza.</p>
        </div>
        <div className="page-head__actions"><button className="btn" onClick={() => navigate("/ideas")}>Ideas de contenido</button></div>
      </div>
      <JobsBar jobs={state.jobs} onChange={reload} pcHint={IN_PANEL} />
      <WeekTemplate week={state.week} onSaved={(w) => setState({ ...state, week: w })} />
      <ThisWeek state={state} onOpen={setOpenId} reload={reload} />
      <MonthPlan state={state} onOpen={setOpenId} reload={reload} />
      {open && <IdeaDetail idea={open} jobs={state.jobs} onClose={() => setOpenId(null)} onChanged={() => reload()} />}
    </div>
  );
}

/* ---------- Semana tipo ---------- */

function WeekTemplate({ week, onSaved }: { week: Week; onSaved: (w: Week) => void }) {
  const toast = useToast();
  const [w, setW] = useState(week);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => setW(week), [week]);
  function change(next: Week) {
    setW(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ideasApi.saveWeek(next).then(onSaved).catch((e) => toast(e.message, "bad")), 600);
  }
  const setDay = (dow: number, f: Partial<WeekDay>) => change({ ...w, days: w.days.map((d) => (d.dow === dow ? { ...d, ...f } : d)) });
  const n = (t: WeekDay["type"]) => w.days.filter((d) => d.type === t).length;
  return (
    <section className="card id-sec">
      <div className="id-sec__head">
        <h3><CalendarDays size={16} /> Tu semana tipo</h3>
        <span className="muted">{n("camara")} días hablando a cámara · {n("pantalla")} de formación grabando pantalla · {n("off")} de descanso</span>
        <span className="spacer" />
        <label className="id-time">Publicar a las <input type="time" className="input input--sm" value={w.time} onChange={(e) => change({ ...w, time: e.target.value })} /></label>
      </div>
      <div className="id-week">
        {ORDER.map((dow) => {
          const d = w.days.find((x) => x.dow === dow)!;
          return (
            <div key={dow} className={"id-wd id-wd--" + d.type}>
              <b>{WEEKDAY[dow]}</b>
              <div className="id-wd__types">
                {(["camara", "pantalla", "off"] as const).map((t) => {
                  const Icon = t === "camara" ? Video : t === "pantalla" ? Monitor : Coffee;
                  return <button key={t} className={d.type === t ? "is-on" : ""} title={TYPE_LABEL[t]} onClick={() => setDay(dow, { type: t, label: t === "pantalla" && !d.label ? "Formación" : t === "off" ? "" : d.label })}><Icon size={14} /></button>;
                })}
              </div>
              <span className="id-wd__type">{TYPE_LABEL[d.type]}</span>
              {d.type !== "off" && <input className="input input--sm" placeholder="Tema (opcional)" value={d.label} onChange={(e) => setDay(dow, { label: e.target.value })} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Esta semana ---------- */

function ThisWeek({ state, onOpen, reload }: { state: IdeasState; onOpen: (id: string) => void; reload: () => void }) {
  const toast = useToast();
  const mon = mondayOf(new Date());
  const days = Array.from({ length: 7 }, (_, k) => { const d = new Date(mon); d.setDate(mon.getDate() + k); return d; });
  const today = isoDay(new Date());
  const byDate = useMemo(() => {
    const m = new Map<string, Idea[]>();
    for (const i of state.ideas) if (i.date && i.status !== "descartada") m.set(i.date, [...(m.get(i.date) || []), i]);
    return m;
  }, [state.ideas]);
  const pieces = days.flatMap((d) => byDate.get(isoDay(d)) || []);
  const toRecord = (f: Idea["format"]) => pieces.filter((i) => i.format === f && ["plan", "idea"].includes(i.status));
  const firstDay = (t: WeekDay["type"]) => ORDER.find((dow) => state.week.days.find((x) => x.dow === dow)?.type === t);
  // Sugerencia de grabación en bloque: las de cámara juntas el primer día de cámara; las de pantalla, el día antes de la primera
  const pFirst = firstDay("pantalla");
  const screenDay = pFirst == null ? null : ORDER[Math.max(0, ORDER.indexOf(pFirst) - 1)];
  const mark = (i: Idea, status: Idea["status"]) => ideasApi.update(i.id, { status }).then(() => { reload(); toast(`«${i.title}»: ${STATUS_LABEL[status].toLowerCase()}`); }).catch((e) => toast(e.message, "bad"));

  return (
    <section className="card id-sec">
      <div className="id-sec__head">
        <h3><Clapperboard size={16} /> Esta semana</h3>
        <span className="muted">del {days[0].toLocaleDateString("es-ES", { day: "numeric", month: "short" })} al {days[6].toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>
      </div>
      {!pieces.length ? (
        <p className="muted">No hay nada planificado esta semana. Genera el plan del mes abajo o pon fecha a alguna idea.</p>
      ) : (
        <>
          <div className="id-rec">
            {(["camara", "pantalla"] as const).map((f) => {
              const list = toRecord(f);
              if (!list.length) return null;
              const day = f === "camara" ? firstDay("camara") : screenDay;
              return (
                <div key={f} className={"id-rec__box id-rec__box--" + f}>
                  <b>{f === "camara" ? <Video size={15} /> : <Monitor size={15} />} Por grabar: {list.length} {f === "camara" ? "hablando a cámara" : "de formación (pantalla)"}</b>
                  {day != null && <span className="muted">{recordWhen(day, list.length)}{f === "pantalla" ? " Deja preparadas antes las cuentas y pestañas de cada tutorial." : list.length > 1 ? " Mismo plano y misma luz, una detrás de otra." : ""}</span>}
                  <ul>{list.map((i) => <li key={i.id}><button className="id-link" onClick={() => onOpen(i.id)}>{i.title}</button><button className="btn btn--ghost btn--sm" onClick={() => mark(i, "grabada")}><Check size={13} /> Grabada</button></li>)}</ul>
                </div>
              );
            })}
          </div>
          <div className="id-days">
            {days.map((d) => {
              const iso = isoDay(d);
              const t = state.week.days.find((x) => x.dow === d.getDay())!;
              const list = byDate.get(iso) || [];
              return (
                <div key={iso} className={"id-day" + (iso === today ? " is-today" : "") + (t.type === "off" ? " is-off" : "")}>
                  <span className="id-day__name">{WEEKDAY[d.getDay()].slice(0, 3)} <b>{d.getDate()}</b></span>
                  {list.length ? list.map((i) => (
                    <button key={i.id} className={"id-piece id-piece--" + i.format} onClick={() => onOpen(i.id)}>
                      <span className="id-piece__t">{i.title}</span>
                      <span className={"id-st id-st--" + i.status}>{STATUS_LABEL[i.status]}</span>
                    </button>
                  )) : <span className="id-day__empty">{t.type === "off" ? "Descanso" : TYPE_LABEL[t.type]}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- Plan del mes ---------- */

function MonthPlan({ state, onOpen, reload }: { state: IdeasState; onOpen: (id: string) => void; reload: () => void }) {
  const toast = useToast();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [picking, setPicking] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const start = mondayOf(first);
  const cells = Array.from({ length: 42 }, (_, k) => { const d = new Date(start); d.setDate(start.getDate() + k); return d; })
    .filter((d, k) => k < 35 || d.getMonth() === m - 1);
  const today = isoDay(new Date());
  const inMonth = state.ideas.filter((i) => i.date?.startsWith(month) && i.status !== "descartada");
  const plan = state.plans[month];
  const job = state.jobs.find((j) => j.kind === "plan" && j.ref === month && (j.status === "queued" || j.status === "running"));
  const pastMonth = month < monthKey(new Date());
  const shift = (k: number) => setMonth(monthKey(new Date(y, m - 1 + k, 1)));

  async function generate() {
    const replace = inMonth.some((i) => i.status === "plan");
    if (replace && !confirm(`Ya hay piezas planificadas en ${monthName(month)}. ¿Rehacer el plan? Lo que ya hayas grabado, editado o publicado se queda.`)) return;
    setAsking(true);
    try { await ideasApi.plan(month, replace); toast(IN_PANEL ? "Encargado: tu PC se lo pasa a Claude" : "Claude está preparando el plan"); reload(); } catch (e) { toast((e as Error).message, "bad"); }
    setAsking(false);
  }

  return (
    <section className="card id-sec">
      <div className="id-sec__head">
        <h3><Sparkles size={16} /> Plan del mes</h3>
        <div className="row id-month">
          <button className="btn btn--ghost btn--icon btn--sm" onClick={() => shift(-1)} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
          <b>{monthName(month)}</b>
          <button className="btn btn--ghost btn--icon btn--sm" onClick={() => shift(1)} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
        </div>
        <span className="spacer" />
        <button className="btn btn--primary" disabled={!!job || asking || pastMonth} onClick={generate}>
          {job || asking ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} {inMonth.some((i) => i.status === "plan") ? "Rehacer el plan" : `Generar plan de ${monthName(month).split(" ")[0].toLowerCase()}`}
        </button>
      </div>
      {job && <p className="note id-working"><Loader2 size={14} className="spin" /> {job.step}{job.status === "queued" && IN_PANEL ? " · en cuanto tu PC esté encendido" : ""}</p>}
      {plan && (
        <div className="id-plan">
          <p>{plan.summary}</p>
          {plan.weeks.length ? <div className="id-plan__weeks">{plan.weeks.map((w) => <div key={w.week}><span className="id-k">Semana {w.week}</span><b>{w.theme}</b><span className="muted">{w.goal}</span></div>)}</div> : null}
        </div>
      )}
      <div className="id-cal">
        {ORDER.map((d) => <span key={d} className="id-cal__wd">{WEEKDAY[d].slice(0, 3)}</span>)}
        {cells.map((d) => {
          const iso = isoDay(d);
          const t = state.week.days.find((x) => x.dow === d.getDay())!;
          const list = inMonth.filter((i) => i.date === iso);
          const out = d.getMonth() !== m - 1;
          return (
            <div key={iso} className={"id-cal__day id-cal__day--" + t.type + (out ? " is-out" : "") + (iso === today ? " is-today" : "")}>
              <span className="id-cal__num">{d.getDate()}{t.type !== "off" && !out && <i title={TYPE_LABEL[t.type]}>{t.type === "camara" ? <Video size={11} /> : <Monitor size={11} />}</i>}</span>
              {!out && list.map((i) => (
                <button key={i.id} className={"id-piece id-piece--" + i.format + " id-piece--sm" + (i.status === "publicada" ? " is-done" : "")} onClick={() => onOpen(i.id)} title={i.title}>
                  <span className="id-piece__t">{i.title}</span>
                  {i.status !== "plan" && <span className={"id-dot id-dot--" + i.status} title={STATUS_LABEL[i.status]} />}
                </button>
              ))}
              {!out && !list.length && t.type !== "off" && iso >= today && (
                <button className="id-cal__add" onClick={() => setPicking(iso)} title="Poner una idea este día"><Plus size={13} /></button>
              )}
            </div>
          );
        })}
      </div>
      <div className="id-legend">
        <FormatBadge format="camara" small /><FormatBadge format="pantalla" small />
        <span><i className="id-dot id-dot--grabada" /> grabada</span><span><i className="id-dot id-dot--editada" /> editada</span><span><i className="id-dot id-dot--publicada" /> publicada</span>
      </div>
      {picking && <PickIdea date={picking} state={state} onClose={() => setPicking(null)} onPicked={() => { setPicking(null); reload(); }} />}
    </section>
  );
}

function PickIdea({ date, state, onClose, onPicked }: { date: string; state: IdeasState; onClose: () => void; onPicked: () => void }) {
  const toast = useToast();
  const dow = new Date(date + "T12:00").getDay();
  const type = state.week.days.find((x) => x.dow === dow)?.type;
  const bank = state.ideas.filter((i) => i.status === "idea").sort((a, b) => Number(b.format === type) - Number(a.format === type) || Number(b.favorite) - Number(a.favorite));
  return (
    <Modal title={`Idea para el ${new Date(date + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}`} onClose={onClose}>
      {type && type !== "off" && <p className="muted">Ese día toca: <b>{TYPE_LABEL[type]}</b>.</p>}
      {!bank.length ? <p className="muted">No tienes ideas sin usar. Genera algunas en «Ideas de contenido».</p> : (
        <div className="id-pick">
          {bank.map((i) => (
            <button key={i.id} className="id-pick__row" onClick={() => ideasApi.update(i.id, { date }).then(onPicked).catch((e) => toast(e.message, "bad"))}>
              <FormatBadge format={i.format} small />
              <span><b>{i.title}</b><span className="muted">«{hookOf(i)}»</span></span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
