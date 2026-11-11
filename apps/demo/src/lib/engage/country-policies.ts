/**
 * Ficha por país (#954), só no servidor: lista, histórico e gravação das fichas da Galaxie e os países de cada
 * cliente. As regras (o que é ficha válida, a trava dos 18 anos, o que o cliente pode endurecer) ficam em
 * `@galaxie/engage`; aqui a gravação, com versão e histórico na mesma transação.
 */
import {
  hardenPolicy,
  isPolicyKey,
  normalizePolicy,
  policyChangeIssues,
  type CountryPolicy,
  type PolicyHardening,
  type PolicyIssue,
  type TenantCountry,
} from '@galaxie/engage';

import { pool } from '@/lib/auth/db';

export interface PolicyRow {
  country: string;
  policy: CountryPolicy;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface PolicyLogRow {
  country: string;
  version: number;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

export class PolicyError extends Error {
  constructor(
    readonly code: 'invalid' | 'stale' | 'exists' | 'not_found' | 'no_policy' | 'primary',
    readonly issues: PolicyIssue[] = [],
  ) {
    super(code);
    this.name = 'PolicyError';
  }
}

export async function listPolicies(): Promise<PolicyRow[]> {
  const { rows } = await pool.query<{
    country: string;
    policy: CountryPolicy;
    version: number;
    updated_by: string;
    updated_at: Date;
  }>(`select country, policy, version, updated_by, updated_at from engage.country_policy order by country`);
  return rows.map((r) => ({
    country: r.country,
    policy: r.policy,
    version: r.version,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at.toISOString(),
  }));
}

export async function policyLog(limit = 50): Promise<PolicyLogRow[]> {
  const { rows } = await pool.query<{
    country: string;
    version: number;
    changed_by: string;
    reason: string | null;
    created_at: Date;
  }>(
    `select country, version, changed_by, reason, created_at from engage.country_policy_log
      order by created_at desc, version desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    country: r.country,
    version: r.version,
    changedBy: r.changed_by,
    reason: r.reason,
    changedAt: r.created_at.toISOString(),
  }));
}

/**
 * Grava a ficha (nova ou nova versão). `expectedVersion` é a versão que a tela abriu (null = país novo): se outra
 * pessoa gravou antes, recusa com `stale` em vez de sobrescrever.
 */
export async function savePolicy(input: {
  country: string;
  policy: CountryPolicy;
  expectedVersion: number | null;
  reason: string | null;
  allowLowerWriteAge: boolean;
  actor: string;
}): Promise<{ version: number }> {
  const country = input.country.trim().toUpperCase();
  if (!isPolicyKey(country))
    throw new PolicyError('invalid', [{ path: 'country', message: 'ISO 3166-1 alfa-2' }]);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ policy: CountryPolicy; version: number }>(
      `select policy, version from engage.country_policy where country = $1 for update`,
      [country],
    );
    const prev = rows[0] ?? null;
    if (prev && input.expectedVersion === null) throw new PolicyError('exists');
    if ((prev?.version ?? null) !== input.expectedVersion) throw new PolicyError('stale');
    const issues = policyChangeIssues(prev?.policy ?? null, input.policy, {
      allowLowerWriteAge: input.allowLowerWriteAge,
    });
    if (issues.length) throw new PolicyError('invalid', issues);
    const policy = normalizePolicy(input.policy);
    const version = (prev?.version ?? 0) + 1;
    await client.query(
      `insert into engage.country_policy (country, policy, version, updated_by, updated_at)
       values ($1, $2::jsonb, $3, $4, now())
       on conflict (country) do update set policy = excluded.policy, version = excluded.version,
         updated_by = excluded.updated_by, updated_at = now()`,
      [country, JSON.stringify(policy), version, input.actor],
    );
    await client.query(
      `insert into engage.country_policy_log (country, version, policy, changed_by, reason)
       values ($1, $2, $3::jsonb, $4, $5)`,
      [country, version, JSON.stringify(policy), input.actor, input.reason?.trim() || null],
    );
    await client.query('commit');
    return { version };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    // duas criações do mesmo país ao mesmo tempo: a segunda bate no índice único do histórico
    if ((err as { code?: string }).code === '23505') throw new PolicyError('stale');
    throw err;
  } finally {
    client.release();
  }
}

export async function listTenantCountries(tenantId: string): Promise<TenantCountry[]> {
  const { rows } = await pool.query<{
    country: string;
    is_primary: boolean;
    hardening: PolicyHardening | null;
  }>(
    `select country, is_primary, hardening from engage.tenant_country where tenant_id = $1 order by country`,
    [tenantId],
  );
  return rows.map((r) => ({ country: r.country, primary: r.is_primary, hardening: r.hardening }));
}

/**
 * Troca os países do cliente de uma vez. Cada país precisa de ficha (própria ou LATAM não serve: o cliente marca
 * país, não região), um e só um é o principal, e o endurecimento só passa se não afrouxar nada.
 */
export async function setTenantCountries(
  tenantId: string,
  countries: TenantCountry[],
  actor: string,
): Promise<void> {
  const list = countries.map((c) => ({ ...c, country: c.country.trim().toUpperCase() }));
  if (list.length && list.filter((c) => c.primary).length !== 1) throw new PolicyError('primary');
  if (new Set(list.map((c) => c.country)).size !== list.length)
    throw new PolicyError('invalid', [{ path: 'country', message: 'país repetido' }]);
  const policies = new Map((await listPolicies()).map((p) => [p.country, p.policy]));
  for (const c of list) {
    if (!/^[A-Z]{2}$/.test(c.country))
      throw new PolicyError('invalid', [{ path: c.country, message: 'ISO2' }]);
    const policy = policies.get(c.country);
    if (!policy) throw new PolicyError('no_policy', [{ path: c.country, message: 'sem ficha' }]);
    if (c.hardening) {
      const { rejected } = hardenPolicy(policy, c.hardening);
      if (rejected.length)
        throw new PolicyError(
          'invalid',
          rejected.map((path) => ({ path: `${c.country}.${path}`, message: 'só pode endurecer' })),
        );
    }
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`delete from engage.tenant_country where tenant_id = $1`, [tenantId]);
    for (const c of list)
      await client.query(
        `insert into engage.tenant_country (tenant_id, country, is_primary, hardening, updated_by)
         values ($1, $2, $3, $4::jsonb, $5)`,
        [tenantId, c.country, c.primary, c.hardening ? JSON.stringify(c.hardening) : null, actor],
      );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Países de todos os clientes, agrupados por cliente (a tela de Ajustes carrega tudo de uma vez). */
export async function allTenantCountries(): Promise<Map<string, TenantCountry[]>> {
  const { rows } = await pool.query<{
    tenant_id: string;
    country: string;
    is_primary: boolean;
    hardening: PolicyHardening | null;
  }>(
    `select tenant_id::text, country, is_primary, hardening from engage.tenant_country order by tenant_id, country`,
  );
  const out = new Map<string, TenantCountry[]>();
  for (const r of rows) {
    const list = out.get(r.tenant_id) ?? [];
    list.push({ country: r.country, primary: r.is_primary, hardening: r.hardening });
    out.set(r.tenant_id, list);
  }
  return out;
}
