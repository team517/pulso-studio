// Prueba de una animación diseñada (motion) dentro del render real: fotos en 3 momentos, 9:16 y 16:9.
//   node server/autoedit/render/test/motion.js <design.json>
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { layoutGeometry } from "../layouts.js";
import { resolveStyle, setStyle } from "../style.js";
import { planGraphics, buildFinalProject } from "../project.js";
import { fixture } from "./fixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const design = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const outs = [];
for (const layout of ["reference", "horizontal"]) {
  const work = path.join(HERE, "out", "pv-motion-" + layout);
  const input = fixture(layout, work, { matte: false, style: false });
  input.graphics = [{ type: "motion", start: 1.0, end: 5.8, design }];
  const { style, theme } = resolveStyle(input);
  setStyle(style);
  const geo = layoutGeometry(layout, input.width, input.height);
  const plan = planGraphics(input, geo, false);
  const dir = path.join(work, "hf");
  fs.rmSync(dir, { recursive: true, force: true });
  buildFinalProject({ ...input, theme }, geo, plan, input.base.video, dir, false);
  setStyle(null);
  const shots = path.join(work, "shots");
  fs.rmSync(shots, { recursive: true, force: true });
  const hf = path.resolve(HERE, "../../../../node_modules/hyperframes/bin/hyperframes.mjs");
  const r = spawnSync(process.execPath, [hf, "snapshot", ".", "--at", "1.1,1.9,3.4,5.5", "--no-end", "--keep", "-o", shots], { cwd: dir, encoding: "utf8", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" } });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
  for (const t of ["1.1", "1.9", "3.4", "5.5"]) outs.push(path.join(shots, `at-${t}s.png`));
}
const sheet = path.join(HERE, "out", "preview-motion.jpg");
const f = outs.map((o, i) => `[${i}]scale=-2:360[v${i}]`).join(";") + ";" + outs.map((_, i) => `[v${i}]`).join("") + `hstack=${outs.length}`;
spawnSync("ffmpeg", ["-v", "error", "-y", ...outs.flatMap((o) => ["-i", o]), "-filter_complex", f, sheet]);
console.log(sheet);
