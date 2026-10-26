/**
 * Onde assistir e grades: o que a API serve (itens no piso editorial `LINEUP_MIN_REVIEW_STATUS`, padrão `approved`,
 * de planos vigentes) tem fonte oficial, preço com moeda e canal do dicionário de emissoras.
 */
import { sql } from 'drizzle-orm';
import type { LineupSource } from '@galaxie/db';
import type { QualityFailureItem, QualityRule } from '../types.js';

const REVIEW_ORDER = ['draft', 'reviewed', 'approved'] as const;

/** Status servidos com o piso editorial dado. */
export function servedStatuses(floor: string | undefined): string[] {
  const i = REVIEW_ORDER.indexOf((floor ?? 'approved') as (typeof REVIEW_ORDER)[number]);
  return REVIEW_ORDER.slice(i < 0 ? 2 : i);
}

/** Segundo nível de domínio que não é o site (com.br, gob.mx, co.uk...). */
const SECOND_LEVEL = new Set(['com', 'net', 'org', 'gob', 'gov', 'co', 'edu', 'tv']);

/** Domínio registrável de uma URL ou host ("www.loja.exemplo.com.br" → "exemplo.com.br"). */
export function siteOf(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null;
  let host: string;
  try {
    host = new URL(
      /^[a-z]+:\/\//i.test(urlOrHost) ? urlOrHost : `https://${urlOrHost}`,
    ).hostname.toLowerCase();
  } catch {
    return null;
  }
  const parts = host
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean);
  if (parts.length < 2) return null;
  const tld = parts.at(-1)!;
  const n = tld.length === 2 && SECOND_LEVEL.has(parts.at(-2)!) && parts.length >= 3 ? 3 : 2;
  return parts.slice(-n).join('.');
}

/** Fonte oficial: informada pela operadora ou página no site da plataforma (ou do plano). */
export function hasOfficialSource(
  sources: readonly LineupSource[],
  sites: readonly (string | null)[],
): boolean {
  const official = new Set(sites.map(siteOf).filter((s): s is string => !!s));
  return sources.some((s) => s.kind === 'operator' || (!!s.url && official.has(siteOf(s.url) ?? '')));
}

/** Preço com moeda (R$, US$, $, S/, Bs, ₲ ou o código ISO) ou explicitamente grátis. */
export function priceHasCurrency(price: string | null | undefined): boolean {
  if (!price?.trim()) return false;
  return /R\$|US\$|U\$S|\$|S\/|₲|€|\bBs\.?\s?\d|\b(BRL|USD|MXN|ARS|COP|CLP|PEN|UYU|PYG|BOB|VES|EUR|Gs)\b|^\s*(grátis|gratis|free)\b/i.test(
    price,
  );
}

/** Plano vigente no dia de `now` (o mesmo filtro da API: só o vigente é servido). */
const planCurrent = (now: Date) => {
  const day = now.toISOString().slice(0, 10);
  return sql`(pp.valid_from is null or pp.valid_from <= ${day}::date) and (pp.valid_to is null or pp.valid_to >= ${day}::date)`;
};

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

export const WATCH_RULES: QualityRule[] = [
  {
    id: 'watch.included-has-official-source',
    sport: 'watch',
    area: 'watch',
    severity: 'critical',
    description: {
      'pt-BR':
        'Canal ou streaming servido como incluso num plano tem fonte oficial (site da operadora ou informado por ela)',
      en: 'A channel or streaming service served as included in a plan has an official source (operator site or operator-provided)',
      es: 'Un canal o streaming servido como incluido en un plan tiene fuente oficial (sitio del operador o informado por él)',
    },
    origin: 'erro achado pelo dono do produto na demo (24/10/2026): canais atribuídos ao plano errado',
    check: async (ctx) => {
      const served = servedStatuses(ctx.env.LINEUP_MIN_REVIEW_STATUS);
      const list = sql.join(
        served.map((s) => sql`${s}`),
        sql`, `,
      );
      const rows = await ctx.db.execute<{
        plan_id: string;
        item: string;
        plan: string;
        platform: string;
        platform_id: string;
        website: string | null;
        plan_url: string | null;
        sources: LineupSource[];
      }>(sql`
        with items as (
          select plan_id, channel_id as item, sources from enrich.plan_channel where access = 'included' and review_status in (${list})
          union all
          select plan_id, service_id, sources from enrich.plan_service where access = 'included' and review_status in (${list})
        )
        select i.plan_id::text, i.item, pp.name as plan, pf.name as platform, pf.id::text as platform_id,
               pf.website, pp.url as plan_url, i.sources
          from items i
          join enrich.platform_plan pp on pp.id = i.plan_id and pp.review_status in (${list}) and ${planCurrent(ctx.now)}
          join enrich.platform pf on pf.id = pp.platform_id and pf.review_status in (${list})
         order by pf.name, pp.name, i.item, i.plan_id`);
      const failures: QualityFailureItem[] = rows
        .filter((r) => !hasOfficialSource(r.sources ?? [], [r.website, r.plan_url]))
        .map((r) => ({
          key: `${r.plan_id}:${r.item}`,
          label: `${r.platform} · ${r.plan} · ${r.item}`,
          current: (r.sources ?? []).map((s) => s.url ?? s.kind ?? '?').join(' · ') || 'sem fonte',
          expected: `página em ${siteOf(r.website) ?? siteOf(r.plan_url) ?? 'site da operadora'} ou informado pela operadora`,
          link: { type: 'platform', id: r.platform_id, name: r.platform },
        }));
      return { checked: rows.length, failures };
    },
  },
  {
    id: 'watch.plan-price-currency',
    sport: 'watch',
    area: 'watch',
    severity: 'high',
    description: {
      'pt-BR': 'Plano servido tem preço com moeda',
      en: 'A served plan has a price with its currency',
      es: 'Un plan servido tiene precio con moneda',
    },
    check: async (ctx) => {
      const list = sql.join(
        servedStatuses(ctx.env.LINEUP_MIN_REVIEW_STATUS).map((s) => sql`${s}`),
        sql`, `,
      );
      const rows = await ctx.db.execute<{
        id: string;
        plan: string;
        platform: string;
        platform_id: string;
        price: string | null;
      }>(sql`
        select pp.id::text, pp.name as plan, pf.name as platform, pf.id::text as platform_id, pp.price_text as price
          from enrich.platform_plan pp
          join enrich.platform pf on pf.id = pp.platform_id and pf.review_status in (${list})
         where pp.review_status in (${list}) and ${planCurrent(ctx.now)}
         order by pf.name, pp.name, pp.id`);
      return {
        checked: rows.length,
        failures: rows
          .filter((r) => !priceHasCurrency(r.price))
          .map((r) => ({
            key: r.id,
            label: `${r.platform} · ${r.plan}`,
            current: r.price ?? 'sem preço',
            expected: 'preço com moeda (ex.: R$ 99,90/mês)',
            link: { type: 'platform', id: r.platform_id, name: r.platform },
          })),
      };
    },
  },
  {
    id: 'watch.channel-in-dictionary',
    sport: 'all',
    area: 'watch',
    severity: 'high',
    description: {
      'pt-BR': 'Onde assistir publicado usa emissora e canal do dicionário (config/broadcasters)',
      en: 'Published where-to-watch uses a broadcaster and channel from the dictionary (config/broadcasters)',
      es: 'El dónde ver publicado usa emisora y canal del diccionario (config/broadcasters)',
    },
    check: async (ctx) => {
      const rows = await ctx.db.execute<{
        id: string;
        event_id: string;
        sport: string;
        country: string;
        provider: string;
        broadcaster_id: string | null;
        channel: string | null;
        known: boolean;
        channels: string[] | null;
        starts_at: string;
      }>(sql`
        select o.id::text, e.id::text as event_id, e.sport, o.country_code as country, o.provider_name as provider,
               o.broadcaster_id, o.channel_name as channel, b.id is not null as known, b.channels, e.starts_at
          from enrich.broadcast_option o
          join core.event e on e.id = o.event_id
          left join enrich.broadcaster b on b.id = o.broadcaster_id
         where o.superseded_by is null and o.status in ('confirmed', 'probable')
           and e.starts_at > ${ctx.now.toISOString()}::timestamptz - interval '30 days'
         order by e.sport, e.starts_at, o.id`);
      const checked: Record<string, number> = {};
      const failures: QualityFailureItem[] = [];
      for (const r of rows) {
        checked[r.sport] = (checked[r.sport] ?? 0) + 1;
        const channelOk =
          !r.channel ||
          !r.channels?.length ||
          r.channels.some((c) => norm(c) === norm(r.channel!)) ||
          norm(r.channel) === norm(r.provider);
        if (r.known && channelOk) continue;
        failures.push({
          key: r.id,
          sport: r.sport,
          label: `${r.country} · ${r.provider}${r.channel ? ` · ${r.channel}` : ''} · ${String(r.starts_at).slice(0, 10)}`,
          current: !r.known
            ? `emissora fora do dicionário (${r.broadcaster_id ?? 'sem id'})`
            : `canal "${r.channel}" fora da lista de ${r.broadcaster_id}`,
          expected: !r.known ? 'id de config/broadcasters' : (r.channels ?? []).join(', '),
          link: { type: 'event', id: r.event_id },
        });
      }
      return { checked, failures };
    },
  },
];
