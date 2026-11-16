// Línea de tiempo: clips (recortar por los bordes, mover para reordenar), textos, subtítulos y música.
import { useMemo, useRef, useState } from "react";
import { Captions, Film, Music2, Type } from "lucide-react";
import { fmtTime, type Media, type ProjectData } from "../api";
import { clipDur, clipStarts, totalDuration } from "./model";

export type Sel = { kind: "clip" | "text" | "caption" | "music"; id: string } | null;

type Props = {
  data: ProjectData;
  mediaById: Record<string, Media>;
  time: number;
  pps: number;
  sel: Sel;
  onSelect: (s: Sel) => void;
  onSeek: (t: number) => void;
  onBegin: () => void;
  onLive: (d: ProjectData) => void;
  onEnd: () => void;
};

const LABEL_W = 108;
const MIN = 0.1;

export default function Timeline({ data, mediaById, time, pps, sel, onSelect, onSeek, onBegin, onLive, onEnd }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const total = totalDuration(data);
  const starts = clipStarts(data);
  const width = Math.max(total + 8, 20) * pps;
  const [dropAt, setDropAt] = useState<number | null>(null);

  const xToTime = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + scroller.current!.scrollLeft - LABEL_W) / pps);
  };

  /* ---------- Escala de tiempo ---------- */
  const step = pps >= 120 ? 0.5 : pps >= 60 ? 1 : pps >= 30 ? 2 : pps >= 14 ? 5 : 10;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= width / pps; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  }, [width, pps, step]);

  function scrub(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onSeek(Math.min(total, xToTime(e.clientX)));
    const move = (ev: PointerEvent) => onSeek(Math.min(total, xToTime(ev.clientX)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Arrastre genérico: llama a fn con los segundos movidos. */
  function dragging(e: React.PointerEvent, fn: (dt: number, ev: PointerEvent) => void, after?: (moved: boolean) => void) {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    let moved = false;
    onBegin();
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 3) moved = true;
      if (moved) fn((ev.clientX - x0) / pps, ev);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      after?.(moved);
      onEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* ---------- Clips ---------- */
  function trimClip(e: React.PointerEvent, i: number, side: "l" | "r") {
    const base = data;
    const c0 = base.clips[i];
    const m = mediaById[c0.mediaId];
    const max = m?.kind === "image" ? 3600 : m?.duration ?? c0.out;
    onSelect({ kind: "clip", id: c0.id });
    dragging(e, (dt) => {
      const c = { ...c0 };
      if (side === "l") c.in = Math.min(Math.max(0, c0.in + dt), c0.out - MIN);
      else c.out = Math.max(Math.min(max, c0.out + dt), c0.in + MIN);
      const clips = [...base.clips];
      clips[i] = c;
      onLive({ ...base, clips });
    });
  }

  function moveClip(e: React.PointerEvent, i: number) {
    const base = data;
    const id = base.clips[i].id;
    onSelect({ kind: "clip", id });
    let target = i;
    dragging(e, (_dt, ev) => {
      const t = xToTime(ev.clientX);
      // Posición de destino según los centros de los demás clips
      let idx = 0;
      base.clips.forEach((c, j) => { if (t > starts[j] + clipDur(c) / 2) idx = j + 1; });
      target = idx;
      setDropAt(idx);
    }, (moved) => {
      setDropAt(null);
      if (!moved) { onSeek(Math.min(total, xToTime(e.clientX))); return; }
      if (target === i || target === i + 1) return;
      const clips = [...base.clips];
      const [c] = clips.splice(i, 1);
      clips.splice(target > i ? target - 1 : target, 0, c);
      onLive({ ...base, clips });
    });
  }

  /* ---------- Textos (en carriles para que no se pisen) ---------- */
  const lanes = useMemo(() => {
    const sorted = [...data.texts].sort((a, b) => a.start - b.start);
    const ends: number[] = [];
    const lane: Record<string, number> = {};
    for (const t of sorted) {
      let l = ends.findIndex((end) => end <= t.start + 0.001);
      if (l < 0) { l = ends.length; ends.push(0); }
      ends[l] = t.end;
      lane[t.id] = l;
    }
    return { lane, count: Math.max(1, ends.length) };
  }, [data.texts]);

  function dragText(e: React.PointerEvent, id: string, mode: "move" | "l" | "r") {
    const base = data;
    const t0 = base.texts.find((t) => t.id === id)!;
    onSelect({ kind: "text", id });
    const limit = Math.max(total, t0.end);
    dragging(e, (dt) => {
      let { start, end } = t0;
      if (mode === "move") {
        const d = Math.min(Math.max(-t0.start, dt), limit - t0.end);
        start = t0.start + d; end = t0.end + d;
      } else if (mode === "l") start = Math.min(Math.max(0, t0.start + dt), t0.end - 0.2);
      else end = Math.max(Math.min(limit, t0.end + dt), t0.start + 0.2);
      onLive({ ...base, texts: base.texts.map((t) => (t.id === id ? { ...t, start, end } : t)) });
    }, (moved) => { if (!moved) onSeek(Math.max(t0.start, Math.min(xToTime(e.clientX), t0.end))); });
  }

  const textRowH = 30;
  const textsH = lanes.count * (textRowH + 4) + 8;
  const music = data.music ? mediaById[data.music.mediaId] : null;

  return (
    <div className="tl" ref={scroller}>
      <div className="tl__inner" style={{ width: width + LABEL_W }}>
        {/* Regla */}
        <div className="tl__row tl__row--ruler">
          <div className="tl__label tl__label--ruler mono">{fmtTime(time, true)}</div>
          <div className="tl__ruler" style={{ width }} onPointerDown={scrub}>
            {ticks.map((t) => (
              <span key={t} className={"tl__tick" + (t % (step * 2) === 0 ? " is-major" : "")} style={{ left: t * pps }}>
                {t % (step * 2) === 0 && <em>{fmtTime(t)}</em>}
              </span>
            ))}
          </div>
        </div>

        {/* Vídeo */}
        <div className="tl__row">
          <div className="tl__label"><Film size={14} /> Vídeo</div>
          <div className="tl__track tl__track--clips" style={{ width }} onPointerDown={(e) => { onSelect(null); scrub(e); }}>
            {data.clips.map((c, i) => {
              const m = mediaById[c.mediaId];
              const w = clipDur(c) * pps;
              const isSel = sel?.kind === "clip" && sel.id === c.id;
              return (
                <div key={c.id} className={"tl-clip" + (isSel ? " is-sel" : "") + (c.muted ? " is-muted" : "")}
                  style={{ left: starts[i] * pps, width: w, backgroundImage: m?.thumbUrl ? `url(${m.thumbUrl})` : undefined }}
                  onPointerDown={(e) => moveClip(e, i)}
                  title={`${m?.name ?? "Clip"} · ${fmtTime(clipDur(c), true)}`}>
                  <span className="tl-clip__h tl-clip__h--l" onPointerDown={(e) => trimClip(e, i, "l")} />
                  {w > 54 && <span className="tl-clip__name">{m?.name ?? "Sin archivo"}</span>}
                  {w > 54 && <span className="tl-clip__dur mono">{fmtTime(clipDur(c), true)}</span>}
                  <span className="tl-clip__h tl-clip__h--r" onPointerDown={(e) => trimClip(e, i, "r")} />
                </div>
              );
            })}
            {dropAt != null && <span className="tl-drop" style={{ left: (dropAt < starts.length ? starts[dropAt] : total) * pps }} />}
            {!data.clips.length && <span className="tl__hint">Arrastra o pulsa + en un clip de la biblioteca para empezar</span>}
          </div>
        </div>

        {/* Textos */}
        <div className="tl__row">
          <div className="tl__label"><Type size={14} /> Textos</div>
          <div className="tl__track" style={{ width, height: textsH }} onPointerDown={(e) => { onSelect(null); scrub(e); }}>
            {data.texts.map((t) => {
              const isSel = sel?.kind === "text" && sel.id === t.id;
              return (
                <div key={t.id} className={"tl-block tl-block--text" + (isSel ? " is-sel" : "")}
                  style={{ left: t.start * pps, width: Math.max(8, (t.end - t.start) * pps), top: 4 + lanes.lane[t.id] * (textRowH + 4), height: textRowH }}
                  onPointerDown={(e) => dragText(e, t.id, "move")}>
                  <span className="tl-clip__h tl-clip__h--l" onPointerDown={(e) => dragText(e, t.id, "l")} />
                  <span className="tl-block__txt">{t.text}</span>
                  <span className="tl-clip__h tl-clip__h--r" onPointerDown={(e) => dragText(e, t.id, "r")} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Subtítulos */}
        <div className={"tl__row" + (data.captions.enabled ? "" : " is-off")}>
          <div className="tl__label"><Captions size={14} /> Subtítulos</div>
          <div className="tl__track tl__track--thin" style={{ width }} onPointerDown={(e) => { onSelect(null); scrub(e); }}>
            {data.captions.items.map((c) => {
              const isSel = sel?.kind === "caption" && sel.id === c.id;
              return (
                <div key={c.id} className={"tl-block tl-block--cap" + (isSel ? " is-sel" : "")}
                  style={{ left: c.start * pps, width: Math.max(4, (c.end - c.start) * pps) }}
                  onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: "caption", id: c.id }); onSeek(c.start + 0.01); }}>
                  <span className="tl-block__txt">{c.text}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Música */}
        <div className="tl__row">
          <div className="tl__label"><Music2 size={14} /> Música</div>
          <div className="tl__track tl__track--thin" style={{ width }} onPointerDown={(e) => { onSelect(null); scrub(e); }}>
            {music && total > 0 && (
              <div className={"tl-block tl-block--music" + (sel?.kind === "music" ? " is-sel" : "")} style={{ left: 0, width: total * pps }}
                onPointerDown={(e) => { e.stopPropagation(); onSelect({ kind: "music", id: music.id }); }}>
                <span className="tl-block__txt">♪ {music.name}</span>
              </div>
            )}
          </div>
        </div>

        <div className="tl__playhead" style={{ left: LABEL_W + time * pps }} />
      </div>
    </div>
  );
}
