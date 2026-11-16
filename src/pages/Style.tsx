// Estilo de edición: lo que pongas aquí lo sigue cada auto-edición (fuentes, colores, subtítulos, tarjetas,
// animación, logo, música e instrucciones). Vista previa en directo a la derecha.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ImagePlus, Loader2, Palette, Play, RotateCcw, Sparkles, Trash2, Type, Upload, Wand2 } from "lucide-react";
import { styleApi, fontFamily, type AutoSettings, type EditStyle, type StyleAsset } from "../style-api";
import { autoApi, type AutoVariant } from "../autoedit-api";
import { Field, Switch, useToast } from "../ui";
import Presets from "./Presets";
import "./style.css";

const SAMPLE = { before: "Te garantizamos", key: "30 reuniones", after: "al mes" };

export default function StylePage() {
  const toast = useToast();
  const [style, setStyle] = useState<EditStyle | null>(null);
  const [auto, setAuto] = useState<AutoSettings | null>(null);
  const [assets, setAssets] = useState<StyleAsset[]>([]);
  const [variants, setVariants] = useState<AutoVariant[]>([]);
  const [saved, setSaved] = useState<"ok" | "saving" | "dirty">("ok");
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestion, setSuggestion] = useState<Partial<EditStyle["colors"]> | null>(null);
  const [replay, setReplay] = useState(0);
  const first = useRef(true);

  useEffect(() => {
    styleApi.get().then((r) => { setStyle(r.style); setAuto(r.auto); setAssets(r.assets); }).catch((e) => toast(e.message, "bad"));
    autoApi.info().then((r) => setVariants(r.variants)).catch(() => {});
  }, [toast]);

  // Guardado automático
  useEffect(() => {
    if (!style || !auto) return;
    if (first.current) { first.current = false; return; }
    setSaved("dirty");
    const t = setTimeout(() => {
      setSaved("saving");
      styleApi.save(style, auto).then(() => setSaved("ok")).catch((e) => { setSaved("dirty"); toast(e.message, "bad"); });
    }, 600);
    return () => clearTimeout(t);
  }, [style, auto, toast]);

  const set = useCallback(<K extends keyof EditStyle>(k: K, v: EditStyle[K]) => { setStyle((s) => (s ? { ...s, [k]: v } : s)); setReplay((n) => n + 1); }, []);
  const fonts = assets.filter((a) => a.kind === "font");
  const logos = assets.filter((a) => a.kind === "logo");
  const refs = assets.filter((a) => a.kind === "reference");

  async function upload(files: File[], kind: StyleAsset["kind"]) {
    if (!files.length) return;
    try {
      const out = await styleApi.upload(files, kind);
      if (out.length < files.length) toast("Algún archivo no es del tipo correcto y no se ha subido.", "bad");
      setAssets((l) => [...out, ...l]);
      if (kind === "logo" && out[0] && style) set("logo", { id: out[0].id, position: style.logo?.position ?? "top-right", size: style.logo?.size ?? 0.1 });
      return out;
    } catch (e) { toast((e as Error).message, "bad"); }
  }
  async function removeAsset(a: StyleAsset) {
    await styleApi.remove(a.id);
    setAssets((l) => l.filter((x) => x.id !== a.id));
    const r = await styleApi.get();
    setStyle(r.style);
  }
  async function analyze() {
    setAnalyzing(true);
    try {
      const r = await styleApi.analyze();
      setSuggestion(r.suggestion);
      setStyle((s) => (s ? { ...s, palette: r.palette, aiNotes: r.aiNotes || s.aiNotes, rhythm: r.rhythm ?? s.rhythm, aiSuggested: r.aiSuggested ?? s.aiSuggested } : s));
      if (r.pending) {
        // En el panel, Claude mira las referencias desde tu PC: se espera su respuesta
        toast("Colores y ritmo listos. Claude está mirando tus referencias desde tu PC…", "info");
        const before = r.style.aiNotes;
        for (let i = 0; i < 40; i++) {
          await new Promise((ok) => setTimeout(ok, 6000));
          const g = await styleApi.get().catch(() => null);
          if (g && g.style.aiNotes && g.style.aiNotes !== before) {
            setStyle((s) => (s ? { ...s, aiNotes: g.style.aiNotes, aiSuggested: g.style.aiSuggested ?? s.aiSuggested } : s));
            toast("Claude ha mirado tus referencias: ya puedes aplicar su estilo");
            break;
          }
        }
      } else toast(r.seen ? "Claude ha mirado tus referencias: colores, estilo y ritmo" : "Colores y ritmo sacados de tus referencias");
    } catch (e) { toast((e as Error).message, "bad"); } finally { setAnalyzing(false); }
  }

  if (!style || !auto) return <div className="page"><p className="muted">Cargando…</p></div>;

  return (
    <div className="page st-page">
      <FontFaces fonts={fonts} />
      <div className="page-head">
        <div>
          <h1>Estilo de edición</h1>
          <p>Tu forma de editar. Pon tus tipografías, colores, logo y referencias: cada vídeo que se auto-edite lo seguirá al pie de la letra.</p>
        </div>
        <div className="page-head__actions">
          <span className={"st-saved" + (saved === "ok" ? " is-ok" : "")}>{saved === "ok" ? <><Check size={14} /> Guardado</> : <><Loader2 size={14} className="spin" /> Guardando…</>}</span>
        </div>
      </div>

      <Presets refs={refs} onApplied={() => styleApi.get().then((r) => { first.current = true; setStyle(r.style); setAssets(r.assets); setReplay((n) => n + 1); }).catch(() => {})} />

      <div className="st-grid">
        <div className="st-col">
          {/* Auto-edición al subir */}
          <Section icon={<Sparkles size={16} />} title="Al subir un vídeo">
            <Switch checked={auto.enabled} onChange={(v) => setAuto({ ...auto, enabled: v })} label="Editarlo automáticamente nada más subirlo" />
            <p className="st-hint">Los vídeos de más de 2,5 minutos se convierten en shorts; los cortos, en estas versiones:</p>
            <div className="st-chips">
              {variants.map((v) => {
                const on = auto.variants.includes(v.key);
                return <button key={v.key} type="button" className={"st-chip" + (on ? " is-on" : "")} onClick={() => setAuto({ ...auto, variants: on ? auto.variants.filter((k) => k !== v.key) : [...auto.variants, v.key] })}>{on && <Check size={12} />} {v.label}</button>;
              })}
            </div>
          </Section>

          {/* Referencias */}
          <Section icon={<ImagePlus size={16} />} title="Referencias" sub="Adjunta vídeos (o capturas) de reels con la edición que quieres copiar: Claude se fija en sus letras, subtítulos, tarjetas, colores, animaciones y ritmo.">
            <div className="st-refs">
              {refs.map((r) => (
                <div key={r.id} className="st-ref">
                  {/\.(mp4|mov|m4v|webm)$/i.test(r.file) ? <video src={r.url} muted playsInline preload="metadata" /> : <img src={r.url} alt="" />}
                  <button className="st-x" onClick={() => removeAsset(r)} title="Quitar"><Trash2 size={12} /></button>
                </div>
              ))}
              <UploadTile accept="image/*,video/*" multiple label="Añadir" onFiles={(f) => upload(f, "reference")} />
            </div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn btn--sm" onClick={analyze} disabled={!refs.length || analyzing}>{analyzing ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Sacar el estilo de mis referencias</button>
              {style.aiNotes && <span className="st-hint">La IA ya ha mirado tus referencias.</span>}
            </div>
            {style.palette.length > 0 && (
              <div className="st-palette">
                {style.palette.slice(0, 12).map((c) => <span key={c.hex} className="st-swatch" style={{ background: c.hex }} title={c.hex} />)}
              </div>
            )}
            {suggestion && Object.keys(suggestion).length > 0 && (
              <div className="note st-suggest">
                <span>Colores de tus referencias:</span>
                {Object.entries(suggestion).map(([k, v]) => <span key={k} className="st-sg"><i style={{ background: v }} /> {COLOR_LABEL[k as keyof EditStyle["colors"]] ?? k}</span>)}
                <button className="btn btn--sm btn--primary" onClick={() => { set("colors", { ...style.colors, ...suggestion }); setSuggestion(null); toast("Colores aplicados"); }}>Usar estos colores</button>
              </div>
            )}
            {style.rhythm?.cutsPerMin != null && <p className="st-hint">Ritmo medido en tus vídeos de referencia: <b>{style.rhythm.cutsPerMin} cambios de plano por minuto</b>. Las ediciones seguirán ese ritmo.</p>}
            {style.aiNotes && <p className="st-ai"><b>Lo que ha visto Claude:</b> {style.aiNotes}</p>}
            {style.aiSuggested && (
              <button className="btn btn--sm btn--primary" style={{ alignSelf: "flex-start" }} onClick={() => {
                const sg = style.aiSuggested!;
                setStyle({ ...style, caption: { ...style.caption, ...(sg.caption || {}) }, cards: { ...style.cards, ...(sg.cards || {}) }, motion: { ...style.motion, ...(sg.motion || {}) } });
                setReplay((n) => n + 1);
                toast("Aplicado: subtítulos, tarjetas y animación como en tus referencias");
              }}><Wand2 size={14} /> Aplicar lo que ha visto Claude</button>
            )}
          </Section>

          {/* Tipografías */}
          <Section icon={<Type size={16} />} title="Tipografías" sub="Sube tus fuentes (.ttf, .otf, .woff2) y elige dónde va cada una.">
            {(["caption", "keyword", "title"] as const).map((slot) => (
              <Field key={slot} label={SLOT_LABEL[slot]}>
                <div className="st-fonts">
                  <button type="button" className={"st-font" + (!style.fonts[slot] ? " is-on" : "")} onClick={() => set("fonts", { ...style.fonts, [slot]: null })}>
                    <span style={{ fontFamily: DEFAULT_FONT[slot] }}>Aa</span><small>Por defecto</small>
                  </button>
                  {fonts.map((f) => (
                    <button key={f.id} type="button" className={"st-font" + (style.fonts[slot] === f.id ? " is-on" : "")} onClick={() => set("fonts", { ...style.fonts, [slot]: f.id })}>
                      <span style={{ fontFamily: fontFamily(f) }}>Aa</span><small title={f.name}>{f.family}</small>
                    </button>
                  ))}
                </div>
              </Field>
            ))}
            <div className="row" style={{ flexWrap: "wrap" }}>
              <UploadButton accept=".ttf,.otf,.woff,.woff2" multiple label="Subir fuentes" onFiles={(f) => upload(f, "font")} />
              {fonts.map((f) => <span key={f.id} className="st-tag">{f.family}<button onClick={() => removeAsset(f)} title="Quitar"><Trash2 size={11} /></button></span>)}
            </div>
          </Section>

          {/* Colores */}
          <Section icon={<Palette size={16} />} title="Colores">
            <div className="st-colors">
              {(Object.keys(COLOR_LABEL) as (keyof EditStyle["colors"])[]).map((k) => (
                <label key={k} className="st-color">
                  <input type="color" value={style.colors[k]} onChange={(e) => set("colors", { ...style.colors, [k]: e.target.value.toUpperCase() })} />
                  <span><b>{COLOR_LABEL[k]}</b><small className="mono">{style.colors[k]}</small></span>
                </label>
              ))}
            </div>
            {style.palette.length > 0 && <p className="st-hint">Pulsa un color de la paleta de tus referencias para copiar su código: {style.palette.slice(0, 8).map((c) => <button key={c.hex} className="st-mini" style={{ background: c.hex }} title={c.hex} onClick={() => navigator.clipboard.writeText(c.hex).then(() => toast(`${c.hex} copiado`))} />)}</p>}
          </Section>

          {/* Subtítulos */}
          <Section title="Subtítulos">
            <div className="grid2">
              <Field label="Tamaño"><Seg value={style.caption.size} onChange={(v) => set("caption", { ...style.caption, size: v })} options={[["s", "Pequeño"], ["m", "Medio"], ["l", "Grande"]]} /></Field>
              <Field label="Posición"><Seg value={style.caption.position} onChange={(v) => set("caption", { ...style.caption, position: v })} options={[["high", "Alta"], ["auto", "Auto"], ["low", "Baja"]]} /></Field>
            </div>
            <Field label="Cómo entran"><Seg value={style.caption.animation} onChange={(v) => set("caption", { ...style.caption, animation: v })} options={[["soft", "Suave"], ["pop", "Pop"], ["word", "Palabra a palabra"], ["typewriter", "Máquina de escribir"]]} /></Field>
            <Field label="Palabra clave"><Seg value={style.caption.keywordStyle} onChange={(v) => set("caption", { ...style.caption, keywordStyle: v })} options={[["big", "Grande"], ["highlight", "En color"], ["box", "Con caja"]]} /></Field>
            <Switch checked={style.caption.uppercase} onChange={(v) => set("caption", { ...style.caption, uppercase: v })} label="Todo en mayúsculas" />
          </Section>

          {/* Gráficos y animación */}
          <Section title="Gráficos y animación">
            <Field label="Tarjetas">
              <div className="st-looks">
                {(["glass", "solid", "light"] as const).map((l) => (
                  <button key={l} type="button" className={"st-look st-look--" + l + (style.cards.look === l ? " is-on" : "")} onClick={() => set("cards", { look: l })}
                    style={{ ["--acc" as string]: style.colors.accent }}>
                    <span className="st-look__card"><i /> 30 reuniones</span>
                    <small>{LOOK_LABEL[l]}</small>
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid2">
              <Field label="Cantidad de gráficos"><Seg value={style.graphics} onChange={(v) => set("graphics", v)} options={[["few", "Pocos"], ["balanced", "Equilibrado"], ["many", "Muchos"]]} /></Field>
              <Field label="Animación"><Seg value={String(style.motion.intensity) as "1" | "2" | "3"} onChange={(v) => set("motion", { intensity: Number(v) as 1 | 2 | 3 })} options={[["1", "Sobria"], ["2", "Normal"], ["3", "Enérgica"]]} /></Field>
            </div>
          </Section>

          {/* Logo */}
          <Section title="Logo" sub="Opcional: tu logo en una esquina de todos los vídeos.">
            <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-start" }}>
              {logos.map((l) => (
                <button key={l.id} type="button" className={"st-logo" + (style.logo?.id === l.id ? " is-on" : "")} onClick={() => set("logo", style.logo?.id === l.id ? null : { id: l.id, position: style.logo?.position ?? "top-right", size: style.logo?.size ?? 0.1 })}>
                  <img src={l.url} alt="" />
                  <span className="st-x" onClick={(e) => { e.stopPropagation(); removeAsset(l); }}><Trash2 size={11} /></span>
                </button>
              ))}
              <UploadTile accept="image/png,image/svg+xml,image/webp,image/jpeg" label="Subir logo" onFiles={(f) => upload(f, "logo")} small />
            </div>
            {style.logo && (
              <div className="grid2">
                <Field label="Esquina"><Seg value={style.logo.position} onChange={(v) => set("logo", { ...style.logo!, position: v })} options={[["top-left", "↖"], ["top-right", "↗"], ["bottom-left", "↙"], ["bottom-right", "↘"]]} /></Field>
                <Field label="Tamaño" right={<span className="mono">{Math.round(style.logo.size * 100)} %</span>}>
                  <input className="range" type="range" min={0.06} max={0.2} step={0.01} value={style.logo.size} onChange={(e) => set("logo", { ...style.logo!, size: Number(e.target.value) })} />
                </Field>
              </div>
            )}
          </Section>

          {/* Música e instrucciones */}
          <Section title="Música e instrucciones">
            <Field label="Música de fondo"><Seg value={style.music} onChange={(v) => set("music", v)} options={[["auto", "Una distinta por versión"], ["synthwave", "Synthwave"], ["lofi", "Lo-Fi"], ["none", "Sin música"]]} /></Field>
            <Field label="Instrucciones para la IA" hint="Lo que quieres SIEMPRE. Ej.: «los titulares cortos y en pregunta», «nunca tapes el micro», «usa mucho la palabra gigante detrás de la cabeza».">
              <textarea className="textarea" rows={4} value={style.notes} onChange={(e) => setStyle({ ...style, notes: e.target.value })} placeholder="Escribe tus reglas de edición…" />
            </Field>
          </Section>
        </div>

        <aside className="st-preview">
          <div className="st-preview__head">
            <b>Vista previa</b>
            <button className="btn btn--ghost btn--sm" onClick={() => setReplay((n) => n + 1)}><Play size={13} /> Repetir</button>
          </div>
          <Phone style={style} fonts={fonts} logos={logos} replay={replay} />
          <button className="btn btn--sm btn--ghost" style={{ alignSelf: "center" }} onClick={() => { setStyle({ ...style, colors: { accent: "#4F8CFF", accent2: "#22D3EE", keyword: "#F2C84B", caption: "#FFFFFF", bg: "#070B18" }, caption: { size: "m", uppercase: false, position: "auto", animation: "soft", keywordStyle: "big" }, cards: { look: "glass" }, motion: { intensity: 2 }, fonts: { caption: null, keyword: null, title: null } }); }}>
            <RotateCcw size={13} /> Volver al estilo por defecto
          </button>
        </aside>
      </div>
    </div>
  );
}

const SLOT_LABEL = { caption: "Subtítulos", keyword: "Palabra clave", title: "Titulares y tarjetas" } as const;
const DEFAULT_FONT = { caption: "Inter, sans-serif", keyword: "Impact, 'Arial Black', sans-serif", title: "Inter, sans-serif" } as const;
const COLOR_LABEL: Record<keyof EditStyle["colors"], string> = { accent: "Principal", accent2: "Secundario", keyword: "Palabra clave", caption: "Subtítulos", bg: "Fondo de escenas" };
const LOOK_LABEL = { glass: "Cristal", solid: "Sólida", light: "Blanca" } as const;

function Section({ icon, title, sub, children }: { icon?: ReactNode; title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="card st-sec">
      <h3>{icon}{title}</h3>
      {sub && <p className="st-hint" style={{ marginTop: -4 }}>{sub}</p>}
      {children}
    </section>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return <div className="seg st-seg">{options.map(([v, l]) => <button key={v} type="button" className={value === v ? "is-on" : ""} onClick={() => onChange(v)}>{l}</button>)}</div>;
}

function UploadTile({ accept, multiple, label, onFiles, small }: { accept: string; multiple?: boolean; label: string; onFiles: (f: File[]) => void; small?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <button type="button" className={"st-up" + (small ? " st-up--sm" : "")} onClick={() => ref.current?.click()}>
      <Upload size={16} /><span>{label}</span>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </button>
  );
}

function UploadButton({ accept, multiple, label, onFiles }: { accept: string; multiple?: boolean; label: string; onFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn btn--sm" onClick={() => ref.current?.click()}><Upload size={14} /> {label}</button>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => { onFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
    </>
  );
}

function FontFaces({ fonts }: { fonts: StyleAsset[] }) {
  const css = fonts.map((f) => `@font-face { font-family: "${fontFamily(f)}"; src: url("${f.url}"); font-display: swap; }`).join("\n");
  return <style>{css}</style>;
}

/* ---------- Vista previa: un reel de mentira con tu estilo ---------- */

function Phone({ style, fonts, logos, replay }: { style: EditStyle; fonts: StyleAsset[]; logos: StyleAsset[]; replay: number }) {
  const f = (slot: keyof EditStyle["fonts"]) => {
    const a = fonts.find((x) => x.id === style.fonts[slot]);
    return a ? `"${fontFamily(a)}", sans-serif` : DEFAULT_FONT[slot];
  };
  const logo = style.logo ? logos.find((l) => l.id === style.logo!.id) : null;
  const up = (s: string) => (style.caption.uppercase ? s.toUpperCase() : s);
  const capSize = { s: 15, m: 18, l: 23 }[style.caption.size];
  const top = { high: "58%", auto: "63%", low: "70%" }[style.caption.position];
  const words = useMemo(() => [...SAMPLE.before.split(" ").map((w) => ({ w, key: false })), { w: SAMPLE.key, key: true }, ...SAMPLE.after.split(" ").map((w) => ({ w, key: false }))], []);
  const anim = style.caption.animation;
  const k = style.caption.keywordStyle;
  return (
    <div className="st-phone" style={{ ["--bg" as string]: style.colors.bg, ["--acc" as string]: style.colors.accent, ["--acc2" as string]: style.colors.accent2, ["--kw" as string]: style.colors.keyword, ["--cap" as string]: style.colors.caption, ["--int" as string]: String(style.motion.intensity) }}>
      <div className="st-person" aria-hidden="true"><span className="st-head" /><span className="st-body" /><span className="st-mic" /></div>
      <div key={"t" + replay} className="st-title" style={{ fontFamily: f("title") }}>{up("Cómo conseguir")} <em>{up("30 reuniones")}</em> {up("al mes")}</div>
      <div key={"c" + replay} className={"st-cap st-cap--" + anim} style={{ top, fontFamily: f("caption"), fontSize: capSize }}>
        {words.map((x, i) => (
          <span key={i} className={x.key ? "st-kw st-kw--" + k : "st-w"} style={{ animationDelay: `${0.15 + i * (anim === "word" ? 0.28 : 0.06)}s`, ...(x.key ? { fontFamily: f("keyword") } : {}) }}>
            {anim === "typewriter" ? [...up(x.w)].map((ch, j) => <i key={j} style={{ animationDelay: `${0.15 + i * 0.25 + j * 0.04}s` }}>{ch}</i>) : up(x.w)}
          </span>
        ))}
      </div>
      <div key={"g" + replay} className={"st-card st-card--" + style.cards.look} style={{ fontFamily: f("title") }}>
        <span className="st-card__ic">✓</span>
        <span><b>{up("30 reuniones")}</b><small>{up("al mes, garantizadas")}</small></span>
      </div>
      {logo && <img className={"st-wm st-wm--" + style.logo!.position} src={logo.url} alt="" style={{ width: `${style.logo!.size * 100}%` }} />}
    </div>
  );
}
