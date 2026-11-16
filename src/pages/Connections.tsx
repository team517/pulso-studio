import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Link2, Loader2, LogOut } from "lucide-react";
import { api, PLATFORM_INFO, type PlatformId, type PlatformStatus } from "../api";
import { Field, navigate, usePath, useToast } from "../ui";
import { PlatformBadge } from "./Calendar";

const GUIDES: Record<PlatformId, { steps: React.ReactNode[]; note?: string; link: string }> = {
  youtube: {
    link: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    steps: [
      <>En <b>Google Cloud Console</b> crea un proyecto y activa la <b>YouTube Data API v3</b>.</>,
      <>En «Pantalla de consentimiento de OAuth» elige <b>Externo</b> y añade tu correo de Google como <b>usuario de prueba</b>.</>,
      <>En «Credenciales» → <b>Crear ID de cliente de OAuth</b> → tipo <b>Aplicación web</b>, y en «URI de redirección autorizados» pega la dirección de abajo.</>,
      <>Copia aquí el <b>ID de cliente</b> y el <b>secreto</b>, guarda y pulsa <b>Conectar con YouTube</b>.</>,
    ],
    note: "Mientras la app de Google esté en modo «Prueba», Google pide volver a conectar cada 7 días. Si la publicas en Google Cloud, deja de caducar.",
  },
  tiktok: {
    link: "https://developers.tiktok.com/apps",
    steps: [
      <>En <b>TikTok for Developers</b> crea una app y añade <b>Login Kit</b> y <b>Content Posting API</b> (activa «Direct Post»).</>,
      <>TikTok solo acepta direcciones <b>https</b>: abre un túnel (por ejemplo <span className="mono">cloudflared tunnel --url http://localhost:4321</span>) y pega su dirección en «Dirección pública» arriba.</>,
      <>En Login Kit pega la <b>URI de redirección</b> de abajo.</>,
      <>Copia aquí el <b>Client key</b> y el <b>Client secret</b>, guarda y pulsa <b>Conectar con TikTok</b>.</>,
    ],
    note: "Hasta que TikTok revise y apruebe tu app, solo deja publicar vídeos en privado («Solo yo»).",
  },
  instagram: {
    link: "https://developers.facebook.com/apps",
    steps: [
      <>Tu Instagram tiene que ser <b>profesional</b> (empresa o creador) y estar <b>vinculado a una página de Facebook</b> (en Instagram: Configuración → Centro de cuentas, o desde Meta Business Suite).</>,
      <>En <b>Meta for Developers</b> pulsa <b>Crear app</b>, elige el tipo <b>Empresa</b> (o el caso de uso de gestionar contenido de Instagram) y créala.</>,
      <>En la app, ve a <b>Configuración → Básica</b> y copia aquí abajo el <b>Identificador de la app</b> y la <b>Clave secreta</b>. Con ellas el token no caduca.</>,
      <>Abre el <b>Explorador de la API Graph</b> (botón de abajo), elige tu app, pulsa <b>Generar token de acceso</b> y marca estos permisos: <span className="mono">instagram_basic</span>, <span className="mono">instagram_content_publish</span>, <span className="mono">pages_show_list</span>, <span className="mono">pages_read_engagement</span> y <span className="mono">business_management</span>. Acepta con tu cuenta de Facebook y elige tu página.</>,
      <>Copia el token que sale arriba, pégalo aquí y pulsa <b>Conectar</b>.</>,
    ],
    note: "No hace falta enviar la app a revisión de Meta: mientras sea tuya (modo desarrollo) puede publicar en tus propias cuentas.",
  },
};

export default function Connections() {
  const toast = useToast();
  const [path] = usePath();
  const [list, setList] = useState<PlatformStatus[] | null>(null);
  const [publicUrl, setPublicUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");

  const load = useCallback(() => api.platforms().then((r) => { setList(r.platforms); setPublicUrl(r.publicUrl); setSavedUrl(r.publicUrl); }).catch((e) => toast(e.message, "bad")), [toast]);
  useEffect(() => { load(); }, [load]);

  // Vuelta de Google / TikTok
  useEffect(() => {
    const q = new URLSearchParams(path.split("?")[1] ?? "");
    if (q.get("ok")) { toast(`${PLATFORM_INFO[q.get("ok") as PlatformId]?.name ?? "Red"} conectada`); navigate("/conexiones", true); load(); }
    else if (q.get("error")) { toast(q.get("error")!, "bad"); navigate("/conexiones", true); }
  }, [path, toast, load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Conexiones</h1>
          <p>Conecta tus cuentas para que los vídeos programados se publiquen solos. Las claves se guardan solo en tu ordenador.</p>
        </div>
      </div>

      <div className="card conn-url">
        <Field label="Dirección pública (solo hace falta para TikTok)" hint="Déjalo vacío si no usas TikTok. Es la dirección https de un túnel hacia este programa.">
          <div className="row">
            <input className="input" value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://tu-tunel.trycloudflare.com" />
            <button className="btn" disabled={publicUrl === savedUrl} onClick={async () => { await api.setPublicUrl(publicUrl); toast("Dirección guardada"); load(); }}>Guardar</button>
          </div>
        </Field>
      </div>

      {list === null ? <p className="muted">Cargando…</p> : (
        <div className="conn-list">
          {(["instagram", "tiktok", "youtube"] as PlatformId[]).map((p) => {
            const st = list.find((x) => x.id === p);
            return st ? <PlatformCard key={p} st={st} onChange={load} /> : null;
          })}
        </div>
      )}
    </div>
  );
}

function PlatformCard({ st, onChange }: { st: PlatformStatus; onChange: () => void }) {
  const toast = useToast();
  const g = GUIDES[st.id];
  const [clientId, setClientId] = useState(st.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!st.connected);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);

  async function runCheck() {
    setCheck({ ok: true, text: "Comprobando…" });
    try {
      const r = await api.checkInstagram();
      setCheck({ ok: true, text: `Todo bien: puedo publicar en @${r.username}${r.media != null ? ` (${r.media} publicaciones)` : ""}${r.quota ? `. Hoy llevas ${r.used ?? 0} de ${r.quota} publicaciones por API.` : "."}` });
    } catch (e) { setCheck({ ok: false, text: (e as Error).message }); }
  }

  async function saveCreds() {
    setBusy(true);
    try {
      if (st.id === "instagram") await api.configurePlatform("instagram", { appId: clientId.trim(), ...(secret ? { appSecret: secret } : {}), accessToken: token });
      else await api.configurePlatform(st.id, { clientId, ...(secret ? { clientSecret: secret } : {}) });
      setSecret(""); setToken("");
      toast(st.id === "instagram" ? "Instagram conectado" : "Datos guardados");
      onChange();
    } catch (e) { toast((e as Error).message, "bad"); } finally { setBusy(false); }
  }

  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast("Copiado"));

  return (
    <div className="card conn">
      <div className="conn__head">
        <PlatformBadge p={st.id} size={40} />
        <div>
          <h3>{PLATFORM_INFO[st.id].name}</h3>
          {st.connected
            ? <span className="row" style={{ gap: 6, color: "var(--ok)", fontSize: 13 }}><CheckCircle2 size={15} /> Conectada{st.account ? ` como ${st.account}` : ""}</span>
            : <span className="muted" style={{ fontSize: 13 }}>{st.configured ? "Datos guardados, falta conectar la cuenta" : "Sin conectar"}</span>}
        </div>
        <span className="spacer" />
        {st.connected && <button className="btn btn--sm" onClick={async () => { await api.disconnectPlatform(st.id); toast("Desconectada"); onChange(); }}><LogOut size={14} /> Desconectar</button>}
        <button className="btn btn--sm btn--ghost" onClick={() => setOpen((o) => !o)}>{open ? "Ocultar" : "Configurar"}</button>
      </div>

      {open && (
        <div className="conn__body">
          <ol className="conn__steps">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <a className="btn btn--sm" href={g.link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir Meta for Developers</a>
            {st.id === "instagram" && <a className="btn btn--sm" href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir el Explorador de la API Graph</a>}
          </div>

          {st.redirectUri && (
            <Field label="URI de redirección (cópiala en la consola)">
              <div className="row">
                <input className="input mono" readOnly value={st.redirectUri} onFocus={(e) => e.target.select()} />
                <button className="btn btn--icon" onClick={() => copy(st.redirectUri!)} title="Copiar"><Copy size={15} /></button>
              </div>
            </Field>
          )}

          {st.id === "instagram" ? (
            <>
              <div className="grid2">
                <Field label="Identificador de la app"><input className="input mono" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234567890" autoComplete="off" /></Field>
                <Field label="Clave secreta de la app"><input className="input mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={st.hasApp ? "•••••• (guardada)" : ""} autoComplete="off" /></Field>
              </div>
              <Field label="Token del Explorador de la API Graph" hint={!clientId.trim() || (!st.hasApp && !secret.trim()) ? "Sin el identificador y la clave secreta el token caduca en 1-2 horas." : undefined}>
                <div className="row">
                  <input className="input mono" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={st.connected ? "•••••• (pega otro para cambiarlo)" : "EAA…"} autoComplete="off" />
                  <button className="btn btn--primary" onClick={saveCreds} disabled={!token.trim() || busy}>{busy ? <Loader2 size={15} className="spin" /> : <Link2 size={15} />} Conectar</button>
                </div>
              </Field>
              {st.connected && (
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {st.expiresAt === 0 ? "El acceso no caduca." : st.expiresAt ? `El acceso caduca el ${new Date(st.expiresAt).toLocaleString("es-ES", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.` : ""}
                    {st.mode === "instagram" && " Conectada con token de Instagram: necesita la «Dirección pública» para publicar."}
                  </span>
                  <span className="spacer" />
                  <button className="btn btn--sm" onClick={runCheck}>Comprobar conexión</button>
                </div>
              )}
              {check && <div className={"note " + (check.ok ? "note--ok" : "note--bad")}>{check.text}</div>}
            </>
          ) : (
            <>
              <div className="grid2">
                <Field label={st.id === "tiktok" ? "Client key" : "ID de cliente"}><input className="input mono" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" /></Field>
                <Field label={st.id === "tiktok" ? "Client secret" : "Secreto de cliente"}><input className="input mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={st.configured ? "•••••• (guardado)" : ""} autoComplete="off" /></Field>
              </div>
              <div className="row">
                <button className="btn" onClick={saveCreds} disabled={busy || !clientId.trim() || (!st.configured && !secret.trim())}>Guardar datos</button>
                <button className="btn btn--primary" disabled={!st.configured} onClick={() => { window.location.href = `/api/auth/${st.id}/start?front=${encodeURIComponent(window.location.origin)}`; }}>
                  <Link2 size={15} /> {st.connected ? "Volver a conectar" : `Conectar con ${st.id === "youtube" ? "YouTube" : "TikTok"}`}
                </button>
              </div>
            </>
          )}
          {g.note && <div className="note">{g.note}</div>}
        </div>
      )}
    </div>
  );
}
