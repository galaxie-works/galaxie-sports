# syntax=docker/dockerfile:1.7
# Imagem do app de demonstração (Next.js standalone). Build a partir da raiz do monorepo:
#   docker build -f apps/demo/Dockerfile -t galaxie-sports-demo .
# Em runtime: GALAXIE_API_URL (ex.: http://api:8080) e GALAXIE_DEMO_KEY (chave do tenant de demo).
ARG NODE_IMAGE=node:24.22.1-alpine

# ── build: instala o workspace e compila a demo e as dependências internas (topológico) ──
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN corepack enable
WORKDIR /repo
# 1) só o lockfile → camada de dependências cacheada enquanto ele não muda
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
# 2) código-fonte e build; a demo não chama a API no build (nenhuma página depende dela no prerender)
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@galaxie/demo..." run build
# 3) servidor standalone + estáticos (o server.js não copia public/ nem .next/static sozinho)
RUN mkdir -p /out \
 && cp -r apps/demo/.next/standalone/. /out/ \
 && mkdir -p /out/apps/demo/.next \
 && cp -r apps/demo/.next/static /out/apps/demo/.next/static \
 && cp -r apps/demo/public /out/apps/demo/public

# ── runtime: Node + tini, usuário sem privilégios ──
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /srv
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/demo/server.js"]
