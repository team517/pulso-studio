import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, Clapperboard, Film, FolderOpen, LayoutGrid, Link2, Paintbrush, Sparkles } from "lucide-react";
import { navigate, usePath } from "./ui";
import { IN_PANEL } from "./base";
import Projects from "./pages/Projects";
import Library from "./pages/Library";
import Videos from "./pages/Videos";
import Calendar from "./pages/Calendar";
import Connections from "./pages/Connections";
import AutoEdit from "./pages/AutoEdit";
import Results from "./pages/Results";
import Edited from "./pages/Edited";
import StylePage from "./pages/Style";
import Editor from "./editor/Editor";

const NAV = [
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
  const [pc, setPc] = useState<{ online: boolean; claude: boolean; busy: string | null } | null>(null);
  const pathname = path.split("?")[0];

  // ¿Está el servidor local encendido?
  useEffect(() => {
    const check = () => {
      fetch("/api/platforms").then((r) => setOnline(r.ok)).catch(() => setOnline(false));
      // En el panel: ¿está tu PC encendido para editar?
      if (IN_PANEL) fetch("/api/autoedit/info").then((r) => r.json()).then((i) => setPc(i.worker ?? null)).catch(() => {});
    };
    check();
    const t = setInterval(check, 15000);
    return () => clearInterval(t);
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
              <span className={"dot" + (pc?.online ? "" : " is-off")} />
              {!online ? "Sin conexión con el servidor" : pc?.online ? (pc.busy ? `Tu PC: ${pc.busy}` : "Tu PC está listo para editar") : "Tu PC está apagado: los vídeos esperan en cola"}
            </>
          ) : (
            <>
              <span className={"dot" + (online ? "" : " is-off")} />
              {online ? "Servidor local activo" : "Servidor apagado: ejecuta npm run dev"}
            </>
          )}
        </div>
      </aside>
      <main className="main">{page}</main>
    </div>
  );
}
