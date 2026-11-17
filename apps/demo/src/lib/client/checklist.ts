/**
 * Leitura do checklist da primeira sessão (F3, decisão 10), só no servidor: o que o banco diz sobre a marca, no formato
 * que `checklist-shared.ts` deriva em passos. Lê pelo pool do console (`api.api_key`, `ops.publishable_key`,
 * `api.tenant_member`, `billing.organization_member`, `ops.widget`); nada aqui escreve.
 */
import { pool } from '@/lib/auth/db';
import { REGISTRY_BASE_URL } from '@/lib/builder/config';
import { PUBLIC_API_URL } from '@/lib/galaxie/request';

import {
  checklistSteps,
  checklistVisible,
  sampleWidgetEmbed,
  testKeyCurl,
  type ChecklistFacts,
  type ChecklistView,
} from './checklist-shared';
import type { TenantInfo } from './tenants';

/** Banco sem alguma tabela (migrations atrasadas): o checklist não aparece, sem alarde. */
const isMissingTable = (err: unknown) => (err as { code?: string }).code === '42P01';

interface KeyRow {
  prefix: string;
  last_used_at: Date | null;
}

export async function loadChecklistFacts(tenant: Pick<TenantInfo, 'id' | 'state'>): Promise<ChecklistFacts> {
  const [testKey, publishable, others, widget] = await Promise.all([
    pool.query<KeyRow>(
      `select prefix, last_used_at
           from api.api_key
          where tenant_id = $1 and env = 'test' and revoked_at is null
            and (expires_at is null or expires_at > now())
          order by last_used_at desc nulls last, created_at
          limit 1`,
      [tenant.id],
    ),
    pool.query<KeyRow>(
      `select prefix, last_used_at
           from ops.publishable_key
          where tenant_id = $1 and revoked_at is null
          order by last_used_at desc nulls last, created_at
          limit 1`,
      [tenant.id],
    ),
    // quem criou a marca é o primeiro cargo gravado nela; conta quem mais já aceitou, na marca ou na organização
    pool.query<{ n: number }>(
      `with creator as (
           select user_id from api.tenant_member
            where tenant_id = $1 and user_id is not null
            order by created_at limit 1
         ), accepted as (
           select user_id from api.tenant_member
            where tenant_id = $1 and user_id is not null and accepted_at is not null
           union
           select om.user_id from billing.organization_member om
             join api.tenant t on t.organization_id = om.organization_id
            where t.id = $1 and om.accepted_at is not null
         )
         select count(*)::int as n from accepted
          where user_id <> coalesce((select user_id from creator), '')`,
      [tenant.id],
    ),
    pool.query<{ id: string }>(
      `select id::text from ops.widget
          where tenant_id = $1 and archived_at is null
          order by created_at limit 1`,
      [tenant.id],
    ),
  ]);
  const key = (r: KeyRow | undefined) => (r ? { prefix: r.prefix, used: r.last_used_at !== null } : null);
  return {
    state: tenant.state,
    testKey: key(testKey.rows[0]),
    publishableKey: key(publishable.rows[0]),
    acceptedOthers: others.rows[0]?.n ?? 0,
    sampleWidgetId: widget.rows[0]?.id ?? null,
  };
}

/**
 * Monta o checklist da marca, ou null quando ele não deve aparecer (tudo feito, estado fora de teste/ativo) ou quando a
 * leitura falhou: o checklist é acessório, a visão geral não cai por ele (o erro vai para o log).
 */
export async function loadChecklist(
  tenant: Pick<TenantInfo, 'id' | 'state'>,
  secretPlaceholder: string,
): Promise<ChecklistView | null> {
  let facts: ChecklistFacts;
  try {
    facts = await loadChecklistFacts(tenant);
  } catch (err) {
    if (!isMissingTable(err))
      console.error('[checklist] leitura falhou; a visão geral segue sem o checklist', err);
    return null;
  }
  const steps = checklistSteps(facts);
  if (!checklistVisible(facts, steps)) return null;
  return {
    tenantId: tenant.id,
    steps,
    curl: facts.testKey ? testKeyCurl(PUBLIC_API_URL, facts.testKey.prefix, secretPlaceholder) : null,
    embed: facts.sampleWidgetId
      ? sampleWidgetEmbed(REGISTRY_BASE_URL, facts.sampleWidgetId, facts.publishableKey?.prefix ?? null)
      : null,
  };
}
