// Editor de vídeo: biblioteca · vista previa · ajustes · línea de tiempo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarPlus, Check, Download, Loader2, Pause, Play, Redo2, Scissors, SkipBack, Trash2, Type, Undo2, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { api, FORMATS, fmtSize, fmtTime, type ExportJob, type Format, type Media, type Project, type ProjectData } from "../api";
import { Field, Modal, navigate, useToast } from "../ui";
import Preview, { type PreviewHandle } from "./Preview";
import Timeline, { type Sel } from "./Timeline";
import MediaPanel from "./MediaPanel";
import Inspector from "./Inspector";
import { capStyle, clampTexts, groupCaptions, newClip, newText, splitAt, timelineWords, totalDuration } from "./model";

type SaveState = "saved" | "saving" | "dirty" | "error";

export default function Editor({ id }: { id: string }) {
  const toast = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [data, setData] = useState<ProjectData | null>(null);
  const [name, setName] = useState("");
  const [media, setMedia] = useState<Media[]>([]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [pps, setPps] = useState(40);
  const [save, setSave] = useState<SaveState>("saved");
  const [captionsBusy, setCaptionsBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState<{ name: string; job: ExportJob | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<PreviewHandle>(null);

  // Historial para deshacer / rehacer
  const undo = useRef<ProjectData[]>([]);
  const redo = useRef<ProjectData[]>([]);
  const dragBase = useRef<ProjectData | null>(null);
  const [, bump] = useState(0);
  const dataRef = useRef(data);
  dataRef.current = data;

  const mediaById = useMemo(() => Object.fromEntries(media.map((m) => [m.id, m])), [media]);
  const total = data ? totalDuration(data) : 0;

  /* ---------- Carga ---------- */
  useEffect(() => {
    Promise.all([api.project(id), api.media()])
      .then(([p, m]) => { setProject(p); setData(p.data); setName(p.name); setMedia(m); })
      .catch((e) => setError(e.message));
  }, [id]);

  /* ---------- Guardado automático ---------- */
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!data || !project) return;
    if (firstLoad.current) { firstLoad.current = false; return; }
    setSave("dirty");
    const t = setTimeout(() => {
      setSave("saving");
      api.saveProject(project.id, { name, data }).then(() => setSave("saved")).catch(() => setSave("error"));
    }, 700);
    return () => clearTimeout(t);
  }, [data, name, project]);

  // Avisar si se cierra con cambios sin guardar
  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => { if (save === "dirty" || save === "saving") e.preventDefault(); };
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, [save]);

  /* ---------- Cambios ---------- */
  const apply = useCallback((next: ProjectData) => {
    const cur = dataRef.current;
    if (cur && cur !== next) { undo.current.push(cur); if (undo.current.length > 100) undo.current.shift(); redo.current = []; }
    const clean = clampTexts(next);
    dataRef.current = clean;
    setData(clean);
    bump((n) => n + 1);
  }, []);
  const live = useCallback((next: ProjectData) => { dataRef.current = next; setData(next); }, []);
  const begin = useCallback(() => { dragBase.current = dataRef.current; }, []);
  const end = useCallback(() => {
    const base = dragBase.current;
    const cur = dataRef.current;
    dragBase.current = null;
    if (base && cur && base !== cur) {
      undo.current.push(base);
      redo.current = [];
      const clean = clampTexts(cur);
      dataRef.current = clean;
      setData(clean);
    }
    bump((n) => n + 1);
  }, []);
  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) return;
    if (dataRef.current) redo.current.push(dataRef.current);
    dataRef.current = prev;
    setData(prev);
    bump((n) => n + 1);
  }, []);
  const doRedo = useCallback(() => {
    const next = redo.current.pop();
    if (!next) return;
    if (dataRef.current) undo.current.push(dataRef.current);
    dataRef.current = next;
    setData(next);
    bump((n) => n + 1);
  }, []);

  const seek = useCallback((t: number) => preview.current?.seek(t), []);

  const addClip = useCallback((m: Media) => {
    if (!data) return;
    const c = newClip(m);
    apply({ ...data, clips: [...data.clips, c] });
    setSel({ kind: "clip", id: c.id });
  }, [data, apply]);

  const setMusic = useCallback((m: Media) => {
    if (!data) return;
    apply({ ...data, music: { mediaId: m.id, volume: 0.3, fadeIn: 1, fadeOut: 2, offset: 0 } });
    setSel({ kind: "music", id: m.id });
    toast(`Música: «${m.name}»`);
  }, [data, apply, toast]);

  const split = useCallback(() => {
    if (!data) return;
    const next = splitAt(data, time);
    if (next) apply(next); else toast("Pon la línea de reproducción dentro de un clip para cortarlo.", "info");
  }, [data, time, apply, toast]);

  const addText = useCallback(() => {
    if (!data) return;
    const t = newText(data, time);
    apply({ ...data, texts: [...data.texts, t] });
    setSel({ kind: "text", id: t.id });
  }, [data, time, apply]);

  const deleteSel = useCallback(() => {
    if (!data || !sel) return;
    if (sel.kind === "clip") apply({ ...data, clips: data.clips.filter((c) => c.id !== sel.id) });
    else if (sel.kind === "text") apply({ ...data, texts: data.texts.filter((t) => t.id !== sel.id) });
    else if (sel.kind === "caption") apply({ ...data, captions: { ...data.captions, items: data.captions.items.filter((c) => c.id !== sel.id) } });
    else if (sel.kind === "music") apply({ ...data, music: null });
    setSel(null);
  }, [data, sel, apply]);

  const changeFormat = useCallback((f: Format) => {
    if (!data) return;
    const fm = FORMATS.find((x) => x.id === f)!;
    // Los textos se reescalan para que ocupen lo mismo
    const k = fm.w / data.width;
    apply({ ...data, format: f, width: fm.w, height: fm.h, texts: data.texts.map((t) => ({ ...t, size: Math.round(t.size * k) })) });
  }, [data, apply]);

  /* ---------- Subtítulos ---------- */
  const generateCaptions = useCallback(async () => {
    if (!data) return;
    const ids = [...new Set(data.clips.filter((c) => !c.muted && mediaById[c.mediaId]?.kind === "video" && mediaById[c.mediaId]?.has_audio).map((c) => c.mediaId))];
    if (!ids.length) { toast("Ningún clip tiene voz.", "info"); return; }
    try {
      const pending = ids.filter((i) => mediaById[i].transcript_status !== "done");
      for (const i of pending) if (mediaById[i].transcript_status !== "running") await api.transcribe(i);
      let fresh: Media[] = ids.map((i) => mediaById[i]);
      const t0 = Date.now();
      while (fresh.some((m) => m.transcript_status !== "done")) {
        const done = fresh.filter((m) => m.transcript_status === "done").length;
        setCaptionsBusy(`Escuchando la voz… ${done}/${ids.length}${Date.now() - t0 > 8000 ? " (la primera vez tarda ~1 min)" : ""}`);
        await new Promise((r) => setTimeout(r, 2500));
        fresh = await Promise.all(ids.map((i) => api.mediaOne(i)));
        // Si una transcripción se cortó (p. ej. se reinició el servidor), se vuelve a pedir
        for (const m of fresh) if (!m.transcript_status) await api.transcribe(m.id);
        const bad = fresh.find((m) => m.transcript_status?.startsWith("error"));
        if (bad) throw new Error("No se pudo transcribir «" + bad.name + "»: " + bad.transcript_status!.slice(7, 200));
      }
      setMedia((list) => list.map((m) => fresh.find((f) => f.id === m.id) ?? m));
      const byId = { ...mediaById, ...Object.fromEntries(fresh.map((m) => [m.id, m])) };
      const cur = dataRef.current!;
      const items = groupCaptions(timelineWords(cur, byId), capStyle(cur).wordsPerLine);
      if (!items.length) { toast("No se ha oído ninguna palabra en los clips.", "info"); return; }
      apply({ ...cur, captions: { ...cur.captions, enabled: true, items } });
      toast(`Subtítulos listos: ${items.length} frases`);
    } catch (e) {
      toast((e as Error).message, "bad");
    } finally {
      setCaptionsBusy(null);
    }
  }, [data, mediaById, apply, toast]);

  // Cambiar "palabras por frase" regenera los grupos con las mismas palabras
  const perLine = data?.captions.style.wordsPerLine;
  useEffect(() => {
    const cur = dataRef.current;
    if (!cur || !perLine || !cur.captions.items.length) return;
    const words = cur.captions.items.flatMap((c) => c.words);
    if (!words.length) return;
    setData({ ...cur, captions: { ...cur.captions, items: groupCaptions(words, perLine) } });
  }, [perLine]);

  /* ---------- Exportar ---------- */
  async function startExport() {
    if (!data || !project || !exporting) return;
    try {
      // Se manda el estilo completo de los subtítulos (con los valores por defecto ya puestos)
      const full = { ...data, captions: { ...data.captions, style: capStyle(data) } };
      const job = await api.exportProject(project.id, exporting.name.trim() || name, full);
      setExporting({ ...exporting, job });
    } catch (e) { toast((e as Error).message, "bad"); }
  }
  useEffect(() => {
    const job = exporting?.job;
    if (!job || job.status === "done" || job.status === "error") return;
    const t = setInterval(() => api.exportOne(job.id).then((j) => setExporting((x) => (x ? { ...x, job: j } : x))).catch(() => {}), 800);
    return () => clearInterval(t);
  }, [exporting?.job]);

  /* ---------- Atajos de teclado ---------- */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || exporting) return;
      const k = e.key.toLowerCase();
      if (k === " ") { e.preventDefault(); preview.current?.toggle(); }
      else if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); doRedo(); }
      else if (k === "s" && !e.ctrlKey && !e.metaKey) split();
      else if (k === "t" && !e.ctrlKey && !e.metaKey) addText();
      else if (k === "delete" || k === "backspace") deleteSel();
      else if (k === "arrowleft") { e.preventDefault(); seek(time - (e.shiftKey ? 1 : 1 / 30)); }
      else if (k === "arrowright") { e.preventDefault(); seek(time + (e.shiftKey ? 1 : 1 / 30)); }
      else if (k === "home") seek(0);
      else if (k === "escape") setSel(null);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [split, addText, deleteSel, doUndo, doRedo, seek, time, exporting]);

  // Zoom inicial para que todo quepa
  const fitted = useRef(false);
  const tlBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fitted.current || !data || !total || !tlBox.current) return;
    fitted.current = true;
    const w = tlBox.current.clientWidth - 140;
    setPps(Math.max(8, Math.min(160, w / (total + 2))));
  }, [data, total]);

  if (error) return <div className="page"><div className="note note--bad">{error}</div><p><button className="btn" onClick={() => navigate("/")}>Volver a proyectos</button></p></div>;
  if (!data || !project) return <div className="ed-loading"><Loader2 className="spin" /> Abriendo el proyecto…</div>;

  const job = exporting?.job;
  return (
    <div className="ed">
      <header className="ed-top">
        <button className="btn btn--ghost btn--sm" onClick={() => navigate("/")}><ArrowLeft size={16} /> Proyectos</button>
        <input className="ed-top__name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre del proyecto" />
        <span className={"ed-save ed-save--" + save}>
          {save === "saved" ? <><Check size={13} /> Guardado</> : save === "error" ? "No se pudo guardar" : <><Loader2 size={13} className="spin" /> Guardando…</>}
        </span>
        <span className="spacer" />
        <button className="btn btn--ghost btn--icon btn--sm" title="Deshacer (Ctrl+Z)" disabled={!undo.current.length} onClick={doUndo}><Undo2 size={16} /></button>
        <button className="btn btn--ghost btn--icon btn--sm" title="Rehacer (Ctrl+Y)" disabled={!redo.current.length} onClick={doRedo}><Redo2 size={16} /></button>
        <span className="pill">{data.format} · {data.width}×{data.height}</span>
        <button className="btn btn--primary btn--sm" disabled={!data.clips.length} onClick={() => setExporting({ name, job: null })}><Upload size={15} /> Exportar</button>
      </header>

      <div className="ed-body">
        <MediaPanel media={media} onUploaded={(m) => setMedia((l) => [...m, ...l])} onAdd={addClip} onMusic={setMusic} />
        <div className="ed-center"
          onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-media")) e.preventDefault(); }}
          onDrop={(e) => { const mid = e.dataTransfer.getData("application/x-media"); const m = mediaById[mid]; if (m) { e.preventDefault(); m.kind === "audio" ? setMusic(m) : addClip(m); } }}>
          <Preview ref={preview} data={data} mediaById={mediaById} time={time} onTime={setTime} onPlaying={setPlaying}
            selectedText={sel?.kind === "text" ? sel.id : null}
            onSelectText={(tid) => setSel(tid ? { kind: "text", id: tid } : null)}
            onMoveText={(tid, x, y, done) => {
              if (!done && !dragBase.current) begin();
              live({ ...data, texts: data.texts.map((t) => (t.id === tid ? { ...t, x, y } : t)) });
              if (done) end();
            }} />
          <div className="ed-transport">
            <button className="btn btn--ghost btn--icon btn--sm" title="Al principio (Inicio)" onClick={() => seek(0)}><SkipBack size={16} /></button>
            <button className="ed-play" title="Reproducir / pausa (Espacio)" onClick={() => preview.current?.toggle()} disabled={!data.clips.length}>
              {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
            <span className="mono ed-time">{fmtTime(time, true)} <span className="muted">/ {fmtTime(total, true)}</span></span>
          </div>
        </div>
        <aside className="ed-ins">
          <Inspector data={data} name={name} media={media} mediaById={mediaById} sel={sel} time={time}
            apply={apply} live={live} onRename={setName} onDeleteSel={deleteSel} onSplit={split} onAddText={addText} onSeek={seek}
            captionsBusy={captionsBusy} onGenerateCaptions={generateCaptions} onFormat={changeFormat} />
        </aside>
      </div>

      <div className="ed-tools">
        <button className="btn btn--sm" onClick={split} title="Cortar el clip en la línea (S)"><Scissors size={14} /> Cortar</button>
        <button className="btn btn--sm" onClick={addText} title="Añadir texto (T)"><Type size={14} /> Texto</button>
        <button className="btn btn--sm btn--danger" onClick={deleteSel} disabled={!sel} title="Borrar lo seleccionado (Supr)"><Trash2 size={14} /> Borrar</button>
        <span className="spacer" />
        <span className="ed-tools__hint">Espacio: reproducir · S: cortar · T: texto · Supr: borrar · Ctrl+Z: deshacer</span>
        <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setPps((p) => Math.max(6, p / 1.4))} title="Alejar"><ZoomOut size={16} /></button>
        <input className="range" style={{ width: 110 }} type="range" min={6} max={220} value={pps} onChange={(e) => setPps(Number(e.target.value))} aria-label="Zoom" />
        <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setPps((p) => Math.min(220, p * 1.4))} title="Acercar"><ZoomIn size={16} /></button>
      </div>
      <div className="ed-tl" ref={tlBox}>
        <Timeline data={data} mediaById={mediaById} time={time} pps={pps} sel={sel} onSelect={setSel} onSeek={seek} onBegin={begin} onLive={live} onEnd={end} />
      </div>

      {exporting && (
        <Modal title="Exportar vídeo" icon={<Upload size={18} color="var(--accent-2)" />} onClose={() => setExporting(null)}
          foot={!job ? (
            <><span className="spacer" /><button className="btn" onClick={() => setExporting(null)}>Cancelar</button><button className="btn btn--primary" onClick={startExport}>Exportar MP4</button></>
          ) : job.status === "done" ? (
            <><button className="btn" onClick={() => setExporting(null)}>Seguir editando</button><span className="spacer" />
              <a className="btn" href={job.url!} download={`${job.name}.mp4`}><Download size={15} /> Descargar</a>
              <button className="btn btn--primary" onClick={() => navigate(`/calendario?nuevo=${job.id}`)}><CalendarPlus size={15} /> Programar publicación</button></>
          ) : job.status === "error" ? (
            <><span className="spacer" /><button className="btn" onClick={() => setExporting(null)}>Cerrar</button><button className="btn btn--primary" onClick={() => setExporting({ ...exporting, job: null })}>Reintentar</button></>
          ) : (
            <><span className="spacer" /><button className="btn" onClick={() => setExporting(null)}>Seguir editando mientras tanto</button></>
          )}>
          {!job ? (
            <>
              <Field label="Nombre del vídeo"><input className="input" autoFocus value={exporting.name} onChange={(e) => setExporting({ ...exporting, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && startExport()} /></Field>
              <div className="note">
                MP4 {data.width}×{data.height} a 30 fps · {fmtTime(total, true)} · H.264 + AAC, listo para Instagram, TikTok y YouTube.
                {data.captions.enabled && data.captions.items.length > 0 && " Con subtítulos incrustados."}
              </div>
            </>
          ) : job.status === "error" ? (
            <div className="note note--bad">No se pudo exportar: {job.error}</div>
          ) : job.status === "done" ? (
            <div className="ex-done">
              <video src={job.url!} controls className="ex-done__video" style={{ aspectRatio: `${data.width} / ${data.height}` }} />
              <div>
                <div className="note note--ok">Vídeo listo · {fmtTime(job.duration ?? 0, true)} · {fmtSize(job.size)}</div>
                <p className="muted" style={{ fontSize: 13 }}>Lo tienes también en «Vídeos exportados». Desde allí o desde aquí puedes programar cuándo se publica.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="row"><Loader2 size={16} className="spin" /> <b>Exportando «{job.name}»…</b><span className="spacer" /><span className="mono">{Math.round(job.progress * 100)} %</span></div>
              <div className="progress"><span style={{ width: `${Math.max(2, job.progress * 100)}%` }} /></div>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>Lo hace tu ordenador con ffmpeg. Puedes cerrar esta ventana y seguir editando.</p>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
