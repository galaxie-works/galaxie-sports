/**
 * Curadoria interna da grade (`lineups:curate`): a grade de uma plataforma informada por quem conhece a
 * oferta por dentro (o dono do produto trabalha em duas operadoras clientes; a palavra dele sobre os
 * planos delas vale mais que fonte pública). O arquivo com os nomes reais fica fora do repositório.
 *
 * - Prévia por padrão: mostra o que entra, o que o dicionário não conhece e o que muda; `apply` grava.
 * - Grava a grade completa da plataforma (plano, canal, streaming ou complemento que não veio sai da
 *   grade) e aprova tudo, com a fonte "operadora (curadoria interna)" e sem URL.
 * - `replaces`: plataformas antigas que viraram esta (rebrand). Os tenants ligados a elas passam para a
 *   nova e a antiga é rejeitada (sai da API; nada é apagado).
 */
import { eq, inArray } from 'drizzle-orm';
import {
  ADDON_KINDS,
  getPlatformLineup,
  lineupSlug,
  platform as platformTable,
  platformSlug,
  PLATFORM_KINDS,
  setLineupReviewStatus,
  setTenantOperator,
  tenant,
  upsertLineupDraft,
  type AddonKind,
  type Database,
  type LineupSource,
  type LineupTarget,
  type PlatformKind,
} from '@galaxie/db';
import type { WtwConfig } from '@galaxie/where-to-watch';
import { resolveOffer } from './extract.js';
import { COUNTRY_CURRENCY, formatPrice } from './validate.js';

export const CURATION_NOTE = 'operadora (curadoria interna)';
export const CURATION_BY = 'curadoria';

/** Arquivo de curadoria (JSON, fora do repositório). */
export interface CuratedLineup {
  country: string;
  platform: {
    slug?: string;
    name: string;
    kind: PlatformKind;
    website: string;
    official_domains?: string[];
  };
  /** Slugs de plataformas antigas que viraram esta (rebrand). */
  replaces?: string[];
  /** Rótulo da fonte (padrão: "operadora (curadoria interna)"). */
  note?: string;
  plans: {
    name: string;
    price_amount: number | null;
    currency?: string | null;
    url?: string | null;
    channels: string[];
    services: string[];
  }[];
  addons?: {
    name: string;
    kind: AddonKind;
    price_amount: number | null;
    /** ISO 4217 (padrão: a moeda do país). */
    currency?: string | null;
    commitment_months?: number | null;
  }[];
}

export interface CurationReport {
  platform: { slug: string; name: string; exists: boolean };
  plans: { name: string; price: string | null; channels: string[]; services: string[]; unknown: string[] }[];
  addons: { name: string; refId: string | null; price: string | null; commitmentMonths: number | null }[];
  unknown: string[];
  replaces: { slug: string; found: boolean; tenants: string[] }[];
  applied: boolean;
  approved: number;
}

export class CurationError extends Error {}

/** Valida o arquivo (formato e valores) antes de qualquer leitura no banco. */
export function parseCuration(raw: unknown): CuratedLineup {
  const fail = (m: string): never => {
    throw new CurationError(m);
  };
  if (!raw || typeof raw !== 'object') fail('arquivo vazio ou inválido');
  const c = raw as CuratedLineup;
  if (!/^[A-Z]{2}$/.test(c.country ?? '')) fail('country: ISO2 (ex.: BR)');
  if (!c.platform?.name?.trim()) fail('platform.name obrigatório');
  if (!PLATFORM_KINDS.includes(c.platform.kind))
    fail(`platform.kind inválido (${PLATFORM_KINDS.join(', ')})`);
  if (!/^https?:\/\//.test(c.platform.website ?? '')) fail('platform.website: URL http(s)');
  if (!Array.isArray(c.plans) || !c.plans.length) fail('plans: ao menos um plano');
  for (const p of c.plans) {
    if (!p.name?.trim()) fail('plano sem nome');
    if (p.price_amount !== null && !(typeof p.price_amount === 'number' && p.price_amount > 0))
      fail(`${p.name}: price_amount número positivo ou null`);
    if (!Array.isArray(p.channels) || !Array.isArray(p.services))
      fail(`${p.name}: channels e services são listas`);
  }
  for (const a of c.addons ?? []) {
    if (!a.name?.trim()) fail('complemento sem nome');
    if (!ADDON_KINDS.includes(a.kind)) fail(`${a.name}: kind ${ADDON_KINDS.join(' ou ')}`);
  }
  return c;
}

export async function curateLineup(
  db: Database,
  config: WtwConfig,
  input: CuratedLineup,
  opts: { apply: boolean; now?: Date },
): Promise<CurationReport> {
  const now = opts.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  if (!config.has(input.country))
    throw new CurationError(`País sem dicionário de emissoras: ${input.country}`);
  const dir = config.directory(input.country);
  const currency = COUNTRY_CURRENCY[input.country] ?? null;
  const slug = input.platform.slug
    ? lineupSlug(input.platform.slug)
    : platformSlug(input.country, input.platform.name);
  const [existing] = await db.select().from(platformTable).where(eq(platformTable.slug, slug));
  const source: LineupSource = {
    url: null,
    kind: 'operator',
    note: input.note?.trim() || CURATION_NOTE,
    seen_at: now.toISOString(),
  };
  const report: CurationReport = {
    platform: { slug, name: input.platform.name, exists: !!existing },
    plans: [],
    addons: [],
    unknown: [],
    replaces: [],
    applied: false,
    approved: 0,
  };
  const unknown = (n: string) => {
    if (!report.unknown.includes(n)) report.unknown.push(n);
  };
  const resolveId = (name: string) => dir.resolve(name, day)?.entry.id ?? null;
  // a moeda informada na curadoria (US$ no Uruguai fica em USD); sem ela, a do país
  const price = (amount: number | null, months: number | null = null, cur: string | null = currency) =>
    amount !== null && cur
      ? `${formatPrice(amount, cur, input.country)}${months ? ` · fidelidade de ${months} meses` : ''}`
      : null;

  const plans = input.plans.map((p) => {
    const channels = new Set<string>();
    const services = new Set<string>();
    const planUnknown: string[] = [];
    for (const n of p.channels) {
      const id = resolveId(n);
      if (id) channels.add(id);
      else {
        planUnknown.push(n);
        unknown(n);
      }
    }
    for (const n of p.services) {
      const id = resolveId(n);
      if (id) services.add(id);
      else {
        planUnknown.push(n);
        unknown(n);
      }
    }
    report.plans.push({
      name: p.name,
      price: price(p.price_amount, null, p.currency ?? currency),
      channels: [...channels],
      services: [...services],
      unknown: planUnknown,
    });
    return {
      name: p.name.trim(),
      priceAmount: p.price_amount,
      priceCurrency: p.price_amount !== null ? (p.currency ?? currency) : null,
      priceText: price(p.price_amount, null, p.currency ?? currency),
      url: p.url ?? null,
      sources: [source],
      channels: [...channels].map((channelId) => ({
        channelId,
        access: 'included' as const,
        sources: [source],
      })),
      services: [...services].map((serviceId) => ({
        serviceId,
        access: 'included' as const,
        sources: [source],
      })),
    };
  });
  const addons = (input.addons ?? []).flatMap((a) => {
    const resolved = resolveOffer(a.name, dir, day);
    const months = a.commitment_months ?? null;
    report.addons.push({
      name: a.name,
      refId: resolved?.entry.id ?? null,
      price: price(a.price_amount, months, a.currency ?? currency),
      commitmentMonths: months,
    });
    if (!resolved) {
      unknown(a.name);
      return [];
    }
    return [
      {
        kind: resolved.channel ? ('channel' as const) : a.kind,
        refId: resolved.entry.id,
        channel: resolved.channel,
        name: a.name.trim(),
        priceAmount: a.price_amount,
        priceCurrency: a.price_amount !== null ? (a.currency ?? currency) : null,
        priceText: price(a.price_amount, months, a.currency ?? currency),
        commitmentMonths: months,
        sources: [source],
      },
    ];
  });

  const old = input.replaces?.length
    ? await db.select().from(platformTable).where(inArray(platformTable.slug, input.replaces))
    : [];
  for (const s of input.replaces ?? []) {
    const o = old.find((x) => x.slug === s);
    const tenants = o
      ? (await db.select({ id: tenant.id }).from(tenant).where(eq(tenant.operatorPlatformId, o.id))).map(
          (t) => t.id,
        )
      : [];
    report.replaces.push({ slug: s, found: !!o, tenants });
  }
  if (!opts.apply) return report;

  const r = await upsertLineupDraft(db, {
    platform: {
      slug,
      name: input.platform.name.trim(),
      kind: input.platform.kind,
      country: input.country,
      website: input.platform.website,
      officialDomains: input.platform.official_domains ?? [],
      sources: [source],
    },
    plans,
    addons,
    addonsComplete: true,
    // a grade informada é completa: o que não veio sai (aprovar a remoção abaixo)
    complete: true,
    seenAt: now,
  });
  // aprova tudo da plataforma (aplica as mudanças e as remoções pendentes)
  const lineup = await getPlatformLineup(db, r.platformId, { minReview: 'draft', includeUnverified: true });
  const targets: LineupTarget[] = lineup
    ? [
        { type: 'platform', id: lineup.platform.id },
        ...lineup.plans.flatMap(({ plan, channels, services }) => [
          { type: 'plan' as const, id: plan.id },
          ...channels.map((c) => ({
            type: 'plan_channel' as const,
            planId: plan.id,
            channelId: c.channelId,
          })),
          ...services.map((s) => ({
            type: 'plan_service' as const,
            planId: plan.id,
            serviceId: s.serviceId,
          })),
        ]),
        ...lineup.addons.map((a) => ({ type: 'addon' as const, id: a.id })),
      ]
    : [];
  for (const t of targets) if (await setLineupReviewStatus(db, t, 'approved', CURATION_BY)) report.approved++;
  // as antigas: tenants passam para a nova e a antiga sai da API
  for (const o of old) {
    if (o.id === r.platformId) continue;
    const tenants = report.replaces.find((x) => x.slug === o.slug)?.tenants ?? [];
    for (const t of tenants) await setTenantOperator(db, t, { platformId: r.platformId });
    await setLineupReviewStatus(db, { type: 'platform', id: o.id }, 'rejected', CURATION_BY);
  }
  report.platform.exists = true;
  report.applied = true;

  return report;
}
