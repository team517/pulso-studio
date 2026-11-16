// Crea una toma de prueba 1080×1920 30 fps (fondo de estudio + silueta de cabeza, hombros y micro) y su mate.
// Uso: node make-plate.js <carpeta> [segundos]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function makePlate(dir, dur = 20) {
  fs.mkdirSync(dir, { recursive: true });
  const plate = path.join(dir, "plate.mp4"), matte = path.join(dir, "matte.mp4");
  if (fs.existsSync(plate) && fs.existsSync(matte)) return { plate, matte };
  const W = 1080, H = 1920;
  // Formas (coordenadas a 1080×1920): cabeza, pelo, cuello, hombros
  const head = "lte(pow((X-540)/205,2)+pow((Y-640)/262,2),1)";
  const hair = "lte(pow((X-540)/228,2)+pow((Y-520)/175,2),1)*lt(Y,585)";
  const neck = "lt(abs(X-540),92)*gt(Y,840)*lt(Y,1000)";
  const body = "lte(pow((X-540)/560,2)+pow((Y-1560)/640,2),1)*gt(Y,930)";
  const glasses = "(lte(hypot(X-462,Y-625),58)+lte(hypot(X-618,Y-625),58))*gt(hypot(X-462,Y-625)*hypot(X-618,Y-625),0)";
  const lens = "(lte(hypot(X-462,Y-625),48)+lte(hypot(X-618,Y-625),48))";
  const mouth = "lte(pow((X-540)/60,2)+pow((Y-790)/16,2),1)";
  const mic = "(lte(abs(X-540),78)*gt(Y,1290)*lt(Y,1640)+lte(abs(X-540),26)*gt(Y,1640))";
  // Color por canal: fondo cálido degradado, piel, pelo oscuro, polo negro, micro gris
  const ch = (bg, skin, hairC, bodyC, micC, glassC, mouthC) =>
    `if(${mic},${micC},if(${hair},${hairC},if(${lens},${skin}-14,if(${glasses},${glassC},if(${mouth},${mouthC},if(${head}+${neck},${skin}-(Y-500)*0.04,if(${body},${bodyC},${bg})))))))`;
  const r = ch("196-Y*0.05+X*0.012", "214", "44", "22", "58", "40", "150");
  const g = ch("180-Y*0.05+X*0.01", "168", "30", "22", "60", "32", "90");
  const b = ch("152-Y*0.045", "140", "24", "26", "66", "30", "90");
  const png = path.join(dir, "plate.png"), mpng = path.join(dir, "matte.png");
  run(["-f", "lavfi", "-i", `color=c=black:s=${W}x${H},format=gbrp`, "-frames:v", "1",
    "-vf", `geq=r='${r}':g='${g}':b='${b}'`, png]);
  const m = `255*min(1,${head}+${hair}+${neck}+${body})`;
  run(["-f", "lavfi", "-i", `color=c=black:s=${W}x${H},format=gray`, "-frames:v", "1", "-vf", `geq=lum='${m}'`, mpng]);
  // Movimiento leve (para notar el zoom) + reloj visible en la esquina inferior izquierda
  run(["-loop", "1", "-framerate", "30", "-i", png, "-f", "lavfi", "-i", `sine=f=220:d=${dur}`, "-t", String(dur),
    "-vf", "noise=alls=6:allf=t,drawtext=text='%{pts\\:hms}':x=40:y=1840:fontsize=36:fontcolor=white@0.6,format=yuv420p",
    "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-c:a", "aac", "-shortest", plate]);
  run(["-loop", "1", "-framerate", "30", "-i", mpng, "-t", String(dur), "-vf", "format=yuv420p",
    "-c:v", "libx264", "-preset", "fast", "-crf", "12", matte]);
  return { plate, matte };
}

// Logo de prueba: píldora naranja con texto blanco y fondo transparente (PNG con alfa)
export function makeLogo(file) {
  if (fs.existsSync(file)) return file;
  run(["-f", "lavfi", "-i", "color=c=0xFF5A36:s=420x140,format=rgba", "-frames:v", "1", "-vf",
    "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(max(0,abs(X-210)-140)/70,2)+pow((Y-70)/70,2),1),255,0)',drawtext=text='PULSO':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",
    file]);
  return file;
}

function run(args) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("ffmpeg: " + r.stderr);
}

if (process.argv[1] && process.argv[1].endsWith("make-plate.js")) {
  console.log(makePlate(process.argv[2] || "out/plate", Number(process.argv[3] || 20)));
}
