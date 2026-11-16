// Estilos guardados: cada uno sale de vídeos de referencia que Claude estudia fotograma a fotograma.
// Se ven sus vídeos, lo que ha sacado (letra, color, posición, zooms, look) y se usa con un clic.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Eye, Film, Loader2, Pencil, Plus, RotateCcw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { presetsApi, type StylePreset, type StyleAsset } from "../style-api";
import { Modal, useToast } from "../ui";

const STATUS: Record<StylePreset["status"], string> = { queued: "En cola", analyzing: "Analizando", ready: "Listo", error: "No salió" };
const ZOOM: Record<string, string> = { smooth: "zooms suaves", punch: "zooms de golpe", none: "sin zooms" };
const GRAPHICS: Record<string, string> = { none: "sin gráficos", few: "pocos gráficos", balanced: "gráficos equilibrados", many: "muchos gráficos" };
const GRADE: Record<string, string> = { neutral: "color natural", warm: "cálido", cool: "frío", punchy: "contrastado", soft: "suave", cinematic: "cine" };

export default function Presets({ refs, onApplied }: { refs: StyleAsset[]; onApplied: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<StylePreset[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<StylePreset | null>(null);

  const load = useCallback(() => presetsApi.list().then(setList).catch((e) => { setList([]); toast(e.message, "bad"); }), [toast]);
  useEffect(() => { load(); }, [load]);
  // Mientras Claude analiza, se refresca solo
  const busy = list?.some((p) => p.status === "queued" || p.status === "analyzing");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [busy, load]);
  useEffect(() => { if (open && list) setOpen(list.find((p) => p.id === open.id) ?? null); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  async function use(p: StylePreset) {
    try { await presetsApi.use(p.id); toast(`Estilo «${p.name}» en uso: las próximas ediciones salen así`); await load(); onApplied(); } catch (e) { toast((e as Error).message, "bad"); }
  }
  async function fromRefs() {
    try { await presetsApi.create("Estilo nuevo", [], refs.map((r) => r.id)); toast("Claude va a estudiar tus referencias fotograma a fotograma"); load(); } catch (e) { toast((e as Error).message, "bad"); }
  }

  return (
    <section className="card st-sec pr-sec">
      <h3><Sparkles size={16} /> Estilos guardados</h3>
      <p className="st-hint" style={{ marginTop: -4 }}>Sube vídeos con la edición que quieres copiar. Claude los estudia fotograma a fotograma: tipografía (la descarga), color y contorno de los subtítulos, dónde salen, cuántas palabras, zooms, color de la imagen y cuántos gráficos. Se queda guardado y lo usas con un clic.</p>
      <div className="pr-grid">
        {list === null ? <p className="muted">Cargando…</p> : list.map((p) => (
          <article key={p.id} className={"pr-card" + (p.active ? " is-active" : "")}>
            <button className="pr-card__media" onClick={() => setOpen(p)} title="Ver vídeos y detalles">
              {p.videos[0] ? (p.videos[0].video
                ? <video src={p.videos[0].url + "#t=1"} muted playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                : <img src={p.videos[0].url} alt="" />) : <Film size={22} />}
              <span className="pr-card__count"><Film size={11} /> {p.videos.length}</span>
              {p.active && <span className="pr-card__badge"><Check size={12} /> En uso</span>}
            </button>
            <div className="pr-card__body">
              <b title={p.name}>{p.name}</b>
              <span className={"pr-status pr-status--" + p.status}>
                {(p.status === "queued" || p.status === "analyzing") && <Loader2 size={12} className="spin" />} {p.status === "ready" ? summaryLine(p) : p.status === "error" ? (p.error || STATUS.error) : (p.step || STATUS[p.status])}
              </span>
              <div className="row pr-card__actions">
                {p.status === "ready" && !p.active && <button className="btn btn--sm btn--primary" onClick={() => use(p)}>Usar este estilo</button>}
                <button className="btn btn--sm btn--ghost" onClick={() => setOpen(p)}><Eye size={14} /> Ver</button>
              </div>
            </div>
          </article>
        ))}
        <button className="pr-new" onClick={() => setCreating(true)}><Plus size={20} /><span>Nuevo estilo desde vídeos</span></button>
      </div>
      {refs.length > 0 && (
        <button className="btn btn--sm pr-fromrefs" onClick={fromRefs}><Sparkles size={14} /> Guardar mis {refs.length} referencias como un estilo</button>
      )}
      {creating && <NewPreset onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
      {open && <PresetDetail p={open} onClose={() => setOpen(null)} onChanged={load} onUse={() => use(open)} />}
    </section>
  );
}

function summaryLine(p: StylePreset) {
  const s = p.style;
  if (!s) return "Listo";
  return [p.fonts?.caption, s.caption.maxWords ? `${s.caption.maxWords} palabra${s.caption.maxWords > 1 ? "s" : ""}` : null, ZOOM[s.motion.zoomStyle || "smooth"], GRAPHICS[s.graphics || "few"]].filter(Boolean).join(" · ");
}

function NewPreset({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function save() {
    if (!files.length) return toast("Añade al menos un vídeo.", "bad");
    setBusy(true);
    try { await presetsApi.create(name.trim() || "Estilo nuevo", files); toast("Subido. Claude lo estudia en tu PC fotograma a fotograma."); onCreated(); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }
  return (
    <Modal title="Nuevo estilo desde vídeos" icon={<Sparkles size={18} color="var(--accent-2)" />} onClose={onClose}
      foot={<><span className="spacer" /><button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn--primary" disabled={busy || !files.length} onClick={save}>{busy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Guardar y analizar</button></>}>
      <label className="field"><span className="field__label">Nombre (opcional: si lo dejas vacío, Claude le pone uno)</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Subtítulos amarillos cine" /></label>
      <input ref={input} type="file" accept="video/*,image/*" multiple hidden onChange={(e) => { setFiles((l) => [...l, ...(e.target.files ? [...e.target.files] : [])]); e.target.value = ""; }} />
      <button className="mp__drop" onClick={() => input.current?.click()}><Upload size={22} /><span>{files.length ? `${files.length} archivo(s): añadir más` : "Elige 1-6 vídeos (o capturas) con esa edición"}</span></button>
      {files.length > 0 && <ul className="pr-files">{files.map((f, i) => <li key={i}><Film size={13} /> {f.name} <button className="btn btn--ghost btn--sm" onClick={() => setFiles((l) => l.filter((_, k) => k !== i))}><X size={12} /></button></li>)}</ul>}
    </Modal>
  );
}

function PresetDetail({ p, onClose, onChanged, onUse }: { p: StylePreset; onClose: () => void; onChanged: () => void; onUse: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState(0);
  const s = p.style, c = s?.caption;
  const v = p.videos[cur];
  async function rename() {
    const n = window.prompt("Nombre del estilo", p.name);
    if (!n?.trim()) return;
    await presetsApi.rename(p.id, n.trim()).catch((e) => toast(e.message, "bad"));
    onChanged();
  }
  async function del() {
    if (!window.confirm(`¿Borrar el estilo «${p.name}» y sus vídeos?`)) return;
    await presetsApi.remove(p.id).catch((e) => toast(e.message, "bad"));
    onChanged(); onClose();
  }
  async function again() { await presetsApi.analyze(p.id).catch((e) => toast(e.message, "bad")); toast("Claude lo vuelve a estudiar"); onChanged(); }
  return (
    <Modal wide title={p.name} icon={<Sparkles size={18} color="var(--accent-2)" />} onClose={onClose}
      foot={<>
        <button className="btn btn--ghost btn--sm" onClick={del}><Trash2 size={14} /> Borrar</button>
        <button className="btn btn--ghost btn--sm" onClick={rename}><Pencil size={14} /> Renombrar</button>
        <button className="btn btn--ghost btn--sm" onClick={again} disabled={p.status === "analyzing" || p.status === "queued"}><RotateCcw size={14} /> Analizar otra vez</button>
        <span className="spacer" />
        {p.status === "ready" && (p.active ? <span className="pill pill--ok"><Check size={12} /> En uso</span> : <button className="btn btn--primary" onClick={onUse}>Usar este estilo</button>)}
      </>}>
      <div className="pr-detail">
        <div className="pr-player">
          {v ? (v.video ? <video key={v.id} src={v.url} controls playsInline autoPlay muted /> : <img src={v.url} alt="" />) : <p className="muted">Sin vídeos</p>}
          {p.videos.length > 1 && (
            <div className="pr-thumbs">{p.videos.map((x, i) => (
              <button key={x.id} className={i === cur ? "is-on" : ""} onClick={() => setCur(i)} title={x.name}>
                {x.video ? <video src={x.url + "#t=1"} muted preload="metadata" /> : <img src={x.url} alt="" />}
              </button>
            ))}</div>
          )}
        </div>
        <div className="pr-info">
          {p.status !== "ready" ? (
            <p className={p.status === "error" ? "gate__err" : "muted"}>{p.status === "error" ? p.error : <><Loader2 size={13} className="spin" /> {p.step || STATUS[p.status]}</>}</p>
          ) : s && c ? (
            <>
              {p.analysis?.summary && <p className="pr-summary">{p.analysis.summary}</p>}
              <dl className="pr-specs">
                <dt>Tipografía</dt><dd>{p.fonts?.caption || "la de siempre"}{c.weight ? ` · ${c.weight}` : ""}{p.analysis?.fonts?.caption?.seen && p.analysis.fonts.caption.seen !== p.fonts?.caption ? <small> (en el vídeo parece {p.analysis.fonts.caption.seen})</small> : null}</dd>
                <dt>Subtítulos</dt><dd>
                  <span className="pr-sw" style={{ background: s.colors.caption || "#fff" }} /> {s.colors.caption || "#FFFFFF"}
                  {c.stroke ? <> · contorno <span className="pr-sw" style={{ background: c.stroke.color }} /> {c.stroke.width}px</> : null}
                  {c.bg ? " · con caja de fondo" : ""}{c.uppercase ? " · MAYÚSCULAS" : ""}
                </dd>
                <dt>Dónde y cuánto</dt><dd>a un {Math.round((c.yPct ?? 0.72) * 100)} % de la altura · {c.maxWords ?? 2} palabra(s) · {c.lines ?? 1} línea(s) · tamaño ×{c.scale ?? 1}</dd>
                <dt>Palabra clave</dt><dd>{c.keywordColor ? <><span className="pr-sw" style={{ background: c.keywordColor }} /> {c.keywordColor}</> : "sin color propio"} · {c.keywordFont === "same" ? "misma letra" : "otra letra"} · ×{c.keywordScale ?? 1}</dd>
                <dt>Movimiento</dt><dd>{ZOOM[s.motion.zoomStyle || "smooth"]} (hasta ×{s.motion.zoomMax ?? 1.1}){s.rhythm ? ` · ${s.rhythm.cutsPerMin} cambios de plano/min` : ""}</dd>
                <dt>Imagen</dt><dd>{GRADE[s.grade || "neutral"]}{s.look?.grain ? " · grano" : ""}{s.look?.vignette ? " · viñeta" : ""}{s.look?.letterbox ? " · bandas de cine" : ""}</dd>
                <dt>Gráficos</dt><dd>{GRAPHICS[s.graphics || "few"]}</dd>
              </dl>
              {s.rules && s.rules.length > 0 && <ul className="pr-rules">{s.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
