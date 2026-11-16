// Prueba de gráficos copiados (plantillas): monta el proyecto con 2 plantillas y saca fotos en sus momentos.
//   node server/autoedit/render/test/custom-gfx.js <result.json del análisis>
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { layoutGeometry, applyStyleGeometry } from "../layouts.js";
import { resolveStyle, setStyle } from "../style.js";
import { planGraphics, buildFinalProject } from "../project.js";
import { fixture } from "./fixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const res = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const tpls = res.graphics.map(({ sample, render, video, ...t }) => t);
const work = path.join(HERE, "out", "pv-custom");
const input = fixture("reference", work, { matte: false, style: true });
input.style = { ...input.style, templates: tpls };
const pick = (k) => tpls.find((t) => t.kind === k) || tpls[0];
const a = pick("pill"), b = tpls.find((t) => t.fields.length >= 3) || tpls[1] || tpls[0];
input.graphics = [
  { type: "custom", tpl: a.id, start: 1.0, end: 3.6, fields: Object.fromEntries(a.fields.map((f) => [f.key, "Sin anuncios"])), icon: "mail", layouts: ["reference"] },
  { type: "custom", tpl: b.id, start: 4.2, end: 7.0, fields: Object.fromEntries(b.fields.map((f, i) => [f.key, ["Cold calls", "Publicidad", "Email"][i] || f.example])), icon: "rocket", layouts: ["reference"] },
];
const { style, theme } = resolveStyle(input);
setStyle(style);
let geo = layoutGeometry("reference", input.width, input.height, style.motion.zoomMax ?? undefined);
if (style.user) geo = applyStyleGeometry(geo, style.caption.position, null, { yPct: style.caption.yPct, letterbox: style.fx.letterbox });
const plan = planGraphics(input, geo, false);
const dir = path.join(work, "hf");
fs.rmSync(dir, { recursive: true, force: true });
buildFinalProject({ ...input, theme }, geo, plan, input.base.video, dir, false);
setStyle(null);
const shots = path.join(work, "shots");
fs.rmSync(shots, { recursive: true, force: true });
const hf = path.resolve(HERE, "../../../../node_modules/hyperframes/bin/hyperframes.mjs");
const r = spawnSync(process.execPath, [hf, "snapshot", ".", "--at", "1.15,2.5,4.4,6", "--no-end", "--keep", "-o", shots], { cwd: dir, encoding: "utf8", env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" } });
if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(1); }
const out = path.join(HERE, "out", "preview-custom.jpg");
spawnSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(shots, "at-1.15s.png"), "-i", path.join(shots, "at-2.5s.png"), "-i", path.join(shots, "at-4.4s.png"), "-i", path.join(shots, "at-6s.png"), "-filter_complex", "[0]scale=300:-2[a];[1]scale=300:-2[b];[2]scale=300:-2[c];[3]scale=300:-2[d];[a][b][c][d]hstack=4", out]);
console.log(out);
