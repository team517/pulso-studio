// Prueba de logo de marca e imagen de la Biblioteca dentro del render real.
//   node server/autoedit/render/test/assets.js <imagen.jpg>
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { layoutGeometry } from "../layouts.js";
import { resolveStyle, setStyle } from "../style.js";
import { planGraphics, buildFinalProject } from "../project.js";
import { fixture } from "./fixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const work = path.join(HERE, "out", "pv-assets");
const input = fixture("reference", work, { matte: false, style: false });
input.graphics = [
  { type: "logo", brand: "Instagram", label: "Instagram", start: 1.0, end: 3.5 },
  { type: "image", file: process.argv[2], aspect: 1.6, caption: "Tu panel de resultados", start: 4.0, end: 7.0 },
];
const { style, theme } = resolveStyle(input);
setStyle(style);
const geo = layoutGeometry("reference", input.width, input.height);
const plan = planGraphics(input, geo, false);
const dir = path.join(work, "hf");
fs.rmSync(dir, { recursive: true, force: true });
buildFinalProject({ ...input, theme }, geo, plan, input.base.video, dir, false);
setStyle(null);
const shots = path.join(work, "shots");
fs.rmSync(shots, { recursive: true, force: true });
const hf = path.resolve(HERE, "../../../../node_modules/hyperframes/bin/hyperframes.mjs");
const r = spawnSync(process.execPath, [hf, "snapshot", ".", "--at", "1.3,2.6,4.4,5.8", "--no-end", "--keep", "-o", shots], { cwd: dir, encoding: "utf8", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" } });
if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
const outs = ["1.3", "2.6", "4.4", "5.8"].map((t) => path.join(shots, `at-${t}s.png`));
const sheet = path.join(HERE, "out", "preview-assets.jpg");
spawnSync("ffmpeg", ["-v", "error", "-y", ...outs.flatMap((o) => ["-i", o]), "-filter_complex", outs.map((_, i) => `[${i}]scale=-2:480[v${i}]`).join(";") + ";" + outs.map((_, i) => `[v${i}]`).join("") + `hstack=${outs.length}`, sheet]);
console.log(sheet);
