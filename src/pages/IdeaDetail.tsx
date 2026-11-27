// Ficha de una idea: gancho, guion por partes (lo que dices y lo que se ve), pasos de la grabación de pantalla,
// cómo grabarlo, portada, descripción y hashtags. Desde aquí se planifica, se marca el avance y se piden cambios.
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Monitor, RotateCcw, Sparkles, Star, Trash2, Video, Wand2, X } from "lucide-react";
import { ideasApi, hookOf, scriptText, ANGLE_LABEL, FORMAT_LABEL, PILLAR_LABEL, STATUS_LABEL, type Idea, type IdeaStatus, type IdeasJob } from "../ideas-api";
import { Modal, useToast } from "../ui";

export function FormatBadge({ format, small }: { format: Idea["format"]; small?: boolean }) {
  const Icon = format === "pantalla" ? Monitor : Video;
  return <span className={"id-fmt id-fmt--" + format + (small ? " id-fmt--sm" : "")}><Icon size={small ? 11 : 13} /> {FORMAT_LABEL[format]}</span>;
}

const FLOW: IdeaStatus[] = ["idea", "plan", "grabada", "editada", "publicada"];

export default function IdeaDetail({ idea, jobs, onClose, onChanged }: {
  idea: Idea; jobs: IdeasJob[]; onClose: () => void; onChanged: (i?: Idea | null) => void;
}) {
  const toast = useToast();
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [notes, setNotes] = useState(idea.notes);
  useEffect(() => setNotes(idea.notes), [idea.id, idea.notes]);
  const job = jobs.find((j) => j.kind === "script" && j.ref === idea.id && (j.status === "queued" || j.status === "running"));

  async function patch(f: Parameters<typeof ideasApi.update>[1], msg?: string) {
    try { const i = await ideasApi.update(idea.id, f); onChanged(i); if (msg) toast(msg); } catch (e) { toast((e as Error).message, "bad"); }
  }
  async function rewrite(request: string) {
    setAsking(true);
    try { await ideasApi.rewrite(idea.id, request); setAsk(""); toast("Claude está reescribiendo el guion"); onChanged(); } catch (e) { toast((e as Error).message, "bad"); }
    setAsking(false);
  }
  const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast(`${what} copiado`)).catch(() => toast("No se pudo copiar", "bad"));

  return (
    <Modal wide title={idea.title} onClose={onClose}
      icon={<button className={"btn btn--ghost btn--icon btn--sm id-star" + (idea.favorite ? " is-on" : "")} title={idea.favorite ? "Quitar de favoritas" : "Favorita"} onClick={() => patch({ favorite: !idea.favorite })}><Star size={16} /></button>}
      foot={
        <>
          <button className="btn btn--sm btn--danger" onClick={async () => {
            if (idea.status === "descartada") { if (!confirm("¿Borrar esta idea para siempre?")) return; await ideasApi.remove(idea.id).catch(() => {}); onChanged(null); onClose(); }
            else patch({ status: "descartada", date: null }, "Idea descartada");
          }}><Trash2 size={14} /> {idea.status === "descartada" ? "Borrar" : "Descartar"}</button>
          <span className="spacer" />
          {!idea.needsScript && <button className="btn btn--sm" onClick={() => copy(scriptText(idea), "Guion")}><Copy size={14} /> Copiar guion</button>}
          <button className="btn btn--sm btn--primary" onClick={onClose}>Hecho</button>
        </>
      }>
      <div className="id-detail">
        <div className="id-detail__meta">
          <FormatBadge format={idea.format} />
          {idea.pillar && <span className="pill">{PILLAR_LABEL[idea.pillar] || idea.pillar}</span>}
          {idea.angle && <span className="pill">{ANGLE_LABEL[idea.angle] || idea.angle}</span>}
          {idea.duration ? <span className="pill">~{idea.duration} s</span> : null}
          <span className="spacer" />
          <label className="id-date">Publicar el
            <input type="date" className="input input--sm" value={idea.date || ""} onChange={(e) => patch({ date: e.target.value || null }, e.target.value ? "Idea planificada" : "Quitada del plan")} />
          </label>
        </div>

        <div className="id-flow" role="group" aria-label="Avance">
          {FLOW.map((s, k) => {
            const done = FLOW.indexOf(idea.status) >= k;
            return (
              <button key={s} className={"id-flow__step" + (done ? " is-done" : "") + (idea.status === s ? " is-cur" : "")} onClick={() => patch({ status: s }, `Marcada como «${STATUS_LABEL[s]}»`)}>
                {done && k > 0 ? <Check size={13} /> : null}{STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>

        {job && <div className="note id-working"><Loader2 size={15} className="spin" /> {job.step || "Claude está trabajando en este guion"}…</div>}

        {idea.needsScript ? (
          <div className="note note--warn id-nosc">
            <span>Esta pieza del plan todavía no tiene guion completo. Gancho previsto: <b>{idea.hook}</b></span>
            <button className="btn btn--sm btn--primary" disabled={!!job || asking} onClick={() => rewrite("Escribe el guion completo de esta idea.")}><Wand2 size={14} /> Escribir guion</button>
          </div>
        ) : (
          <>
            <section className="id-hook">
              <span className="id-k">Gancho · primeros 3 segundos</span>
              <p>«{hookOf(idea)}»</p>
              {idea.hookVisual && <span className="id-hook__vis">Se ve: {idea.hookVisual}</span>}
            </section>

            <section>
              <h4 className="id-h">Guion</h4>
              <div className="id-script">
                <div className="id-script__head"><span>Parte</span><span>Lo que dices</span><span>{idea.format === "pantalla" ? "Lo que enseñas en pantalla" : "Lo que se ve"}</span></div>
                {(idea.script || []).map((p, k) => (
                  <div key={k} className="id-script__row">
                    <span className="id-script__part"><b>{p.part}</b>{p.time && <em>{p.time}</em>}</span>
                    <span className="id-script__say">{p.say}</span>
                    <span className="id-script__show">{p.show}</span>
                  </div>
                ))}
              </div>
            </section>

            {(idea.screen?.length || idea.prep?.length || idea.howTo) ? (
              <div className="id-cols">
                {idea.screen?.length ? (
                  <section>
                    <h4 className="id-h"><Monitor size={15} /> Grabación de pantalla, paso a paso</h4>
                    <ol className="id-steps">{idea.screen.map((s, k) => <li key={k}>{s}</li>)}</ol>
                  </section>
                ) : null}
                <section>
                  {idea.prep?.length ? <><h4 className="id-h">Antes de grabar</h4><ul className="id-list">{idea.prep.map((s, k) => <li key={k}>{s}</li>)}</ul></> : null}
                  {idea.howTo && <><h4 className="id-h">Cómo grabarlo</h4><p className="id-p">{idea.howTo}</p></>}
                </section>
              </div>
            ) : null}

            <div className="id-cols">
              <section>
                <h4 className="id-h">Descripción
                  <button className="btn btn--ghost btn--sm" onClick={() => copy(`${idea.caption || ""}\n\n${(idea.hashtags || []).map((h) => "#" + h).join(" ")}`, "Descripción")}><Copy size={13} /> Copiar</button>
                </h4>
                <p className="id-p id-caption">{idea.caption}</p>
                <div className="id-tags">{(idea.hashtags || []).map((h) => <span key={h}>#{h}</span>)}</div>
              </section>
              <section>
                {idea.cover && <><h4 className="id-h">Texto de portada</h4><p className="id-cover">{idea.cover}</p></>}
                {idea.inspiration && (idea.inspiration.creator || idea.inspiration.why) && (
                  <>
                    <h4 className="id-h">De dónde sale</h4>
                    <p className="id-p">
                      {idea.inspiration.creator && <b>{idea.inspiration.creator} </b>}
                      {idea.inspiration.post && /^https:\/\//.test(idea.inspiration.post) && <a href={idea.inspiration.post} target="_blank" rel="noreferrer">ver post <ExternalLink size={12} /></a>}
                      {idea.inspiration.why && <>{(idea.inspiration.creator || idea.inspiration.post) && <br />}{idea.inspiration.why}</>}
                    </p>
                  </>
                )}
              </section>
            </div>
          </>
        )}

        <section className="id-ask">
          <h4 className="id-h"><Sparkles size={15} /> Pedir cambios a Claude</h4>
          <div className="row">
            <input className="input" placeholder="Ej.: gancho más polémico, más corto, añade un ejemplo con una agencia…" value={ask} onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask.trim() && rewrite(ask.trim())} disabled={!!job} />
            <button className="btn btn--primary" disabled={!ask.trim() || !!job || asking} onClick={() => rewrite(ask.trim())}><Wand2 size={15} /> Reescribir</button>
          </div>
          <div className="id-quick">
            {["Gancho más fuerte", "Más corto (25 s)", "Añade un ejemplo real", "Más cercano, menos formal"].map((q) => (
              <button key={q} className="btn btn--ghost btn--sm" disabled={!!job || asking || !!idea.needsScript} onClick={() => rewrite(q)}><RotateCcw size={12} /> {q}</button>
            ))}
          </div>
        </section>

        <section>
          <h4 className="id-h">Tus notas</h4>
          <textarea className="textarea" rows={2} placeholder="Apuntes para la grabación…" value={notes} onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== idea.notes && patch({ notes })} />
        </section>
      </div>
    </Modal>
  );
}

/** Lo que Claude tiene entre manos (y lo que acaba de terminar o falló). */
export function JobsBar({ jobs, onChange, pcHint }: { jobs: IdeasJob[]; onChange: () => void; pcHint?: boolean }) {
  const toast = useToast();
  const shown = jobs.filter((j) => j.status !== "cancelled" && (j.status !== "done" || Date.now() - new Date(j.updated_at).getTime() < 60e3));
  if (!shown.length) return null;
  return (
    <div className="id-jobs">
      {shown.map((j) => (
        <div key={j.id} className={"id-job id-job--" + j.status}>
          {j.status === "done" ? <Check size={15} /> : j.status === "error" || j.status === "needs_login" ? <X size={15} /> : <Loader2 size={15} className="spin" />}
          <b>{j.label}</b>
          <span className="id-job__step">
            {j.status === "done" ? "Listo" : j.status === "error" ? j.error : j.status === "needs_login" ? (j.error || "Claude no tiene la sesión iniciada") : j.step}
            {j.status === "queued" && pcHint ? " · se hace en cuanto tu PC esté encendido" : ""}
          </span>
          {(j.status === "queued" || j.status === "running") && <span className="id-job__bar"><i style={{ width: `${Math.max(4, j.progress || 0)}%` }} /></span>}
          {(j.status === "error" || j.status === "needs_login") && <button className="btn btn--sm" onClick={() => ideasApi.retryJob(j.id).then(onChange).catch((e) => toast(e.message, "bad"))}>Reintentar</button>}
          {(j.status === "queued" || j.status === "error" || j.status === "needs_login") && <button className="btn btn--ghost btn--sm btn--icon" title="Quitar" onClick={() => ideasApi.cancelJob(j.id).then(onChange)}><X size={14} /></button>}
        </div>
      ))}
    </div>
  );
}
