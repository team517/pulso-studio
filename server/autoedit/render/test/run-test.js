// Prueba del motor: crea una toma de 20 s con mate, renderiza los 5 formatos y saca hojas de contactos.
//   node server/autoedit/render/test/run-test.js [reference headline minimal horizontal framed] [--sheets-only] [--no-matte]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderVariant } from "../index.js";
import { makePlate } from "./make-plate.js";
import { fixture, SIZES, DUR } from "./fixture.js";
import { SHOTS } from "./shots.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "out");


function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(cmd + " " + r.stderr);
  return r.stdout;
}

function contactSheet(video, layout, W, H) {
  const dir = path.join(OUT, layout, "frames");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tw = W > H ? 480 : 300;
  SHOTS.forEach(([t, label], i) => {
    sh("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf",
      `scale=${tw}:-2,drawbox=x=0:y=0:w=iw:h=26:color=black@0.6:t=fill,drawtext=text='${t}s ${label}':x=6:y=5:fontsize=16:fontcolor=white`,
      path.join(dir, `f${String(i).padStart(2, "0")}.png`)]);
  });
  const cols = W > H ? 3 : 6;
  const sheet = path.join(OUT, `sheet-${layout}.jpg`);
  sh("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(dir, "f%02d.png"), "-vf", `tile=${cols}x${Math.ceil(SHOTS.length / cols)}:padding=4:color=0x222222`, "-frames:v", "1", "-q:v", "3", sheet]);
  return sheet;
}

async function main() {
  const args = process.argv.slice(2);
  const sheetsOnly = args.includes("--sheets-only"), noMatte = args.includes("--no-matte");
  const layouts = args.filter((a) => !a.startsWith("--"));
  const list = layouts.length ? layouts : Object.keys(SIZES);
  const { plate, matte } = makePlate(path.join(OUT, "plate"), DUR);
  const results = [];
  for (const layout of list) {
    const [W, H, captionStyle] = SIZES[layout];
    const tag = layout + (noMatte ? "-nomatte" : "");
    const workDir = path.join(OUT, tag);
    const video = path.join(workDir, "video.mp4");
    let secs = null, sfx = null, timings = null;
    if (!sheetsOnly) {
      const input = fixture(layout, workDir, { matte: !noMatte });
      const t = Date.now();
      let last = -1;
      const res = await renderVariant(input, (f, label) => {
        const p = Math.floor(f * 10);
        if (p !== last) { last = p; process.stdout.write(`  [${layout}] ${Math.round(f * 100)}% ${label}\n`); }
      });
      secs = (Date.now() - t) / 1000;
      sfx = res.sfx; timings = res.timings;
      fs.writeFileSync(path.join(workDir, "sfx.json"), JSON.stringify(res.sfx, null, 1));
    }
    const pr = JSON.parse(sh("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,r_frame_rate,pix_fmt,nb_frames", "-of", "json", video])).streams[0];
    const sheet = contactSheet(video, tag, W, H);
    results.push({ layout: tag, secs, timings, sfx: sfx ? sfx.length : null, probe: `${pr.codec_name} ${pr.width}x${pr.height} ${pr.r_frame_rate} ${pr.pix_fmt} ${pr.nb_frames} fr`, sheet });
    console.log(results[results.length - 1]);
  }
  fs.writeFileSync(path.join(OUT, noMatte ? "results-nomatte.json" : "results.json"), JSON.stringify(results, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
