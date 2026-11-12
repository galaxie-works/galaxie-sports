/**
 * Ajuda de integração da Cosmos (#1007), no servidor: lê os fatos do próprio tenant (erros de acesso, chaves sem
 * segredo, entregas de webhook e uso do mês), chama a função pela carteira (`runCosmosTask`) e confere a resposta.
 * Sem fatos, responde "nada encontrado" sem chamar o modelo e sem cobrar.
 */
import {
  listTenantSecretKeyStates,
  listTenantUsageByRoute,
  listTenantWebhookFailures,
  sumTenantAccessErrors,
} from '@galaxie/db';
import { listTenantWebhooks } from '@galaxie/db/webhooks';
import { activeFunctionMinCredits, parseModelJson, readCosmosSettings, runCosmosTask } from '@galaxie/cosmos';

import { builderDb, listPublishableKeys } from '@/lib/builder/store';
import type { ClientContext } from '@/lib/client/session';
import type { Locale } from '@/lib/i18n/config';

import {
  HELP_FUNCTION,
  HELP_MAX_OUTPUT_TOKENS,
  hasFacts,
  KEY_DIAGNOSE_DAYS,
  keyDiagnosePrompt,
  factUrls,
  keyFacts,
  parseHelpAnswer,
  usageFacts,
  usageReportPrompt,
  webhookDiagnosePrompt,
  webhookFacts,
  type HelpAnswer,
  type HelpKind,
  type KeyFact,
} from './integration-help';
import { widgetTaskAccess, type WidgetTaskError } from './widget-tasks';

export type HelpTaskError = WidgetTaskError | 'notFound';

export type HelpTaskResult = { ok: true; answer: HelpAnswer | null } | { ok: false; error: HelpTaskError };

/** Mesma regra das funções do Builder: quem edita as configurações (`settings.manage`) com a Cosmos contratada. */
export const helpAccess = widgetTaskAccess;

/** Mínimo de cada função para o aviso de custo; null = função fora do catálogo (o cartão some). */
export async function helpMinimum(kind: HelpKind): Promise<number | null> {
  return activeFunctionMinCredits(builderDb(), HELP_FUNCTION[kind]);
}

const LANGUAGE: Record<Locale, string> = {
  'pt-BR': 'Brazilian Portuguese',
  'es-AR': 'Spanish',
  en: 'English',
};

const SCREEN: Record<HelpKind, string> = {
  keys: '/cliente/chaves',
  webhooks: '/cliente/webhooks',
  usage: '/cliente',
};

async function run(
  ctx: ClientContext,
  kind: HelpKind,
  prompt: { system: string; message: string },
  facts: unknown,
  metadata: Record<string, unknown>,
): Promise<HelpTaskResult> {
  const db = builderDb();
  const allowedUrls = factUrls(facts);
  const r = await runCosmosTask(
    db,
    {
      tenantId: ctx.tenant!.id,
      userId: ctx.userId,
      functionName: HELP_FUNCTION[kind],
      scope: 'integration',
      system: prompt.system,
      message: prompt.message,
      maxOutputTokens: HELP_MAX_OUTPUT_TOKENS[kind],
      metadata,
      evaluate: async (text) => {
        const answer = parseHelpAnswer(parseModelJson(text), allowedUrls);
        return { usable: answer !== null, value: answer };
      },
      ...(ctx.role === 'admin' ? { staff: { route: `${SCREEN[kind]}#cosmos-${kind}` } } : {}),
    },
    { settings: await readCosmosSettings(db) },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, answer: r.value };
}

/**
 * Endereço do receptor sem usuário, senha, query nem fragmento: um token na query (`?token=…`) não vai ao provedor
 * do modelo.
 */
export function publicUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(endereço inválido)';
  }
}

const limitsOf = (tenant: NonNullable<ClientContext['tenant']>) => ({
  perMinute: tenant.rateLimitPerMinute,
  dailyQuota: tenant.dailyRequestQuota,
});

/** Chaves do tenant, só com o que é público (prefixo, ambiente, situação, origens). */
async function tenantKeys(tenantId: string, now: Date): Promise<KeyFact[]> {
  const db = builderDb();
  const [secret, publishable] = await Promise.all([
    listTenantSecretKeyStates(db, tenantId),
    listPublishableKeys(db, tenantId),
  ]);
  return [
    ...secret.map((k): KeyFact => ({
      prefix: k.prefix,
      kind: 'secret',
      env: k.env,
      state: k.revokedAt ? 'revoked' : k.expiresAt && k.expiresAt <= now ? 'expired' : 'active',
      name: k.label,
    })),
    ...publishable.map((k): KeyFact => ({
      prefix: k.prefix,
      kind: 'publishable',
      env: k.env,
      state: k.revokedAt ? 'revoked' : 'active',
      origins: k.allowedOrigins,
      name: k.name,
    })),
  ];
}

export async function diagnoseKeys(
  ctx: ClientContext,
  locale: Locale,
  now = new Date(),
): Promise<HelpTaskResult> {
  const denied = helpAccess(ctx);
  if (denied) return { ok: false, error: denied };
  const tenant = ctx.tenant!;
  const [keys, errors] = await Promise.all([
    tenantKeys(tenant.id, now),
    sumTenantAccessErrors(builderDb(), tenant.id, { days: KEY_DIAGNOSE_DAYS, limit: 200, now }),
  ]);
  const facts = keyFacts({
    keys,
    errors: errors.map((e) => ({ ...e, day: e.lastDay })),
    limits: limitsOf(tenant),
    modules: tenant.modules,
  });
  if (!hasFacts('keys', facts)) return { ok: true, answer: null };
  return run(ctx, 'keys', keyDiagnosePrompt(facts, LANGUAGE[locale]), facts, { errors: facts.errors.length });
}

export async function diagnoseWebhook(
  ctx: ClientContext,
  endpointId: string,
  locale: Locale,
): Promise<HelpTaskResult> {
  const denied = helpAccess(ctx);
  if (denied) return { ok: false, error: denied };
  const tenant = ctx.tenant!;
  const db = builderDb();
  // o endpoint vem da lista do próprio tenant: id de outro tenant não existe para quem pede
  const endpoint = (await listTenantWebhooks(db, tenant.id)).find((w) => w.id === endpointId);
  if (!endpoint) return { ok: false, error: 'notFound' };
  const failures = await listTenantWebhookFailures(db, tenant.id, endpoint.id, 50);
  const facts = webhookFacts({
    endpoint: {
      url: publicUrl(endpoint.url),
      active: endpoint.active,
      topics: endpoint.topics,
      pending: endpoint.pending,
      dead: endpoint.dead,
      delivered24h: endpoint.delivered24h,
    },
    deliveries: failures.map((d) => ({ ...d, at: d.at.toISOString() })),
  });
  if (!hasFacts('webhooks', facts)) return { ok: true, answer: null };
  return run(ctx, 'webhooks', webhookDiagnosePrompt(facts, LANGUAGE[locale]), facts, {
    failures: facts.failures.length,
  });
}

export async function reportUsage(
  ctx: ClientContext,
  locale: Locale,
  now = new Date(),
): Promise<HelpTaskResult> {
  const denied = helpAccess(ctx);
  if (denied) return { ok: false, error: denied };
  const tenant = ctx.tenant!;
  const db = builderDb();
  const monthStart = `${now.toISOString().slice(0, 7)}-01`;
  const [rows, errors] = await Promise.all([
    listTenantUsageByRoute(db, tenant.id, monthStart),
    sumTenantAccessErrors(db, tenant.id, { days: now.getUTCDate(), limit: 1000, now }),
  ]);
  const facts = usageFacts({
    now,
    rows,
    errors,
    limits: limitsOf(tenant),
    modules: tenant.modules,
  });
  if (!hasFacts('usage', facts)) return { ok: true, answer: null };
  return run(ctx, 'usage', usageReportPrompt(facts, LANGUAGE[locale]), facts, { month: facts.month });
}
