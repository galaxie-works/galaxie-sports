/**
 * Controle dos webhooks pela operação (Ajustes → Webhooks da demo, e o worker que obedece): pausa geral das
 * entregas, recusa de segredo em texto puro, a cifra dos segredos legados e o retrato do que está ligado.
 *
 * Os controles moram em ops.runtime_setting (com histórico em runtime_setting_log, como as outras flags do painel)
 * e o worker relê a cada `WEBHOOK_CONTROLS_REFRESH_MS`. A KEK nunca passa por aqui: ela fica no `.env` da VPS,
 * fora do banco que ela protege. O painel só sabe se cada processo a tem (o worker relata em ops.runtime_env).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { readRuntimeOverrides, reportRuntimeEnv, writeRuntimeSetting } from './runtime-settings.js';
import { runtimeEnv, webhookEndpoint } from './schema/index.js';
import { WEBHOOK_KEK_ENV, WEBHOOK_REJECT_PLAINTEXT_ENV, WebhookSecretBox } from './webhook-secret-box.js';

/** Pausa geral: `off` = o worker não entrega nada (continua enfileirando; ao religar, sai tudo). */
export const WEBHOOK_DELIVERY_SETTING = 'WEBHOOK_DELIVERY';
export { WEBHOOK_REJECT_PLAINTEXT_ENV };
/** Nome do serviço do worker em ops.runtime_env. */
export const WEBHOOK_WORKER_SERVICE = 'webhooks';
/** O worker relê os controles (e relata que está no ar) neste intervalo. */
export const WEBHOOK_CONTROLS_REFRESH_MS = 15_000;
/** Sem relato há mais que isto, o painel mostra o worker como fora do ar. */
export const WEBHOOK_WORKER_ALIVE_MS = 3 * 60_000;

export interface WebhookControls {
  deliveryEnabled: boolean;
  rejectPlaintext: boolean;
}

/** Controles valendo: banco (painel) > env do processo > padrão (entregas ligadas, texto puro aceito). */
export async function readWebhookControls(
  db: Pick<Database, 'select'>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebhookControls> {
  const overrides = await readRuntimeOverrides(db);
  const reject = overrides.get(WEBHOOK_REJECT_PLAINTEXT_ENV) ?? env[WEBHOOK_REJECT_PLAINTEXT_ENV];
  return {
    deliveryEnabled: (overrides.get(WEBHOOK_DELIVERY_SETTING) ?? 'on') !== 'off',
    rejectPlaintext: reject === 'true',
  };
}

/** O worker relata o que vale nele: KEK presente (sem o valor), recusa de texto puro e pausa. */
export async function reportWebhookWorker(
  db: Database,
  state: { kekConfigured: boolean; rejectPlaintext: boolean; deliveryEnabled: boolean },
): Promise<void> {
  await reportRuntimeEnv(db, WEBHOOK_WORKER_SERVICE, [
    { key: WEBHOOK_KEK_ENV, value: null, configured: state.kekConfigured },
    {
      key: WEBHOOK_REJECT_PLAINTEXT_ENV,
      value: state.rejectPlaintext ? 'true' : 'false',
      configured: state.rejectPlaintext,
    },
    { key: WEBHOOK_DELIVERY_SETTING, value: state.deliveryEnabled ? 'on' : 'off', configured: true },
  ]);
}

export interface WebhookAdminOverview {
  endpoints: number;
  activeEndpoints: number;
  /** Segredos ainda em texto puro (legado, de antes da cifra). */
  plaintextSecrets: number;
  pending: number;
  dead: number;
  /** Atraso da entrega vencida mais antiga (s); 0 sem entrega vencida. */
  overdueSeconds: number;
  controls: WebhookControls;
  worker: {
    /** Último relato do worker; null = nunca relatou (versão sem o relato, ou nunca subiu). */
    reportedAt: Date | null;
    alive: boolean;
    /** KEK no worker; null = sem relato. */
    kekConfigured: boolean | null;
    /** O que o worker aplicou no último relato (pode atrasar até um ciclo em relação ao painel). */
    rejectPlaintext: boolean | null;
    deliveryEnabled: boolean | null;
  };
}

export async function webhookAdminOverview(
  db: Database,
  now: Date = new Date(),
): Promise<WebhookAdminOverview> {
  const [counts] = await db.execute<{
    endpoints: number;
    active: number;
    plaintext: number;
    pending: number;
    dead: number;
    overdue: number;
  }>(sql`
    select (select count(*)::int from api.webhook_endpoint) as endpoints,
           (select count(*)::int from api.webhook_endpoint where active) as active,
           (select count(*)::int from api.webhook_endpoint where secret not like 'enc:v1:%') as plaintext,
           (select count(*)::int from api.webhook_delivery where status = 'pending') as pending,
           (select count(*)::int from api.webhook_delivery where status = 'dead') as dead,
           coalesce((select extract(epoch from (now() - min(next_retry_at)))::float8
                       from api.webhook_delivery where status = 'pending' and next_retry_at <= now()), 0) as overdue`);
  const env = await db
    .select({
      key: runtimeEnv.key,
      value: runtimeEnv.value,
      configured: runtimeEnv.configured,
      at: runtimeEnv.reportedAt,
    })
    .from(runtimeEnv)
    .where(
      and(
        eq(runtimeEnv.service, WEBHOOK_WORKER_SERVICE),
        inArray(runtimeEnv.key, [WEBHOOK_KEK_ENV, WEBHOOK_REJECT_PLAINTEXT_ENV, WEBHOOK_DELIVERY_SETTING]),
      ),
    );
  const byKey = new Map(env.map((r) => [r.key, r]));
  const reportedAt = env.reduce<Date | null>((max, r) => (!max || r.at > max ? r.at : max), null);
  const kek = byKey.get(WEBHOOK_KEK_ENV);
  const reject = byKey.get(WEBHOOK_REJECT_PLAINTEXT_ENV);
  const delivery = byKey.get(WEBHOOK_DELIVERY_SETTING);
  return {
    endpoints: counts?.endpoints ?? 0,
    activeEndpoints: counts?.active ?? 0,
    plaintextSecrets: counts?.plaintext ?? 0,
    pending: counts?.pending ?? 0,
    dead: counts?.dead ?? 0,
    overdueSeconds: Math.max(0, Math.round(Number(counts?.overdue ?? 0))),
    // sem sobrescrita no painel, vale o env do worker (o .env da VPS), que ele relata
    controls: await readWebhookControls(db, { [WEBHOOK_REJECT_PLAINTEXT_ENV]: reject?.value ?? undefined }),
    worker: {
      reportedAt,
      alive: Boolean(reportedAt && now.getTime() - reportedAt.getTime() < WEBHOOK_WORKER_ALIVE_MS),
      kekConfigured: kek ? kek.configured : null,
      rejectPlaintext: reject ? reject.value === 'true' : null,
      deliveryEnabled: delivery ? delivery.value !== 'off' : null,
    },
  };
}

export class WebhookControlError extends Error {
  constructor(
    readonly code: 'plaintext_left' | 'no_kek',
    message: string,
  ) {
    super(message);
    this.name = 'WebhookControlError';
  }
}

/** Liga ou desliga as entregas (pausa geral), com histórico. */
export async function setWebhookDelivery(db: Database, enabled: boolean, by: string): Promise<void> {
  // ligar = voltar ao padrão (sem sobrescrita); desligar grava `off`
  await writeRuntimeSetting(db, {
    key: WEBHOOK_DELIVERY_SETTING,
    value: enabled ? null : 'off',
    valueType: 'enum',
    by,
  });
}

/**
 * Liga ou desliga a recusa de segredo em texto puro. Ligar com segredo legado no banco pararia as entregas
 * desses endpoints (o worker passaria a falhar cada tentativa até a DLQ), então é recusado até a cifra terminar.
 */
export async function setWebhookRejectPlaintext(db: Database, reject: boolean, by: string): Promise<void> {
  if (reject) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(webhookEndpoint)
      .where(sql`${webhookEndpoint.secret} not like 'enc:v1:%'`);
    if ((row?.n ?? 0) > 0)
      throw new WebhookControlError(
        'plaintext_left',
        `${row!.n} segredo(s) ainda em texto puro: cifre antes de recusar.`,
      );
  }
  await writeRuntimeSetting(db, {
    key: WEBHOOK_REJECT_PLAINTEXT_ENV,
    value: reject ? 'true' : 'false',
    valueType: 'enum',
    by,
  });
}

/**
 * Migração dos segredos: cifra os legados em texto puro e recifra os que usam uma KEK antiga (rotação).
 * Idempotente e segura com o worker no ar: cada linha só é trocada se o valor lido não mudou, e o worker
 * lê os dois formatos.
 */
export async function sealWebhookSecrets(
  db: Database,
  secrets: WebhookSecretBox,
): Promise<{ sealed: number; total: number; failed: { id: string; error: string }[] }> {
  if (!secrets.configured) throw new WebhookControlError('no_kek', `${WEBHOOK_KEK_ENV} não definida.`);
  const rows = await db
    .select({ id: webhookEndpoint.id, secret: webhookEndpoint.secret })
    .from(webhookEndpoint);
  let sealed = 0;
  // uma linha que não abre (KEK antiga ausente, dado corrompido) não impede as outras: vai para `failed`
  const failed: { id: string; error: string }[] = [];
  for (const r of rows) {
    if (!secrets.needsSeal(r.secret)) continue;
    try {
      // legado é lido direto (mesmo com a recusa de texto puro ligada, a migração precisa dele)
      const plain = WebhookSecretBox.isSealed(r.secret) ? secrets.open(r.secret, r.id) : r.secret;
      const updated = await db
        .update(webhookEndpoint)
        .set({ secret: secrets.seal(plain, r.id), updatedAt: new Date() })
        .where(and(eq(webhookEndpoint.id, r.id), eq(webhookEndpoint.secret, r.secret)))
        .returning({ id: webhookEndpoint.id });
      sealed += updated.length;
    } catch (err) {
      failed.push({ id: r.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sealed, total: rows.length, failed };
}
