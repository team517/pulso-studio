// Panel derecho: ajustes de lo que esté seleccionado (o del proyecto si no hay nada).
import { AlignVerticalJustifyCenter, ArrowDownToLine, ArrowUpToLine, Captions, Loader2, Music2, Scissors, Sparkles, Trash2, Type, Volume2, VolumeX } from "lucide-react";
import { FORMATS, fmtTime, type Caption, type Format, type Media, type ProjectData, type TextItem } from "../api";
import { Field, Switch } from "../ui";
import { capStyle, clipDur, FONTS, retimeWords } from "./model";
import type { Sel } from "./Timeline";

type Props = {
  data: ProjectData;
  name: string;
  media: Media[];
  mediaById: Record<string, Media>;
  sel: Sel;
  time: number;
  apply: (d: ProjectData) => void;
  live: (d: ProjectData) => void;
  onRename: (n: string) => void;
  onDeleteSel: () => void;
  onSplit: () => void;
  onAddText: () => void;
  onSeek: (t: number) => void;
  captionsBusy: string | null;
  onGenerateCaptions: () => void;
  onFormat: (f: Format) => void;
};

const n2 = (v: number) => Math.round(v * 100) / 100;

export default function Inspector(p: Props) {
  const { data, sel } = p;
  if (sel?.kind === "clip") {
    const c = data.clips.find((x) => x.id === sel.id);
    if (c) return <ClipPanel {...p} clipId={c.id} />;
  }
  if (sel?.kind === "text") {
    const t = data.texts.find((x) => x.id === sel.id);
    if (t) return <TextPanel {...p} t={t} />;
  }
  if (sel?.kind === "caption") {
    const c = data.captions.items.find((x) => x.id === sel.id);
    if (c) return <CaptionPanel {...p} c={c} />;
  }
  if (sel?.kind === "music" && data.music) return <MusicPanel {...p} />;
  return <ProjectPanel {...p} />;
}

function Section({ title, icon, children, right }: { title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="ins-sec">
      <h3 className="ins-sec__h">{icon}{title}<span className="spacer" />{right}</h3>
      {children}
    </section>
  );
}

/* ---------- Clip ---------- */

function ClipPanel({ data, mediaById, clipId, apply, live, onDeleteSel, onSplit, onGenerateCaptions, captionsBusy }: Props & { clipId: string }) {
  const i = data.clips.findIndex((x) => x.id === clipId);
  const c = data.clips[i];
  const m = mediaById[c.mediaId];
  const set = (patch: Partial<typeof c>, commit = true) => {
    const clips = [...data.clips];
    clips[i] = { ...c, ...patch };
    (commit ? apply : live)({ ...data, clips });
  };
  const max = m?.kind === "image" ? 3600 : m?.duration ?? c.out;
  return (
    <div className="ins">
      <Section title="Clip" icon={<Scissors size={15} />}>
        <div className="ins-media">
          <span className="ins-media__thumb" style={m?.thumbUrl ? { backgroundImage: `url(${m.thumbUrl})` } : undefined} />
          <span>
            <b className="ins-media__name">{m?.name ?? "Archivo borrado"}</b>
            <small className="muted mono">{fmtTime(clipDur(c), true)} de {fmtTime(m?.duration ?? 0, true)}</small>
          </span>
        </div>
        {m?.kind !== "image" ? (
          <div className="grid2">
            <Field label="Empieza en (s)"><input className="input input--sm mono" type="number" step="0.1" min={0} max={c.out - 0.1} value={n2(c.in)} onChange={(e) => set({ in: Math.min(Math.max(0, Number(e.target.value)), c.out - 0.1) })} /></Field>
            <Field label="Acaba en (s)"><input className="input input--sm mono" type="number" step="0.1" min={c.in + 0.1} max={max} value={n2(c.out)} onChange={(e) => set({ out: Math.max(Math.min(max, Number(e.target.value)), c.in + 0.1) })} /></Field>
          </div>
        ) : (
          <Field label="Duración (s)"><input className="input input--sm mono" type="number" step="0.5" min={0.5} value={n2(c.out - c.in)} onChange={(e) => set({ in: 0, out: Math.max(0.5, Number(e.target.value)) })} /></Field>
        )}
        <Field label="Encuadre" hint={c.fit === "cover" ? "Llena toda la pantalla (recorta los bordes que sobren)." : "Se ve entero, con bandas del color de fondo."}>
          <div className="seg">
            <button className={c.fit === "cover" ? "is-on" : ""} onClick={() => set({ fit: "cover" })}>Llenar</button>
            <button className={c.fit === "contain" ? "is-on" : ""} onClick={() => set({ fit: "contain" })}>Encajar</button>
          </div>
        </Field>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn--sm" onClick={onSplit}><Scissors size={14} /> Cortar aquí <kbd>S</kbd></button>
          <button className="btn btn--sm btn--danger" onClick={onDeleteSel}><Trash2 size={14} /> Quitar</button>
        </div>
      </Section>
      {m?.kind === "video" && (
        <Section title="Sonido" icon={c.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}>
          {m.has_audio ? (
            <>
              <Switch checked={!c.muted} onChange={(v) => set({ muted: !v })} label="Sonido del clip" />
              <Field label="Volumen" right={<span className="mono">{Math.round((c.volume ?? 1) * 100)} %</span>}>
                <input className="range" type="range" min={0} max={2} step={0.05} value={c.volume ?? 1} disabled={c.muted}
                  onChange={(e) => set({ volume: Number(e.target.value) }, false)} onPointerUp={(e) => set({ volume: Number((e.target as HTMLInputElement).value) })} />
              </Field>
            </>
          ) : <p className="muted" style={{ margin: 0 }}>Este clip no tiene sonido.</p>}
        </Section>
      )}
      {m?.kind === "video" && m.has_audio && (
        <Section title="Subtítulos de este clip" icon={<Captions size={15} />}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            {m.transcript_status === "done" ? "La voz ya está transcrita." : m.transcript_status === "running" ? "Transcribiendo la voz…" : "Se escucha la voz y se escribe sola (Whisper, en tu ordenador)."}
          </p>
          <button className="btn btn--sm" onClick={onGenerateCaptions} disabled={!!captionsBusy}>
            {captionsBusy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {captionsBusy ? captionsBusy : "Generar subtítulos del vídeo"}
          </button>
        </Section>
      )}
    </div>
  );
}

/* ---------- Texto ---------- */

function TextPanel({ data, t, apply, live, onDeleteSel, onSeek }: Props & { t: TextItem }) {
  const set = (patch: Partial<TextItem>, commit = true) => (commit ? apply : live)({ ...data, texts: data.texts.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) });
  return (
    <div className="ins">
      <Section title="Texto" icon={<Type size={15} />} right={<button className="btn btn--sm btn--ghost btn--danger" onClick={onDeleteSel}><Trash2 size={14} /></button>}>
        <textarea className="textarea" rows={3} value={t.text} onChange={(e) => set({ text: e.target.value }, false)} onBlur={(e) => set({ text: e.target.value })} />
        <div className="grid2">
          <Field label="Fuente">
            <select className="select select--sm" value={t.font} onChange={(e) => set({ font: e.target.value })}>
              {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
          </Field>
          <Field label="Tamaño">
            <input className="input input--sm mono" type="number" min={16} max={400} value={t.size} onChange={(e) => set({ size: Math.max(8, Number(e.target.value)) })} />
          </Field>
        </div>
        <div className="row">
          <Field label="Color"><input className="color" type="color" value={t.color} onChange={(e) => set({ color: e.target.value }, false)} onBlur={(e) => set({ color: e.target.value })} /></Field>
          <div style={{ flex: 1 }}><Switch checked={t.box} onChange={(v) => set({ box: v })} label="Fondo detrás" /></div>
          {t.box && <input className="color" type="color" value={t.boxColor} onChange={(e) => set({ boxColor: e.target.value }, false)} onBlur={(e) => set({ boxColor: e.target.value })} title="Color del fondo" />}
        </div>
        {t.box && (
          <Field label="Opacidad del fondo" right={<span className="mono">{Math.round(t.boxOpacity * 100)} %</span>}>
            <input className="range" type="range" min={0.1} max={1} step={0.05} value={t.boxOpacity} onChange={(e) => set({ boxOpacity: Number(e.target.value) }, false)} onPointerUp={(e) => set({ boxOpacity: Number((e.target as HTMLInputElement).value) })} />
          </Field>
        )}
      </Section>
      <Section title="Posición" icon={<AlignVerticalJustifyCenter size={15} />}>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn--sm" onClick={() => set({ x: 0.5, y: 0.14 })}><ArrowUpToLine size={14} /> Arriba</button>
          <button className="btn btn--sm" onClick={() => set({ x: 0.5, y: 0.5 })}>Centro</button>
          <button className="btn btn--sm" onClick={() => set({ x: 0.5, y: 0.84 })}><ArrowDownToLine size={14} /> Abajo</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>También puedes arrastrarlo en la vista previa.</p>
      </Section>
      <Section title="Cuándo sale">
        <div className="grid2">
          <Field label="Desde (s)"><input className="input input--sm mono" type="number" step="0.1" min={0} value={n2(t.start)} onChange={(e) => set({ start: Math.min(Math.max(0, Number(e.target.value)), t.end - 0.2) })} /></Field>
          <Field label="Hasta (s)"><input className="input input--sm mono" type="number" step="0.1" value={n2(t.end)} onChange={(e) => set({ end: Math.max(Number(e.target.value), t.start + 0.2) })} /></Field>
        </div>
        <button className="btn btn--sm" onClick={() => onSeek(t.start + 0.01)}>Ir al texto</button>
      </Section>
    </div>
  );
}

/* ---------- Subtítulo suelto ---------- */

function CaptionPanel({ data, c, apply, live, onDeleteSel }: Props & { c: Caption }) {
  const set = (cap: Caption, commit = true) => (commit ? apply : live)({ ...data, captions: { ...data.captions, items: data.captions.items.map((x) => (x.id === c.id ? cap : x)) } });
  return (
    <div className="ins">
      <Section title="Subtítulo" icon={<Captions size={15} />} right={<button className="btn btn--sm btn--ghost btn--danger" onClick={onDeleteSel}><Trash2 size={14} /></button>}>
        <textarea className="textarea" rows={2} value={c.text} onChange={(e) => set({ ...c, text: e.target.value }, false)} onBlur={(e) => set(retimeWords(c, e.target.value))} />
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Corrige aquí lo que Whisper haya entendido mal.</p>
        <div className="grid2">
          <Field label="Desde (s)"><input className="input input--sm mono" type="number" step="0.05" value={n2(c.start)} onChange={(e) => set(retimeWords({ ...c, start: Math.min(Number(e.target.value), c.end - 0.1) }, c.text))} /></Field>
          <Field label="Hasta (s)"><input className="input input--sm mono" type="number" step="0.05" value={n2(c.end)} onChange={(e) => set(retimeWords({ ...c, end: Math.max(Number(e.target.value), c.start + 0.1) }, c.text))} /></Field>
        </div>
      </Section>
      <CaptionStyleSection data={data} apply={apply} live={live} />
    </div>
  );
}

function CaptionStyleSection({ data, apply, live }: Pick<Props, "data" | "apply" | "live">) {
  const st = capStyle(data);
  const set = (patch: Partial<typeof st>, commit = true) => (commit ? apply : live)({ ...data, captions: { ...data.captions, style: { ...data.captions.style, ...patch } } });
  return (
    <Section title="Estilo de los subtítulos">
      <div className="grid2">
        <Field label="Fuente">
          <select className="select select--sm" value={st.font} onChange={(e) => set({ font: e.target.value })}>
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Tamaño"><input className="input input--sm mono" type="number" min={20} max={300} value={st.size} onChange={(e) => set({ size: Math.max(12, Number(e.target.value)) })} /></Field>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Field label="Color"><input className="color" type="color" value={st.color} onChange={(e) => set({ color: e.target.value }, false)} onBlur={(e) => set({ color: e.target.value })} /></Field>
        <Field label="Palabra que suena">
          <div className="row" style={{ gap: 6 }}>
            <input className="color" type="color" value={st.highlight ?? "#ffd60a"} disabled={!st.highlight} onChange={(e) => set({ highlight: e.target.value }, false)} onBlur={(e) => st.highlight && set({ highlight: e.target.value })} />
            <Switch checked={!!st.highlight} onChange={(v) => set({ highlight: v ? "#ffd60a" : null })} />
          </div>
        </Field>
      </div>
      <Switch checked={st.uppercase} onChange={(v) => set({ uppercase: v })} label="En mayúsculas" />
      <Switch checked={st.box} onChange={(v) => set({ box: v })} label="Con fondo oscuro" />
      <Field label="Altura en pantalla" right={<span className="mono">{Math.round(st.y * 100)} %</span>}>
        <input className="range" type="range" min={0.1} max={0.92} step={0.01} value={st.y} onChange={(e) => set({ y: Number(e.target.value) }, false)} onPointerUp={(e) => set({ y: Number((e.target as HTMLInputElement).value) })} />
      </Field>
    </Section>
  );
}

/* ---------- Música ---------- */

function MusicPanel({ data, mediaById, apply, live }: Props) {
  const mu = data.music!;
  const m = mediaById[mu.mediaId];
  const set = (patch: Partial<typeof mu>, commit = true) => (commit ? apply : live)({ ...data, music: { ...mu, ...patch } });
  return (
    <div className="ins">
      <Section title="Música" icon={<Music2 size={15} />} right={<button className="btn btn--sm btn--ghost btn--danger" onClick={() => apply({ ...data, music: null })}><Trash2 size={14} /></button>}>
        <b className="ins-media__name">{m?.name ?? "Audio borrado"}</b>
        <Field label="Volumen" right={<span className="mono">{Math.round(mu.volume * 100)} %</span>}>
          <input className="range" type="range" min={0} max={1.5} step={0.02} value={mu.volume} onChange={(e) => set({ volume: Number(e.target.value) }, false)} onPointerUp={(e) => set({ volume: Number((e.target as HTMLInputElement).value) })} />
        </Field>
        <div className="grid2">
          <Field label="Entrada suave (s)"><input className="input input--sm mono" type="number" min={0} max={10} step={0.5} value={mu.fadeIn} onChange={(e) => set({ fadeIn: Math.max(0, Number(e.target.value)) })} /></Field>
          <Field label="Salida suave (s)"><input className="input input--sm mono" type="number" min={0} max={10} step={0.5} value={mu.fadeOut} onChange={(e) => set({ fadeOut: Math.max(0, Number(e.target.value)) })} /></Field>
        </div>
        <Field label="Empezar la canción en (s)" hint="Para saltarte la intro de la canción.">
          <input className="input input--sm mono" type="number" min={0} step={1} value={mu.offset} onChange={(e) => set({ offset: Math.max(0, Number(e.target.value)) })} />
        </Field>
      </Section>
    </div>
  );
}

/* ---------- Proyecto ---------- */

function ProjectPanel({ data, name, media, onRename, apply, live, onAddText, captionsBusy, onGenerateCaptions, onFormat }: Props) {
  const audios = media.filter((m) => m.kind === "audio" || (m.kind === "video" && m.has_audio));
  const hasVoice = data.clips.some((c) => !c.muted);
  return (
    <div className="ins">
      <Section title="Proyecto">
        <Field label="Nombre"><input className="input input--sm" value={name} onChange={(e) => onRename(e.target.value)} /></Field>
        <Field label="Formato">
          <select className="select select--sm" value={data.format} onChange={(e) => onFormat(e.target.value as Format)}>
            {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label} — {f.hint}</option>)}
          </select>
        </Field>
        <Field label="Color de fondo" hint="Se ve en los clips con «Encajar».">
          <input className="color" type="color" value={data.background} onChange={(e) => live({ ...data, background: e.target.value })} onBlur={(e) => apply({ ...data, background: e.target.value })} />
        </Field>
      </Section>
      <Section title="Textos" icon={<Type size={15} />}>
        <button className="btn btn--sm" onClick={onAddText}><Type size={14} /> Añadir texto <kbd>T</kbd></button>
      </Section>
      <Section title="Subtítulos automáticos" icon={<Captions size={15} />}
        right={data.captions.items.length > 0 && <Switch checked={data.captions.enabled} onChange={(v) => apply({ ...data, captions: { ...data.captions, enabled: v } })} />}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {data.captions.items.length
            ? `${data.captions.items.length} frases. Pulsa una en la línea de tiempo para corregirla.`
            : "Whisper escucha la voz de tus clips y escribe los subtítulos con el tiempo de cada palabra."}
        </p>
        <button className="btn btn--sm btn--primary" onClick={onGenerateCaptions} disabled={!!captionsBusy || !hasVoice}>
          {captionsBusy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
          {captionsBusy ? captionsBusy : data.captions.items.length ? "Volver a generar" : "Generar subtítulos"}
        </button>
        {data.captions.items.length > 0 && (
          <Field label="Palabras por frase">
            <div className="seg">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={(data.captions.style.wordsPerLine ?? 3) === n ? "is-on" : ""} onClick={() => apply({ ...data, captions: { ...data.captions, style: { ...data.captions.style, wordsPerLine: n } } })}>{n}</button>
              ))}
            </div>
          </Field>
        )}
      </Section>
      {data.captions.items.length > 0 && <CaptionStyleSection data={data} apply={apply} live={live} />}
      <Section title="Música de fondo" icon={<Music2 size={15} />}>
        {data.music ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Pulsa la pista de música en la línea de tiempo para ajustar volumen y fundidos.</p>
        ) : (
          <>
            <select className="select select--sm" value="" onChange={(e) => e.target.value && apply({ ...data, music: { mediaId: e.target.value, volume: 0.3, fadeIn: 1, fadeOut: 2, offset: 0 } })}>
              <option value="">Elegir de la biblioteca…</option>
              {audios.map((m) => <option key={m.id} value={m.id}>{m.kind === "audio" ? "♪ " : "🎬 "}{m.name}</option>)}
            </select>
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Sube un MP3 a la biblioteca y pulsa ♪ para ponerlo.</p>
          </>
        )}
      </Section>
    </div>
  );
}
