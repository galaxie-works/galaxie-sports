/**
 * Registro dos e-mails do ciclo de vida do tenant (`billing.tenant_notification`, plataforma comercial F3, decisão 11)
 * e quem os recebe. Mora aqui porque o console (boas-vindas, no provisionamento) e o worker (lembretes do trial, trial
 * vencido, teste de módulo acabando, suspensão e cancelamento, na tarefa `tenant.lifecycle`) gravam o mesmo registro e
 * escolhem os destinatários pela mesma regra; nenhum dos dois importa o outro. Os **textos** não moram aqui: cada
 * processo tem os seus (a demo no dicionário de i18n, o worker em `services/ingestor/src/mail`).
 *
 * Idempotência: `claimTenantNotification` grava a linha antes do envio (`insert ... on conflict do nothing`); null = já
 * registrado, nada a enviar. Depois do envio, `markTenantNotificationSent`; se o envio falhou, `releaseTenantNotification`
 * apaga a linha para a próxima rodada tentar de novo. Sem SMTP ou sem destinatário a linha fica com `sent_at` nulo:
 * registrado sem entrega.
 *
 * Destinatários: os Donos e o Financeiro da organização (`billing.organization_member`, cargos `owner` e `billing`), com
 * o e-mail lido da tabela `user` do Better Auth, que vive no schema do console (`demo_auth`, a `AUTH_SCHEMA` de
 * `apps/demo/src/lib/auth/db.ts`; quem roda noutro schema passa `authSchema`). Convite ainda não aceito e dentro do
 * prazo conta (o Dono convidado pela equipe precisa receber o que acontece com a conta dele); convite vencido sem
 * aceite, não.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { organization, tenant, tenantNotification, type TenantNotificationKind } from './schema/index.js';

/** Schema do Better Auth da demo (a mesma constante `AUTH_SCHEMA` de `apps/demo/src/lib/auth/db.ts`). */
export const DEFAULT_AUTH_SCHEMA = 'demo_auth';

/** Cargos da organização que recebem os e-mails do ciclo de vida. */
export const NOTIFICATION_ROLES = ['owner', 'billing'] as const;

/** O banco ou uma transação aberta do Drizzle. */
type Executor = Pick<Database, 'insert' | 'update' | 'delete' | 'select' | 'execute'>;

export interface TenantNotificationKey {
  tenantId: string;
  kind: TenantNotificationKind;
  /** Dia do lembrete, módulo, `state_since` em ISO 8601 ou vazio (padrão). */
  ref?: string;
}

/**
 * Registra o e-mail antes de enviar. Devolve o id da linha nova, ou null quando já havia (o e-mail já saiu, ou outra
 * rodada está enviando agora): quem chama não envia.
 */
export async function claimTenantNotification(
  db: Executor,
  key: TenantNotificationKey,
): Promise<string | null> {
  const [row] = await db
    .insert(tenantNotification)
    .values({ tenantId: key.tenantId, kind: key.kind, ref: key.ref ?? '' })
    .onConflictDoNothing({
      target: [tenantNotification.tenantId, tenantNotification.kind, tenantNotification.ref],
    })
    .returning({ id: tenantNotification.id });
  return row?.id ?? null;
}

/** O e-mail saiu: grava quando e para quem. `delivered = false` grava só os destinatários (registrado sem entrega). */
export async function markTenantNotificationSent(
  db: Executor,
  id: string,
  input: { recipients: readonly string[]; delivered: boolean; at?: Date },
): Promise<void> {
  await db
    .update(tenantNotification)
    .set({ recipients: [...input.recipients], sentAt: input.delivered ? (input.at ?? new Date()) : null })
    .where(eq(tenantNotification.id, id));
}

/** O envio falhou: apaga o registro para a próxima rodada tentar de novo. */
export async function releaseTenantNotification(db: Executor, id: string): Promise<void> {
  await db.delete(tenantNotification).where(eq(tenantNotification.id, id));
}

/** Já há registro deste e-mail para o tenant? (leitura; o `claim` é quem decide o envio) */
export async function hasTenantNotification(db: Executor, key: TenantNotificationKey): Promise<boolean> {
  const [row] = await db
    .select({ id: tenantNotification.id })
    .from(tenantNotification)
    .where(
      and(
        eq(tenantNotification.tenantId, key.tenantId),
        eq(tenantNotification.kind, key.kind),
        eq(tenantNotification.ref, key.ref ?? ''),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export interface NotificationRecipient {
  email: string;
  name: string | null;
  role: (typeof NOTIFICATION_ROLES)[number];
}

export interface TenantNotificationAudience {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  organizationId: string | null;
  organizationName: string | null;
  /** `billing.organization.locale` como gravado (`pt-BR`, `en`, `es-AR`…); null sem organização ou sem idioma. */
  locale: string | null;
  recipients: NotificationRecipient[];
}

/**
 * Quem recebe os e-mails do tenant e em que idioma: os Donos e o Financeiro da organização da marca, com e-mail, um
 * por endereço (minúsculas). Tenant sem organização (legado) devolve a lista vazia: nada a enviar. null = tenant não
 * existe. O convite pendente conta até `expires_at`, comparado com `options.at` (o relógio de quem chama, como o
 * `now` do `tenant.lifecycle`); sem `at`, o relógio do banco.
 */
export async function tenantNotificationAudience(
  db: Executor,
  tenantId: string,
  options: { authSchema?: string; at?: Date } = {},
): Promise<TenantNotificationAudience | null> {
  const schema = options.authSchema ?? DEFAULT_AUTH_SCHEMA;
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Schema do auth inválido: ${schema}`);
  const [t] = await db
    .select({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      organizationId: tenant.organizationId,
      organizationName: organization.name,
      locale: organization.locale,
    })
    .from(tenant)
    .leftJoin(organization, eq(organization.id, tenant.organizationId))
    .where(eq(tenant.id, tenantId))
    .limit(1);
  if (!t) return null;
  const audience: TenantNotificationAudience = {
    tenantId: t.id,
    tenantName: t.name,
    tenantSlug: t.slug,
    organizationId: t.organizationId,
    organizationName: t.organizationName,
    locale: t.locale,
    recipients: [],
  };
  if (!t.organizationId) return audience;
  let rows: { email: string | null; name: string | null; role: string }[];
  try {
    rows = await db.execute<{ email: string | null; name: string | null; role: string }>(sql`
      select lower(u.email) as email, u.name, om.role
        from billing.organization_member om
        join ${sql.raw(`"${schema}"."user"`)} u on u.id = om.user_id
       where om.organization_id = ${t.organizationId}
         and om.role in ('owner', 'billing')
         and (om.accepted_at is not null or om.expires_at is null or om.expires_at > ${options.at ? sql`${options.at.toISOString()}::timestamptz` : sql`now()`})
       order by case om.role when 'owner' then 0 else 1 end, om.created_at`);
  } catch (err) {
    // banco sem o schema do console (ensaio fora do ambiente da demo): ninguém a avisar, nada a derrubar
    if ((err as { code?: string }).code === '42P01') return audience;
    throw err;
  }
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.email || seen.has(r.email)) continue;
    seen.add(r.email);
    audience.recipients.push({
      email: r.email,
      name: r.name,
      role: r.role === 'billing' ? 'billing' : 'owner',
    });
  }
  return audience;
}
