/**
 * Domínios de uma marca comprovados por registro TXT (`billing.domain`, #1136 F2), só no servidor. O cliente cadastra
 * o host, publica `_galaxie-verify.<host>` TXT com o `txt_token` e pede a conferência; quem confere é a tarefa
 * `tenant.verify_domain` do worker (`@galaxie/db/queue-types`), que grava `verified_at`, `last_checked_at` e
 * `last_error`. O host comprovado ainda NÃO entra sozinho nas origens da chave publicável (fica para a F3).
 */
import { enqueue } from '@galaxie/db/queue';
import { TENANT_VERIFY_DOMAIN } from '@galaxie/db/queue-types';
import { domain } from '@galaxie/db/schema';
import { and, eq } from 'drizzle-orm';

import { pool } from '@/lib/auth/db';
import { builderDb } from '@/lib/builder/store';

import { isUuid } from './tenants';

/** O mesmo CHECK de `billing.domain.host`: rótulos de 1 a 63 caracteres, minúsculas, dígitos e hífen, dois ou mais. */
export const DOMAIN_HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
export const DOMAIN_HOST_MAX = 253;
/** Domínios por marca (teto da tela; o banco não limita). */
export const MAX_DOMAINS = 20;
/** Prefixo do registro TXT que o cliente publica. */
export const DOMAIN_TXT_PREFIX = '_galaxie-verify';

/** Host como o banco aceita: minúsculas, sem esquema, caminho, porta nem ponto final; null se não serve. */
export function normalizeDomainHost(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let host = value.trim().toLowerCase();
  host = host.replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host || host.length > DOMAIN_HOST_MAX || !DOMAIN_HOST_RE.test(host)) return null;
  return host;
}

/** Nome do registro TXT a criar para o host. */
export const txtRecordName = (host: string) => `${DOMAIN_TXT_PREFIX}.${host}`;

export interface DomainRow {
  id: string;
  host: string;
  txtToken: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** Conferência pedida e ainda na fila (pendente ou rodando). */
  checking: boolean;
}

export class DomainError extends Error {
  constructor(readonly code: 'invalid' | 'exists' | 'limit' | 'notFound' | 'taken') {
    super(code);
    this.name = 'DomainError';
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Domínios da marca, do mais novo ao mais antigo, com a tarefa de conferência em aberto, se houver. */
export async function listDomains(tenantId: string): Promise<DomainRow[]> {
  if (!isUuid(tenantId)) return [];
  const { rows } = await pool.query<{
    id: string;
    host: string;
    txt_token: string;
    verified_at: Date | null;
    last_checked_at: Date | null;
    last_error: string | null;
    created_at: Date;
    checking: boolean;
  }>(
    `select d.id::text, d.host, d.txt_token, d.verified_at, d.last_checked_at, d.last_error, d.created_at,
            exists (select 1 from ops.job_request r
                     where r.type = $2 and r.dedupe_key = d.id::text and r.status in ('pending', 'running')) as checking
       from billing.domain d
      where d.tenant_id = $1
      order by d.id desc`,
    [tenantId, TENANT_VERIFY_DOMAIN.type],
  );
  return rows.map((r) => ({
    id: r.id,
    host: r.host,
    txtToken: r.txt_token,
    verifiedAt: iso(r.verified_at),
    lastCheckedAt: iso(r.last_checked_at),
    lastError: r.last_error,
    createdAt: r.created_at.toISOString(),
    checking: r.checking,
  }));
}

/** Cadastra um host na marca. Já cadastrado → `exists`; comprovado por outra marca → `taken`. */
export async function addDomain(input: { tenantId: string; host: unknown; actor: string }): Promise<DomainRow> {
  const host = normalizeDomainHost(input.host);
  if (!host) throw new DomainError('invalid');
  const current = await listDomains(input.tenantId);
  if (current.length >= MAX_DOMAINS) throw new DomainError('limit');
  if (current.some((d) => d.host === host)) throw new DomainError('exists');
  const { rows: taken } = await pool.query(
    `select 1 from billing.domain where host = $1 and verified_at is not null and tenant_id <> $2`,
    [host, input.tenantId],
  );
  if (taken.length) throw new DomainError('taken');
  const [row] = await builderDb()
    .insert(domain)
    .values({ tenantId: input.tenantId, host, createdBy: input.actor })
    .onConflictDoNothing()
    .returning({ id: domain.id });
  if (!row) throw new DomainError('exists');
  const created = (await listDomains(input.tenantId)).find((d) => d.id === row.id);
  if (!created) throw new DomainError('notFound');
  return created;
}

/** Apaga o domínio da marca (o id de outra marca não acha nada). */
export async function removeDomain(tenantId: string, id: string): Promise<boolean> {
  if (!isUuid(id) || !isUuid(tenantId)) return false;
  const gone = await builderDb()
    .delete(domain)
    .where(and(eq(domain.tenantId, tenantId), eq(domain.id, id)))
    .returning({ id: domain.id });
  return gone.length > 0;
}

/**
 * Pede a conferência do TXT: enfileira `tenant.verify_domain` (uma viva por domínio, `dedupeKey` = id). Devolve
 * `created: false` quando já havia uma na fila.
 */
export async function requestDomainVerification(
  tenantId: string,
  id: string,
  requestedBy: string,
): Promise<{ created: boolean } | null> {
  if (!isUuid(id) || !isUuid(tenantId)) return null;
  const [found] = await builderDb()
    .select({ id: domain.id })
    .from(domain)
    .where(and(eq(domain.tenantId, tenantId), eq(domain.id, id)))
    .limit(1);
  if (!found) return null;
  const r = await enqueue(builderDb(), {
    type: TENANT_VERIFY_DOMAIN.type,
    params: { domainId: id },
    dedupeKey: id,
    maxAttempts: TENANT_VERIFY_DOMAIN.maxAttempts ?? 3,
    requestedBy,
  });
  return { created: r.created };
}
