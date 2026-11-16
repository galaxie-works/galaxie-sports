'use server';

/**
 * Assistente de criação da organização (doc 02 §Cadastro), depois do login: valida o que a pessoa informou, aplica as
 * travas antiabuso (PL2: e-mail grátis em revisão, teto por IP) e a calculadora (PL7: C3 e C4 por proposta), e chama
 * o provisionamento idempotente (`lib/client/provision.ts`). As chaves voltam uma única vez, nesta resposta.
 */
import { headers } from 'next/headers';

import { roleOf } from '@/lib/auth/roles';
import { auth } from '@/lib/auth/server';
import { builderDb } from '@/lib/builder/store';
import { clientAddress } from '@/lib/cache/request-guard';
import { addDomain, DomainError, listDomains } from '@/lib/client/domains';
import { normalizeDomainHost, txtRecordName } from '@/lib/client/domains-shared';
import { catalog } from '@/lib/client/entitlements';
import type { CapacityTier } from '@/lib/client/organizations-shared';
import { ProvisionError, provisionOrganization, type ProvisionedKeys } from '@/lib/client/provision';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { normalizeUsage, recommendCapacityTier } from '@/lib/signup/capacity';
import { emailDomain, isFreeEmailDomain } from '@/lib/signup/email-domain';
import { countOrganizationsFromIp, hasAnyMembership } from '@/lib/signup/guards';
import {
  billingFor,
  defaultBrandOrigin,
  isSignupMarket,
  isValidSlug,
  normalizeBrandColor,
  normalizeName,
} from '@/lib/signup/organization';
import { readSignupSettings } from '@/lib/signup/settings-db';
import { SITE_HOST } from '@/lib/site';
import { SPORT_FAMILIES } from '@/lib/sport-families';

export interface CreateOrganizationInput {
  organizationName: string;
  country: string;
  termsAccepted: boolean;
  brandName: string;
  slug: string;
  sports: string[];
  domain: string;
  color: string;
  usage: { viewsPerMonth: unknown; peakConcurrent: unknown; chatWriters: unknown };
}

export interface CreatedOrganization {
  organizationName: string;
  brandName: string;
  slug: string;
  /** Faixa gravada na organização (C1 no trial; a calculada quando foi por proposta). */
  tier: CapacityTier;
  /** Faixa que o uso declarado pediria. */
  declaredTier: CapacityTier;
  /** A faixa calculada entrou em autoatendimento (senão foi pedida como proposta). */
  selfService: boolean;
  reviewStatus: 'none' | 'pending' | 'approved' | 'rejected';
  trialEndsAt: string | null;
  keys: ProvisionedKeys;
  domain: { host: string; record: string; token: string; existed: boolean } | null;
  email: string;
}

export interface CreateOrganizationResult {
  ok: boolean;
  error?: string;
  created?: CreatedOrganization;
}

const VALID_SPORTS = new Set<string>(SPORT_FAMILIES.flatMap((f) => [...f.sports]));

export async function createOrganizationAction(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  const locale = await getRequestLocale();
  const e = getDictionary(locale).signup.errors;
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) return { ok: false, error: e.noSession };
  if (roleOf(session.user.role) !== 'client') return { ok: false, error: e.staffAccount };
  const settings = await readSignupSettings();
  if (!settings.open || !settings.termsVersion) return { ok: false, error: e.closed };
  if (await hasAnyMembership(session.user.id)) return { ok: false, error: e.hasMembership };

  const organizationName = normalizeName(input?.organizationName);
  if (!organizationName) return { ok: false, error: e.organizationName };
  const country = String(input?.country ?? '').toUpperCase();
  if (!isSignupMarket(country)) return { ok: false, error: e.country };
  if (input?.termsAccepted !== true) return { ok: false, error: e.terms };
  const brandName = normalizeName(input?.brandName);
  if (!brandName) return { ok: false, error: e.brandName };
  const slug = String(input?.slug ?? '')
    .trim()
    .toLowerCase();
  if (!isValidSlug(slug)) return { ok: false, error: e.slug };
  const sports = [...new Set((Array.isArray(input?.sports) ? input.sports : []).map(String))].filter((s) =>
    VALID_SPORTS.has(s),
  );
  const domainRaw = String(input?.domain ?? '').trim();
  const host = domainRaw ? normalizeDomainHost(domainRaw) : null;
  if (domainRaw && !host) return { ok: false, error: e.domain };
  const colorRaw = String(input?.color ?? '').trim();
  const color = colorRaw ? normalizeBrandColor(colorRaw) : null;
  if (colorRaw && !color) return { ok: false, error: e.color };

  const usage = {
    viewsPerMonth: normalizeUsage(input?.usage?.viewsPerMonth),
    peakConcurrent: normalizeUsage(input?.usage?.peakConcurrent),
    chatWriters: normalizeUsage(input?.usage?.chatWriters),
  };
  const recommended = recommendCapacityTier(catalog().capacity.tiers, usage);
  // e-mail grátis (PL2) ou faixa por proposta (PL7): em revisão, sem chave até a equipe decidir
  const email = session.user.email.toLowerCase();
  const free = isFreeEmailDomain(emailDomain(email));
  const reviewStatus = free || !recommended.selfService ? 'pending' : 'none';
  // no trial a faixa é C1 (PL3); por proposta, a calculada, para a equipe ver o pedido
  const tier: CapacityTier = recommended.selfService ? 'C1' : recommended.tier;

  const ip = clientAddress(h);
  if (ip && (await countOrganizationsFromIp(ip)) >= settings.perIpPerDay)
    return { ok: false, error: e.ipLimit };

  const actor = `signup:${session.user.id}`;
  let result;
  try {
    result = await provisionOrganization(builderDb(), {
      organization: {
        slug,
        name: organizationName,
        country,
        ...billingFor(country),
        capacityTier: tier,
        reviewStatus,
        locale,
        terms: { version: settings.termsVersion, acceptedBy: session.user.id, ip },
      },
      brand: { slug, name: brandName, sports, color },
      owner: { userId: session.user.id, email, accepted: true },
      catalog: catalog(),
      trialDays: settings.trialDays,
      actor,
      defaultOrigin: defaultBrandOrigin(slug, SITE_HOST),
      declared: { usage, tier: recommended.tier, selfService: recommended.selfService },
      source: 'signup',
    });
  } catch (err) {
    if (err instanceof ProvisionError && err.code === 'domainInTrial')
      return { ok: false, error: fill(e.domainInTrial, { organization: err.organizationName ?? '' }) };
    if (err instanceof ProvisionError) return { ok: false, error: e.slugTaken };
    console.error('[cadastro] provisionamento falhou', err);
    return { ok: false, error: e.generic };
  }

  let domain: CreatedOrganization['domain'] = null;
  if (host) {
    try {
      const row = await addDomain({ tenantId: result.tenantId, host, actor });
      domain = { host, record: txtRecordName(host), token: row.txtToken, existed: false };
    } catch (err) {
      const existing =
        err instanceof DomainError && err.code === 'exists'
          ? (await listDomains(result.tenantId)).find((d) => d.host === host)
          : undefined;
      if (existing) domain = { host, record: txtRecordName(host), token: existing.txtToken, existed: true };
      else console.error('[cadastro] domínio não cadastrado', err);
    }
  }

  return {
    ok: true,
    created: {
      organizationName,
      brandName,
      slug,
      tier,
      declaredTier: recommended.tier,
      selfService: recommended.selfService,
      reviewStatus: result.reviewStatus,
      trialEndsAt: result.trialEndsAt?.toISOString() ?? null,
      keys: result.keys,
      domain,
      email,
    },
  };
}
