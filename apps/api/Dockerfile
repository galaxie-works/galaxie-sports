# syntax=docker/dockerfile:1.7
# Imagem da API pública. Build a partir da raiz do monorepo:
#   docker build -f apps/api/Dockerfile -t galaxie-sports-api .
ARG NODE_IMAGE=node:24.22.1-alpine

# ── build: instala o workspace, compila a API e as dependências internas, isola só o necessário ──
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
# 1) só o lockfile → camada de dependências cacheada enquanto ele não muda
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
# 2) código-fonte e build da API com tudo de que ela depende (topológico)
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@galaxie/api..." run build
# 3) pacote autocontido: só dependências de produção (workspace incluído) em /out
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @galaxie/api deploy --prod --legacy /out

# ── runtime: Node + tini, usuário sem privilégios, arquivos somente leitura ──
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production API_PORT=8080
WORKDIR /srv/apps/api
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# config/ e a base semântica inteiros, no mesmo layout do repositório (/srv = raiz): planos, geografia,
# regulamentos (stakes, tags do torcedor), dicionários do onde assistir, denylist de mídia e glossário.
# Os pacotes procuram esses arquivos a partir de si mesmos, o que não vale no node_modules do deploy, e
# silenciam quando não acham (lista vazia) — por isso os ENV apontam o caminho e o smoke test confere.
COPY --from=build /repo/config /srv/config
COPY --from=build /repo/data/knowledge /srv/data/knowledge
ENV GEO_CONFIG_DIR=/srv/config/geo RULES_CONFIG_DIR=/srv/config/rules WTW_CONFIG_DIR=/srv/config \
    MEDIA_DENYLIST_PATH=/srv/config/assets/denylist.yaml KNOWLEDGE_DIR=/srv/data/knowledge
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
