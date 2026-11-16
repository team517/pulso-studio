// Aviso de vida del PC, en un hilo aparte: aunque el editor esté ocupado renderizando (ffmpeg bloquea
// el hilo principal), el panel sigue sabiendo que tu PC está encendido.
import { parentPort, workerData } from "node:worker_threads";

let { server, token, name } = workerData;
let state = { busy: null, claude: undefined };

parentPort.on("message", (m) => {
  if (m.token) token = m.token;
  if ("busy" in m) state.busy = m.busy;
  if ("claude" in m) state.claude = m.claude;
  if (m.now) beat();
});

async function beat() {
  if (!token) return;
  try {
    const body = { beat: true, name, busy: state.busy, version: 2, ...(state.claude === undefined ? {} : { claude: state.claude }) };
    const r = await fetch(`${server}/api/worker/hello`, {
      method: "POST", headers: { "x-worker-token": token, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20e3),
    });
    parentPort.postMessage({ status: r.status });
  } catch (e) { parentPort.postMessage({ status: 0, error: String(e.message || e) }); }
}

beat();
setInterval(beat, 25e3);
