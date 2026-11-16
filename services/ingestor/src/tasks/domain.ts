/**
 * `tenant.verify_domain` (#1136, F2): confere o registro TXT `_galaxie-verify.<host>` de um domínio da marca
 * (`billing.domain`). Se algum valor é igual ao `txt_token`, grava `verified_at = now()`; sempre grava
 * `last_checked_at` e `last_error` (null quando bateu). Idempotente: domínio já comprovado só atualiza a conferência;
 * domínio apagado antes da tomada encerra sem erro. Um host comprovado é de uma marca só (índice parcial do banco):
 * a gravação que colide vira `last_error`, não falha da tarefa.
 */
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';
import { eq } from 'drizzle-orm';
import { domain, type Database } from '@galaxie/db';
import type { TaskHandler } from './run.js';

/** Nome do registro TXT que o cliente publica (o mesmo do painel). */
export const DOMAIN_TXT_PREFIX = '_galaxie-verify';
export const txtRecordName = (host: string) => `${DOMAIN_TXT_PREFIX}.${host}`;

export interface DomainRecord {
  id: string;
  host: string;
  txtToken: string;
  verifiedAt: Date | null;
}

export interface DomainVerifyDeps {
  /** Registros TXT do nome (cada registro vem em pedaços, como o `node:dns` devolve). Lança quando o nome não existe. */
  resolveTxt: (name: string) => Promise<string[][]>;
  load: (db: Database, id: string) => Promise<DomainRecord | null>;
  save: (
    db: Database,
    id: string,
    patch: { verifiedAt?: Date; lastCheckedAt: Date; lastError: string | null },
  ) => Promise<void>;
  now?: () => Date;
}

export const pgDomainStore: Pick<DomainVerifyDeps, 'load' | 'save'> = {
  async load(db, id) {
    const [row] = await db
      .select({ id: domain.id, host: domain.host, txtToken: domain.txtToken, verifiedAt: domain.verifiedAt })
      .from(domain)
      .where(eq(domain.id, id))
      .limit(1);
    return row ?? null;
  },
  async save(db, id, patch) {
    await db
      .update(domain)
      .set({
        ...(patch.verifiedAt ? { verifiedAt: patch.verifiedAt } : {}),
        lastCheckedAt: patch.lastCheckedAt,
        lastError: patch.lastError,
        updatedAt: patch.lastCheckedAt,
      })
      .where(eq(domain.id, id));
  },
};

/** Mensagem curta do erro de DNS (o cliente vê no painel). */
function dnsError(err: unknown): string {
  const code = (err as { code?: string }).code;
  if (code === 'ENOTFOUND' || code === 'ENODATA') return 'TXT não encontrado';
  if (code === 'ETIMEOUT' || code === 'ECONNREFUSED') return 'DNS sem resposta';
  return `DNS: ${code ?? (err instanceof Error ? err.message : String(err))}`.slice(0, 200);
}

/** Algum registro TXT (pedaços juntados, aparado) é igual ao token? */
export const txtMatches = (records: string[][], token: string) =>
  records.some((chunks) => chunks.join('').trim() === token);

export function tenantVerifyDomain(
  deps: DomainVerifyDeps = { resolveTxt: dnsResolveTxt, ...pgDomainStore },
): TaskHandler {
  return async ({ db, params, save: checkpoint }) => {
    const id = String(params.domainId);
    const now = deps.now?.() ?? new Date();
    const record = await deps.load(db, id);
    if (!record) return { detail: `domínio ${id} não existe mais`, stats: { encontrado: 0 } };
    const name = txtRecordName(record.host);
    let records: string[][] = [];
    let error: string | null = null;
    try {
      records = await deps.resolveTxt(name);
    } catch (err) {
      error = dnsError(err);
    }
    const matched = error === null && txtMatches(records, record.txtToken);
    if (!matched && error === null) error = `TXT em ${name} não tem o valor esperado`;
    try {
      await deps.save(db, id, {
        ...(matched && !record.verifiedAt ? { verifiedAt: now } : {}),
        lastCheckedAt: now,
        lastError: matched ? null : error,
      });
    } catch (err) {
      // o host já está comprovado por outra marca (índice parcial): fica registrado, sem nova tentativa
      const code = (err as { code?: string }).code;
      if (code !== '23505') throw err;
      await deps.save(db, id, { lastCheckedAt: now, lastError: 'host já comprovado por outra marca' });
      return { detail: `${record.host}: já comprovado por outra marca`, stats: { comprovado: 0 } };
    }
    await checkpoint({ log: [`${name}: ${matched ? 'bateu' : (error ?? 'não bateu')}`] });
    return {
      detail: matched ? `${record.host} comprovado` : `${record.host}: ${error}`,
      stats: { comprovado: matched ? 1 : 0, registros: records.length },
    };
  };
}
