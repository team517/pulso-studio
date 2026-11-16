# Pulso Studio

Editor de vídeo y programador de publicaciones para Instagram Reels, TikTok y YouTube Shorts. Funciona en tu ordenador: la web es la interfaz y un servidor local hace el trabajo pesado (exportar con ffmpeg, subtítulos con Whisper y publicar a la hora programada).

## Arrancar

```bash
npm install
npm run dev
```

Abre http://localhost:5174. El servidor local escucha en el puerto 4321 (se cambia con la variable `STUDIO_PORT`).

Para usarlo sin modo desarrollo: `npm run build` y luego `npm start` (todo en http://localhost:4321).

## Qué hace

- **Proyectos**: formato 9:16, 4:5, 1:1 o 16:9.
- **Editor**: clips en secuencia (recortar por los bordes, cortar con S, reordenar arrastrando), textos que se arrastran en la vista previa, subtítulos automáticos con la palabra que suena resaltada, música con volumen y fundidos, deshacer/rehacer y guardado automático.
- **Exportar**: MP4 H.264 + AAC a 30 fps. Usa la GPU NVIDIA si el driver lo permite (NVENC necesita driver 610 o más nuevo); si no, x264.
- **Calendario**: programa cada vídeo en una o varias redes. A la hora se publica solo, siempre que el programa esté abierto.
- **Conexiones**: YouTube (OAuth de Google), TikTok (OAuth, necesita una dirección https pública) e Instagram (token de la API de Instagram).

## Necesita

- Node 24 (usa el SQLite integrado).
- ffmpeg y ffprobe en el PATH.
- Python con `openai-whisper` y PyTorch (con CUDA va mucho más rápido). Modelo `large-v3-turbo`.

## Datos

Todo se guarda en `data/` (no se sube a git): `studio.db`, `media/`, `exports/` y `thumbs/`. Las claves de las redes solo viven en `studio.db`.
