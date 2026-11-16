// Vista previa: reproduce los clips en orden, la música y dibuja textos y subtítulos encima.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Media, ProjectData, TextItem } from "../api";
import { capStyle, clipAt, clipStarts, totalDuration } from "./model";

export type PreviewHandle = { play: () => void; pause: () => void; toggle: () => void; seek: (t: number) => void; isPlaying: () => boolean };

type Props = {
  data: ProjectData;
  mediaById: Record<string, Media>;
  time: number;
  onTime: (t: number) => void;
  onPlaying: (p: boolean) => void;
  selectedText: string | null;
  onSelectText: (id: string | null) => void;
  onMoveText: (id: string, x: number, y: number, done: boolean) => void;
};

const Preview = forwardRef<PreviewHandle, Props>(function Preview({ data, mediaById, time, onTime, onPlaying, selectedText, onSelectText, onMoveText }, ref) {
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const music = useRef<HTMLAudioElement>(null);
  const playing = useRef(false);
  const timeRef = useRef(time);
  const raf = useRef(0);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [scale, setScale] = useState(0.3);
  const [box, setBox] = useState({ w: 270, h: 480 });

  const total = totalDuration(data);
  const at = clipAt(data, time);
  const activeClip = at ? data.clips[at.index] : null;

  // Tamaño de la vista previa según el hueco disponible
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min((r.width - 24) / data.width, (r.height - 24) / data.height);
      setScale(Math.max(0.05, s));
      setBox({ w: Math.round(data.width * s), h: Math.round(data.height * s) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.width, data.height]);

  /** Pone cada vídeo en su sitio para el instante t. */
  function sync(t: number, startPlaying: boolean) {
    const d = dataRef.current;
    const a = clipAt(d, t);
    d.clips.forEach((c, i) => {
      const v = videos.current[c.id];
      if (!v) return;
      if (a && i === a.index) {
        const want = c.in + a.local;
        if (Math.abs(v.currentTime - want) > 0.08) v.currentTime = want;
        v.volume = c.muted ? 0 : Math.min(1, c.volume ?? 1);
        v.muted = !!c.muted;
        if (startPlaying && v.paused) v.play().catch(() => {});
        if (!startPlaying && !v.paused) v.pause();
      } else if (!v.paused) v.pause();
    });
    const mu = music.current;
    if (mu && d.music) {
      const m = mediaById[d.music.mediaId];
      const dur = m?.duration || mu.duration || 0;
      const want = dur ? (d.music.offset + t) % dur : t;
      if (Math.abs(mu.currentTime - want) > 0.25) mu.currentTime = want;
      mu.volume = Math.max(0, Math.min(1, musicGain(d, t)));
      if (startPlaying && mu.paused) mu.play().catch(() => {});
      if (!startPlaying && !mu.paused) mu.pause();
    }
  }

  function loop() {
    const d = dataRef.current;
    const a = clipAt(d, timeRef.current);
    let t = timeRef.current;
    if (a) {
      const c = d.clips[a.index];
      const m = mediaById[c.mediaId];
      const v = videos.current[c.id];
      const start = clipStarts(d)[a.index];
      if (m?.kind === "image" || !v) t = timeRef.current + 1 / 60;
      else t = start + Math.max(0, v.currentTime - c.in);
      // Fin del clip → siguiente
      if (t >= start + (c.out - c.in) - 0.02) {
        if (a.index >= d.clips.length - 1) { pause(); timeRef.current = totalDuration(d); onTime(timeRef.current); return; }
        t = start + (c.out - c.in) + 0.001;
        timeRef.current = t;
        sync(t, true);
      }
    }
    timeRef.current = t;
    onTime(t);
    if (music.current && d.music) music.current.volume = Math.max(0, Math.min(1, musicGain(d, t)));
    raf.current = requestAnimationFrame(loop);
  }

  function play() {
    if (!dataRef.current.clips.length) return;
    if (timeRef.current >= totalDuration(dataRef.current) - 0.05) timeRef.current = 0;
    playing.current = true;
    onPlaying(true);
    sync(timeRef.current, true);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(loop);
  }
  function pause() {
    playing.current = false;
    onPlaying(false);
    cancelAnimationFrame(raf.current);
    sync(timeRef.current, false);
  }

  useImperativeHandle(ref, () => ({
    play, pause,
    toggle: () => (playing.current ? pause() : play()),
    seek: (t: number) => {
      timeRef.current = Math.max(0, Math.min(t, totalDuration(dataRef.current)));
      onTime(timeRef.current);
      sync(timeRef.current, playing.current);
    },
    isPlaying: () => playing.current,
  }));

  // Cuando cambian los clips (cortes, recortes) se recoloca todo
  useEffect(() => {
    if (!playing.current) { timeRef.current = Math.min(time, total); sync(timeRef.current, false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.clips, data.music]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  /* ---------- Textos (se pueden arrastrar) ---------- */
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  function startDrag(e: React.PointerEvent, t: TextItem) {
    e.stopPropagation();
    onSelectText(t.id);
    const r = frame.current!.getBoundingClientRect();
    drag.current = { id: t.id, dx: (e.clientX - r.left) / r.width - t.x, dy: (e.clientY - r.top) / r.height - t.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDrag(e: React.PointerEvent, done = false) {
    if (!drag.current) return;
    const r = frame.current!.getBoundingClientRect();
    let x = (e.clientX - r.left) / r.width - drag.current.dx;
    let y = (e.clientY - r.top) / r.height - drag.current.dy;
    // Imán al centro
    if (Math.abs(x - 0.5) < 0.02) x = 0.5;
    if (Math.abs(y - 0.5) < 0.015) y = 0.5;
    onMoveText(drag.current.id, Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y)), done);
    if (done) drag.current = null;
  }

  const textStyle = (t: { font: string; size: number; color: string; box?: boolean; boxColor?: string; boxOpacity?: number }, outline = true): React.CSSProperties => {
    const px = t.size * scale;
    const o = Math.max(1, px / 18);
    return {
      fontFamily: `"${t.font}", Arial, sans-serif`,
      fontSize: px,
      fontWeight: 800,
      color: t.color,
      lineHeight: 1.15,
      ...(t.box
        ? { background: hexA(t.boxColor || "#000000", t.boxOpacity ?? 0.6), padding: `${px * 0.12}px ${px * 0.28}px`, borderRadius: px * 0.12 }
        : outline ? { textShadow: shadowOutline(o) } : {}),
    };
  };

  const cs = capStyle(data);
  const caption = data.captions.enabled ? data.captions.items.find((c) => time >= c.start && time < c.end) : null;

  return (
    <div className="pv-stage" ref={stage} onClick={() => onSelectText(null)}>
      <div className="pv-frame" ref={frame} style={{ width: box.w, height: box.h, background: data.background }}>
        {data.clips.map((c, i) => {
          const m = mediaById[c.mediaId];
          if (!m) return null;
          const show = activeClip?.id === c.id;
          const near = at && Math.abs(i - at.index) <= 1;
          const style: React.CSSProperties = { objectFit: c.fit === "contain" ? "contain" : "cover", visibility: show ? "visible" : "hidden" };
          return m.kind === "image" ? (
            <img key={c.id} src={m.url} className="pv-media" style={style} alt="" />
          ) : (
            <video key={c.id} ref={(el) => { videos.current[c.id] = el; }} src={m.url} className="pv-media" style={style}
              preload={near ? "auto" : "metadata"} playsInline
              onLoadedMetadata={(e) => { if (!show) (e.target as HTMLVideoElement).currentTime = c.in; else sync(timeRef.current, playing.current); }} />
          );
        })}
        {!data.clips.length && <div className="pv-empty">Añade clips desde la biblioteca de la izquierda</div>}

        {caption && (
          <div className="pv-text pv-caption" style={{ left: "50%", top: `${cs.y * 100}%` }}>
            <span style={{ ...textStyle({ ...cs, box: cs.box, boxColor: "#000000", boxOpacity: 0.6 }), display: "inline-block", maxWidth: box.w * 0.9 }}>
              {caption.words.length && cs.highlight
                ? caption.words.map((w, i) => {
                  const on = time >= (i === 0 ? caption.start : w.s) && (i === caption.words.length - 1 ? time < caption.end : time < caption.words[i + 1].s);
                  return <span key={i} style={on ? { color: cs.highlight! } : undefined}>{(cs.uppercase ? w.w.toUpperCase() : w.w) + (i < caption.words.length - 1 ? " " : "")}</span>;
                })
                : cs.uppercase ? caption.text.toUpperCase() : caption.text}
            </span>
          </div>
        )}

        {data.texts.map((t) => {
          const visible = time >= t.start && time < t.end;
          const sel = selectedText === t.id;
          if (!visible && !sel) return null;
          return (
            <div key={t.id} className={"pv-text is-draggable" + (sel ? " is-selected" : "") + (visible ? "" : " is-ghost")}
              style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
              onPointerDown={(e) => startDrag(e, t)} onPointerMove={(e) => moveDrag(e)} onPointerUp={(e) => moveDrag(e, true)}
              onClick={(e) => e.stopPropagation()}>
              <span style={{ ...textStyle(t), display: "inline-block", whiteSpace: "pre-wrap", maxWidth: box.w * 0.92 }}>{t.text}</span>
            </div>
          );
        })}

        {data.music && mediaById[data.music.mediaId] && <audio ref={music} src={mediaById[data.music.mediaId].url} preload="auto" />}
      </div>
      <div className="pv-dims mono">{data.width}×{data.height} · {Math.round(scale * 100)} %</div>
    </div>
  );
});

export default Preview;

function musicGain(d: ProjectData, t: number) {
  const m = d.music;
  if (!m) return 0;
  const total = totalDuration(d);
  let g = m.volume;
  if (m.fadeIn > 0 && t < m.fadeIn) g *= t / m.fadeIn;
  if (m.fadeOut > 0 && t > total - m.fadeOut) g *= Math.max(0, (total - t) / m.fadeOut);
  return g;
}

function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function shadowOutline(o: number) {
  const steps = 12;
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push(`${(Math.cos(a) * o).toFixed(1)}px ${(Math.sin(a) * o).toFixed(1)}px 0 #000`);
  }
  return out.join(",");
}
