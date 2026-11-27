import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, CalendarRange, Clapperboard, Film, FolderOpen, LayoutGrid, Lightbulb, Link2, Paintbrush, Sparkles } from "lucide-react";
import { navigate, usePath } from "./ui";
import { IN_PANEL, logout } from "./base";
import Projects from "./pages/Projects";
import Library from "./pages/Library";
import Videos from "./pages/Videos";
import Calendar from "./pages/Calendar";
import Connections from "./pages/Connections";
import AutoEdit from "./pages/AutoEdit";
import Results from "./pages/Results";
import Edited from "./pages/Edited";
import StylePage from "./pages/Style";
import ConnectPC, { approvePC, type PairRequest } from "./pages/ConnectPC";
import Editor from "./editor/Editor";
import Ideas from "./pages/Ideas";
import Plan from "./pages/Plan";
import ChangePassword from "./pages/ChangePassword";

const NAV = [
  { path: "/ideas", label: "Ideas de contenido", icon: Lightbulb, group: "Planificar" },
  { path: "/semana", label: "Mi semana", icon: CalendarRange, group: "Planificar" },
  { path: "/autoedicion", label: "Auto-edición", icon: Sparkles, group: "Crear" },
  { path: "/editados", label: "Editados", icon: LayoutGrid, group: "Crear" },
  { path: "/estilo", label: "Estilo de edición", icon: Paintbrush, group: "Crear" },
  { path: "/", label: "Editor manual", icon: Clapperboard, group: "Crear" },
  { path: "/biblioteca", label: "Biblioteca", icon: FolderOpen, group: "Crear" },
  { path: "/videos", label: "Vídeos exportados", icon: Film, group: "Crear" },
  { path: "/calendario", label: "Calendario", icon: CalendarDays, group: "Publicar" },
  { path: "/resultados", label: "Resultados", icon: BarChart3, group: "Publicar" },
  { path: "/conexiones", label: "Conexiones", icon: Link2, group: "Publicar" },
];

export default function App() {
  const [path] = usePath();
  const [online, setOnline] = useState(true);
  const [pc, setPc] = useState<{ online: boolean; claude: boolean; busy: string | null; name?: string | null } | null>(null);
  const [pending, setPending] = useState<PairRequest[]>([]);
  const [approving, setApproving] = useState(false);
  const [pcJustConnected, setPcJustConnected] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const pathname = path.split("?")[0];

  // Conexión automática: si en este ordenador está abierto el editor y no está conectado, se le da la clave
  useEffect(() => {
    if (!IN_PANEL) return;
    let busy = false;
    const local = (path: string, init?: RequestInit) =>
      fetch(`http://127.0.0.1:47321${path}`, { ...init, signal: AbortSignal.timeout(4000), targetAddressSpace: "loopback" } as RequestInit);
    const tryConnect = async () => {
      if (busy) return;
      busy = true;
      try {
        const st = await local("/status").then((r) => r.json()).catch(() => null);
        if (!st || st.connected) return;
        const pair = await fetch("/api/pc/pair", { method: "POST" }).then((r) => (r.ok ? r.json() : null));
        if (!pair?.token) return;
        const r = await local("/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: pair.token }) });
        if (r.ok) {
          setPcJustConnected(st.name || "Tu PC");
          setTimeout(() => window.dispatchEvent(new Event("ps:pc")), 2500);
        }
      } finally { busy = false; }
    };
    tryConnect();
    const t = setInterval(tryConnect, 20000);
    return () => clearInterval(t);
  }, []);

  // ¿Está el servidor local encendido?
  useEffect(() => {
    const check = () => {
      fetch("/api/platforms").then((r) => setOnline(r.ok)).catch(() => setOnline(false));
      // En el panel: ¿está tu PC encendido para editar?
      if (IN_PANEL) {
        fetch("/api/autoedit/info").then((r) => r.json()).then((i) => { setPc(i.worker ?? { online: false, claude: false, busy: null }); }).catch(() => {});
        fetch("/api/pc/pending").then((r) => (r.ok ? r.json() : [])).then(setPending).catch(() => {});
      }
    };
    check();
    const t = setInterval(check, 10000);
    window.addEventListener("ps:pc", check);
    return () => { clearInterval(t); window.removeEventListener("ps:pc", check); };
  }, []);

  const editorId = pathname.match(/^\/editor\/([\w-]+)/)?.[1];
  if (editorId) return <Editor key={editorId} id={editorId} />;

  let page = <Projects />;
  if (pathname === "/biblioteca") page = <Library />;
  else if (pathname === "/videos") page = <Videos />;
  else if (pathname === "/calendario") page = <Calendar />;
  else if (pathname === "/conexiones") page = <Connections />;
  else if (pathname === "/autoedicion") page = <AutoEdit />;
  else if (pathname === "/resultados") page = <Results />;
  else if (pathname === "/editados") page = <Edited />;
  else if (pathname === "/estilo") page = <StylePage />;
  else if (pathname === "/conectar-pc") page = <ConnectPC />;
  else if (pathname === "/ideas") page = <Ideas />;
  else if (pathname === "/semana") page = <Plan />;

  let lastGroup = "";
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="brand__logo"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M8 5.5v13l11-6.5z" fill="#fff" /></svg></span>
          <span>
            <div className="brand__name">Pulso Studio</div>
            <div className="brand__sub">Edita y programa vídeos</div>
          </span>
        </div>
        {NAV.map((n) => {
          const head = n.group !== lastGroup ? <div className="nav-label">{n.group}</div> : null;
          lastGroup = n.group;
          const Icon = n.icon;
          const active = n.path === "/" ? pathname === "/" : pathname.startsWith(n.path);
          return (
            <div key={n.path}>
              {head}
              <button className={"nav-item" + (active ? " is-active" : "")} onClick={() => navigate(n.path)}>
                <Icon size={18} /> {n.label}
              </button>
            </div>
          );
        })}
        <div className="side__foot">
          {IN_PANEL ? (
            <>
              <span className="side__acts">
                <button className="btn btn--ghost btn--sm" onClick={() => setPwOpen(true)}>Cambiar contraseña</button>
                <button className="btn btn--ghost btn--sm" onClick={logout}>Salir</button>
              </span>
              <span className={"dot" + (pc === null ? " is-wait" : pc.online ? "" : " is-off")} />
              {!online ? "Sin conexión con el servidor" : pc === null ? "Comprobando tu PC…" : pc.online ? (pc.busy ? `Tu PC: ${pc.busy}` : `${pc.name || "Tu PC"} está listo para editar`) : "Tu PC está apagado: los vídeos esperan en cola"}
            </>
          ) : (
            <>
              <span className={"dot" + (online ? "" : " is-off")} />
              {online ? "Servidor local activo" : "Servidor apagado: ejecuta npm run dev"}
            </>
          )}
        </div>
      </aside>
      <main className="main">
        {pcJustConnected && <div className="note note--ok" style={{ margin: "16px 24px 0" }} onClick={() => setPcJustConnected(null)}><b>{pcJustConnected} se ha conectado solo.</b> Ya edita para ti y guarda una copia de todo (también de tu cuenta).</div>}
        {IN_PANEL && !pcJustConnected && pending.length > 0 && pathname !== "/conectar-pc" && (
          <div className="note note--warn pc-ask" style={{ margin: "16px 24px 0" }}>
            <span><b>{pending[0].name}</b> quiere conectarse para editar (código <span className="mono">{pending[0].code}</span>).</span>
            <button className="btn btn--primary btn--sm" disabled={approving} onClick={async () => {
              setApproving(true);
              try { await approvePC(pending[0].code); setPending((p) => p.slice(1)); } catch { /* caducado */ }
              setApproving(false);
            }}>Conectar este PC</button>
          </div>
        )}
        {page}
      </main>
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </div>
  );
}
