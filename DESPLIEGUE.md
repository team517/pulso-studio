# Pulso Studio en EasyPanel

Dirección: **https://backend-onepulso-chipsfinder.25kofp.easypanel.host** (servicio «chipsfinder» del proyecto «backend-onepulso»).
Se entra con una cuenta de **administrador de ChipsFinder** (mismas cuentas de Supabase).

```
EasyPanel (siempre encendido)                       tu PC («Editor Pulso Studio.cmd»)
subir vídeos · editados · calendario · publicar  ◄──►  recoge vídeos, edita con GPU + Whisper + Claude,
resultados · estilo de edición                         sube el resultado
```

## EasyPanel (servicio chipsfinder)

- **Fuente → Github**: `team517/pulso-studio`, rama `main`, ruta `/`. Compilación: **Dockerfile**.
- **Entorno**: `STUDIO_WORKER_TOKEN=…` (la línea de `data/claves-easypanel.txt`, que no se sube a GitHub).
- **Montajes**: volumen en `/app/data` (base de datos y vídeos; sin él se pierden en cada Implementar).
- **Dominio**: puerto **80** (el de siempre).
- El Dockerfile ya trae lo demás (cuentas de Supabase, puerto, dirección pública).

## Tu PC

- `data/worker.json` → `{ "server": "https://backend-onepulso-chipsfinder.25kofp.easypanel.host", "token": "…" }`
- Doble clic en **Editor Pulso Studio.cmd** y déjalo abierto. Con el PC apagado, los vídeos esperan en cola.

## Notas

- Las conexiones con Instagram, TikTok y YouTube se hacen otra vez en la web (las de `npm run dev` no se copian).
  En YouTube y TikTok, la dirección de vuelta es `https://backend-onepulso-chipsfinder.25kofp.easypanel.host/api/auth/youtube/callback` (o `/tiktok/`).
- No uses a la vez `npm run dev` con publicaciones programadas y la web: publicarían dos veces.
- El panel de ChipsFinder sigue en GitHub (`team517/chipsfinder`) por si se quiere volver a desplegar en otro servicio.
