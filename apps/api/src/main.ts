import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import { parse } from 'yaml';
import { MediaDenylist, type MediaDenylistEntry } from '@galaxie/apisports-client';
import { closeDb, createDb, readRuntimeOverrides, reportRuntimeEnv } from '@galaxie/db';
import { applyOverrides, envReport, lineupMinReviewStatus } from '@galaxie/runtime-config';
import { hardeningFromEnv } from './config.js';
import type { ReviewStatus } from './context.js';
import { buildServer } from './server.js';

/** config/assets/denylist.yaml (ou MEDIA_DENYLIST_PATH): mídia que nunca aparece reescrita no espelho. */
function loadDenylist(): MediaDenylist | undefined {
  const path =
    process.env.MEDIA_DENYLIST_PATH ??
    fileURLToPath(new URL('../../../config/assets/denylist.yaml', import.meta.url));
  if (!existsSync(path)) return undefined;
  const doc = parse(readFileSync(path, 'utf8')) as { denylist?: MediaDenylistEntry[] } | null;
  return new MediaDenylist(doc?.denylist ?? []);
}
const mediaDenylist = loadDenylist();

// perfil `api`: statement/lock/idle-in-transaction curtos (consulta presa solta a conexão antes do timeout da requisição)
const db = process.env.DATABASE_URL
  ? createDb(process.env.DATABASE_URL, { profile: 'api', applicationName: 'galaxie-api' })
  : undefined;

const REVIEW_STATUSES: ReviewStatus[] = ['draft', 'reviewed', 'approved'];
const minReviewStatus = process.env.SEMANTIC_MIN_REVIEW_STATUS as ReviewStatus | undefined;
if (minReviewStatus && !REVIEW_STATUSES.includes(minReviewStatus))
  throw new Error(
    `SEMANTIC_MIN_REVIEW_STATUS inválido: ${minReviewStatus} (use draft, reviewed ou approved)`,
  );

/**
 * Painel de Ajustes → Operação: as flags que a API lê (intervalo do ao vivo, planos e reserva nas
 * métricas) valem do banco na partida (banco > env > padrão; mudanças exigem reiniciar a API). O env do
 * contêiner vai para ops.runtime_env, com segredos só como configurado/não configurado.
 */
if (db) {
  try {
    const containerEnv = { ...process.env };
    const { env, applied } = applyOverrides(containerEnv, await readRuntimeOverrides(db));
    for (const key of applied) process.env[key] = env[key];
    await reportRuntimeEnv(db, 'api', [
      ...envReport('api', containerEnv),
      // piso editorial efetivo: a revisão semântica (Ajustes → Revisão) mostra se o item é servido hoje
      {
        key: 'SEMANTIC_MIN_REVIEW_STATUS',
        value: minReviewStatus ?? 'approved',
        configured: Boolean(minReviewStatus),
      },
    ]);
  } catch (err) {
    console.warn('configuração do painel indisponível na partida; seguindo com o env', err);
  }
}
// piso editorial da grade de canais e ofertas: lido depois das sobrescritas do painel (banco > env > padrão)
const lineupMinReview = lineupMinReviewStatus(process.env);

// commandTimeout: Valkey lento (cheio, swap, AOF reescrevendo) vira erro em 1 s, e o cache e o rate limit seguem
// o caminho de falha deles, em vez de a requisição esperar o comando para sempre
const redisCommandTimeoutMs = Number(process.env.REDIS_COMMAND_TIMEOUT_MS) || 1_000;
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: redisCommandTimeoutMs,
    })
  : undefined;
redis?.on('error', () => {}); // reconexão automática; falhas de cache/rate limit são registradas por requisição

const port = Number(process.env.API_PORT ?? 8080);
const hardening = hardeningFromEnv();
const app = buildServer({
  ...hardening,
  ...(db ? { db } : {}),
  ...(redis ? { redis } : {}),
  logger: true,
  changeFeed: true,
  realtime: {
    maxConnectionsPerTenant: Number(process.env.SSE_MAX_CONNECTIONS_PER_TENANT ?? 100),
    // segredo do token curto do SSE: o mesmo em todas as instâncias (sem ele, um aleatório por processo)
    streamTokenSecret: process.env.STREAM_TOKEN_SECRET,
  },
  ...(process.env.ASSETS_PUBLIC_BASE_URL ? { assetsBaseUrl: process.env.ASSETS_PUBLIC_BASE_URL } : {}),
  customLogos: true,
  ...(process.env.RULES_DIR ? { rulesDir: process.env.RULES_DIR } : {}),
  ...(mediaDenylist ? { mediaDenylist } : {}),
  publicUrl: process.env.API_PUBLIC_URL ?? `http://localhost:${port}`,
  lineup: { minReviewStatus: lineupMinReview },
  semantic: {
    minReviewStatus: minReviewStatus ?? 'approved',
    ...(process.env.KNOWLEDGE_DIR ? { knowledgeDir: process.env.KNOWLEDGE_DIR } : {}),
  },
});

if (hardening.admin && !hardening.admin.ipAllowlist?.length)
  app.log.warn(
    'ADMIN_IP_ALLOWLIST vazia: /internal/admin aceita qualquer IP (use só atrás de VPN/rede privada).',
  );

const shutdown = async () => {
  await app.close();
  redis?.disconnect();
  if (db) await closeDb(db);
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await app.listen({ host: '0.0.0.0', port });
