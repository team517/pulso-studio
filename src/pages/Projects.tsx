import { useCallback, useEffect, useState } from "react";
import { Clapperboard, Copy, Plus, Trash2 } from "lucide-react";
import { api, FORMATS, fmtTime, type Format, type Project } from "../api";
import { Field, Modal, navigate, useToast } from "../ui";

export function FormatPicker({ value, onChange }: { value: Format; onChange: (f: Format) => void }) {
  return (
    <div className="formats">
      {FORMATS.map((f) => {
        const s = 34 / Math.max(f.w, f.h);
        return (
          <button key={f.id} type="button" className={"format-opt" + (value === f.id ? " is-on" : "")} onClick={() => onChange(f.id)}>
            <span className="format-opt__shape" style={{ width: f.w * s, height: f.h * s }} />
            <b>{f.label}</b>
            <small>{f.hint}</small>
          </button>
        );
      })}
    </div>
  );
}

const duration = (p: Project) => p.data.clips.reduce((n, c) => n + (c.out - c.in), 0);
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  if (m < 1440) return `hace ${Math.round(m / 60)} h`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
};

export default function Projects() {
  const toast = useToast();
  const [list, setList] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<Format>("9:16");
  const [del, setDel] = useState<Project | null>(null);

  const load = useCallback(() => api.projects().then(setList).catch((e) => { setList([]); toast(e.message, "bad"); }), [toast]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    try {
      const p = await api.createProject(name.trim() || "Proyecto sin título", format);
      navigate(`/editor/${p.id}`);
    } catch (e) { toast((e as Error).message, "bad"); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Proyectos</h1>
          <p>Cada proyecto es un vídeo: sube tus clips, córtalos, añade textos, subtítulos y música, y expórtalo listo para publicar.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn btn--primary" onClick={() => setCreating(true)}><Plus size={16} /> Nuevo proyecto</button>
        </div>
      </div>

      {list === null ? <p className="muted">Cargando…</p> : (
        <div className="cards">
          <button className="new-card" onClick={() => setCreating(true)}>
            <span className="empty__icon" style={{ margin: 0 }}><Plus size={22} /></span>
            Nuevo proyecto
          </button>
          {list.map((p) => (
            <div key={p.id} className="pcard" role="button" tabIndex={0} onClick={() => navigate(`/editor/${p.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/editor/${p.id}`)}>
              <div className="pcard__thumb" style={p.thumbUrl ? { backgroundImage: `url(${p.thumbUrl})` } : undefined}>
                {!p.thumbUrl && <Clapperboard size={28} />}
                <span className="pcard__badge pill">{p.data.format}</span>
              </div>
              <div className="pcard__menu" onClick={(e) => e.stopPropagation()}>
                <button className="btn btn--icon btn--sm" title="Duplicar" onClick={async () => { await api.duplicateProject(p.id); load(); toast("Proyecto duplicado"); }}><Copy size={14} /></button>
                <button className="btn btn--icon btn--sm btn--danger" title="Borrar" onClick={() => setDel(p)}><Trash2 size={14} /></button>
              </div>
              <div className="pcard__body">
                <span className="pcard__name">{p.name}</span>
                <span className="pcard__meta">
                  <span>{p.data.clips.length} {p.data.clips.length === 1 ? "clip" : "clips"}</span>·
                  <span className="mono">{fmtTime(duration(p))}</span>·
                  <span>{ago(p.updated_at)}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <Modal title="Nuevo proyecto" onClose={() => setCreating(false)}
          foot={<><span className="spacer" /><button className="btn" onClick={() => setCreating(false)}>Cancelar</button><button className="btn btn--primary" onClick={create}>Crear y editar</button></>}>
          <Field label="Nombre">
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Reel lunes · consejos" onKeyDown={(e) => e.key === "Enter" && create()} />
          </Field>
          <Field label="Formato" hint="Lo puedes cambiar después dentro del editor.">
            <FormatPicker value={format} onChange={setFormat} />
          </Field>
        </Modal>
      )}

      {del && (
        <Modal title="Borrar proyecto" onClose={() => setDel(null)}
          foot={<><span className="spacer" /><button className="btn" onClick={() => setDel(null)}>Cancelar</button>
            <button className="btn btn--primary" style={{ background: "var(--bad)", borderColor: "var(--bad)" }} onClick={async () => { await api.deleteProject(del.id); setDel(null); load(); toast("Proyecto borrado"); }}>Borrar</button></>}>
          <p style={{ margin: 0 }}>Se borrará <b>{del.name}</b>. Los clips de la biblioteca y los vídeos ya exportados se quedan.</p>
        </Modal>
      )}
    </div>
  );
}
