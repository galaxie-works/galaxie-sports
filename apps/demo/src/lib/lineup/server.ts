/**
 * Leituras de grades e ofertas para as páginas (só no servidor). Quem chama já conferiu a sessão: o portal
 * passa o tenant da sessão (`ClientArea`), o painel de admin chama `requireAdmin` antes.
 *
 * A grade vem de `@galaxie/db/lineups` (por `./store`); nomes e logos de canais e streamings vêm da
 * biblioteca de emissoras (`enrich.broadcaster`), lida direto do Postgres como a revisão e a operação fazem.
 */
import { pool } from '@/lib/auth/db';
import { listTenantOptions, type TenantOption } from '@/lib/client/tenants';

import {
  getPlatformLineup,
  getTenantOperator,
  lineupDb,
  listLineupReviewRequests,
  listPlatforms,
  type LineupReviewRequest,
  type PlatformLineup,
  type TenantOperator,
} from './store';
import {
  PLAN_LIBRARY_KINDS,
  PUBLISHED_MIN_REVIEW,
  assetUrl,
  awaitsDecision,
  findInLineup,
  flattenLineup,
  libraryTargetType,
  lineupView,
  planCurrentAt,
  proposedView,
  type ItemView,
  type LibraryEntry,
  type LineupView,
  type RequestStatus,
  type RequestView,
  type TargetType,
} from './types';

const isMissingTable = (err: unknown) => (err as { code?: string }).code === '42P01';

async function rows<T extends object>(sql: string, params: unknown[]): Promise<T[]> {
  try {
    return (await pool.query<T>(sql, params)).rows;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

type LibraryRow = {
  id: string;
  name: string;
  kind: string;
  storage_key: string | null;
  source_url: string | null;
  dark_storage_key: string | null;
  custom: boolean;
  custom_dark: boolean;
};
// logo enviado no painel (custom_logo_asset_id) vale no lugar do da origem, como na API; a versão escura
// do painel vale sempre, a do acervo só sem logo claro do painel
const LIBRARY_SELECT = `select b.id, b.name, b.kind, a.storage_key, a.source_url, d.storage_key as dark_storage_key,
      b.custom_logo_asset_id is not null as custom,
      b.custom_logo_dark_asset_id is not null as custom_dark
    from enrich.broadcaster b
    left join core.asset a on a.id = coalesce(b.custom_logo_asset_id, b.logo_asset_id)
    left join core.asset d on d.id = coalesce(b.custom_logo_dark_asset_id,
      case when b.custom_logo_asset_id is null then b.logo_dark_asset_id end)`;
const toEntry = (r: LibraryRow): LibraryEntry => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  logoUrl: assetUrl(r.storage_key, r.source_url),
  logoDarkUrl: r.dark_storage_key ? assetUrl(r.dark_storage_key, null) : null,
  customLogo: r.custom === true,
  customDarkLogo: r.custom_dark === true,
});

/** Nome e logo das entradas da biblioteca de emissoras usadas nas grades. */
export async function readLibrary(ids: string[]): Promise<Map<string, LibraryEntry>> {
  if (!ids.length) return new Map();
  const list = await rows<LibraryRow>(`${LIBRARY_SELECT} where b.id = any($1)`, [ids]);
  return new Map(list.map((r) => [r.id, toEntry(r)]));
}

/**
 * Biblioteca de um país (canais e streamings que a operadora pode pedir para incluir num plano). Rádio
 * fica de fora: não é canal de grade.
 */
export async function readCountryLibrary(country: string): Promise<LibraryEntry[]> {
  const list = await rows<LibraryRow>(
    `${LIBRARY_SELECT} where $1 = any(b.countries) and b.kind = any($2) order by b.name`,
    [country, [...PLAN_LIBRARY_KINDS]],
  );
  return list.map(toEntry);
}

async function assetUrls(ids: string[]): Promise<Map<string, string | null>> {
  if (!ids.length) return new Map();
  const list = await rows<{ id: string; storage_key: string | null; source_url: string | null }>(
    'select id::text, storage_key, source_url from core.asset where id = any($1)',
    [ids],
  );
  return new Map(list.map((r) => [r.id, assetUrl(r.storage_key, r.source_url)]));
}

/**
 * Versão escura do acervo para logos de plataforma que são o logo de uma entrada da biblioteca (mesmo
 * site oficial), como `loadLogoBook` na API: asset do logo → URL da versão escura.
 */
async function officialDarkUrls(ids: string[]): Promise<Map<string, string | null>> {
  if (!ids.length) return new Map();
  const list = await rows<{ id: string; storage_key: string | null }>(
    `select b.logo_asset_id::text as id, d.storage_key
      from enrich.broadcaster b join core.asset d on d.id = b.logo_dark_asset_id
      where b.logo_asset_id = any($1)`,
    [ids],
  );
  return new Map(list.map((r) => [r.id, r.storage_key ? assetUrl(r.storage_key, null) : null]));
}

/** Grades do banco → grades do navegador, com nomes e logos da biblioteca. */
async function toViews(lineups: PlatformLineup[]): Promise<LineupView[]> {
  const refs = new Set<string>();
  for (const l of lineups) {
    if (l.platform.broadcasterId) refs.add(l.platform.broadcasterId);
    for (const p of l.plans) {
      p.channels.forEach((c) => refs.add(c.channelId));
      p.services.forEach((s) => refs.add(s.serviceId));
    }
  }
  // logo da plataforma: o enviado no painel vale no lugar do da busca de logos
  const logoOf = (l: PlatformLineup) => l.platform.customLogoAssetId ?? l.platform.logoAssetId;
  const own = lineups.map(logoOf).filter((x): x is string => Boolean(x));
  const logos = [...own, ...lineups.map((l) => l.platform.customLogoDarkAssetId)].filter((x): x is string =>
    Boolean(x),
  );
  const [library, assets, official] = await Promise.all([
    readLibrary([...refs]),
    assetUrls(logos),
    officialDarkUrls(own),
  ]);
  const urlOf = (id: string | null | undefined) => (id ? (assets.get(id) ?? null) : null);
  // escura: a do painel; senão, a do acervo que acompanha o logo da plataforma
  return lineups.map((l) => {
    const id = logoOf(l);
    const dark = urlOf(l.platform.customLogoDarkAssetId) ?? (id ? (official.get(id) ?? null) : null);
    return lineupView(l, library, urlOf(id), dark);
  });
}

const today = () => new Date().toISOString().slice(0, 10);

function requestView(r: LineupReviewRequest, lineup: LineupView | null, library?: Map<string, LibraryEntry>) {
  const found = lineup ? findInLineup(lineup, r.targetType, r.targetId) : null;
  // Inclusão de canal ou streaming: o vínculo ainda não existe; o nome vem da biblioteca.
  const ref =
    r.targetType === 'plan_channel' || r.targetType === 'plan_service' ? r.targetId.split(':')[1] : null;
  return {
    id: r.id,
    targetType: r.targetType,
    targetId: r.targetId,
    targetName: found?.name ?? (ref ? (library?.get(ref)?.name ?? ref) : null),
    message: r.message,
    proposed: proposedView(r.targetType, r.proposed),
    status: r.status,
    resolutionNote: r.resolutionNote,
    resolvedBy: r.resolvedBy,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
  } satisfies RequestView;
}

export interface OperatorPortalData {
  operator: TenantOperator | null;
  /** Grade como a API publica (aprovado, planos vigentes); null = operadora ainda não aprovada. */
  lineup: LineupView | null;
  /** Itens da grade que a Galaxie ainda está conferindo: não saem na API. */
  pending: number;
  requests: RequestView[];
  /** Canais e streamings do país, para pedir a inclusão num plano. */
  library: LibraryEntry[];
}

/** Grade publicada da plataforma: o que a API mostra (aprovado e plano vigente hoje). */
async function publishedLineup(platformId: string): Promise<LineupView | null> {
  const lineup = await getPlatformLineup(lineupDb(), platformId, { minReview: PUBLISHED_MIN_REVIEW });
  if (!lineup) return null;
  const [view] = await toViews([lineup]);
  const day = today();
  return { ...view!, plans: view!.plans.filter((p) => planCurrentAt(p, day)) };
}

/** Portal do cliente: a operadora do tenant, a grade publicada e os pedidos do próprio tenant. */
export async function readOperatorPortal(tenantId: string): Promise<OperatorPortalData> {
  const db = lineupDb();
  const operator = await getTenantOperator(db, tenantId);
  if (!operator?.platformId) return { operator, lineup: null, pending: 0, requests: [], library: [] };
  const [lineup, all, requests] = await Promise.all([
    publishedLineup(operator.platformId),
    getPlatformLineup(db, operator.platformId, { minReview: 'draft' }),
    listLineupReviewRequests(db, { tenantId }),
  ]);
  const [full] = all ? await toViews([all]) : [null];
  // nomes dos pedidos de inclusão pela biblioteca inteira (como a fila do admin): a do país vem sem
  // rádio, e um pedido de rádio já gravado mostraria o id cru em "Meus pedidos"
  const refs = requests
    .filter((r) => r.targetType === 'plan_channel' || r.targetType === 'plan_service')
    .map((r) => r.targetId.split(':')[1]!)
    .filter(Boolean);
  const [library, byId] = await Promise.all([
    operator.platform ? readCountryLibrary(operator.platform.country) : Promise.resolve([]),
    readLibrary([...new Set(refs)]),
  ]);
  return {
    operator,
    lineup,
    pending: full ? flattenLineup(full).filter(awaitsDecision).length : 0,
    requests: requests.map((r) => requestView(r, full ?? null, byId)),
    library,
  };
}

/**
 * O que a operadora do tenant pode pedir para revisar: um item da grade publicada, ou a inclusão de um
 * canal ou streaming da biblioteca num plano publicado. null = fora da grade dela.
 */
export async function findOperatorTarget(
  tenantId: string,
  type: TargetType,
  id: string,
): Promise<{ item: ItemView | null; adding: boolean } | null> {
  const operator = await getTenantOperator(lineupDb(), tenantId);
  if (!operator?.platformId) return null;
  const lineup = await publishedLineup(operator.platformId);
  if (!lineup) return null;
  const item = findInLineup(lineup, type, id);
  if (item) return { item, adding: false };
  if (type !== 'plan_channel' && type !== 'plan_service') return null;
  const [planId, ref] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (!lineup.plans.some((p) => p.id === planId)) return null;
  const entry = (await readLibrary([ref])).get(ref);
  // canal de TV como plan_channel, streaming como plan_service; rádio não entra em plano
  if (!entry || libraryTargetType(entry.kind) !== type) return null;
  return { item: null, adding: true };
}

// ─── admin ───────────────────────────────────────────────────────────────────────────────────────

/** Canal ou streaming da biblioteca que o painel pode pôr num plano (com os países). */
export interface PlanLibraryOption extends LibraryEntry {
  countries: string[];
}

/** Biblioteca inteira de canais e streamings (sem rádio), para criar vínculos e complementos à mão. */
export async function readPlanLibrary(): Promise<PlanLibraryOption[]> {
  const list = await rows<LibraryRow & { countries: string[] }>(
    `select b.id, b.name, b.kind, null as storage_key, null as source_url, false as custom, b.countries
       from enrich.broadcaster b where b.kind = any($1) order by b.name`,
    [[...PLAN_LIBRARY_KINDS]],
  );
  return list.map((r) => ({ ...toEntry(r), countries: r.countries ?? [] }));
}

/** Todas as grades, com tudo (rascunho, conferido, aprovado e rejeitado), para a revisão. */
export async function readAllLineups(): Promise<LineupView[]> {
  const db = lineupDb();
  // o painel vê também os vínculos sem prova (a API nunca os mostra)
  const opts = { minReview: 'draft', includeRejected: true, includeUnverified: true } as const;
  const platforms = await listPlatforms(db, opts);
  const lineups = await Promise.all(platforms.map((p) => getPlatformLineup(db, p.id, opts)));
  return toViews(lineups.filter((l): l is PlatformLineup => l !== null));
}

export interface QueueRequest extends RequestView {
  tenant: { id: string; name: string };
  userEmail: string | null;
  platform: { id: string; name: string } | null;
  /** Item como está hoje (com tudo, não só o publicado); null = saiu da grade ou é uma inclusão. */
  current: ItemView | null;
}

async function emailsOf(userIds: string[]) {
  if (!userIds.length) return new Map<string, string>();
  const list = await rows<{ id: string; email: string }>('select id, email from "user" where id = any($1)', [
    userIds,
  ]);
  return new Map(list.map((r) => [r.id, r.email]));
}

/** Fila de pedidos das operadoras, com o item atual ao lado do proposto. */
export async function readRequestQueue(status: RequestStatus | null): Promise<{
  requests: QueueRequest[];
  counts: Record<RequestStatus, number>;
}> {
  const db = lineupDb();
  const [all, tenants] = await Promise.all([
    listLineupReviewRequests(db, { limit: 1000 }),
    listTenantOptions(),
  ]);
  const counts = { open: 0, accepted: 0, rejected: 0 } satisfies Record<RequestStatus, number>;
  for (const r of all) counts[r.status] += 1;
  const list = status ? all.filter((r) => r.status === status) : all;

  const lineups = new Map<string, LineupView | null>();
  const lineupOfTenant = async (tenantId: string) => {
    const op = await getTenantOperator(db, tenantId);
    if (!op?.platformId) return null;
    if (!lineups.has(op.platformId)) {
      const l = await getPlatformLineup(db, op.platformId, {
        minReview: 'draft',
        includeRejected: true,
        includeUnverified: true,
      });
      lineups.set(op.platformId, l ? ((await toViews([l]))[0] ?? null) : null);
    }
    return lineups.get(op.platformId) ?? null;
  };
  const refs = list
    .filter((r) => r.targetType === 'plan_channel' || r.targetType === 'plan_service')
    .map((r) => r.targetId.split(':')[1]!)
    .filter(Boolean);
  const [emails, library] = await Promise.all([
    emailsOf([...new Set(list.map((r) => r.userId))]),
    readLibrary([...new Set(refs)]),
  ]);
  const requests: QueueRequest[] = [];
  for (const r of list) {
    const lineup = await lineupOfTenant(r.tenantId);
    requests.push({
      ...requestView(r, lineup, library),
      tenant: { id: r.tenantId, name: tenants.find((t) => t.id === r.tenantId)?.name ?? r.tenantId },
      userEmail: emails.get(r.userId) ?? null,
      platform: lineup ? { id: lineup.platform.id, name: lineup.platform.name } : null,
      current: lineup ? findInLineup(lineup, r.targetType, r.targetId) : null,
    });
  }
  return { requests, counts };
}

export interface TenantOperatorRow {
  tenant: TenantOption;
  platformId: string | null;
  showOtherOperators: boolean;
  emailDomains: string[];
}

/** Cadastro: cada tenant com a operadora ligada, os domínios de e-mail e a preferência de outras operadoras. */
export async function readTenantOperators(): Promise<{
  rows: TenantOperatorRow[];
  platforms: { id: string; name: string; country: string }[];
}> {
  const db = lineupDb();
  const [tenants, platforms] = await Promise.all([
    listTenantOptions(),
    listPlatforms(db, { minReview: 'draft' }),
  ]);
  const list = await Promise.all(
    tenants.map(async (tenant) => {
      const op = await getTenantOperator(db, tenant.id);
      return {
        tenant,
        platformId: op?.platformId ?? null,
        showOtherOperators: op?.showOtherOperators ?? false,
        emailDomains: op?.emailDomains ?? [],
      };
    }),
  );
  return { rows: list, platforms: platforms.map((p) => ({ id: p.id, name: p.name, country: p.country })) };
}

/** Domínios de e-mail da operadora de cada tenant (aviso no convite de usuário cliente). */
export async function readOperatorDomains(tenantIds: string[]): Promise<Record<string, string[]>> {
  const db = lineupDb();
  const entries = await Promise.all(
    tenantIds.map(async (id) => [id, (await getTenantOperator(db, id))?.emailDomains ?? []] as const),
  );
  return Object.fromEntries(entries.filter(([, d]) => d.length));
}
