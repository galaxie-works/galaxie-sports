/** Leitura pública do onde assistir (GET /v1/events/{id}/where-to-watch, docs/05 §4). */
import { and, eq, isNull } from 'drizzle-orm';
import { broadcastOption, competition, event, season, type Database } from '@galaxie/db';
import type { WtwConfig } from './config/directory.js';
import type { AccessModel, BroadcastMedium } from '@galaxie/db';
import { listBroadcasters } from './library.js';
import { currentResearchedRights, ResearchedRightsIndex } from './rights-research.js';
import { effectiveRights } from './rights.js';
import type { BroadcastOptionRow } from './store.js';

/** Mensagem quando não há informação confiável — o evento continua existindo. */
export const UNKNOWN_MESSAGES: Record<string, string> = {
  'pt-BR': 'Não temos as informações de transmissão ainda.',
  'es-AR': 'Todavía no tenemos la información de transmisión.',
  'es-MX': 'Todavía no tenemos la información de transmisión.',
  'es-CO': 'Todavía no tenemos la información de transmisión.',
  'es-CL': 'Todavía no tenemos la información de transmisión.',
  'es-PE': 'Todavía no tenemos la información de transmisión.',
  'es-UY': 'Todavía no tenemos la información de transmisión.',
  'es-EC': 'Todavía no tenemos la información de transmisión.',
};

export function unknownMessage(locale: string): string {
  return (
    UNKNOWN_MESSAGES[locale] ??
    (locale.startsWith('es') ? UNKNOWN_MESSAGES['es-AR']! : UNKNOWN_MESSAGES['pt-BR']!)
  );
}

/** Ordem de exibição sugerida por meio (a ordenação final por direito de acesso é do cliente). */
export const MEDIUM_ORDER = [
  'free_tv',
  'youtube',
  'streaming_free',
  'pay_tv',
  'streaming_svod',
  'official_app',
  'radio',
] as const;

export interface PublicSource {
  publisher: string;
  url: string;
}

/** Logo da emissora (biblioteca): chave no nosso storage e URL de origem. */
export interface PublicLogo {
  storageKey: string | null;
  sourceUrl: string | null;
}

export interface PublicOption {
  row: BroadcastOptionRow;
  sources: PublicSource[];
  logo: PublicLogo | null;
}

export interface PublicWhereToWatch {
  eventId: string;
  country: string;
  status: 'resolved' | 'unknown';
  options: PublicOption[];
  /** Detentores de direitos sem o jogo confirmado ("canal a confirmar", status `probable`). */
  toConfirm: PublicOption[];
  /**
   * Sem nenhuma opção gravada (o jogo ainda não passou por nenhuma janela no país — mercado novo,
   * jogo distante): os detentores dos direitos efetivos, ou os incertos quando só eles existem,
   * "a confirmar". Nunca "sem informações" quando a curadoria ou a pesquisa sabem quem pode passar.
   */
  fromRights: PublicRightsOption[];
  updatedAt: Date | null;
}

/** Detentor de direitos sem opção gravada: entra em `to_confirm` com as fontes da linha de direitos. */
export interface PublicRightsOption {
  providerName: string;
  broadcasterId: string;
  medium: BroadcastMedium;
  accessModel: AccessModel;
  sources: PublicSource[];
  logo: PublicLogo | null;
}

/** Detentores dos direitos efetivos do evento no país (curadoria vence; incertos se não há certos). */
async function rightsToConfirm(
  db: Database,
  config: WtwConfig,
  eventId: string,
  country: string,
): Promise<Omit<PublicRightsOption, 'logo'>[]> {
  if (!config.has(country)) return [];
  const [ev] = await db
    .select({ slug: competition.slug, startsAt: event.startsAt, year: season.year })
    .from(event)
    .innerJoin(competition, eq(competition.id, event.competitionId))
    .leftJoin(season, eq(season.id, event.seasonId))
    .where(eq(event.id, eventId));
  if (!ev) return [];
  const year = ev.year ?? ev.startsAt.getUTCFullYear();
  const researched = new ResearchedRightsIndex(
    await currentResearchedRights(db, { competitions: [ev.slug], countries: [country] }),
  );
  const directory = config.directory(country);
  const entry = effectiveRights(
    directory.rightsFor(ev.slug, ev.startsAt),
    researched.get(ev.slug, year, country),
  );
  if (!entry) return [];
  const ids = entry.holders.length ? entry.holders : entry.uncertainHolders;
  const sources = entry.sources.map((url) => ({ publisher: new URL(url).hostname, url }));
  return ids.flatMap((id) => {
    const b = directory.byIdOrNull(id);
    return b
      ? [{ providerName: b.name, broadcasterId: b.id, medium: b.medium, accessModel: b.accessModel, sources }]
      : [];
  });
}

/**
 * Opções publicadas (`confirmed`, versão vigente) de um evento × país. Com `region`, devolve as
 * nacionais + as daquela região; sem `region`, todas (cada uma com seu campo `region`).
 * Retorna null se o evento não existe.
 */
export async function getPublicWhereToWatch(
  db: Database,
  params: { eventId: string; country: string; region?: string | null },
  /** Com a configuração, o país sem nenhuma opção gravada mostra os detentores dos direitos. */
  config?: WtwConfig | null,
): Promise<PublicWhereToWatch | null> {
  const [ev] = await db.select({ id: event.id }).from(event).where(eq(event.id, params.eventId));
  if (!ev) return null;
  const country = params.country.toUpperCase();
  const rows = await db
    .select()
    .from(broadcastOption)
    .where(
      and(
        eq(broadcastOption.eventId, params.eventId),
        eq(broadcastOption.countryCode, country),
        isNull(broadcastOption.supersededBy),
      ),
    );

  const region = params.region?.trim().toUpperCase() || null;
  const inRegion = (r: BroadcastOptionRow) =>
    !region || r.region === null || r.region.toUpperCase() === region;
  const order = (a: BroadcastOptionRow, b: BroadcastOptionRow) =>
    MEDIUM_ORDER.indexOf(a.medium) - MEDIUM_ORDER.indexOf(b.medium) ||
    Number(b.confidence) - Number(a.confidence) ||
    a.providerName.localeCompare(b.providerName) ||
    (a.region ?? '').localeCompare(b.region ?? '');
  const confirmed = rows.filter((r) => r.status === 'confirmed' && inRegion(r)).sort(order);
  // "a confirmar" só aparece enquanto nenhuma opção estiver confirmada
  const probable = confirmed.length
    ? []
    : rows.filter((r) => r.status === 'probable' && inRegion(r)).sort(order);

  const fallback =
    config && !confirmed.length && !probable.length
      ? await rightsToConfirm(db, config, params.eventId, country)
      : [];
  const ids = [
    ...new Set([
      ...[...confirmed, ...probable].flatMap((r) => (r.broadcasterId ? [r.broadcasterId] : [])),
      ...fallback.map((f) => f.broadcasterId),
    ]),
  ];
  const library = new Map((await listBroadcasters(db, { ids })).map((b) => [b.id, b]));
  const logoOf = (row: Pick<BroadcastOptionRow, 'broadcasterId'>): PublicLogo | null => {
    const b = row.broadcasterId ? library.get(row.broadcasterId) : undefined;
    if (!b || (!b.logoStorageKey && !b.logoSourceUrl)) return null;
    return { storageKey: b.logoStorageKey, sourceUrl: b.logoSourceUrl };
  };

  const toPublic = (row: BroadcastOptionRow): PublicOption => {
    const seen = new Set<string>();
    const sources: PublicSource[] = [];
    for (const e of row.evidence) {
      if (e.stance === 'denies' || seen.has(e.url)) continue;
      seen.add(e.url);
      sources.push({ publisher: e.publisher ?? new URL(e.url).hostname, url: e.url });
    }
    return { row, sources, logo: logoOf(row) };
  };
  const options = confirmed.map(toPublic);
  const toConfirm = probable.map(toPublic);

  const stamps = rows.flatMap((r) => [r.createdAt.getTime(), r.lastVerifiedAt.getTime()]);
  return {
    eventId: params.eventId,
    country,
    status: options.length ? 'resolved' : 'unknown',
    options,
    toConfirm,
    fromRights: fallback.map((f) => ({ ...f, logo: logoOf(f) })),
    updatedAt: stamps.length ? new Date(Math.max(...stamps)) : null,
  };
}
