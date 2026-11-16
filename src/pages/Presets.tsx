// Estilos guardados: cada uno sale de vídeos de referencia que Claude estudia fotograma a fotograma.
// Se ven sus vídeos, lo que ha sacado (letra, color, posición, zooms, look) y se usa con un clic.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Eye, Film, Loader2, Pencil, Plus, RotateCcw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { presetsApi, type PresetGfx, type PresetProgress, type PresetSub, type StylePreset, type StyleAsset } from "../style-api";
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
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [busy, load]);
  useEffect(() => { if (open && list) setOpen(list.find((p) => p.id === open.id) ?? null); }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  async function use(p: StylePreset) {
    try { await presetsApi.use(p.id); toast(`Estilo «${p.name}» en uso: las próximas ediciones salen así`); await load(); onApplied(); } catch (e) { toast((e as Error).message, "bad"); }
  }
  async function fromRefs() {
    try { const p = await presetsApi.create("Estilo nuevo", [], refs.map((r) => r.id)); toast("Claude va a estudiar tus referencias una a una"); await load(); setOpen(p); } catch (e) { toast((e as Error).message, "bad"); }
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
              {(p.status === "queued" || p.status === "analyzing") && <Bar pct={p.analysis?.progress?.pct ?? (p.status === "queued" ? 0 : 2)} />}
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
      {creating && <NewPreset onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); load().then(() => setOpen(p)); }} />}
      {open && <PresetDetail p={open} onClose={() => setOpen(null)} onChanged={load} onUse={() => use(open)} onApplied={() => { load(); onApplied(); }} />}
    </section>
  );
}

function summaryLine(p: StylePreset) {
  const s = p.style;
  if (!s) return "Listo";
  return [p.fonts?.caption, s.caption.maxWords ? `${s.caption.maxWords} palabra${s.caption.maxWords > 1 ? "s" : ""}` : null, ZOOM[s.motion.zoomStyle || "smooth"], GRAPHICS[s.graphics || "few"]].filter(Boolean).join(" · ");
}

function NewPreset({ onClose, onCreated }: { onClose: () => void; onCreated: (p: StylePreset) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function save() {
    if (!files.length) return toast("Añade al menos un vídeo.", "bad");
    setBusy(true);
    try { const p = await presetsApi.create(name.trim() || "Estilo nuevo", files); toast("Subido. Claude estudia cada vídeo, uno a uno."); onCreated(p); }
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

function PresetDetail({ p, onClose, onChanged, onUse, onApplied }: { p: StylePreset; onClose: () => void; onChanged: () => void; onUse: () => void; onApplied: () => void }) {
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
            p.status === "error" ? <p className="gate__err">{p.error}</p>
              : <Progress p={p.analysis?.progress} step={p.step || STATUS[p.status]} videos={p.videos.map((x) => x.name)} />
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
              {p.analysis?.zooms && p.analysis.zooms.some((z) => z.zoomStyle) && (
                <div className="pr-zooms"><b>Zooms medidos fotograma a fotograma</b>
                  {p.analysis.zooms.map((z) => <span key={z.video}>Vídeo {z.video + 1}: {z.zoomStyle ? `${ZOOM[z.zoomStyle]}${z.zoomStyle !== "none" ? ` · hasta ×${z.zoomMax} · ${z.perMin} por minuto` : ""}` : "no se pudo medir"}</span>)}
                </div>
              )}
              {s.rules && s.rules.length > 0 && <ul className="pr-rules">{s.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>}
            </>
          ) : null}
        </div>
      </div>
      {p.status === "ready" && p.analysis?.subtitles && p.analysis.subtitles.length > 0 && (
        <SubsPicker p={p} onApplied={onApplied} />
      )}
      {p.status === "ready" && p.analysis?.graphics && p.analysis.graphics.length > 0 && (
        <GfxPicker p={p} onApplied={onApplied} />
      )}
      {p.status === "ready" && !p.analysis?.subtitles && (
        <div className="note" style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <span>Este estilo se analizó con la versión anterior. Vuelve a analizarlo para ver los <b>subtítulos encontrados</b> (recortes reales y su animación) y elegir cuál copiar.</span>
          <button className="btn btn--primary btn--sm" onClick={again}><RotateCcw size={14} /> Analizar otra vez</button>
        </div>
      )}
    </Modal>
  );
}

function Bar({ pct }: { pct: number }) {
  return <div className="pr-bar"><span style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></div>;
}

/** Avance del análisis: una barra por vídeo con lo que está haciendo. */
function Progress({ p, step, videos }: { p?: PresetProgress; step: string; videos: string[] }) {
  const list = p?.videos?.length ? p.videos : videos.map((name) => ({ name, pct: 0, step: "En cola" }));
  return (
    <div className="pr-prog">
      <div className="pr-prog__head"><Loader2 size={14} className="spin" /> <b>{p ? `${p.pct} %` : ""}</b> {step}</div>
      <Bar pct={p?.pct ?? 1} />
      <ul>
        {list.map((v, i) => (
          <li key={i}>
            <div className="pr-prog__row"><span title={v.name}>Vídeo {i + 1} · {v.name}</span><span className="mono">{v.pct} %</span></div>
            <Bar pct={v.pct} />
            <small>{v.step}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROLE: Record<PresetSub["role"], string> = { subtitle: "Subtítulo", keyword: "Palabra clave", title: "Titular", watermark: "Marca de agua", other: "Otro texto" };
const ANIM: Record<string, string> = { pop: "palabra a palabra con rebote", word: "palabra a palabra, de golpe", typewriter: "letra a letra", soft: "fundido suave", none: "sin animación" };

/** Los subtítulos que Claude ha encontrado (recortes reales y su animación): eliges cuál copiar. */
function SubsPicker({ p, onApplied }: { p: StylePreset; onApplied: () => void }) {
  const toast = useToast();
  const all = p.analysis!.subtitles!;
  const subs = all.filter((x) => x.role !== "watermark");
  const marks = all.filter((x) => x.role === "watermark");
  const [sub, setSub] = useState<string | null>(p.analysis?.choice?.subtitle ?? subs[0]?.id ?? null);
  const [kw, setKw] = useState<string | null>(p.analysis?.choice?.keyword ?? null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const changed = sub !== (p.analysis?.choice?.subtitle ?? null) || kw !== (p.analysis?.choice?.keyword ?? null);
  async function apply() {
    if (!sub) return;
    setBusy(true);
    try { await presetsApi.choose(p.id, sub, kw, true); toast("Aplicado: la vista previa y las próximas ediciones usan estos subtítulos"); onApplied(); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }
  return (
    <div className="pr-subs">
      <div className="pr-subs__head">
        <div><b>Subtítulos encontrados</b><small>Recortados de tus vídeos tal cual salen. Elige cuál copiar como subtítulo y, si quieres, cuál como palabra clave.</small></div>
        <button className="btn btn--primary" disabled={!sub || busy || (!changed && p.active)} onClick={apply}>{busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {p.active && !changed ? "Aplicado" : "Aplicar estos subtítulos"}</button>
      </div>
      <div className="pr-subs__grid">
        {subs.map((x) => (
          <article key={x.id} className={"pr-sub" + (sub === x.id ? " is-sub" : "") + (kw === x.id ? " is-kw" : "")}>
            <div className="pr-sub__shots">
              {x.samples.map((m, i) => <img key={i} src={m.url} alt={m.text} title={`«${m.text}» · segundo ${m.t}`} onClick={() => setZoom(m.url)} />)}
              {!x.samples.length && <span className="muted">Sin recorte</span>}
            </div>
            <div className="pr-sub__body">
              <div className="pr-sub__title"><span className="pill">{ROLE[x.role]}</span> <small>vídeo {x.video + 1} · visto {x.count} {x.count === 1 ? "vez" : "veces"}</small></div>
              <p>{x.label}</p>
              <dl>
                <dt>Letra</dt><dd>{x.font.seen || x.font.family || "?"}{x.font.got ? <small> → {x.font.got} (descargada)</small> : x.font.family ? <small> → {x.font.family}</small> : null}</dd>
                <dt>Color</dt><dd><span className="pr-sw" style={{ background: x.spec.color }} /> {x.spec.color}{x.spec.stroke ? <> · contorno <span className="pr-sw" style={{ background: x.spec.stroke.color }} /> {x.spec.stroke.width}px</> : null}{x.spec.bg ? " · caja" : ""}{x.spec.uppercase ? " · MAYÚS." : ""}</dd>
                <dt>Tamaño</dt><dd>{x.fontPx}px · a un {Math.round((x.spec.yPct ?? 0.7) * 100)} % de alto · {x.spec.maxWords ?? "?"} palabra(s)</dd>
                <dt>Entrada</dt><dd>{x.animation ? `${ANIM[x.animation.type] || x.animation.type} · ${x.animation.inMs} ms` : "sin capturar"}</dd>
              </dl>
              {x.animation?.notes && <small className="pr-sub__notes">{x.animation.notes}</small>}
              {x.strip && <button className="pr-sub__strip" onClick={() => setZoom(x.strip!.url)} title="Fotograma a fotograma: cómo entra"><img src={x.strip.url} alt="Animación fotograma a fotograma" /><span>Ver la animación fotograma a fotograma</span></button>}
              <div className="row pr-sub__pick">
                <label><input type="radio" name={"sub-" + p.id} checked={sub === x.id} onChange={() => { setSub(x.id); if (kw === x.id) setKw(null); }} /> Subtítulo</label>
                <label><input type="checkbox" checked={kw === x.id} disabled={sub === x.id} onChange={(e) => setKw(e.target.checked ? x.id : null)} /> Palabra clave</label>
              </div>
            </div>
          </article>
        ))}
      </div>
      {marks.length > 0 && <p className="muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>También vi (no se copia): {marks.map((m) => m.samples[0]?.text || m.label).join(" · ")}</p>}
      {zoom && <div className="pr-zoom" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>}
    </div>
  );
}

/** Muestra una plantilla de gráfico tal cual la pinta el render (en un marco aislado, sin scripts). */
export function GfxLive({ g, scale = 0.42 }: { g: PresetGfx; scale?: number }) {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  const body = g.html.replace(/\{\{\s*([a-zA-Z_]\w*)\s*\}\}/g, (_, k) => k === "icon"
    ? '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>'
    : esc(g.fields.find((f) => f.key === k)?.example ?? k));
  const W = g.width + 40, H = g.height + 40;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{--f-title:"Inter",system-ui,sans-serif;--f-keyword:"Anton","Impact",sans-serif;--f-caption:"Inter",system-ui,sans-serif;--accent:#4F8CFF;--accent2:#22D3EE;--gold:#F2C84B}
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(120% 90% at 30% 20%,#3a4250,#12151c 60%,#07080b);display:grid;place-items:center;color:#fff;font-family:var(--f-title)}
    svg.ico{display:block}
    .tpl{position:relative;width:${g.width}px;height:${g.height}px}
    .tpl{${g.css}}
  </style></head><body><div class="tpl">${body}</div></body></html>`;
  return (
    <div className="pr-gfx__live" style={{ width: W * scale, height: H * scale }}>
      <iframe title={g.name} sandbox="" srcDoc={doc} style={{ width: W, height: H, transform: `scale(${scale})` }} />
    </div>
  );
}

/** Gráficos encontrados en tus vídeos y su recreación: eliges cuáles usará la edición. */
function GfxPicker({ p, onApplied }: { p: StylePreset; onApplied: () => void }) {
  const toast = useToast();
  const list = p.analysis!.graphics!;
  const initial = p.analysis?.choice?.graphics ?? list.map((g) => g.id);
  const [sel, setSel] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const changed = sel.slice().sort().join() !== initial.slice().sort().join();
  async function apply() {
    setBusy(true);
    try { await presetsApi.chooseGraphics(p.id, sel, true); toast(sel.length ? `${sel.length} gráfico(s) copiados: las próximas ediciones los usan` : "Sin gráficos copiados"); onApplied(); }
    catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }
  return (
    <div className="pr-subs">
      <div className="pr-subs__head">
        <div><b>Gráficos encontrados</b><small>A la izquierda, el original de tu vídeo; a la derecha, la recreación que usará la edición (con tus textos). Marca los que quieras.</small></div>
        <button className="btn btn--primary" disabled={busy || (!changed && p.active)} onClick={apply}>{busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {p.active && !changed ? "Aplicado" : "Usar estos gráficos"}</button>
      </div>
      <div className="pr-subs__grid">
        {list.map((g) => (
          <article key={g.id} className={"pr-sub" + (sel.includes(g.id) ? " is-sub" : "")}>
            <div className="pr-gfx__pair">
              <figure><img src={g.sample.url} alt="Original" onClick={() => setZoom(g.sample.url)} /><figcaption>Original</figcaption></figure>
              <figure>{g.render ? <img src={g.render} alt="Recreación" onClick={() => setZoom(g.render!)} /> : <GfxLive g={g} />}<figcaption>Recreado</figcaption></figure>
            </div>
            <div className="pr-sub__body">
              <div className="pr-sub__title"><span className="pill">{g.name}</span> <small>vídeo {g.video + 1} · entra: {g.anim.in}</small></div>
              {g.use && <p>{g.use}</p>}
              <small className="pr-sub__notes">Textos: {g.fields.map((f) => `${f.label} (máx. ${f.max})`).join(" · ") || "ninguno"}{g.hasIcon ? " · con icono" : ""}</small>
              <div className="row pr-sub__pick">
                <label><input type="checkbox" checked={sel.includes(g.id)} onChange={(e) => setSel((l) => (e.target.checked ? [...l, g.id] : l.filter((x) => x !== g.id)))} /> Usar en las ediciones</label>
              </div>
            </div>
          </article>
        ))}
      </div>
      {zoom && <div className="pr-zoom" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>}
    </div>
  );
}
