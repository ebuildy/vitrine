FROM node:24-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS build
RUN npm ci
COPY astro.config.mjs tsconfig.json ./
COPY src src
RUN ASTRO_TELEMETRY_DISABLED=1 npm run build

FROM base AS dependencies
RUN npm ci --omit=dev

FROM base
# No Settings file is baked in: an Administrator mounts one at VITRINE_SETTINGS, and secrets come from the environment.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 VITRINE_SETTINGS=/etc/vitrine/settings.yaml
COPY --from=dependencies /app/node_modules node_modules
COPY --from=build /app/dist dist
# start.ts checks Settings before the server starts, so it runs src/ directly through Node's type stripping.
COPY LICENSE start.ts ./
COPY src src
# Numeric, or kubelet cannot check runAsNonRoot. It is the user node of the base image.
USER 1000
EXPOSE 8080
CMD ["node", "start.ts"]
