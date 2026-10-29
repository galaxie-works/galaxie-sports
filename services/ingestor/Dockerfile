# syntax=docker/dockerfile:1.7
# Imagem do ingestor: scheduler que executa os CLIs (quota, bootstrap do catálogo...) em horários fixos.
# Build a partir da raiz do monorepo:
#   docker build -f services/ingestor/Dockerfile -t galaxie-sports-ingestor .
ARG NODE_IMAGE=node:24.22.1-alpine

FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm --filter "@galaxie/ingestor..." --filter "@galaxie/ai-agents..." run build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @galaxie/ingestor deploy --prod --legacy /out && \
    pnpm --filter @galaxie/ai-agents deploy --prod --legacy /out-agents

FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache tini
ENV NODE_ENV=production SCHEDULER_HEARTBEAT_FILE=/tmp/galaxie-scheduler.heartbeat \
    RULES_CONFIG_DIR=/srv/config/rules WTW_CONFIG_DIR=/srv/config GEO_CONFIG_DIR=/srv/config/geo \
    AI_POLICY_FILE=/srv/config/ai-policy.yaml \
    KNOWLEDGE_DIR=/srv/data/knowledge
# Mesmo layout do repositório: os CLIs resolvem ../../config e ../../data a partir do pacote.
WORKDIR /srv/services/ingestor
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# Agentes de IA: mesmo scheduler, perfil `agents` (SCHEDULER_PROFILE=agents → serviço `agents` da stack)
COPY --from=build /out-agents/package.json /srv/services/ai-agents/package.json
COPY --from=build /out-agents/node_modules /srv/services/ai-agents/node_modules
COPY --from=build /out-agents/dist /srv/services/ai-agents/dist
COPY --from=build /repo/config /srv/config
COPY --from=build /repo/data/knowledge /srv/data/knowledge
COPY infra/healthcheck/selfheal.mjs /usr/local/lib/galaxie/selfheal.mjs
USER node
# Scheduler parado (batimento com mais de 2 min): depois de 6 falhas (~3 min) o processo é encerrado e o Docker
# sobe outro (infra/healthcheck/selfheal.mjs, no máximo 3 reinícios em 30 min).
HEALTHCHECK --interval=30s --timeout=6s --start-period=30s --retries=3 \
  CMD node /usr/local/lib/galaxie/selfheal.mjs heartbeat "$SCHEDULER_HEARTBEAT_FILE" 120000
ENTRYPOINT ["/sbin/tini", "--"]
# O scheduler só agenda (heap pequeno); cada job é um processo filho com heap próprio (SCHEDULER_JOB_HEAP_MB e o
# heapMb do job) e o teto SCHEDULER_MAX_JOBS. A conta da memória está em infra/vps-telemetry/README.md › Memória.
# CLI rodada à mão (docker compose run ... node dist/cli/x.js) fica no padrão do V8.
CMD ["node", "--max-old-space-size=64", "--max-semi-space-size=8", "dist/cli/scheduler.js"]
