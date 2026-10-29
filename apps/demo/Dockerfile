# syntax=docker/dockerfile:1.7
# Imagem do app de demonstração (Next.js standalone). Build a partir da raiz do monorepo:
#   docker build -f apps/demo/Dockerfile -t galaxie-sports-demo .
# Em runtime: GALAXIE_API_URL (ex.: http://api:8080) e GALAXIE_DEMO_KEY (chave do tenant de demo).
# O dicionário de emissoras (config/broadcasters, config/broadcast-rights) vai junto: o portal casa a
# lista de canais do cliente com ele (WTW_CONFIG_DIR).
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
 && cp -r apps/demo/public /out/apps/demo/public \
 && mkdir -p /out/config \
 && cp -r config/broadcasters config/broadcast-rights /out/config/

# ── runtime: Node + tini, usuário sem privilégios ──
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 WTW_CONFIG_DIR=/srv/config
WORKDIR /srv
COPY --from=build --chown=node:node /out ./
COPY infra/healthcheck/selfheal.mjs /usr/local/lib/galaxie/selfheal.mjs
USER node
EXPOSE 3000
# Vivacidade sem depender da API (/robots.txt sai do próprio Next); travado, o processo é encerrado e o Docker
# sobe outro (infra/healthcheck/selfheal.mjs).
HEALTHCHECK --interval=15s --timeout=6s --start-period=20s --retries=3 \
  CMD node /usr/local/lib/galaxie/selfheal.mjs http "http://127.0.0.1:${PORT:-3000}/robots.txt"
ENTRYPOINT ["/sbin/tini", "--"]
# Heap fixo para caber no mem_limit de 512m (velho 320 + novo 3 × 16 + ~50 do processo), como a API
CMD ["node", "--max-old-space-size=320", "--max-semi-space-size=16", "apps/demo/server.js"]
