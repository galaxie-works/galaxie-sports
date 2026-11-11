'use server';

/**
 * Ações dos patrocinadores no painel do cliente (#1021). O tenant sai sempre da sessão (`readClientContext`), nunca do
 * navegador: cada consulta filtra pelo tenant, então um id de outro cliente não acha nada.
 */
import type { SponsorInput, SponsorIssue } from '@galaxie/engage';
import { revalidatePath } from 'next/cache';

import { can } from '@/lib/client/permissions';
import { readClientContext } from '@/lib/client/session';
import { isUuid } from '@/lib/client/tenants';
import { archiveSponsor, MAX_SPONSORS, saveSponsor, SponsorError } from '@/lib/client/sponsors';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export interface SponsorActionResult {
  ok: boolean;
  error?: string;
  issues?: SponsorIssue[];
}

const PATH = '/cliente/patrocinadores';

async function context() {
  const dict = getDictionary(await getRequestLocale());
  const t = dict.sponsors;
  const ctx = await readClientContext();
  if (!ctx) return { t, error: dict.client.errors.forbidden } as const;
  if (!ctx.tenant) return { t, error: dict.client.errors.noTenant } as const;
  // cadastro do tenant: cargo com settings.manage (#1019)
  if (!can(ctx, 'settings.manage')) return { t, error: dict.client.errors.role } as const;
  return { t, tenantId: ctx.tenant.id, actor: ctx.email } as const;
}

function failure(err: unknown, t: Awaited<ReturnType<typeof context>>['t']): SponsorActionResult {
  if (err instanceof SponsorError) {
    if (err.code === 'invalid') return { ok: false, error: t.errors.invalid, issues: err.issues };
    if (err.code === 'limit') return { ok: false, error: fill(t.errors.limit, { max: MAX_SPONSORS }) };
    return { ok: false, error: t.errors[err.code] };
  }
  console.error('[patrocinadores] ação do painel falhou', err);
  return { ok: false, error: t.errors.generic };
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Cria (`id` nulo) ou altera um patrocinador. */
export async function saveSponsorAction(input: {
  id: string | null;
  version: number | null;
  sponsor: SponsorInput;
}): Promise<SponsorActionResult> {
  const c = await context();
  if ('error' in c) return { ok: false, error: c.error };
  if (input.id !== null && (!isUuid(input.id) || !Number.isInteger(input.version)))
    return { ok: false, error: c.t.errors.not_found };
  const s = input.sponsor ?? ({} as SponsorInput);
  try {
    await saveSponsor({
      tenantId: c.tenantId,
      id: input.id,
      expectedVersion: input.id === null ? null : input.version,
      sponsor: {
        name: String(s.name ?? '').slice(0, 200),
        category: String(s.category ?? ''),
        linkUrl: str(s.linkUrl, 2000),
        logoLightUrl: str(s.logoLightUrl, 2000),
        logoDarkUrl: str(s.logoDarkUrl, 2000),
        countries: Array.isArray(s.countries) ? s.countries.slice(0, 100).map(String) : [],
        startsAt: str(s.startsAt, 40),
        endsAt: str(s.endsAt, 40),
      },
      actor: c.actor,
    });
  } catch (err) {
    return failure(err, c.t);
  }
  revalidatePath(PATH);
  return { ok: true };
}

/** Arquiva o patrocinador: some das salas, campanhas e recompensas; as impressões ficam no relatório. */
export async function archiveSponsorAction(input: {
  id: string;
  version: number;
}): Promise<SponsorActionResult> {
  const c = await context();
  if ('error' in c) return { ok: false, error: c.error };
  if (!isUuid(input.id) || !Number.isInteger(input.version))
    return { ok: false, error: c.t.errors.not_found };
  try {
    await archiveSponsor({
      tenantId: c.tenantId,
      id: input.id,
      expectedVersion: input.version,
      actor: c.actor,
    });
  } catch (err) {
    return failure(err, c.t);
  }
  revalidatePath(PATH);
  return { ok: true };
}
