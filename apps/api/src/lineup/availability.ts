/**
 * Grade de canais e ofertas no onde assistir: em que operadora ou streaming, e em que plano, está o
 * canal que tem o jogo, e quais streamings vêm inclusos no plano (bloco `availability` e /v1/platforms).
 *
 * As consultas da grade vêm de `@galaxie/db` (`availabilityForChannels`, `listPlatforms`,
 * `getPlatformLineup`, `getTenantOperator`) por uma `LineupSource`, injetável nos testes. Aqui ficam a
 * regra por tenant (operadora própria esconde as concorrentes) e a montagem do contrato com os logos da
 * biblioteca de emissoras.
 */
import { inArray } from 'drizzle-orm';
import type {
  AvailabilityLogo,
  AvailabilityPlan,
  LineupItem,
  Platform,
  PlatformAvailability,
  PlatformLineup,
  WhereToWatchAvailability,
} from '@galaxie/contracts';
import {
  asset,
  availabilityForChannels,
  getPlatformLineup,
  getTenantOperator,
  listPlatforms,
  type ChannelAvailability,
  type Database,
  type LineupAccess,
  type LineupMinReview,
  type LineupPlatform,
  type PlatformKind,
  type PlatformLineup as DbPlatformLineup,
} from '@galaxie/db';
import { listBroadcasters, type PublicOption } from '@galaxie/where-to-watch';
import { assetUrl } from '../util.js';

/** As consultas da grade (as de `@galaxie/db` em produção; fixas nos testes). */
export interface LineupSource {
  availabilityForChannels: typeof availabilityForChannels;
  listPlatforms: typeof listPlatforms;
  getPlatformLineup: typeof getPlatformLineup;
  getTenantOperator: typeof getTenantOperator;
}

export const dbLineupSource: LineupSource = {
  availabilityForChannels,
  listPlatforms,
  getPlatformLineup,
  getTenantOperator,
};

/** Operadora do tenant, como a regra de visibilidade usa (tenant sem plataforma = sem operadora). */
export interface Operator {
  platformId: string;
  showOtherOperators: boolean;
}

export interface LineupOptions {
  /** Piso editorial da grade (LINEUP_MIN_REVIEW_STATUS); padrão `approved`. */
  minReviewStatus?: LineupMinReview;
  source?: LineupSource;
  /** Por quanto tempo a operadora de um tenant fica em memória (ms; padrão 60 s, como a chave). */
  operatorTtlMs?: number;
}

/** Grade resolvida para as rotas: consultas, piso e a operadora de cada tenant (memoizada). */
export class Lineup {
  readonly source: LineupSource;
  readonly minReview: LineupMinReview;
  private readonly ttlMs: number;
  private readonly operators = new Map<string, { value: Operator | null; expiresAt: number }>();

  constructor(
    options: LineupOptions = {},
    private readonly now: () => number = Date.now,
  ) {
    this.source = options.source ?? dbLineupSource;
    this.minReview = options.minReviewStatus ?? 'approved';
    this.ttlMs = options.operatorTtlMs ?? 60_000;
  }

  /** Operadora do tenant (null = não é operadora: vê todas as plataformas). */
  async operatorOf(db: Database, tenantId: string | undefined): Promise<Operator | null> {
    if (!tenantId) return null;
    const hit = this.operators.get(tenantId);
    if (hit && hit.expiresAt > this.now()) return hit.value;
    const row = await this.source.getTenantOperator(db, tenantId);
    const value = row?.platformId
      ? { platformId: row.platformId, showOtherOperators: row.showOtherOperators }
      : null;
    if (this.operators.size > 10_000) this.operators.clear();
    this.operators.set(tenantId, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }
}

// ─── regra por tenant ────────────────────────────────────────────────────────────────────────────

/**
 * Tenant com operadora própria e `show_other_operators = false` vê só a própria operadora e os
 * streamings; com `true`, ou sem operadora (outros tenants e a demo), vê todas.
 */
export function visibleTo(operator: Operator | null, platform: { id: string; kind: PlatformKind }): boolean {
  return (
    !operator ||
    operator.showOtherOperators ||
    platform.id === operator.platformId ||
    platform.kind === 'streaming'
  );
}

/** Parte do `vary` do cache: a resposta muda com a operadora do tenant (e com o filtro dela). */
export function operatorVary(operator: Operator | null): string[] {
  return operator ? [`op:${operator.platformId}:${operator.showOtherOperators ? 'all' : 'own'}`] : [];
}

/** Tags de purge da grade: a coleção e cada plataforma servida. */
export function lineupTags(platformIds: Iterable<string>): string[] {
  return ['platform', ...[...new Set(platformIds)].map((id) => `platform:${id}`)];
}

// ─── logos ───────────────────────────────────────────────────────────────────────────────────────

interface LogoRef {
  name: string;
  logo: string | null;
  logo_dark: string | null;
}

/** Logos da biblioteca de emissoras e dos assets das plataformas, já como URL pública. */
export class LogoBook {
  constructor(
    private readonly library: Map<string, LogoRef>,
    private readonly assets: Map<string, string | null>,
  ) {}

  static empty(): LogoBook {
    return new LogoBook(new Map(), new Map());
  }

  /** Canal ou streaming da biblioteca (sem entrada: o próprio id como nome, sem logo). */
  item(id: string): AvailabilityLogo {
    const ref = this.library.get(id);
    return { id, name: ref?.name ?? id, logo: ref?.logo ?? null, logo_dark: ref?.logo_dark ?? null };
  }

  /** Plataforma: logo do asset dela; senão, o da entrada dela na biblioteca. */
  platform(row: LineupPlatform): Platform {
    const lib = row.broadcasterId ? this.library.get(row.broadcasterId) : undefined;
    const own = row.logoAssetId ? (this.assets.get(row.logoAssetId) ?? null) : null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      country: row.country,
      broadcaster_id: row.broadcasterId,
      logo: own ?? lib?.logo ?? null,
      logo_dark: own ? null : (lib?.logo_dark ?? null),
    };
  }
}

const httpOnly = (url: string | null | undefined) => (url && /^https?:\/\//.test(url) ? url : null);

/** Carrega os logos dos ids da biblioteca e dos assets das plataformas. */
export async function loadLogoBook(
  db: Database,
  assetsBaseUrl: string | undefined,
  libraryIds: Iterable<string>,
  platforms: LineupPlatform[],
): Promise<LogoBook> {
  const ids = [
    ...new Set([...libraryIds, ...platforms.flatMap((p) => (p.broadcasterId ? [p.broadcasterId] : []))]),
  ];
  const assetIds = [...new Set(platforms.flatMap((p) => (p.logoAssetId ? [p.logoAssetId] : [])))];
  const [rows, assets] = await Promise.all([
    ids.length ? listBroadcasters(db, { ids }) : Promise.resolve([]),
    assetIds.length
      ? db
          .select({ id: asset.id, storageKey: asset.storageKey, sourceUrl: asset.sourceUrl })
          .from(asset)
          .where(inArray(asset.id, assetIds))
      : Promise.resolve([]),
  ]);
  const stored = (key: string | null) => (key ? assetUrl(assetsBaseUrl, key, null) : null);
  return new LogoBook(
    new Map(
      rows.map((b) => [
        b.id,
        {
          name: b.name,
          logo: assetUrl(assetsBaseUrl, b.logoStorageKey, httpOnly(b.logoSourceUrl)),
          logo_dark: stored(b.logoDarkStorageKey),
        },
      ]),
    ),
    new Map(assets.map((a) => [a.id, assetUrl(assetsBaseUrl, a.storageKey, httpOnly(a.sourceUrl))])),
  );
}

// ─── montagem ────────────────────────────────────────────────────────────────────────────────────

const KIND_ORDER: readonly PlatformKind[] = ['pay_tv_operator', 'telco_bundle', 'vmvpd', 'streaming'];

const lineupItem = (logos: LogoBook, id: string, access: LineupItem['access']): LineupItem => ({
  ...logos.item(id),
  access,
});

function availabilityPlan(
  logos: LogoBook,
  platform: LineupPlatform,
  p: {
    plan: { id: string; name: string };
    viaChannels: { channelId: string; access: LineupAccess }[];
    services: { serviceId: string; access: LineupAccess }[];
  },
): AvailabilityPlan {
  // a própria plataforma de streaming vem como "serviço" do plano: não se lista como inclusa nela mesma
  const included = p.services.filter(
    (s) => s.access === 'included' && s.serviceId !== platform.broadcasterId,
  );
  // o jogo vem com o plano quando algum canal dele está incluso (sem canal: quando o streaming está)
  const access =
    p.viaChannels.some((c) => c.access === 'included') ||
    (!p.viaChannels.length && p.services.some((s) => s.access === 'included'))
      ? 'included'
      : 'addon';
  return {
    id: p.plan.id,
    name: p.plan.name,
    access,
    via_channels: p.viaChannels.map((c) => lineupItem(logos, c.channelId, c.access)),
    included_services: included.map((s) => logos.item(s.serviceId)),
  };
}

/** Plataformas visíveis ao tenant, a operadora dele primeiro, depois por tipo e nome. */
export function platformAvailability(
  rows: ChannelAvailability[],
  operator: Operator | null,
  logos: LogoBook,
): PlatformAvailability[] {
  return rows
    .filter((r) => visibleTo(operator, r.platform) && r.plans.length)
    .sort(
      (a, b) =>
        Number(b.platform.id === operator?.platformId) - Number(a.platform.id === operator?.platformId) ||
        KIND_ORDER.indexOf(a.platform.kind) - KIND_ORDER.indexOf(b.platform.kind) ||
        a.platform.name.localeCompare(b.platform.name),
    )
    .map((r) => ({
      platform: logos.platform(r.platform),
      plans: r.plans.map((p) => availabilityPlan(logos, r.platform, p)),
    }));
}

type OptionLogo = (o: PublicOption) => { logo: string | null; logo_dark: string | null };

/**
 * Canais das opções publicadas de um meio, sem repetir (o mesmo canal em várias praças), com o logo da
 * opção (o do canal, quando o acervo oficial tem um).
 */
export function channelsOf(
  options: PublicOption[],
  medium: 'free_tv' | 'pay_tv',
  optionLogo: OptionLogo,
): AvailabilityLogo[] {
  const seen = new Set<string>();
  const out: AvailabilityLogo[] = [];
  for (const o of options) {
    if (o.row.medium !== medium) continue;
    const id = o.row.broadcasterId ?? o.row.id;
    const key = `${id}|${o.row.channelName ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name: o.row.channelName ?? o.row.providerName, ...optionLogo(o) });
  }
  return out;
}

export const EMPTY_AVAILABILITY: WhereToWatchAvailability = {
  free_tv: [],
  pay_tv_channels: [],
  platforms: [],
  your_operator: null,
};

/**
 * Bloco `availability` do onde assistir: TV aberta e canais pagos das opções publicadas, e as
 * plataformas (com o plano) que levam esses canais, filtradas pela regra do tenant.
 */
export async function buildAvailability(input: {
  db: Database;
  lineup: Lineup;
  assetsBaseUrl: string | undefined;
  country: string;
  options: PublicOption[];
  /** Logo resolvido de cada opção publicada (o do canal, quando o acervo oficial tem). */
  optionLogo: OptionLogo;
  operator: Operator | null;
}): Promise<{ availability: WhereToWatchAvailability; platformIds: string[] }> {
  const { db, lineup, operator } = input;
  const channelIds = [
    ...new Set(input.options.flatMap((o) => (o.row.broadcasterId ? [o.row.broadcasterId] : []))),
  ];
  const rows = channelIds.length
    ? await lineup.source.availabilityForChannels(db, {
        channelIds,
        country: input.country,
        minReview: lineup.minReview,
        // sem `onlyPlatformId`: ele restringe também os streamings; a regra do tenant filtra abaixo
        includeStreaming: true,
      })
    : [];
  // a própria operadora sem o jogo na grade: aparece mesmo assim, com `plans: []`
  const own =
    operator && !rows.some((r) => r.platform.id === operator.platformId)
      ? await lineup.source.getPlatformLineup(db, operator.platformId, { minReview: lineup.minReview })
      : null;
  const ids = [
    ...channelIds,
    ...rows.flatMap((r) =>
      r.plans.flatMap((p) => [
        ...p.viaChannels.map((c) => c.channelId),
        ...p.services.map((s) => s.serviceId),
      ]),
    ),
  ];
  const logos = await loadLogoBook(db, input.assetsBaseUrl, ids, [
    ...rows.map((r) => r.platform),
    ...(own ? [own.platform] : []),
  ]);

  const platforms = platformAvailability(rows, operator, logos);
  const yours = operator
    ? (platforms.find((p) => p.platform.id === operator.platformId) ??
      (own ? { platform: logos.platform(own.platform), plans: [] } : null))
    : null;
  return {
    availability: {
      free_tv: channelsOf(input.options, 'free_tv', input.optionLogo),
      pay_tv_channels: channelsOf(input.options, 'pay_tv', input.optionLogo),
      platforms,
      your_operator: yours,
    },
    platformIds: [...platforms.map((p) => p.platform.id), ...(yours ? [yours.platform.id] : [])],
  };
}

/** Grade de uma plataforma no contrato (`/v1/platforms/{id}/lineup`). */
export function lineupDto(row: DbPlatformLineup, logos: LogoBook): PlatformLineup {
  return {
    platform: logos.platform(row.platform),
    plans: row.plans.map((p) => ({
      id: p.plan.id,
      name: p.plan.name,
      channels: p.channels.map((c) => lineupItem(logos, c.channelId, c.access)),
      services: p.services.map((s) => lineupItem(logos, s.serviceId, s.access)),
    })),
  };
}
