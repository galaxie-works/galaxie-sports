/**
 * Relógios da ficha do país (D5) para uma decisão da fila: os do torcedor autor do caso, ou os do país principal do
 * cliente quando o caso não tem autor. Só servidor. Sem ficha, recusa: a fila não grava o que não sabe quando apagar.
 */
import type { ModerationClocks } from '@galaxie/db/moderation-queue';
import { resolvePolicy, retentionDeadlines, type CountryPolicy, type PolicyHardening } from '@galaxie/engage';

import { pool } from '@/lib/auth/db';

export class NoPolicyError extends Error {
  constructor() {
    super('no_policy');
  }
}

export async function clocksFor(
  tenantId: string,
  profileId: string | null,
  at: Date = new Date(),
): Promise<ModerationClocks> {
  const [policies, countries, fan] = await Promise.all([
    pool.query<{ country: string; policy: unknown }>('select country, policy from engage.country_policy'),
    pool.query<{ country: string; primary: boolean; hardening: unknown }>(
      'select country, is_primary as primary, hardening from engage.tenant_country where tenant_id = $1',
      [tenantId],
    ),
    profileId
      ? pool.query<{ country: string | null }>(
          'select country from fan.profile where tenant_id = $1 and id = $2 and deleted_at is null',
          [tenantId, profileId],
        )
      : Promise.resolve({ rows: [] as { country: string | null }[] }),
  ]);
  const resolved = resolvePolicy(
    fan.rows[0]?.country ?? null,
    new Map(policies.rows.map((p) => [p.country, p.policy as CountryPolicy])),
    countries.rows.map((c) => ({
      country: c.country,
      primary: c.primary,
      hardening: (c.hardening as PolicyHardening | null) ?? null,
    })),
  );
  if (!resolved) throw new NoPolicyError();
  const d = retentionDeadlines(resolved.policy, at.getTime());
  return { contentPurgeAt: new Date(d.contentPurgeAt), decisionPurgeAt: new Date(d.decisionPurgeAt) };
}
