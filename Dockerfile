FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY astro.config.mjs tsconfig.json ./
COPY src src
RUN ASTRO_TELEMETRY_DISABLED=1 npm run build

FROM node:24-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-slim
# No Settings file is baked in: an Administrator mounts one at VITRINE_SETTINGS, and secrets come from the environment.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 VITRINE_SETTINGS=/etc/vitrine/settings.yaml
WORKDIR /app
COPY --from=dependencies /app/node_modules node_modules
COPY --from=build /app/dist dist
# start.ts checks Settings before the server starts, so it runs src/ directly through Node's type stripping.
COPY LICENSE package.json start.ts ./
COPY src src
USER node
EXPOSE 8080
CMD ["node", "start.ts"]
