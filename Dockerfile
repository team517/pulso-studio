# Pulso Studio en EasyPanel (modo servidor): guarda vídeos, programa y publica, y lo enseña dentro del panel
# de ChipsFinder en /studio. La edición la hace tu PC (npm run worker), que tiene la tarjeta gráfica y Claude.
FROM node:24-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# Sin scripts de instalación: aquí no hace falta el navegador de los gráficos (se renderiza en tu PC)
RUN npm ci --ignore-scripts

COPY . .
# La web compilada para ir bajo /studio y pedir la sesión del panel
RUN VITE_BASE=/studio/ VITE_STUDIO_AUTH=1 npx vite build

ENV NODE_ENV=production \
    STUDIO_MODE=server \
    STUDIO_BASE=/studio \
    STUDIO_PORT=4321
# Base de datos, vídeos y miniaturas: monta aquí un volumen en EasyPanel para no perderlos
VOLUME /app/data
EXPOSE 4321
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
