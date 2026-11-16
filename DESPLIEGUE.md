# Pulso Studio dentro del panel de ChipsFinder

```
Panel ChipsFinder (/panel/studio)  ──►  nginx de ChipsFinder  ──►  servicio «pulso-studio» (EasyPanel)
   solo administradores                  /studio/ → STUDIO_UPSTREAM      guarda vídeos, programa y publica
                                                                              ▲
                                                                              │ recoge y devuelve
                                                                     tu PC («Editor Pulso Studio.cmd»)
                                                                     tarjeta gráfica + Whisper + Claude
```

- **En EasyPanel** está siempre encendido: subes vídeos, ves los editados, programas y se publican aunque tu PC esté apagado.
- **Tu PC edita**: recoge los vídeos pendientes, los edita y sube el resultado. Con el PC apagado, los vídeos esperan en cola.

## 1. Servicio «pulso-studio» en EasyPanel (mismo proyecto que ChipsFinder)

- **Origen**: GitHub → repositorio `pulso-studio`, rama `main`, Dockerfile en la raíz.
- **Puerto**: 4321 (no hace falta dominio propio: se entra por el panel).
- **Volumen**: monta un volumen en `/app/data` (ahí van la base de datos y los vídeos).
- **Variables de entorno**:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | la misma que `VITE_SUPABASE_URL` de ChipsFinder |
| `SUPABASE_KEY` | la misma que `VITE_SUPABASE_PUBLISHABLE_KEY` de ChipsFinder |
| `STUDIO_SECRET` | una clave larga al azar (firma las sesiones) |
| `STUDIO_WORKER_TOKEN` | otra clave larga al azar (la usa tu PC) |
| `PUBLIC_URL` | `https://backend-onepulso-chipsfinder.25kofp.easypanel.host/studio` |

## 2. ChipsFinder

- Variable `STUDIO_UPSTREAM` = `http://<proyecto>_pulso-studio:4321` (nombre interno del servicio en EasyPanel).
  Por defecto es `http://backend-onepulso_pulso-studio:4321` (proyecto «backend-onepulso»).
- **Implementar**. En el menú del panel (Administración) sale **Pulso Studio**.

## 3. Tu PC

1. Crea `data/worker.json` en la carpeta de Pulso Studio:
   ```json
   { "server": "https://backend-onepulso-chipsfinder.25kofp.easypanel.host/studio", "token": "el STUDIO_WORKER_TOKEN" }
   ```
2. Doble clic en **Editor Pulso Studio.cmd** y déjalo abierto (minimizado).
3. En el panel, abajo a la izquierda de Pulso Studio, verás «Tu PC está listo para editar».

## Notas

- Las conexiones con Instagram, TikTok y YouTube hay que hacerlas otra vez en el panel (las de este PC no se copian).
  En YouTube y TikTok, la dirección de vuelta pasa a ser `PUBLIC_URL/api/auth/youtube/callback` (o `/tiktok/`).
- No dejes encendidos a la vez `npm run dev` y el editor con las mismas publicaciones programadas: publicarían dos veces.
