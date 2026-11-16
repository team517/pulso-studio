// Exporta un proyecto a MP4 con ffmpeg (NVIDIA si hay; si falla, x264).
// Clips en secuencia → recorte/encuadre al formato → textos y subtítulos (ASS) → música.
import { writeFileSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { db, DIRS, now } from "./db.js";
import { run, makeThumb } from "./media.js";

const FPS = 30;

/* ---------- ASS (textos y subtítulos) ---------- */

const pad2 = (n) => String(n).padStart(2, "0");
function assTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100);
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs % 100)}`;
}
/** #RRGGBB (+ opacidad 0-1) → &HAABBGGRR */
function assColor(hex = "#ffffff", opacity = 1) {
  const h = hex.replace("#", "").padEnd(6, "0");
  const a = Math.round((1 - opacity) * 255).toString(16).padStart(2, "0");
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}
const assText = (s) => String(s).replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
// El tamaño ASS es la altura de línea; en CSS es el "em". Factor para que se vea igual que en el editor.
const ASS_SIZE = 1.15;

function textStyleTags(t, W, H) {
  const tags = [
    "\\an5",
    `\\pos(${Math.round((t.x ?? 0.5) * W)},${Math.round((t.y ?? 0.5) * H)})`,
    `\\fn${t.font || "Arial Black"}`,
    `\\fs${Math.round((t.size || 64) * ASS_SIZE)}`,
    `\\c${assColor(t.color || "#ffffff")}`,
    `\\b${(t.weight ?? 800) >= 600 ? 1 : 0}`,
  ];
  if (t.box) {
    tags.push("\\4a&HFF&", `\\3c${assColor(t.boxColor || "#000000")}`, `\\3a&H${Math.round((1 - (t.boxOpacity ?? 0.6)) * 255).toString(16).padStart(2, "0").toUpperCase()}&`, `\\bord${Math.round((t.size || 64) * 0.25)}`);
  } else {
    tags.push(`\\bord${t.outline ?? Math.max(2, Math.round((t.size || 64) / 18))}`, `\\3c${assColor(t.outlineColor || "#000000")}`, "\\shad0");
  }
  return "{" + tags.join("") + "}";
}

export function buildAss(project, totalDur) {
  const { width: W, height: H } = project;
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,3,0,5,40,40,40,1",
    "Style: Box,Arial,64,&H00FFFFFF,&H00FFFFFF,&H99000000,&H00000000,0,0,0,0,100,100,0,0,3,10,0,5,40,40,40,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const ev = (layer, s, e, style, text) => {
    const st = Math.max(0, Math.min(s, totalDur)), en = Math.max(0, Math.min(e, totalDur));
    if (en - st > 0.01) lines.push(`Dialogue: ${layer},${assTime(st)},${assTime(en)},${style},,0,0,0,,${text}`);
  };

  // Subtítulos (debajo de los textos)
  const cap = project.captions;
  if (cap?.enabled && cap.items?.length) {
    // Mismos valores por defecto que el editor (src/editor/model.ts → CAPTION_DEFAULTS)
    const st = { font: "Arial Black", size: 72, color: "#ffffff", highlight: "#ffd60a", y: 0.72, uppercase: true, box: false, outline: 5, ...cap.style };
    const tpl = { ...st, x: 0.5 };
    for (const it of cap.items) {
      const txt = st.uppercase ? it.text.toUpperCase() : it.text;
      const style = st.box ? "Box" : "Default";
      if (st.highlight && it.words?.length) {
        // Palabra que se está diciendo en otro color
        it.words.forEach((w, i) => {
          const s = i === 0 ? it.start : w.s;
          const e = i === it.words.length - 1 ? it.end : it.words[i + 1].s;
          const parts = it.words.map((x, j) => {
            const word = assText(st.uppercase ? x.w.toUpperCase() : x.w);
            return j === i ? `{\\c${assColor(st.highlight)}}${word}{\\c${assColor(st.color)}}` : word;
          });
          ev(1, s, e, style, textStyleTags(tpl, W, H) + parts.join(" "));
        });
      } else {
        ev(1, it.start, it.end, style, textStyleTags(tpl, W, H) + assText(txt));
      }
    }
  }
  // Textos libres
  for (const t of project.texts || []) ev(2, t.start, t.end, t.box ? "Box" : "Default", textStyleTags(t, W, H) + assText(t.text));
  return lines.join("\n") + "\n";
}

/* ---------- Exportación ---------- */

const jobs = new Map(); // exportId → { cancel }

function update(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(`UPDATE exports SET ${keys.map((k) => k + " = ?").join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k]), id);
}

export function buildCommand(project, mediaById, assFile, outFile) {
  const { width: W, height: H } = project;
  const clips = (project.clips || []).filter((c) => mediaById[c.mediaId] && c.out > c.in);
  if (!clips.length) throw new Error("El proyecto no tiene clips.");
  const args = ["-y", "-hide_banner", "-nostats", "-progress", "pipe:1"];
  const f = [];
  let total = 0;

  clips.forEach((c, i) => {
    const m = mediaById[c.mediaId];
    const dur = c.out - c.in;
    total += dur;
    const file = join(DIRS.media, m.file);
    if (m.kind === "image") args.push("-loop", "1", "-t", dur.toFixed(3), "-i", file);
    else args.push("-ss", c.in.toFixed(3), "-t", dur.toFixed(3), "-i", file);
    const fit = c.fit === "contain"
      ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${(project.background || "#000000").replace("#", "0x")}`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    f.push(`[${i}:v]${fit},setsar=1,fps=${FPS},format=yuv420p,trim=0:${dur.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    const vol = c.muted ? 0 : (c.volume ?? 1);
    if (m.has_audio && m.kind !== "image") {
      f.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${vol},atrim=0:${dur.toFixed(3)},apad=whole_dur=${dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    } else {
      f.push(`anullsrc=r=48000:cl=stereo,atrim=0:${dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    }
  });
  f.push(`${clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${clips.length}:v=1:a=1[vc][ac]`);
  f.push(`[vc]subtitles=${assFile}[vout]`);

  let audioOut = "[ac]";
  const mu = project.music;
  if (mu?.mediaId && mediaById[mu.mediaId]) {
    const idx = clips.length;
    args.push("-stream_loop", "-1", "-ss", String(mu.offset || 0), "-i", join(DIRS.media, mediaById[mu.mediaId].file));
    const fi = Math.max(0, mu.fadeIn ?? 0), fo = Math.max(0, mu.fadeOut ?? 0);
    let chain = `[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${mu.volume ?? 0.3}`;
    if (fi > 0) chain += `,afade=t=in:st=0:d=${fi}`;
    if (fo > 0) chain += `,afade=t=out:st=${Math.max(0, total - fo).toFixed(3)}:d=${fo}`;
    f.push(chain + "[mus]");
    f.push(`[ac][mus]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
    audioOut = "[aout]";
  }

  args.push("-filter_complex", f.join(";"), "-map", "[vout]", "-map", audioOut, "-r", String(FPS));
  return { args, total, outFile };
}

const VIDEO_GPU = ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "20", "-b:v", "0", "-maxrate", "16M", "-bufsize", "32M", "-profile:v", "high"];
const VIDEO_CPU = ["-c:v", "libx264", "-preset", "fast", "-crf", "19", "-profile:v", "high"];
// Se comprueba una vez si la GPU NVIDIA puede codificar (necesita un driver reciente)
let gpu = null;
async function canUseGpu() {
  if (gpu === null) {
    gpu = await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.2", "-c:v", "h264_nvenc", "-f", "null", "-"]).then(() => true, () => false);
    console.log("[export] codificación por GPU:", gpu ? "sí (NVENC)" : "no, uso la CPU (x264)");
  }
  return gpu;
}

const TAIL = ["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart"];

export async function startExport(exportId, project) {
  const ids = [...new Set([...(project.clips || []).map((c) => c.mediaId), project.music?.mediaId].filter(Boolean))];
  const mediaById = Object.fromEntries(ids.map((id) => [id, db.prepare("SELECT * FROM media WHERE id = ?").get(id)]).filter(([, m]) => m));
  const assName = `job-${exportId}.ass`;
  const outName = `${exportId}.mp4`;
  const outFile = join(DIRS.exports, outName);
  let cmd;
  try {
    cmd = buildCommand(project, mediaById, assName, outFile);
    writeFileSync(join(DIRS.tmp, assName), buildAss(project, cmd.total), "utf8");
  } catch (e) {
    update(exportId, { status: "error", error: e.message });
    return;
  }
  update(exportId, { status: "running", progress: 0, duration: cmd.total, width: project.width, height: project.height });

  const onStdout = (chunk) => {
    const m = /out_time_us=(\d+)/g; let r, last = null;
    while ((r = m.exec(chunk))) last = Number(r[1]);
    if (last != null && cmd.total > 0) update(exportId, { progress: Math.min(0.99, last / 1e6 / cmd.total) });
  };
  const attempt = (codec) => run("ffmpeg", [...cmd.args, ...codec, ...TAIL, outFile], { cwd: DIRS.tmp, onStdout });

  try {
    if (await canUseGpu()) {
      try { await attempt(VIDEO_GPU); }
      catch (e) {
        console.warn("[export] NVENC falló, uso x264:", e.message.slice(-300));
        await attempt(VIDEO_CPU);
      }
    } else {
      await attempt(VIDEO_CPU);
    }
    const thumb = await makeThumb(outFile, `export-${exportId}.jpg`, Math.min(1, cmd.total / 2)).catch(() => null);
    update(exportId, { status: "done", progress: 1, file: outName, thumb, size: statSync(outFile).size, error: null });
  } catch (e) {
    console.error("[export]", e.message);
    update(exportId, { status: "error", error: e.message.slice(-800) });
  } finally {
    rmSync(join(DIRS.tmp, assName), { force: true });
    jobs.delete(exportId);
  }
}

export function createExport(projectId, name, project) {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO exports (id, project_id, name, status, created_at) VALUES (?, ?, ?, 'queued', ?)").run(id, projectId, name, now());
  startExport(id, project);
  return id;
}
