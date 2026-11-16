# Pulso Studio en EasyPanel (modo servidor): guarda vídeos, programa y publica. Se entra con una cuenta de
# administrador de ChipsFinder. La edición la hace tu PC («Editor Pulso Studio.cmd»), que tiene la tarjeta gráfica y Claude.
FROM node:24-slim

RUN apt-get update  && apt-get install -y --no-install-recommends ffmpeg ca-certificates  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# Sin scripts de instalación: aquí no hace falta el navegador de los gráficos (se renderiza en tu PC)
RUN npm ci --ignore-scripts

COPY . .
# La web compilada para el servidor (con pantalla de entrada)
RUN VITE_BASE=/ VITE_STUDIO_AUTH=1 npx vite build

# Las cuentas son las de ChipsFinder (Supabase). Dirección y clave publicable: públicas, como en la web de ChipsFinder.
# STUDIO_WORKER_TOKEN (la clave de tu PC) se pone en EasyPanel → Entorno.
ENV NODE_ENV=production     STUDIO_MODE=server     STUDIO_PORT=80     SUPABASE_URL=https://vwybcwidffcnpcjlehxv.supabase.co     SUPABASE_KEY=sb_publishable_ak3EfOjkSE25l5YBz-EU7g_mMbY_vif     PUBLIC_URL=https://backend-onepulso-chipsfinder.25kofp.easypanel.host
# Base de datos, vídeos y miniaturas: monta aquí un volumen en EasyPanel para no perderlos
# (Sin VOLUME aquí: el volumen lo pones en EasyPanel → Montajes → /app/data. Uno anónimo se borraba al implementar.)
EXPOSE 80
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
