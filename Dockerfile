# syntax=docker/dockerfile:1

# ---- build: TypeScript → dist ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/signing-service/package.json packages/signing-service/
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci
COPY packages/core packages/core
COPY packages/signing-service packages/signing-service
RUN npm run build

# ---- runtime: jen produkční závislosti a sestavený kód ----
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/signing-service/package.json packages/signing-service/
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev
COPY --from=build /app/packages/core/dist packages/core/dist
COPY packages/core/certs packages/core/certs
COPY --from=build /app/packages/signing-service/dist packages/signing-service/dist

ARG VERSION=dev
ARG GIT_SHA=
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="eet2-signing-service" \
      org.opencontainers.image.description="HTTP služba pro EET 2.0 (elektronická evidence tržeb v ČR)" \
      org.opencontainers.image.source="https://github.com/ma-zal/node-eet2" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

# .storage/ drží config.cjs, certifikát s privátním klíčem a stav obnovy – připojit jako volume (ADR-007).
RUN mkdir -p /app/.storage
VOLUME ["/app/.storage"]

EXPOSE 3000

# /healthy vrací chybu jen při prošlém certifikátu (ADR-008). Vestavěný fetch – v alpine není curl ani wget.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthy').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "packages/signing-service/dist/server.js"]
