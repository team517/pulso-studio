// Secciones con pestañas para que el menú sea corto:
//  · Calendario: el plan de contenido (qué grabar y publicar cada día) y las publicaciones programadas.
//  · Auto-edición: editar un vídeo, los editados y tus referentes de estilo.
import type { ReactNode } from "react";
import { CalendarDays, CalendarRange, LayoutGrid, Paintbrush, Sparkles } from "lucide-react";
import { navigate, usePath } from "../ui";
import Calendar from "./Calendar";
import Plan from "./Plan";
import AutoEdit from "./AutoEdit";
import Edited from "./Edited";
import StylePage from "./Style";

type Tab = { id: string; label: string; icon: ReactNode; to: string };

function Tabs({ tabs, current }: { tabs: Tab[]; current: string }) {
  return (
    <div className="hub">
      <div className="seg hub__tabs">
        {tabs.map((t) => (
          <button key={t.id} className={current === t.id ? "is-on" : ""} onClick={() => navigate(t.to)}>{t.icon} {t.label}</button>
        ))}
      </div>
    </div>
  );
}

/** /calendario → plan de contenido · /calendario?vista=publicaciones (o ?nuevo=…) → publicaciones programadas */
export function CalendarHub() {
  const [path] = usePath();
  const q = new URLSearchParams(path.split("?")[1] ?? "");
  const pubs = q.get("vista") === "publicaciones" || q.has("nuevo");
  return (
    <>
      <Tabs current={pubs ? "pubs" : "plan"} tabs={[
        { id: "plan", label: "Plan de contenido", icon: <CalendarRange size={15} />, to: "/calendario" },
        { id: "pubs", label: "Publicaciones programadas", icon: <CalendarDays size={15} />, to: "/calendario?vista=publicaciones" },
      ]} />
      {pubs ? <Calendar /> : <Plan />}
    </>
  );
}

/** /autoedicion → editar · /editados → editados · /estilo → referentes y estilo */
export function AutoEditHub() {
  const [path] = usePath();
  const p = path.split("?")[0];
  const cur = p === "/editados" ? "done" : p === "/estilo" ? "style" : "edit";
  return (
    <>
      <Tabs current={cur} tabs={[
        { id: "edit", label: "Editar un vídeo", icon: <Sparkles size={15} />, to: "/autoedicion" },
        { id: "done", label: "Editados", icon: <LayoutGrid size={15} />, to: "/editados" },
        { id: "style", label: "Referentes y estilo", icon: <Paintbrush size={15} />, to: "/estilo" },
      ]} />
      {cur === "done" ? <Edited /> : cur === "style" ? <StylePage /> : <AutoEdit />}
    </>
  );
}
