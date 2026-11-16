// Vista previa rápida sin render completo: genera el proyecto y captura los momentos clave con «hyperframes snapshot».
//   node server/autoedit/render/test/preview.js <layout> [--base ruta.mp4]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { layoutGeometry, applyStyleGeometry } from "../layouts.js";
import { resolveStyle, setStyle } from "../style.js";
import { makeLogo } from "./make-plate.js";
import { planGraphics, buildFinalProject } from "../project.js";
import { fixture } from "./fixture.js";
import { SHOTS } from "./shots.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const layout = process.argv[2] || "reference";
const bi = process.argv.indexOf("--base");
const noMatte = process.argv.includes("--no-matte"), withStyle = process.argv.includes("--style");
if (withStyle) makeLogo(path.join(HERE, "out", "plate", "logo.png"));
const tag = layout + (noMatte ? "-nomatte" : "") + (withStyle ? "-style" : "");
const work = path.join(HERE, "out", "pv-" + tag);
const input = fixture(layout, work, { matte: !noMatte, style: withStyle });
const composed = path.join(HERE, "out", withStyle ? layout + "-style" : layout, "base-composed.mp4");
const base = noMatte ? input.base.video : bi > 0 ? process.argv[bi + 1] : fs.existsSync(composed) ? composed : input.base.video;
// igual que renderVariant: el estilo se activa solo mientras se genera el HTML
const { style, theme } = resolveStyle(input);
setStyle(style);
let geo = layoutGeometry(layout, input.width, input.height, style.motion.zoomMax ?? undefined);
if (style.user) geo = applyStyleGeometry(geo, style.caption.position, style.logo ? { ...style.logo, aspect: 1 / 3 } : null,
  { yPct: style.caption.yPct, letterbox: style.fx.letterbox });
const plan = planGraphics(input, geo, !noMatte);
const dir = path.join(work, "hf");
fs.rmSync(dir, { recursive: true, force: true });
buildFinalProject({ ...input, theme }, geo, plan, base, dir, !noMatte);
setStyle(null);
const shots = path.join(work, "shots");
fs.rmSync(shots, { recursive: true, force: true });
const hf = path.resolve(HERE, "../../../../node_modules/hyperframes/bin/hyperframes.mjs");
const r = spawnSync(process.execPath, [hf, "snapshot", ".", "--at", SHOTS.map((s) => s[0]).join(","), "--no-end", "--keep", "-o", shots], { cwd: dir, encoding: "utf8", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" } });
if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
const W = input.width, H = input.height, tw = W > H ? 480 : 300;
const fdir = path.join(work, "frames");
fs.rmSync(fdir, { recursive: true, force: true });
fs.mkdirSync(fdir, { recursive: true });
SHOTS.forEach(([t, label], i) => {
  const png = path.join(shots, `at-${t}s.png`);
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", png, "-vf", `scale=${tw}:-2,drawbox=x=0:y=0:w=iw:h=26:color=black@0.6:t=fill,drawtext=text='${t}s ${label}':x=6:y=5:fontsize=16:fontcolor=white`, path.join(fdir, `f${String(i).padStart(2, "0")}.png`)]);
});
const cols = W > H ? 3 : 6;
const sheet = path.join(HERE, "out", `preview-${tag}.jpg`);
spawnSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(fdir, "f%02d.png"), "-vf", `tile=${cols}x${Math.ceil(SHOTS.length / cols)}:padding=4:color=0x222222`, "-frames:v", "1", "-q:v", "3", sheet]);
console.log(sheet);
