// Ideas de contenido: las ideas con su guion, los creadores que te inspiran (sus posts de Instagram)
// y lo que Claude tiene que saber de ti para escribir como tú.
import { useEffect, useMemo, useState } from "react";
import {
  AtSign, BarChart3, Eye, ExternalLink, Film, Heart, Image as ImageIcon, Instagram, Lightbulb, Loader2, MessageCircle,
  Monitor, Plus, RefreshCw, Search, Sparkles, Star, Trash2, User, Video, Wand2,
} from "lucide-react";
import {
  ideasApi, useIdeas, fmtNum, hookOf, ANGLE_LABEL, PILLAR_LABEL, STATUS_LABEL,
  type Creator, type Idea, type IdeaFormat, type IdeasState, type IgPost, type Profile,
} from "../ideas-api";
import IdeaDetail, { FormatBadge, JobsBar } from "./IdeaDetail";
import { Field, Modal, navigate, useToast } from "../ui";
import { IN_PANEL } from "../base";
import "./ideas.css";

type Tab = "ideas" | "inspiracion" | "perfil";

export default function Ideas() {
  const { state, error, reload, setState } = useIdeas();
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get("tab") as Tab) || "ideas");
  const [generating, setGenerating] = useState<{ post?: { creatorId: string; postId: string; label: string } } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = state?.ideas.find((i) => i.id === openId) ?? null;

  if (!state) return <div className="page"><p className="muted">{error ? error : "Cargando…"}</p></div>;
  const live = state.ideas.filter((i) => i.status !== "descartada").length;

  return (
    <div className="page id-page">
      <div className="page-head">
        <div>
          <h1>Ideas de contenido</h1>
          <p>Claude piensa ideas y te escribe el guion listo para grabar: qué dices, qué se ve y cómo grabarlo. Se basa en tu negocio y en lo que mejor les funciona a los creadores que te inspiran.</p>
        </div>
        <div className="page-head__actions">
          <button className="btn" onClick={() => navigate("/semana")}>Mi semana</button>
          <button className="btn btn--primary" onClick={() => setGenerating({})}><Sparkles size={16} /> Generar ideas</button>
        </div>
      </div>

      <JobsBar jobs={state.jobs} onChange={reload} pcHint={IN_PANEL} />

      <div className="seg id-tabs">
        <button className={tab === "ideas" ? "is-on" : ""} onClick={() => setTab("ideas")}><Lightbulb size={15} /> Ideas <span className="id-n">{live}</span></button>
        <button className={tab === "inspiracion" ? "is-on" : ""} onClick={() => setTab("inspiracion")}><Instagram size={15} /> Inspiración <span className="id-n">{state.creators.length}</span></button>
        <button className={tab === "perfil" ? "is-on" : ""} onClick={() => setTab("perfil")}><User size={15} /> Sobre ti</button>
      </div>

      {tab === "ideas" && <IdeasTab state={state} onOpen={setOpenId} onGenerate={() => setGenerating({})} onChanged={reload} />}
      {tab === "inspiracion" && <Inspiration state={state} reload={reload} onIdeasFromPost={(post) => setGenerating({ post })} />}
      {tab === "perfil" && <ProfileTab profile={state.profile} onSaved={(p) => setState({ ...state, profile: p })} />}

      {generating && <GenerateModal state={state} post={generating.post} onClose={() => setGenerating(null)} onQueued={() => { setGenerating(null); setTab("ideas"); reload(); }} />}
      {open && <IdeaDetail idea={open} jobs={state.jobs} onClose={() => setOpenId(null)} onChanged={() => reload()} />}
    </div>
  );
}

/* ---------- Ideas ---------- */

const FILTERS = [
  { id: "todas", label: "Por usar", test: (i: Idea) => i.status === "idea" },
  { id: "plan", label: "En el plan", test: (i: Idea) => ["plan", "grabada", "editada"].includes(i.status) },
  { id: "publicadas", label: "Publicadas", test: (i: Idea) => i.status === "publicada" },
  { id: "fav", label: "Favoritas", test: (i: Idea) => i.favorite && i.status !== "descartada" },
  { id: "descartadas", label: "Descartadas", test: (i: Idea) => i.status === "descartada" },
] as const;

function IdeasTab({ state, onOpen, onGenerate, onChanged }: { state: IdeasState; onOpen: (id: string) => void; onGenerate: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("todas");
  const [fmt, setFmt] = useState<IdeaFormat | "all">("all");
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter)!;
    const s = q.trim().toLowerCase();
    return state.ideas.filter((i) => f.test(i) && (fmt === "all" || i.format === fmt) && (!s || `${i.title} ${i.hook}`.toLowerCase().includes(s)))
      .sort((a, b) => (filter === "plan" ? String(a.date).localeCompare(String(b.date)) : Number(b.favorite) - Number(a.favorite) || b.created_at.localeCompare(a.created_at)));
  }, [state.ideas, filter, fmt, q]);

  if (!state.ideas.length) {
    return (
      <div className="empty id-empty">
        <div className="empty__icon"><Lightbulb size={26} /></div>
        <h3>Todavía no tienes ideas</h3>
        <p className="muted">Añade en «Inspiración» los creadores que te gustan (opcional) y pulsa «Generar ideas». Claude te da cada idea con su guion completo.</p>
        <button className="btn btn--primary" onClick={onGenerate}><Sparkles size={16} /> Generar ideas</button>
      </div>
    );
  }
  return (
    <>
      <div className="id-filters">
        <div className="seg seg--sm">
          {FILTERS.map((f) => <button key={f.id} className={filter === f.id ? "is-on" : ""} onClick={() => setFilter(f.id)}>{f.label} <span className="id-n">{state.ideas.filter(f.test).length}</span></button>)}
        </div>
        <div className="seg seg--sm">
          <button className={fmt === "all" ? "is-on" : ""} onClick={() => setFmt("all")}>Todas</button>
          <button className={fmt === "camara" ? "is-on" : ""} onClick={() => setFmt("camara")}><Video size={13} /> Cámara</button>
          <button className={fmt === "pantalla" ? "is-on" : ""} onClick={() => setFmt("pantalla")}><Monitor size={13} /> Pantalla</button>
        </div>
        <label className="id-search"><Search size={14} /><input className="input input--sm" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      {!list.length ? <p className="muted id-none">No hay ideas con este filtro.</p> : (
        <div className="id-grid">
          {list.map((i) => (
            <article key={i.id} className={"id-card" + (i.status === "descartada" ? " is-off" : "")} onClick={() => onOpen(i.id)}>
              <div className="id-card__top">
                <FormatBadge format={i.format} small />
                {i.status !== "idea" && <span className={"id-st id-st--" + i.status}>{STATUS_LABEL[i.status]}</span>}
                <span className="spacer" />
                <button className={"btn btn--ghost btn--icon btn--sm id-star" + (i.favorite ? " is-on" : "")} title="Favorita"
                  onClick={(e) => { e.stopPropagation(); ideasApi.update(i.id, { favorite: !i.favorite }).then(onChanged).catch((er) => toast(er.message, "bad")); }}><Star size={15} /></button>
              </div>
              <h3>{i.title}</h3>
              <p className="id-card__hook">«{hookOf(i)}»</p>
              <div className="id-card__meta">
                {i.pillar && <span>{PILLAR_LABEL[i.pillar] || i.pillar}</span>}
                {i.angle && <span>{ANGLE_LABEL[i.angle] || i.angle}</span>}
                {i.duration ? <span>~{i.duration} s</span> : null}
                {i.date && <span className="id-card__date">{new Date(i.date + "T12:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</span>}
                {i.needsScript && <span className="id-card__warn">sin guion</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- Generar ---------- */

function GenerateModal({ state, post, onClose, onQueued }: { state: IdeasState; post?: { creatorId: string; postId: string; label: string }; onClose: () => void; onQueued: () => void }) {
  const toast = useToast();
  const [count, setCount] = useState(post ? 3 : 5);
  const [format, setFormat] = useState<IdeaFormat | "mix">("mix");
  const [focus, setFocus] = useState("");
  const ready = state.creators.filter((c) => c.status === "ready");
  const [picked, setPicked] = useState<string[]>(ready.map((c) => c.id));
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await ideasApi.generate({ count, format, focus: focus.trim() || undefined, creatorIds: post ? undefined : picked, post: post ? { creatorId: post.creatorId, postId: post.postId } : undefined });
      toast(IN_PANEL ? "Encargado: tu PC se lo pasa a Claude" : "Claude se pone con ello");
      onQueued();
    } catch (e) { toast((e as Error).message, "bad"); setBusy(false); }
  }
  return (
    <Modal title={post ? "Ideas a partir de este post" : "Generar ideas"} icon={<Sparkles size={18} color="var(--accent-2)" />} onClose={onClose}
      foot={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn--primary" disabled={busy} onClick={go}>{busy ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} Generar {count} ideas</button></>}>
      {post && <p className="note">{post.label}</p>}
      <Field label="¿Cuántas?">
        <div className="seg">{[3, 5, 8, 10].map((n) => <button key={n} className={count === n ? "is-on" : ""} onClick={() => setCount(n)}>{n}</button>)}</div>
      </Field>
      <Field label="Formato" hint="«Mezcla» sigue tu semana: formación grabando pantalla y vídeos hablando a cámara.">
        <div className="seg">
          <button className={format === "mix" ? "is-on" : ""} onClick={() => setFormat("mix")}>Mezcla</button>
          <button className={format === "camara" ? "is-on" : ""} onClick={() => setFormat("camara")}><Video size={14} /> Hablando a cámara</button>
          <button className={format === "pantalla" ? "is-on" : ""} onClick={() => setFormat("pantalla")}><Monitor size={14} /> Formación · pantalla</button>
        </div>
      </Field>
      <Field label="Enfoque (opcional)" hint="Un tema, una objeción de tus clientes, una campaña…">
        <input className="input" placeholder="Ej.: por qué los correos acaban en spam" value={focus} onChange={(e) => setFocus(e.target.value)} />
      </Field>
      {!post && (
        <Field label="Inspirarse en" hint={ready.length ? "Claude mira qué les funciona (ganchos, estructura, temas) y lo adapta a ti." : "Añade creadores en «Inspiración» para que Claude se base en lo que les funciona."}>
          {ready.length ? (
            <div className="id-chips">
              {ready.map((c) => (
                <button key={c.id} className={"id-chip" + (picked.includes(c.id) ? " is-on" : "")} onClick={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}>
                  @{c.username}{c.analysis && <Sparkles size={11} />}
                </button>
              ))}
            </div>
          ) : <span className="muted">Sin creadores todavía.</span>}
        </Field>
      )}
    </Modal>
  );
}

/* ---------- Inspiración: creadores de Instagram ---------- */

function Inspiration({ state, reload, onIdeasFromPost }: { state: IdeasState; reload: () => void; onIdeasFromPost: (p: { creatorId: string; postId: string; label: string }) => void }) {
  const toast = useToast();
  const [names, setNames] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function add() {
    if (!names.trim()) return;
    setAdding(true);
    try {
      const r = await ideasApi.addCreators(names);
      const bad = r.filter((c) => c.status === "error");
      if (bad.length) toast(bad.map((c) => c.error).join(" · "), "bad");
      if (r.length > bad.length) toast(`${r.length - bad.length} creador${r.length - bad.length > 1 ? "es" : ""} añadido${r.length - bad.length > 1 ? "s" : ""}`);
      setNames("");
      reload();
    } catch (e) { toast((e as Error).message, "bad"); }
    setAdding(false);
  }

  return (
    <>
      {!state.ig.ready && (
        <div className="note note--warn id-ig">
          <Instagram size={16} />
          <span>{state.ig.why || "Conecta tu Instagram para ver los posts de otros creadores."}</span>
          <button className="btn btn--sm" onClick={() => navigate("/conexiones")}>Ir a Conexiones</button>
        </div>
      )}
      <div className="card id-add">
        <div>
          <h3><AtSign size={16} /> Creadores que te inspiran</h3>
          <p className="muted">Escribe su @ (puedes poner varios separados por comas). Ves sus posts con visitas, likes y comentarios, y Claude estudia qué les funciona para tus ideas. Solo cuentas profesionales o de creador (así lo permite Instagram).</p>
        </div>
        <div className="row">
          <input className="input" placeholder="@creador1, @creador2" value={names} onChange={(e) => setNames(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} disabled={!state.ig.ready} />
          <button className="btn btn--primary" disabled={!names.trim() || adding || !state.ig.ready} onClick={add}>{adding ? <Loader2 size={15} className="spin" /> : <Plus size={15} />} Añadir</button>
        </div>
      </div>

      {state.creators.length ? (
        <div className="id-creators">
          {state.creators.map((c) => <CreatorCard key={c.id} c={c} jobs={state.jobs} onOpen={() => setOpenId(c.id)} reload={reload} toast={toast} />)}
        </div>
      ) : <p className="muted id-none">Aún no has añadido creadores.</p>}

      {openId && <CreatorModal id={openId} jobs={state.jobs} onClose={() => setOpenId(null)} reload={reload}
        onIdeas={(p, c) => { setOpenId(null); onIdeasFromPost({ creatorId: c.id, postId: p.id, label: `@${c.username} · ${p.type} · ${fmtNum(p.views ?? p.likes)} ${p.views != null ? "vistas" : "likes"} · «${p.caption.slice(0, 90)}…»` }); }} />}
    </>
  );
}

function Avatar({ c, size = 46 }: { c: Creator; size?: number }) {
  const [bad, setBad] = useState(false);
  return c.profile?.pic && !bad
    ? <img className="id-av" style={{ width: size, height: size }} src={c.profile.pic} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} />
    : <span className="id-av id-av--none" style={{ width: size, height: size }}>{c.username.slice(0, 1).toUpperCase()}</span>;
}

function CreatorCard({ c, jobs, onOpen, reload, toast }: { c: Creator; jobs: IdeasState["jobs"]; onOpen: () => void; reload: () => void; toast: ReturnType<typeof useToast> }) {
  const studying = jobs.find((j) => j.kind === "creator" && j.ref === c.id && (j.status === "queued" || j.status === "running"));
  return (
    <article className="card id-creator">
      <div className="id-creator__head">
        <Avatar c={c} />
        <div className="id-creator__who">
          <b>@{c.username}</b>
          <span className="muted">{c.profile?.name || ""}{c.profile?.followers != null ? ` · ${fmtNum(c.profile.followers)} seguidores` : ""}</span>
        </div>
        <a className="btn btn--ghost btn--icon btn--sm" href={`https://www.instagram.com/${c.username}/`} target="_blank" rel="noreferrer" title="Abrir en Instagram"><ExternalLink size={14} /></a>
      </div>
      {c.status === "loading" && <p className="muted"><Loader2 size={13} className="spin" /> Leyendo sus posts…</p>}
      {c.status === "error" && <p className="id-err">{c.error}</p>}
      {c.status === "ready" && (
        <button className="id-creator__thumbs" onClick={onOpen} title="Ver sus posts">
          {(c.preview || []).map((p) => <Thumb key={p.id} p={p} />)}
          <span className="id-creator__more">{c.postCount} posts</span>
        </button>
      )}
      {studying ? <p className="id-creator__an muted"><Loader2 size={13} className="spin" /> {studying.step || "En cola"}</p>
        : c.analysis ? <p className="id-creator__an"><Sparkles size={13} /> {c.analysis.summary}</p> : null}
      <div className="row id-creator__actions">
        <button className="btn btn--sm" disabled={c.status !== "ready"} onClick={onOpen}><Eye size={14} /> Ver posts</button>
        <button className="btn btn--sm" disabled={c.status !== "ready" || !!studying} title="Claude escucha sus mejores reels y saca sus ganchos y estructuras"
          onClick={() => ideasApi.analyzeCreator(c.id).then(() => { toast("Claude va a estudiar sus mejores reels"); reload(); }).catch((e) => toast(e.message, "bad"))}>
          <BarChart3 size={14} /> {c.analysis ? "Estudiar" : "Estudiar a fondo"}
        </button>
        <span className="spacer" />
        <button className="btn btn--ghost btn--icon btn--sm" title="Actualizar posts" onClick={() => ideasApi.refreshCreator(c.id).then(reload).catch((e) => { toast(e.message, "bad"); reload(); })}><RefreshCw size={14} /></button>
        <button className="btn btn--ghost btn--icon btn--sm" title="Quitar" onClick={() => confirm(`¿Quitar a @${c.username}?`) && ideasApi.removeCreator(c.id).then(reload)}><Trash2 size={14} /></button>
      </div>
    </article>
  );
}

function Thumb({ p }: { p: IgPost }) {
  const [bad, setBad] = useState(false);
  const Icon = p.type === "reel" || p.type === "video" ? Film : ImageIcon;
  if (p.img && !bad) return <span className="id-thumb"><img src={p.img} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBad(true)} /><Icon size={12} className="id-thumb__ic" /></span>;
  if (p.video && !bad) return <span className="id-thumb"><video src={p.video + "#t=0.5"} muted playsInline preload="metadata" onError={() => setBad(true)} /><Icon size={12} className="id-thumb__ic" /></span>;
  return <span className="id-thumb id-thumb--none"><Icon size={18} /></span>;
}

const SORTS = { best: "Mejores", views: "Más vistos", recent: "Recientes" } as const;

function CreatorModal({ id, jobs, onClose, reload, onIdeas }: { id: string; jobs: IdeasState["jobs"]; onClose: () => void; reload: () => void; onIdeas: (p: IgPost, c: Creator) => void }) {
  const toast = useToast();
  const [c, setC] = useState<Creator | null>(null);
  const [sort, setSort] = useState<keyof typeof SORTS>("best");
  const [type, setType] = useState<"all" | "video" | "foto">("all");
  const [sel, setSel] = useState<IgPost | null>(null);
  useEffect(() => { ideasApi.creator(id).then(setC).catch((e) => toast(e.message, "bad")); }, [id, toast]);
  const studying = jobs.find((j) => j.kind === "creator" && j.ref === id && (j.status === "queued" || j.status === "running"));
  const posts = useMemo(() => {
    const s = (p: IgPost) => (p.views ?? 0) / 50 + (p.likes ?? 0) + 2 * (p.comments ?? 0);
    return (c?.posts || []).filter((p) => type === "all" || (type === "video" ? p.type === "reel" || p.type === "video" : p.type === "imagen" || p.type === "carrusel"))
      .sort((a, b) => (sort === "recent" ? b.at.localeCompare(a.at) : sort === "views" ? (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0) : s(b) - s(a)));
  }, [c, sort, type]);
  if (!c) return <Modal wide title="Cargando…" onClose={onClose}><p className="muted">Cargando sus posts…</p></Modal>;
  const tr = sel ? c.transcripts.find((t) => t.id === sel.id) : null;
  return (
    <Modal wide title={`@${c.username}`} icon={<Avatar c={c} size={30} />} onClose={onClose}
      foot={<><a className="btn" href={`https://www.instagram.com/${c.username}/`} target="_blank" rel="noreferrer"><Instagram size={15} /> Abrir en Instagram</a><span className="spacer" /><button className="btn btn--primary" onClick={onClose}>Cerrar</button></>}>
      <div className="id-cm">
        <div className="id-cm__prof">
          <span><b>{fmtNum(c.profile?.followers)}</b> seguidores</span>
          <span><b>{fmtNum(c.profile?.posts)}</b> publicaciones</span>
          {c.profile?.bio && <p className="muted">{c.profile.bio}</p>}
        </div>
        {c.analysis ? (
          <section className="id-an">
            <h4 className="id-h"><Sparkles size={15} /> Qué le funciona</h4>
            <p className="id-p">{c.analysis.summary}</p>
            <div className="id-cols">
              <div><span className="id-k">Ganchos</span><ul className="id-list">{c.analysis.hooks.map((h, k) => <li key={k}>{h}</li>)}</ul></div>
              <div><span className="id-k">Estructuras</span><ul className="id-list">{c.analysis.structures.map((h, k) => <li key={k}>{h}</li>)}</ul></div>
            </div>
            <div className="id-cols">
              <div><span className="id-k">Temas</span><div className="id-tags">{c.analysis.topics.map((t) => <span key={t}>{t}</span>)}</div>{c.analysis.formats && <p className="id-p muted">{c.analysis.formats}</p>}</div>
              <div><span className="id-k">Qué copiar</span><ul className="id-list">{c.analysis.copy.map((h, k) => <li key={k}>{h}</li>)}</ul>
                {c.analysis.avoid.length ? <><span className="id-k">Qué no</span><ul className="id-list">{c.analysis.avoid.map((h, k) => <li key={k}>{h}</li>)}</ul></> : null}</div>
            </div>
          </section>
        ) : (
          <div className="note id-an-cta">
            <span>{studying ? <><Loader2 size={13} className="spin" /> {studying.step || "En cola"}</> : "Claude puede escuchar sus mejores reels y sacar sus fórmulas de gancho, estructuras y temas."}</span>
            {!studying && <button className="btn btn--sm btn--primary" onClick={() => ideasApi.analyzeCreator(c.id).then(() => { toast("Claude va a estudiar sus mejores reels"); reload(); }).catch((e) => toast(e.message, "bad"))}><BarChart3 size={14} /> Estudiar a fondo</button>}
          </div>
        )}

        <div className="id-filters">
          <div className="seg seg--sm">{(Object.keys(SORTS) as (keyof typeof SORTS)[]).map((k) => <button key={k} className={sort === k ? "is-on" : ""} onClick={() => setSort(k)}>{SORTS[k]}</button>)}</div>
          <div className="seg seg--sm">
            <button className={type === "all" ? "is-on" : ""} onClick={() => setType("all")}>Todo</button>
            <button className={type === "video" ? "is-on" : ""} onClick={() => setType("video")}>Reels</button>
            <button className={type === "foto" ? "is-on" : ""} onClick={() => setType("foto")}>Fotos y carruseles</button>
          </div>
          <span className="muted">{posts.length} posts</span>
        </div>

        {sel && (
          <div className="card id-sel">
            <div className="row">
              <b>{sel.type[0].toUpperCase() + sel.type.slice(1)} · {new Date(sel.at).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}</b>
              {sel.engagement != null && <span className="pill">{sel.engagement} % interacción</span>}
              <span className="spacer" />
              <a className="btn btn--sm" href={sel.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Ver en Instagram</a>
              <button className="btn btn--sm btn--primary" onClick={() => onIdeas(sel, c)}><Wand2 size={13} /> Ideas con este</button>
            </div>
            <p className="id-p id-caption">{sel.caption || <span className="muted">Sin descripción.</span>}</p>
            {tr && <><span className="id-k">Lo que dice</span><p className="id-p id-caption">{tr.text}</p></>}
          </div>
        )}
        <div className="id-posts">
          {posts.map((p, k) => (
            <button key={p.id} className={"id-post" + (sel?.id === p.id ? " is-sel" : "")} onClick={() => setSel(sel?.id === p.id ? null : p)}>
              <Thumb p={p} />
              {sort === "best" && k < 3 && <span className="id-post__top">Top {k + 1}</span>}
              <span className="id-post__stats">
                {p.views != null && <span><Eye size={11} /> {fmtNum(p.views)}</span>}
                <span><Heart size={11} /> {fmtNum(p.likes)}</span>
                <span><MessageCircle size={11} /> {fmtNum(p.comments)}</span>
              </span>
            </button>
          ))}
        </div>

      </div>
    </Modal>
  );
}

/* ---------- Sobre ti ---------- */

const PROFILE_FIELDS: { k: keyof Profile; label: string; hint: string; rows: number }[] = [
  { k: "about", label: "Qué haces", hint: "Tu negocio, tu producto y lo que te diferencia. Cifras reales: Claude no se las inventa.", rows: 4 },
  { k: "audience", label: "A quién le hablas", hint: "Tu cliente ideal: quién es, qué le preocupa.", rows: 3 },
  { k: "offer", label: "Llamada a la acción", hint: "Qué quieres que hagan al terminar el vídeo.", rows: 2 },
  { k: "tone", label: "Tu tono", hint: "Cómo hablas.", rows: 2 },
  { k: "goals", label: "Objetivo del contenido", hint: "Para qué publicas.", rows: 2 },
  { k: "avoid", label: "Qué evitar", hint: "Temas, palabras o enfoques que no quieres.", rows: 2 },
];

function ProfileTab({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const toast = useToast();
  const [p, setP] = useState(profile);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(p) !== JSON.stringify(profile);
  return (
    <div className="card id-profile">
      <p className="muted">Claude lee esto antes de pensar cada idea y cada guion: cuanto más concreto, más tuyo suena.</p>
      {PROFILE_FIELDS.map((f) => (
        <Field key={f.k} label={f.label} hint={f.hint}>
          <textarea className="textarea" rows={f.rows} value={p[f.k]} onChange={(e) => setP({ ...p, [f.k]: e.target.value })} />
        </Field>
      ))}
      <div className="row">
        <span className="spacer" />
        <button className="btn btn--primary" disabled={!dirty || busy} onClick={async () => {
          setBusy(true);
          try { const r = await ideasApi.saveProfile(p); onSaved(r); setP(r); toast("Guardado"); } catch (e) { toast((e as Error).message, "bad"); }
          setBusy(false);
        }}>Guardar</button>
      </div>
    </div>
  );
}
