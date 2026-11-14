/**
 * Rotas da verificação de idade feita pela Galaxie (#1109, módulo `age_verification`):
 *
 * - `POST /v1/fans/me/age-verification`: o torcedor (token `gft_`) abre a verificação e recebe a URL da tela do
 *   provedor;
 * - `GET /v1/fans/me/age-verification`: a última verificação do Perfil;
 * - `POST /webhooks/didit/age-verification`: o Didit avisa que a sessão mudou. Fora de `/internal` de propósito (é
 *   o provedor que chama) e autenticado pela assinatura dele, não por chave nossa. O corpo chega cru.
 *
 * Sem a chave, o segredo ou o workflow do provedor, as rotas respondem 503 e nada é aberto.
 */
import type { FastifyInstance } from 'fastify';
import {
  AgeVerificationStartBody,
  type AgeVerificationLatest,
  type AgeVerificationStart,
} from '@galaxie/contracts';
import { tenant as tenantTable, type Database } from '@galaxie/db';
import { and, eq, sql } from 'drizzle-orm';
import { problems } from '../errors.js';
import type { ModuleUsageMeter } from '../engage/module-usage.js';
import { fanCan } from '../engage/fan-rules.js';
import { readFan } from '../engage/fans.js';
import { parseInput } from '../util.js';
import { DiditClient, DiditError, verifyDiditWebhook, type DiditFetch } from './didit.js';
import {
  applyDiditEvent,
  latestAgeVerification,
  purgeAgeVerification,
  startAgeVerification,
  meterPending,
  sweepAgeVerifications,
} from './service.js';

export const DIDIT_WEBHOOK_PATH = '/webhooks/didit/age-verification';
const BODY_LIMIT = 512 * 1024;

export interface AgeVerificationConfig {
  apiKey?: string | undefined;
  workflowId?: string | undefined;
  /** Segredos do destino do webhook; vários separados por vírgula na troca (o primeiro é o atual). */
  webhookSecrets?: readonly string[] | undefined;
  baseUrl?: string | undefined;
  fetch?: DiditFetch | undefined;
}

export interface AgeVerificationDeps {
  db: Database | undefined;
  config: AgeVerificationConfig;
  meter?: (() => ModuleUsageMeter | undefined) | undefined;
  now?: (() => Date) | undefined;
}

/** Lê a configuração do ambiente (o painel de chaves grava as mesmas variáveis; valem ao reiniciar a API). */
export function ageVerificationConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AgeVerificationConfig {
  return {
    apiKey: env.DIDIT_API_KEY?.trim() || undefined,
    workflowId: env.DIDIT_WORKFLOW_ID?.trim() || undefined,
    webhookSecrets: (env.DIDIT_WEBHOOK_SECRET ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** Sem a chave, o workflow ou o segredo do webhook, nada abre: sessão sem webhook seria paga e nunca aplicada. */
function clientOf(config: AgeVerificationConfig): DiditClient | null {
  if (!config.apiKey || !config.workflowId || !config.webhookSecrets?.length) return null;
  return new DiditClient(
    {
      apiKey: config.apiKey,
      workflowId: config.workflowId,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    },
    config.fetch ?? fetch,
  );
}

async function tenantHasModule(db: Database, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({
      ok: sql<boolean>`'age_verification' = any(${tenantTable.modules}) and ${tenantTable.status} = 'active'`,
    })
    .from(tenantTable)
    .where(and(eq(tenantTable.id, tenantId)))
    .limit(1);
  return row?.ok === true;
}

/** Rotas do torcedor (no escopo das rotas /v1). */
export async function ageVerificationFanRoutes(
  app: FastifyInstance,
  deps: AgeVerificationDeps,
): Promise<void> {
  const client = clientOf(deps.config);
  const now = () => deps.now?.() ?? new Date();
  const db = () => {
    if (!deps.db) throw problems.degraded('Banco de dados não configurado.');
    return deps.db;
  };

  app.post('/v1/fans/me/age-verification', { config: { fan: true } }, async (request, reply) => {
    const fan = request.fan!;
    const database = db();
    if (!(await tenantHasModule(database, fan.tenantId))) throw problems.moduleNotInPlan('age_verification');
    // menor de 13 não passa o rosto por ninguém: o caminho dele é o responsável (#1108)
    if (!fanCan(fan.ageBand, 'read'))
      throw problems.fanAgeRestricted('Perfis com menos de 13 anos não fazem a verificação de idade.');
    const body = parseInput(AgeVerificationStartBody, request.body);
    if (!client) throw problems.degraded('Verificação de idade não configurada.');
    const profile = await readFan(database, fan.tenantId, fan.profileId);
    if (!profile) throw problems.invalidFanToken('Perfil excluído.');
    // a faixa gravada vale mais que a do token (o cliente pode ter descido o Perfil depois de emitir)
    if (!fanCan(profile.ageBand, 'read'))
      throw problems.fanAgeRestricted('Perfis com menos de 13 anos não fazem a verificação de idade.');
    // só origem e caminho vão ao provedor: query e fragmento podem levar dado do torcedor
    const back = new URL(body.returnUrl);
    back.search = '';
    back.hash = '';
    const at = now();
    let started;
    try {
      started = await startAgeVerification(database, client, {
        tenantId: fan.tenantId,
        profileId: fan.profileId,
        language: profile.locale.slice(0, 2).toLowerCase(),
        returnUrl: back.toString(),
        consent: { givenAt: new Date(body.consent.givenAt), textVersion: body.consent.textVersion },
        now: at,
      });
    } catch (err) {
      if (err instanceof DiditError) {
        request.log.warn({ err: err.message, status: err.status }, 'verificação de idade: provedor recusou');
        throw problems.degraded('Provedor da verificação de idade indisponível. Tente de novo em instantes.');
      }
      throw err;
    }
    if (!started) throw problems.rateLimited(3_600);
    reply.header('cache-control', 'no-store');
    const res: AgeVerificationStart = {
      data: {
        verification_id: started.id,
        status: 'pending',
        method: null,
        decided_at: null,
        created_at: started.createdAt.toISOString(),
        url: started.url,
        expires_at: started.expiresAt.toISOString(),
      },
    };
    return reply.code(201).send(res);
  });

  app.get('/v1/fans/me/age-verification', { config: { fan: true } }, async (request, reply) => {
    const fan = request.fan!;
    const database = db();
    if (!(await tenantHasModule(database, fan.tenantId))) throw problems.moduleNotInPlan('age_verification');
    const row = await latestAgeVerification(database, fan.tenantId, fan.profileId);
    reply.header('cache-control', 'no-store');
    const res: AgeVerificationLatest = {
      data: row
        ? {
            verification_id: row.id,
            status: row.status as AgeVerificationStart['data']['status'],
            method: row.method,
            decided_at: row.decidedAt?.toISOString() ?? null,
            created_at: row.createdAt.toISOString(),
          }
        : null,
    };
    return res;
  });
}

/** Webhook do provedor (escopo próprio: o corpo chega cru, para conferir a assinatura dos bytes). */
export async function ageVerificationWebhookRoutes(
  app: FastifyInstance,
  deps: AgeVerificationDeps,
): Promise<void> {
  const client = clientOf(deps.config);
  const secrets = deps.config.webhookSecrets ?? [];
  if (client && deps.db) {
    const stop = startAgeVerificationSweep(deps.db, client, app.log, () => deps.meter?.());
    app.addHook('onClose', async () => stop());
  }
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: BODY_LIMIT },
    (_req, body, done) => done(null, body),
  );

  app.post(
    DIDIT_WEBHOOK_PATH,
    // assinatura do Didit no lugar da chave (auditoria de rotas em security.test.ts)
    { config: { public: true, signed: 'didit' }, bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      if (!client || !secrets.length || !deps.db || !deps.config.workflowId)
        return reply.code(503).send({ error: 'age_verification_unavailable' });
      const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const now = deps.now?.() ?? new Date();
      const event = verifyDiditWebhook(request.headers, raw, secrets, now);
      if (!event) return reply.code(401).send({ error: 'invalid_signature' });
      // só eventos de sessão interessam (status.updated e data.updated)
      if (event.webhookType !== 'status.updated' && event.webhookType !== 'data.updated')
        return reply.code(200).send({ received: true, outcome: 'ignored' });
      let result;
      try {
        result = await applyDiditEvent(deps.db, client, event, {
          workflowId: deps.config.workflowId,
          meter: deps.meter?.(),
          now,
        });
      } catch (err) {
        // decisão indisponível: 503 e o provedor tenta de novo
        request.log.warn({ err, session: event.sessionId }, 'verificação de idade: decisão indisponível');
        return reply.code(503).send({ error: 'decision_unavailable' });
      }
      request.log.info(
        { session: event.sessionId, event: event.eventId, outcome: result.outcome },
        'verificação de idade: evento do provedor',
      );
      if (result.outcome === 'applied' && result.meterFailed)
        request.log.error(
          { session: event.sessionId },
          'verificação de idade: medidor fora, a soma fica para a varredura',
        );
      if (result.outcome === 'applied' && result.purge) {
        // depois da resposta: o provedor espera no máximo 5 s pelo 2xx
        const db = deps.db;
        setImmediate(() => {
          purgeAgeVerification(db, client, event.sessionId, new Date())
            .then((ok) => {
              if (!ok)
                request.log.warn(
                  { session: event.sessionId },
                  'verificação de idade: apagamento ficou para a varredura',
                );
            })
            .catch((err: unknown) =>
              request.log.warn(
                { err, session: event.sessionId },
                'verificação de idade: apagamento ficou para a varredura',
              ),
            );
        });
      }
      return reply.code(200).send({ received: true, outcome: result.outcome });
    },
  );
}

/** Varredura de hora em hora (`sweepAgeVerifications`); a primeira sai poucos minutos depois de subir. */
export function startAgeVerificationSweep(
  db: Database,
  client: DiditClient,
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void },
  meter: () => ModuleUsageMeter | undefined = () => undefined,
  everyMs = 3_600_000,
): () => void {
  const run = () => {
    meterPending(db, meter(), new Date())
      .then((m) => {
        if (m.metered || m.failed) log.warn(m, 'verificação de idade: somas atrasadas no medidor');
      })
      .catch((err: unknown) => log.warn({ err }, 'verificação de idade: soma atrasada falhou'));
    sweepAgeVerifications(db, client, new Date())
      .then((r) => {
        if (r.expired || r.purged || r.pending) log.info(r, 'verificação de idade: varredura');
        if (r.pending) log.warn(r, 'verificação de idade: sessões ainda não apagadas no provedor');
      })
      .catch((err: unknown) => log.warn({ err }, 'verificação de idade: varredura falhou'));
  };
  const first = setTimeout(run, Math.floor(60_000 + Math.random() * 240_000));
  first.unref();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
