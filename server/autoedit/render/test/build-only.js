// Solo genera el proyecto final (sin render) para revisarlo con «hyperframes check/snapshot».
import path from "node:path";
import { fileURLToPath } from "node:url";
import { layoutGeometry } from "../layouts.js";
import { planGraphics, buildFinalProject, buildBehindProject } from "../project.js";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const layout = process.argv[2] || "reference";
const mod = await import("./fixture.js");
const input = mod.fixture(layout, path.join(HERE, "out", "dbg-" + layout));
const geo = layoutGeometry(layout, input.width, input.height);
const plan = planGraphics(input, geo, true);
buildBehindProject(input, plan.behind, path.join(input.workDir, "hf-behind"));
const r = buildFinalProject(input, geo, plan, input.base.video, path.join(input.workDir, "hf"), true);
console.log(JSON.stringify(r.sfx));
