/**
 * Grade de canais e ofertas das operadoras e streamings (onde assistir): em que plataforma e em que
 * plano está cada canal, e quais streamings vêm inclusos num plano.
 *
 * - A pesquisa (`lineups-research`, em services/ai-agents) grava tudo como `draft` por
 *   `upsertLineupDraft`, sempre com fonte; item sem fonte não entra.
 * - O painel aprova (`setLineupReviewStatus`). Item já revisado ou aprovado nunca volta a rascunho só
 *   por ser revisto: a mudança encontrada fica em `proposed_change` até alguém aprovar ou descartar.
 * - A operadora cliente só pede revisão pelo portal (`createLineupReviewRequest`); aceito com `apply`,
 *   o pedido vira dado oficial com a fonte "informado pela operadora".
 * - A leitura pública (`availabilityForChannels`) usa só o que está aprovado (padrão `minReview`).
 */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  ADDON_KINDS,
  asset,
  broadcaster,
  LOGO_UPLOAD_TARGETS,
  logoUpload,
  LINEUP_ACCESS,
  LINEUP_REQUEST_STATUSES,
  LINEUP_REVIEW_STATUSES,
  LINEUP_TARGET_TYPES,
  lineupPage,
  lineupReviewRequest,
  planChannel,
  platformAddon,
  planService,
  platform,
  platformPlan,
  PLATFORM_KINDS,
  tenant,
  type LineupAccess,
  type LineupManualEdit,
  type LineupManualFields,
  type LineupProposedChange,
  type LineupRequestStatus,
  type LineupReviewStatus,
  type LineupSource,
  type LineupTargetType,
  type AddonKind,
  type LineupPageContent,
  type LineupPageStatus,
  type LineupPageVia,
  type LineupVerification,
  type LogoUploadTarget,
  type PlatformKind,
} from './schema/index.js';
import { publishChange } from './change-feed.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

// ─── tipos ───────────────────────────────────────────────────────────────────────────────────────

export type LineupPlatform = typeof platform.$inferSelect;
export type LineupPlan = typeof platformPlan.$inferSelect;
export type LineupPlanChannel = typeof planChannel.$inferSelect;
export type LineupPlanService = typeof planService.$inferSelect;
export type LineupReviewRequest = typeof lineupReviewRequest.$inferSelect;
export type LineupAddon = typeof platformAddon.$inferSelect;
export type LineupPage = typeof lineupPage.$inferSelect;

/** Item da grade: plataforma, plano ou vínculo plano × canal / plano × streaming. */
export type LineupTarget =
  | { type: 'platform'; id: string }
  | { type: 'plan'; id: string }
  | { type: 'plan_channel'; planId: string; channelId: string }
  | { type: 'plan_service'; planId: string; serviceId: string }
  | { type: 'addon'; id: string };

/** Nível mínimo de revisão de uma leitura (`rejected` nunca conta como nível). */
export type LineupMinReview = Exclude<LineupReviewStatus, 'rejected'>;

export interface LineupReadOptions {
  /** Padrão `approved` (o que a API pública mostra). O painel usa `draft`. */
  minReview?: LineupMinReview;
  /** Inclui os itens `rejected` (painel). */
  includeRejected?: boolean;
  /**
   * Inclui os vínculos `unverified` (sem prova oficial e específica do plano). Padrão false: a leitura
   * pública nunca os mostra, nem como incluso nem como adicional. O painel usa true.
   */
  includeUnverified?: boolean;
}

/** Fonte de entrada: URL (pesquisa) ou a fonte completa. */
export type LineupSourceInput = string | LineupSource;

export interface LineupChannelDraft {
  /** Id da biblioteca de emissoras (enrich.broadcaster.id). */
  channelId: string;
  access?: LineupAccess;
  sources: LineupSourceInput[];
  /** Checagens do validador (sempre regravadas: não viram mudança para revisar). */
  verification?: LineupVerification | null;
}

export interface LineupServiceDraft {
  /** Id da biblioteca de emissoras (enrich.broadcaster.id) do streaming. */
  serviceId: string;
  access?: LineupAccess;
  sources: LineupSourceInput[];
  verification?: LineupVerification | null;
}

export interface LineupPlanDraft {
  name: string;
  /** Padrão: `lineupSlug(name)`. */
  slug?: string;
  priceText?: string | null;
  /** Preço cheio de lista, só com prova oficial; null limpa o do rascunho (o aprovado fica). */
  priceAmount?: number | null;
  /** ISO 4217. */
  priceCurrency?: string | null;
  url?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  sources: LineupSourceInput[];
  verification?: LineupVerification | null;
  channels?: LineupChannelDraft[];
  services?: LineupServiceDraft[];
  /**
   * Os vínculos vieram completos (a grade do plano lida na página oficial): canal ou streaming gravado
   * que não veio fica com `proposed_change.removed`, mesmo sem `complete` na plataforma.
   */
  completeLinks?: boolean;
}

/** Oferta de complemento da plataforma (serviço ou canal contratado à parte). */
export interface LineupAddonDraft {
  kind: AddonKind;
  /** Id da biblioteca de emissoras. */
  refId: string;
  /** Canal numerado da entrada ("ESPN 6"), quando o complemento é um canal. */
  channel?: string | null;
  /** Nome como a plataforma publica. */
  name: string;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  priceText?: string | null;
  /** Fidelidade em meses (null = mensal). */
  commitmentMonths?: number | null;
  url?: string | null;
  sources: LineupSourceInput[];
  verification?: LineupVerification | null;
}

export interface LineupDraftInput {
  platform: {
    name: string;
    kind: PlatformKind;
    /** ISO2. */
    country: string;
    /** Padrão: `platformSlug(country, name)`. */
    slug?: string;
    website?: string | null;
    /** Domínios oficiais além do site (somados aos já gravados). */
    officialDomains?: string[];
    broadcasterId?: string | null;
    sources: LineupSourceInput[];
  };
  plans?: LineupPlanDraft[];
  /** Catálogo de complementos da plataforma. */
  addons?: LineupAddonDraft[];
  /** O catálogo veio completo: complemento gravado que não veio fica com `proposed_change.removed`. */
  addonsComplete?: boolean;
  /** Quando a pesquisa viu os dados (padrão: agora). */
  seenAt?: Date;
  /**
   * A entrada traz a grade inteira da plataforma (revisita): planos e vínculos gravados que não vieram
   * ficam com `proposed_change.removed` (nada é apagado; o painel decide).
   */
  complete?: boolean;
}

export interface LineupChange {
  target: LineupTarget;
  /** Campos que mudaram (ou `removed`). */
  fields: string[];
}

export interface LineupUpsertResult {
  platformId: string;
  /** slug do plano → id. */
  planIds: Record<string, string>;
  created: number;
  /** Rascunhos atualizados com dados novos. */
  updated: number;
  /** Só a fonte e o `seen_at` renovados. */
  unchanged: number;
  /** Itens sem fonte (ou plano sem nome): não entram. */
  skipped: number;
  /** Itens marcados como não vistos na revisita (`complete`). */
  removed: number;
  /** Mudanças em itens revisados/aprovados, guardadas em `proposed_change`. */
  changes: LineupChange[];
}

/** Campos que um pedido de revisão (ou uma mudança pendente) pode propor, por tipo de item. */
export interface LineupProposal {
  name?: string;
  website?: string | null;
  kind?: PlatformKind;
  priceText?: string | null;
  priceAmount?: number | null;
  priceCurrency?: string | null;
  url?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  access?: LineupAccess;
  /** Tirar o item da grade (plano: encerra a vigência hoje; vínculo: apaga). */
  removed?: boolean;
}

export interface ChannelAvailabilityPlan {
  plan: LineupPlan;
  /** Canais pedidos que estão no plano. */
  viaChannels: { channelId: string; access: LineupAccess }[];
  /** Streamings pedidos que o plano inclui (ou o próprio streaming, quando a plataforma é ele). */
  services: { serviceId: string; access: LineupAccess }[];
}

export interface ChannelAvailability {
  platform: LineupPlatform;
  plans: ChannelAvailabilityPlan[];
  /** Complementos da plataforma para os canais ou streamings pedidos (contratados à parte). */
  addons: LineupAddon[];
}

export interface AvailabilityOptions extends LineupReadOptions {
  /** Ids da biblioteca de emissoras (os canais/streamings que transmitem o jogo). */
  channelIds: string[];
  /** ISO2. */
  country: string;
  /** Só esta plataforma (cliente operadora que não mostra as outras). */
  onlyPlatformId?: string | null;
  /**
   * Inclui os planos que dão acesso por um streaming incluso (plano × serviço) e as plataformas de
   * streaming que são o próprio serviço pedido. Padrão: true.
   */
  includeStreaming?: boolean;
  /** Data de vigência dos planos (padrão: hoje, UTC). */
  at?: Date;
  /**
   * Canais numerados do jogo por id da biblioteca (`{ espn: ['ESPN 4'] }`). Um complemento de canal
   * ("ESPN 6") só entra quando o jogo passa nesse canal: sem isso, ele não colapsa na emissora
   * e um plano que já tem a ESPN não ganha "ESPN 6 como complemento" num jogo da ESPN 4.
   */
  channelNames?: Record<string, readonly (string | null)[]>;
}

export interface PlatformLineup {
  platform: LineupPlatform;
  plans: { plan: LineupPlan; channels: LineupPlanChannel[]; services: LineupPlanService[] }[];
  /** Catálogo de complementos da plataforma (por nome e fidelidade). */
  addons: LineupAddon[];
}

export interface TenantOperator {
  tenantId: string;
  platformId: string | null;
  showOtherOperators: boolean;
  emailDomains: string[];
  platform: LineupPlatform | null;
}

export type LineupErrorCode =
  | 'invalid_input'
  | 'target_not_found'
  | 'forbidden_target'
  | 'request_not_found'
  | 'already_resolved'
  | 'tenant_not_found';

export class LineupError extends Error {
  constructor(
    readonly code: LineupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LineupError';
  }
}

/** Rótulo da fonte do dado informado pela operadora. */
export const OPERATOR_SOURCE_NOTE = 'informado pela operadora';
/** Fontes guardadas por item (as mais recentes). */
export const MAX_LINEUP_SOURCES = 10;

// ─── utilitários ─────────────────────────────────────────────────────────────────────────────────

/** Nome → slug (sem acento, minúsculas, `+` = "plus", hífens). */
export function lineupSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Slug da plataforma: `<iso2>-<nome>`. */
export function platformSlug(country: string, name: string): string {
  return `${country.trim().toLowerCase()}-${lineupSlug(name)}`;
}

/** `target_id` do pedido de revisão. */
export function lineupTargetId(target: LineupTarget): string {
  switch (target.type) {
    case 'platform':
    case 'plan':
    case 'addon':
      return target.id;
    case 'plan_channel':
      return `${target.planId}:${target.channelId}`;
    case 'plan_service':
      return `${target.planId}:${target.serviceId}`;
  }
}

/** (target_type, target_id) → alvo. */
export function parseLineupTarget(type: string, id: string): LineupTarget {
  if (type === 'platform' || type === 'plan' || type === 'addon') return { type, id };
  if (type === 'plan_channel' || type === 'plan_service') {
    const i = id.indexOf(':');
    if (i <= 0 || i === id.length - 1) throw new LineupError('invalid_input', `target_id inválido: ${id}`);
    const planId = id.slice(0, i);
    const other = id.slice(i + 1);
    return type === 'plan_channel' ? { type, planId, channelId: other } : { type, planId, serviceId: other };
  }
  throw new LineupError('invalid_input', `target_type inválido: ${type}`);
}

/** Status aceitos numa leitura com `minReview`. */
export function reviewStatusesFor(opts: LineupReadOptions = {}): LineupReviewStatus[] {
  const min = opts.minReview ?? 'approved';
  const levels: LineupMinReview[] = ['draft', 'reviewed', 'approved'];
  const i = levels.indexOf(min);
  if (i < 0) throw new LineupError('invalid_input', `minReview inválido: ${String(min)}`);
  const out: LineupReviewStatus[] = levels.slice(i);
  if (opts.includeRejected) out.push('rejected');
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO2_RE = /^[A-Z]{2}$/;

const isUuid = (v: string) => UUID_RE.test(v);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

function normalizeCountry(country: string): string {
  const c = country.trim().toUpperCase();
  if (!ISO2_RE.test(c)) throw new LineupError('invalid_input', `País inválido: ${country}`);
  return c;
}

function cleanText(v: string | null | undefined, max: number): string | null {
  if (v === null || v === undefined) return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function cleanUrl(v: string | null | undefined): string | null {
  const t = cleanText(v, 1000);
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Preço: número positivo com até 2 casas (string numérica também vale); null = sem preço. */
function cleanAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0 || n >= 1e10)
    throw new LineupError('invalid_input', `Preço inválido: ${String(v)}`);
  return Math.round(n * 100) / 100;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

function cleanCurrency(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const c = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (!CURRENCY_RE.test(c)) throw new LineupError('invalid_input', `Moeda inválida (ISO 4217): ${String(v)}`);
  return c;
}

/** Domínios oficiais: host (com caminho opcional), minúsculo, sem esquema nem `www.`, sem repetidos. */
export function normalizeOfficialDomains(domains: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of domains) {
    const d = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
    const host = d.split('/')[0] ?? '';
    if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) continue;
    if (!out.includes(d)) out.push(d);
  }
  return out.slice(0, 20);
}

function cleanDay(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (!DAY_RE.test(v) || !Number.isFinite(Date.parse(v)))
    throw new LineupError('invalid_input', `Data inválida (YYYY-MM-DD): ${v}`);
  return v;
}

/** Fontes de entrada → fontes válidas (http(s) ou informadas sem URL com `kind`). */
export function normalizeSources(input: readonly LineupSourceInput[], seenAt: Date): LineupSource[] {
  const out: LineupSource[] = [];
  for (const s of input) {
    if (typeof s === 'string') {
      const url = cleanUrl(s);
      if (url) out.push({ url, seen_at: seenAt.toISOString(), kind: 'research' });
      continue;
    }
    const url = s.url === null ? null : cleanUrl(s.url);
    if (!url && !(s.url === null && s.kind && s.kind !== 'research')) continue;
    out.push({ ...s, url, seen_at: s.seen_at || seenAt.toISOString() });
  }
  return mergeSources([], out);
}

/** Junta fontes por URL (a mais recente vence) e guarda as `MAX_LINEUP_SOURCES` mais recentes. */
export function mergeSources(prev: readonly LineupSource[], next: readonly LineupSource[]): LineupSource[] {
  const key = (s: LineupSource) => s.url ?? `${s.kind ?? ''}:${s.request_id ?? s.note ?? ''}`;
  const byKey = new Map<string, LineupSource>();
  for (const s of [...prev, ...next]) {
    const k = key(s);
    const cur = byKey.get(k);
    if (!cur || cur.seen_at <= s.seen_at) byKey.set(k, cur ? { ...cur, ...s } : s);
  }
  return [...byKey.values()]
    .sort((a, b) => (a.seen_at < b.seen_at ? 1 : a.seen_at > b.seen_at ? -1 : 0))
    .slice(0, MAX_LINEUP_SOURCES);
}

/** Campos de `next` (definidos e não nulos) que diferem de `cur`. */
function diffFields<T extends Record<string, unknown>>(cur: T, next: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(next) as [keyof T, T[keyof T]][]) {
    if (v === undefined || v === null) continue;
    if (cur[k] !== v) out[k] = v;
  }
  return out;
}

const PROPOSAL_KEYS: Record<LineupTargetType, (keyof LineupProposal)[]> = {
  platform: ['name', 'website', 'kind'],
  plan: ['name', 'priceText', 'priceAmount', 'priceCurrency', 'url', 'validFrom', 'validTo', 'removed'],
  plan_channel: ['access', 'removed'],
  plan_service: ['access', 'removed'],
  addon: ['name', 'priceText', 'priceAmount', 'priceCurrency', 'url', 'removed'],
};

/** Mantém só os campos válidos para o tipo de item, já normalizados. */
export function sanitizeProposal(type: LineupTargetType, raw: unknown): LineupProposal {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw))
    throw new LineupError('invalid_input', 'proposed precisa ser um objeto.');
  const src = raw as Record<string, unknown>;
  const out: LineupProposal = {};
  for (const k of PROPOSAL_KEYS[type]) {
    if (!(k in src) || src[k] === undefined) continue;
    const v = src[k];
    switch (k) {
      case 'name': {
        const t = typeof v === 'string' ? cleanText(v, 160) : null;
        if (!t) throw new LineupError('invalid_input', 'name vazio.');
        out.name = t;
        break;
      }
      case 'website':
      case 'url': {
        if (v !== null && typeof v !== 'string') throw new LineupError('invalid_input', `${k} inválido.`);
        const u = v === null ? null : cleanUrl(v);
        if (v !== null && !u) throw new LineupError('invalid_input', `${k} precisa ser uma URL http(s).`);
        out[k] = u;
        break;
      }
      case 'kind':
        if (!PLATFORM_KINDS.includes(v as PlatformKind))
          throw new LineupError('invalid_input', `kind inválido: ${String(v)}`);
        out.kind = v as PlatformKind;
        break;
      case 'priceText':
        if (v !== null && typeof v !== 'string')
          throw new LineupError('invalid_input', 'priceText inválido.');
        out.priceText = v === null ? null : cleanText(v, 120);
        break;
      case 'priceAmount':
        out.priceAmount = cleanAmount(v);
        break;
      case 'priceCurrency':
        out.priceCurrency = cleanCurrency(v);
        break;
      case 'validFrom':
      case 'validTo':
        if (v !== null && typeof v !== 'string') throw new LineupError('invalid_input', `${k} inválido.`);
        out[k] = cleanDay(v as string | null);
        break;
      case 'access':
        if (!LINEUP_ACCESS.includes(v as LineupAccess))
          throw new LineupError('invalid_input', `access inválido: ${String(v)}`);
        out.access = v as LineupAccess;
        break;
      case 'removed':
        if (typeof v !== 'boolean') throw new LineupError('invalid_input', 'removed precisa ser booleano.');
        if (v) out.removed = true;
        break;
    }
  }
  return out;
}

// ─── leitura ─────────────────────────────────────────────────────────────────────────────────────

const KIND_ORDER: Record<PlatformKind, number> = {
  pay_tv_operator: 0,
  vmvpd: 1,
  telco_bundle: 2,
  streaming: 3,
};

const byPlatform = (a: LineupPlatform, b: LineupPlatform) =>
  KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name, 'pt-BR');
const byPlan = (a: LineupPlan, b: LineupPlan) => a.name.localeCompare(b.name, 'pt-BR');
const byAddon = (a: LineupAddon, b: LineupAddon) =>
  a.refId.localeCompare(b.refId) ||
  (a.commitmentMonths ?? 0) - (b.commitmentMonths ?? 0) ||
  a.name.localeCompare(b.name, 'pt-BR');

/** Sem `includeUnverified`, o vínculo sem prova (`unverified`) fica fora da leitura. */
function verifiedOnly(
  access: typeof planChannel.access | typeof planService.access,
  opts: LineupReadOptions,
): SQL[] {
  return opts.includeUnverified ? [] : [ne(access, 'unverified')];
}

/** Plano vigente na data (YYYY-MM-DD). */
function planCurrentAt(day: string): SQL {
  return sql`(${platformPlan.validFrom} is null or ${platformPlan.validFrom} <= ${day}) and (${platformPlan.validTo} is null or ${platformPlan.validTo} >= ${day})`;
}

/** Plataformas (de um país e/ou tipo), por tipo e nome. */
export async function listPlatforms(
  db: Database,
  opts: LineupReadOptions & { country?: string; kind?: PlatformKind } = {},
): Promise<LineupPlatform[]> {
  const where: SQL[] = [inArray(platform.reviewStatus, reviewStatusesFor(opts))];
  if (opts.country) where.push(eq(platform.country, normalizeCountry(opts.country)));
  if (opts.kind) where.push(eq(platform.kind, opts.kind));
  const rows = await db
    .select()
    .from(platform)
    .where(and(...where))
    .orderBy(asc(platform.country), asc(platform.name));
  return rows.sort((a, b) => a.country.localeCompare(b.country) || byPlatform(a, b));
}

/**
 * Plataforma com os planos (todos, inclusive fora de vigência), canais e serviços, filtrados pelo
 * nível de revisão. null se a plataforma não existe ou está abaixo do nível.
 */
export async function getPlatformLineup(
  db: Database,
  platformId: string,
  opts: LineupReadOptions = {},
): Promise<PlatformLineup | null> {
  if (!isUuid(platformId)) return null;
  const statuses = reviewStatusesFor(opts);
  const [p] = await db
    .select()
    .from(platform)
    .where(and(eq(platform.id, platformId), inArray(platform.reviewStatus, statuses)));
  if (!p) return null;
  const plans = await db
    .select()
    .from(platformPlan)
    .where(and(eq(platformPlan.platformId, platformId), inArray(platformPlan.reviewStatus, statuses)));
  const ids = plans.map((pl) => pl.id);
  const [channels, services] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(planChannel)
          .where(
            and(
              inArray(planChannel.planId, ids),
              inArray(planChannel.reviewStatus, statuses),
              ...verifiedOnly(planChannel.access, opts),
            ),
          )
          .orderBy(asc(planChannel.channelId)),
        db
          .select()
          .from(planService)
          .where(
            and(
              inArray(planService.planId, ids),
              inArray(planService.reviewStatus, statuses),
              ...verifiedOnly(planService.access, opts),
            ),
          )
          .orderBy(asc(planService.serviceId)),
      ])
    : [[], []];
  const addons = await db
    .select()
    .from(platformAddon)
    .where(and(eq(platformAddon.platformId, platformId), inArray(platformAddon.reviewStatus, statuses)));
  return {
    platform: p,
    plans: plans.sort(byPlan).map((plan) => ({
      plan,
      channels: channels.filter((c) => c.planId === plan.id),
      services: services.filter((s) => s.planId === plan.id),
    })),
    addons: addons.sort(byAddon),
  };
}

/**
 * Onde estão os canais de um jogo: plataformas do país cujos planos vigentes têm algum dos canais
 * (e, com `includeStreaming`, algum dos streamings inclusos, ou que são o próprio streaming). Plataforma,
 * plano e vínculo precisam estar no nível de revisão pedido (padrão: aprovado).
 */
export async function availabilityForChannels(
  db: Database,
  opts: AvailabilityOptions,
): Promise<ChannelAvailability[]> {
  const ids = [...new Set(opts.channelIds.filter(Boolean))];
  if (!ids.length) return [];
  const country = normalizeCountry(opts.country);
  const statuses = reviewStatusesFor(opts);
  const day = dayOf(opts.at ?? new Date());
  const includeStreaming = opts.includeStreaming ?? true;
  if (opts.onlyPlatformId !== undefined && opts.onlyPlatformId !== null && !isUuid(opts.onlyPlatformId))
    return [];
  const platformWhere = (): SQL[] => {
    const w: SQL[] = [eq(platform.country, country), inArray(platform.reviewStatus, statuses)];
    if (opts.onlyPlatformId) w.push(eq(platform.id, opts.onlyPlatformId));
    return w;
  };
  const planWhere = (): SQL[] => [inArray(platformPlan.reviewStatus, statuses), planCurrentAt(day)];

  const viaChannel = await db
    .select({ platform, plan: platformPlan, channelId: planChannel.channelId, access: planChannel.access })
    .from(planChannel)
    .innerJoin(platformPlan, eq(platformPlan.id, planChannel.planId))
    .innerJoin(platform, eq(platform.id, platformPlan.platformId))
    .where(
      and(
        inArray(planChannel.channelId, ids),
        inArray(planChannel.reviewStatus, statuses),
        ...verifiedOnly(planChannel.access, opts),
        ...planWhere(),
        ...platformWhere(),
      ),
    );
  const viaService = includeStreaming
    ? await db
        .select({
          platform,
          plan: platformPlan,
          serviceId: planService.serviceId,
          access: planService.access,
        })
        .from(planService)
        .innerJoin(platformPlan, eq(platformPlan.id, planService.planId))
        .innerJoin(platform, eq(platform.id, platformPlan.platformId))
        .where(
          and(
            inArray(planService.serviceId, ids),
            inArray(planService.reviewStatus, statuses),
            ...verifiedOnly(planService.access, opts),
            ...planWhere(),
            ...platformWhere(),
          ),
        )
    : [];
  const selfStreaming = includeStreaming
    ? await db
        .select()
        .from(platform)
        .where(and(eq(platform.kind, 'streaming'), inArray(platform.broadcasterId, ids), ...platformWhere()))
    : [];
  const selfPlans = selfStreaming.length
    ? await db
        .select()
        .from(platformPlan)
        .where(
          and(
            inArray(
              platformPlan.platformId,
              selfStreaming.map((p) => p.id),
            ),
            ...planWhere(),
          ),
        )
    : [];

  // complemento da plataforma (contratado à parte) para os canais/streamings pedidos
  const viaAddon = await db
    .select({ platform, addon: platformAddon })
    .from(platformAddon)
    .innerJoin(platform, eq(platform.id, platformAddon.platformId))
    .where(
      and(
        inArray(platformAddon.refId, ids),
        inArray(platformAddon.reviewStatus, statuses),
        ...platformWhere(),
      ),
    );

  const order = new Map(ids.map((id, i) => [id, i]));
  const out = new Map<
    string,
    { platform: LineupPlatform; plans: Map<string, ChannelAvailabilityPlan>; addons: LineupAddon[] }
  >();
  const entry = (p: LineupPlatform) => {
    let e = out.get(p.id);
    if (!e) out.set(p.id, (e = { platform: p, plans: new Map(), addons: [] }));
    return e;
  };
  const planEntry = (p: LineupPlatform, plan: LineupPlan) => {
    const e = entry(p);
    let pe = e.plans.get(plan.id);
    if (!pe) e.plans.set(plan.id, (pe = { plan, viaChannels: [], services: [] }));
    return pe;
  };
  for (const r of viaChannel)
    planEntry(r.platform, r.plan).viaChannels.push({ channelId: r.channelId, access: r.access });
  for (const r of viaService)
    planEntry(r.platform, r.plan).services.push({ serviceId: r.serviceId, access: r.access });
  for (const p of selfStreaming) {
    entry(p);
    for (const plan of selfPlans.filter((pl) => pl.platformId === p.id)) {
      const pe = planEntry(p, plan);
      if (!pe.services.some((s) => s.serviceId === p.broadcasterId))
        pe.services.push({ serviceId: p.broadcasterId!, access: 'included' });
    }
  }
  const gameChannels = new Map(
    Object.entries(opts.channelNames ?? {}).map(([id, names]) => [
      id,
      new Set(names.flatMap((n) => (n ? [lineupSlug(n)] : []))),
    ]),
  );
  // complemento de canal: só com o canal do jogo; o de serviço/emissora inteira vale pela emissora
  const addonMatches = (a: LineupAddon) =>
    !a.channel || !!gameChannels.get(a.refId)?.has(lineupSlug(a.channel));
  for (const r of viaAddon) if (addonMatches(r.addon)) entry(r.platform).addons.push(r.addon);
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...out.values()]
    .map((e) => ({
      platform: e.platform,
      addons: e.addons.sort((a, b) => rank(a.refId) - rank(b.refId) || byAddon(a, b)),
      plans: [...e.plans.values()]
        .map((pe) => ({
          plan: pe.plan,
          viaChannels: pe.viaChannels.sort((a, b) => rank(a.channelId) - rank(b.channelId)),
          services: pe.services.sort((a, b) => rank(a.serviceId) - rank(b.serviceId)),
        }))
        .sort((a, b) => byPlan(a.plan, b.plan)),
    }))
    .sort((a, b) => byPlatform(a.platform, b.platform));
}

// ─── gravação da pesquisa ────────────────────────────────────────────────────────────────────────

const PRICE_FIELDS = ['priceText', 'priceAmount', 'priceCurrency'] as const;

/** Slug da oferta de complemento: `<ref>[-<canal>][-f<meses>]`. */
export function addonSlug(refId: string, channel: string | null, commitmentMonths: number | null): string {
  return [refId, channel ? lineupSlug(channel) : '', commitmentMonths ? `f${commitmentMonths}` : '']
    .filter(Boolean)
    .join('-');
}

interface UpsertCtx {
  tx: Tx;
  now: Date;
  seenAt: Date;
  result: LineupUpsertResult;
}

/**
 * Decide o que fazer com um item já gravado visto de novo pela pesquisa: rascunho recebe os dados
 * novos; revisado/aprovado só guarda a mudança em `proposed_change`; rejeitado só renova a fonte.
 * `meta` (as checagens do validador) é sempre regravado e não conta como mudança. `clearable`: campos
 * cujo null vindo da pesquisa limpa o rascunho (preço sem prova); no aprovado, null não propõe nada.
 */
function reconcile<T extends Record<string, unknown>>(
  ctx: UpsertCtx,
  target: LineupTarget,
  cur: T & {
    reviewStatus: LineupReviewStatus;
    sources: LineupSource[];
    proposedChange: LineupProposedChange | null;
    manualFields?: LineupManualFields | null;
  },
  next: Partial<T>,
  sources: LineupSource[],
  opts: { meta?: Record<string, unknown>; clearable?: readonly string[] } = {},
): Record<string, unknown> {
  const merged = mergeSources(cur.sources, sources);
  // campo editado à mão no painel: a pesquisa não mexe (nem aplica no rascunho, nem propõe no aprovado)
  const manual = cur.manualFields ?? {};
  const diff = withoutManual(diffFields(cur, next), manual);
  const cleared: Record<string, null> = {};
  for (const k of opts.clearable ?? [])
    if (k in next && (next as Record<string, unknown>)[k] === null && cur[k] != null && !(k in manual))
      cleared[k] = null;
  const keys = Object.keys(diff);
  const set: Record<string, unknown> = {
    sources: merged,
    seenAt: ctx.seenAt,
    updatedAt: ctx.now,
    ...opts.meta,
  };
  const pending = cur.proposedChange;
  if (cur.reviewStatus === 'draft') {
    Object.assign(set, diff, cleared);
    keys.push(...Object.keys(cleared));
    set.proposedChange = explicitChange(pending);
    if (keys.length) ctx.result.updated++;
    else ctx.result.unchanged++;
  } else if (cur.reviewStatus === 'rejected') {
    ctx.result.unchanged++;
  } else if (keys.length && !pending?.manual) {
    set.proposedChange = { ...diff, seen_at: ctx.seenAt.toISOString() };
    ctx.result.changes.push({ target, fields: keys });
  } else {
    // (com edição manual esperando aprovação, a diferença da pesquisa fica para a revisita seguinte: a
    // mudança pendente é a do painel)
    // visto de novo igual ao aprovado: a mudança pendente (ou o "não visto") perde o sentido; a explícita
    // (rebrand, página oficial mudou) fica até alguém decidir
    if (pending) set.proposedChange = explicitChange(pending);
    ctx.result.unchanged++;
  }
  return set;
}

/** Tira de `diff` os campos editados à mão. */
function withoutManual<T extends Record<string, unknown>>(
  diff: Partial<T>,
  manual: LineupManualFields,
): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(diff) as [keyof T, T[keyof T]][])
    if (!(String(k) in manual)) out[k] = v;
  return out;
}

/**
 * Mudança proposta explicitamente (rebrand, página oficial mudou: vem com `note`): sobrevive à pesquisa
 * que revê o item. O "não visto" (`removed`) e a diferença da pesquisa, não.
 */
function explicitChange(pending: LineupProposedChange | null): LineupProposedChange | null {
  if (pending?.manual) return pending;
  if (!pending || typeof pending.note !== 'string') return null;
  const { removed: _removed, ...rest } = pending;
  void _removed;
  return rest;
}

async function markRemoved(
  ctx: UpsertCtx,
  target: LineupTarget,
  row: {
    reviewStatus: LineupReviewStatus;
    proposedChange: LineupProposedChange | null;
    manualFields?: LineupManualFields | null;
  },
): Promise<void> {
  if (row.reviewStatus === 'rejected' || row.proposedChange?.removed) return;
  // item criado à mão não vem da pesquisa (não tê-lo visto não diz nada); edição manual pendente fica
  if (row.manualFields?.created || row.proposedChange?.manual) return;
  const change: LineupProposedChange = { removed: true, seen_at: ctx.seenAt.toISOString() };
  const set = { proposedChange: change, updatedAt: ctx.now };
  if (target.type === 'plan')
    await ctx.tx.update(platformPlan).set(set).where(eq(platformPlan.id, target.id));
  else if (target.type === 'plan_channel')
    await ctx.tx
      .update(planChannel)
      .set(set)
      .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)));
  else if (target.type === 'plan_service')
    await ctx.tx
      .update(planService)
      .set(set)
      .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)));
  else if (target.type === 'addon')
    await ctx.tx.update(platformAddon).set(set).where(eq(platformAddon.id, target.id));
  ctx.result.removed++;
  ctx.result.changes.push({ target, fields: ['removed'] });
}

async function upsertLink(
  ctx: UpsertCtx,
  kind: 'channel' | 'service',
  planId: string,
  refId: string,
  access: LineupAccess,
  sources: LineupSource[],
  verification: LineupVerification | null,
): Promise<void> {
  const table = kind === 'channel' ? planChannel : planService;
  const refCol = kind === 'channel' ? planChannel.channelId : planService.serviceId;
  const planCol = kind === 'channel' ? planChannel.planId : planService.planId;
  const target: LineupTarget =
    kind === 'channel'
      ? { type: 'plan_channel', planId, channelId: refId }
      : { type: 'plan_service', planId, serviceId: refId };
  const [cur] = await ctx.tx
    .select()
    .from(table)
    .where(and(eq(planCol, planId), eq(refCol, refId)));
  if (!cur) {
    const base = {
      planId,
      access,
      sources,
      verification,
      seenAt: ctx.seenAt,
      reviewStatus: 'draft' as const,
    };
    if (kind === 'channel') await ctx.tx.insert(planChannel).values({ ...base, channelId: refId });
    else await ctx.tx.insert(planService).values({ ...base, serviceId: refId });
    ctx.result.created++;
    return;
  }
  const set = reconcile(
    ctx,
    target,
    cur,
    { access },
    sources,
    verification ? { meta: { verification } } : {},
  );
  await ctx.tx
    .update(table)
    .set(set)
    .where(and(eq(planCol, planId), eq(refCol, refId)));
}

/**
 * Grava (ou revê) a grade de uma plataforma vinda da pesquisa. Idempotente por slug e país: rodar de
 * novo com os mesmos dados só renova a fonte e o `seen_at`. Item novo entra como `draft`; item
 * revisado/aprovado nunca volta a rascunho (a mudança fica em `proposed_change`); item rejeitado
 * continua rejeitado. Item sem fonte não entra.
 */
export async function upsertLineupDraft(db: Database, input: LineupDraftInput): Promise<LineupUpsertResult> {
  const now = new Date();
  const seenAt = input.seenAt ?? now;
  const country = normalizeCountry(input.platform.country);
  const name = cleanText(input.platform.name, 160);
  if (!name) throw new LineupError('invalid_input', 'Plataforma sem nome.');
  if (!PLATFORM_KINDS.includes(input.platform.kind))
    throw new LineupError('invalid_input', `kind inválido: ${String(input.platform.kind)}`);
  const slug = input.platform.slug ? lineupSlug(input.platform.slug) : platformSlug(country, name);
  if (!slug) throw new LineupError('invalid_input', 'Slug da plataforma vazio.');
  const platformSources = normalizeSources(input.platform.sources, seenAt);
  if (!platformSources.length) throw new LineupError('invalid_input', `Plataforma sem fonte: ${slug}`);

  return db.transaction(async (tx) => {
    const result: LineupUpsertResult = {
      platformId: '',
      planIds: {},
      created: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      removed: 0,
      changes: [],
    };
    const ctx: UpsertCtx = { tx, now, seenAt, result };
    const fields = {
      name,
      kind: input.platform.kind,
      website: cleanUrl(input.platform.website),
      broadcasterId: input.platform.broadcasterId?.trim() || null,
    };
    const domains = normalizeOfficialDomains(input.platform.officialDomains ?? []);
    const [cur] = await tx.select().from(platform).where(eq(platform.slug, slug));
    let platformId: string;
    if (!cur) {
      const [row] = await tx
        .insert(platform)
        .values({
          slug,
          country,
          ...fields,
          officialDomains: domains,
          sources: platformSources,
          seenAt,
          reviewStatus: 'draft',
        })
        .returning({ id: platform.id });
      platformId = row!.id;
      result.created++;
    } else {
      if (cur.country !== country)
        throw new LineupError('invalid_input', `Slug ${slug} já existe em outro país (${cur.country}).`);
      platformId = cur.id;
      // domínios oficiais só somam (tirar um é decisão do painel)
      const officialDomains = normalizeOfficialDomains([...cur.officialDomains, ...domains]);
      const set = reconcile(ctx, { type: 'platform', id: cur.id }, cur, fields, platformSources, {
        meta: { officialDomains },
      });
      await tx.update(platform).set(set).where(eq(platform.id, cur.id));
    }
    result.platformId = platformId;

    const seenPlans = new Set<string>();
    for (const p of input.plans ?? []) {
      const planName = cleanText(p.name, 160);
      const planSlug = planName ? lineupSlug(p.slug ?? planName) : '';
      const planSources = normalizeSources(p.sources, seenAt);
      if (!planName || !planSlug || !planSources.length || seenPlans.has(planSlug)) {
        result.skipped++;
        continue;
      }
      seenPlans.add(planSlug);
      const priceAmount = p.priceAmount === undefined ? undefined : cleanAmount(p.priceAmount);
      const planFields = {
        name: planName,
        priceText: cleanText(p.priceText, 120),
        ...(priceAmount !== undefined
          ? { priceAmount, priceCurrency: priceAmount === null ? null : cleanCurrency(p.priceCurrency) }
          : {}),
        url: cleanUrl(p.url),
        validFrom: cleanDay(p.validFrom),
        validTo: cleanDay(p.validTo),
      };
      const verification = p.verification ?? null;
      const [curPlan] = await tx
        .select()
        .from(platformPlan)
        .where(and(eq(platformPlan.platformId, platformId), eq(platformPlan.slug, planSlug)));
      let planId: string;
      if (!curPlan) {
        const [row] = await tx
          .insert(platformPlan)
          .values({
            platformId,
            slug: planSlug,
            country,
            ...planFields,
            verification,
            sources: planSources,
            seenAt,
            reviewStatus: 'draft',
          })
          .returning({ id: platformPlan.id });
        planId = row!.id;
        result.created++;
      } else {
        planId = curPlan.id;
        // com a checagem do validador, preço sem prova limpa o do rascunho
        const set = reconcile(
          ctx,
          { type: 'plan', id: planId },
          curPlan,
          planFields,
          planSources,
          verification ? { meta: { verification }, clearable: PRICE_FIELDS } : {},
        );
        await tx.update(platformPlan).set(set).where(eq(platformPlan.id, planId));
      }
      result.planIds[planSlug] = planId;

      const seenChannels = new Set<string>();
      for (const c of p.channels ?? []) {
        const id = c.channelId?.trim();
        const sources = normalizeSources(c.sources, seenAt);
        if (!id || !sources.length || seenChannels.has(id)) {
          result.skipped++;
          continue;
        }
        seenChannels.add(id);
        await upsertLink(ctx, 'channel', planId, id, c.access ?? 'included', sources, c.verification ?? null);
      }
      const seenServices = new Set<string>();
      for (const s of p.services ?? []) {
        const id = s.serviceId?.trim();
        const sources = normalizeSources(s.sources, seenAt);
        if (!id || !sources.length || seenServices.has(id)) {
          result.skipped++;
          continue;
        }
        seenServices.add(id);
        await upsertLink(ctx, 'service', planId, id, s.access ?? 'included', sources, s.verification ?? null);
      }
      if ((input.complete || p.completeLinks) && curPlan) {
        const links = await tx.select().from(planChannel).where(eq(planChannel.planId, planId));
        for (const l of links.filter((l) => !seenChannels.has(l.channelId)))
          await markRemoved(ctx, { type: 'plan_channel', planId, channelId: l.channelId }, l);
        const svcs = await tx.select().from(planService).where(eq(planService.planId, planId));
        for (const l of svcs.filter((l) => !seenServices.has(l.serviceId)))
          await markRemoved(ctx, { type: 'plan_service', planId, serviceId: l.serviceId }, l);
      }
    }
    if (input.complete && cur) {
      const today = dayOf(seenAt);
      const plans = await tx.select().from(platformPlan).where(eq(platformPlan.platformId, platformId));
      for (const pl of plans.filter((pl) => !seenPlans.has(pl.slug) && !(pl.validTo && pl.validTo < today)))
        await markRemoved(ctx, { type: 'plan', id: pl.id }, pl);
    }

    const seenAddons = new Set<string>();
    for (const a of input.addons ?? []) {
      const name = cleanText(a.name, 160);
      const refId = a.refId?.trim();
      const sources = normalizeSources(a.sources, seenAt);
      const months = a.commitmentMonths && a.commitmentMonths > 0 ? Math.round(a.commitmentMonths) : null;
      const slug = refId ? addonSlug(refId, a.channel ?? null, months) : '';
      if (!name || !refId || !ADDON_KINDS.includes(a.kind) || !sources.length || seenAddons.has(slug)) {
        result.skipped++;
        continue;
      }
      seenAddons.add(slug);
      const priceAmount = a.priceAmount === undefined ? undefined : cleanAmount(a.priceAmount);
      const fields = {
        name,
        priceText: cleanText(a.priceText, 120),
        ...(priceAmount !== undefined
          ? { priceAmount, priceCurrency: priceAmount === null ? null : cleanCurrency(a.priceCurrency) }
          : {}),
        url: cleanUrl(a.url),
      };
      const verification = a.verification ?? null;
      const [curAddon] = await tx
        .select()
        .from(platformAddon)
        .where(and(eq(platformAddon.platformId, platformId), eq(platformAddon.slug, slug)));
      if (!curAddon) {
        await tx.insert(platformAddon).values({
          platformId,
          slug,
          kind: a.kind,
          refId,
          channel: cleanText(a.channel, 80),
          commitmentMonths: months,
          ...fields,
          verification,
          sources,
          seenAt,
          reviewStatus: 'draft',
        });
        result.created++;
        continue;
      }
      const set = reconcile(
        ctx,
        { type: 'addon', id: curAddon.id },
        curAddon,
        fields,
        sources,
        verification ? { meta: { verification }, clearable: PRICE_FIELDS } : {},
      );
      await tx.update(platformAddon).set(set).where(eq(platformAddon.id, curAddon.id));
    }
    if (input.addonsComplete && cur) {
      const addons = await tx.select().from(platformAddon).where(eq(platformAddon.platformId, platformId));
      for (const a of addons.filter((a) => !seenAddons.has(a.slug)))
        await markRemoved(ctx, { type: 'addon', id: a.id }, a);
    }
    return result;
  });
}

// ─── revisão no painel ───────────────────────────────────────────────────────────────────────────

/** Marca os campos da proposta como editados à mão (quem editou e quando), somando aos já marcados. */
function markManual(
  prev: LineupManualFields | null | undefined,
  proposal: LineupProposal,
  manual: LineupManualEdit | undefined,
): { manualFields?: LineupManualFields } {
  if (!manual) return {};
  const out: LineupManualFields = { ...(prev ?? {}) };
  for (const k of Object.keys(proposal)) if (k !== 'removed') out[k] = { by: manual.by, at: manual.at };
  if (proposal.removed) out.removed = { by: manual.by, at: manual.at };
  return { manualFields: out };
}

/** Rótulo da fonte de um dado editado à mão no painel. */
export const MANUAL_SOURCE_NOTE = 'edição manual no painel';

/** Fonte `editorial` de uma edição manual (a URL informada, ou só o rótulo). */
function manualSource(manual: LineupManualEdit): LineupSource {
  return {
    url: cleanUrl(manual.source_url) ?? null,
    seen_at: manual.at,
    kind: 'editorial',
    note: `${MANUAL_SOURCE_NOTE} (${manual.by})`,
  };
}

/**
 * Aplica campos oficiais a um item (pedido aceito ou mudança pendente aprovada). Com `manual` (edição do
 * painel), os campos ficam marcados em `manual_fields`, e tirar um vínculo do plano o deixa `rejected` em
 * vez de apagar: a pesquisa seguinte não o traz de volta.
 */
async function applyToTarget(
  tx: Tx,
  target: LineupTarget,
  proposal: LineupProposal,
  opts: {
    by: string;
    now: Date;
    source?: LineupSource;
    status: LineupReviewStatus;
    manual?: LineupManualEdit;
  },
): Promise<boolean> {
  const { by, now, status, manual } = opts;
  const review = {
    reviewStatus: status,
    reviewedBy: by,
    reviewedAt: now,
    proposedChange: null,
    updatedAt: now,
  };
  const source = opts.source ?? (manual ? manualSource(manual) : undefined);
  const withSource = (prev: LineupSource[]) => (source ? mergeSources(prev, [source]) : prev);
  switch (target.type) {
    case 'platform': {
      if (!isUuid(target.id)) return false;
      const [cur] = await tx.select().from(platform).where(eq(platform.id, target.id));
      if (!cur) return false;
      const { name, website, kind } = proposal;
      await tx
        .update(platform)
        .set({
          ...review,
          ...(name !== undefined ? { name } : {}),
          ...(website !== undefined ? { website } : {}),
          ...(kind !== undefined ? { kind } : {}),
          sources: withSource(cur.sources),
          ...(opts.source ? { seenAt: now } : {}),
          ...markManual(cur.manualFields, proposal, manual),
        })
        .where(eq(platform.id, cur.id));
      return true;
    }
    case 'plan': {
      if (!isUuid(target.id)) return false;
      const [cur] = await tx.select().from(platformPlan).where(eq(platformPlan.id, target.id));
      if (!cur) return false;
      const { name, priceText, priceAmount, priceCurrency, url, validFrom, removed } = proposal;
      let { validTo } = proposal;
      if (removed && validTo === undefined)
        validTo = cur.validTo && cur.validTo < dayOf(now) ? cur.validTo : dayOf(now);
      await tx
        .update(platformPlan)
        .set({
          ...review,
          ...(name !== undefined ? { name } : {}),
          ...(priceText !== undefined ? { priceText } : {}),
          ...(priceAmount !== undefined ? { priceAmount } : {}),
          ...(priceCurrency !== undefined ? { priceCurrency } : {}),
          ...(url !== undefined ? { url } : {}),
          ...(validFrom !== undefined ? { validFrom } : {}),
          ...(validTo !== undefined ? { validTo } : {}),
          sources: withSource(cur.sources),
          ...(opts.source ? { seenAt: now } : {}),
          ...markManual(cur.manualFields, proposal, manual),
        })
        .where(eq(platformPlan.id, cur.id));
      return true;
    }
    case 'addon': {
      if (!isUuid(target.id)) return false;
      const [cur] = await tx.select().from(platformAddon).where(eq(platformAddon.id, target.id));
      if (!cur) return false;
      if (proposal.removed) {
        await tx.delete(platformAddon).where(eq(platformAddon.id, cur.id));
        return true;
      }
      const { name, priceText, priceAmount, priceCurrency, url } = proposal;
      await tx
        .update(platformAddon)
        .set({
          ...review,
          ...(name !== undefined ? { name } : {}),
          ...(priceText !== undefined ? { priceText } : {}),
          ...(priceAmount !== undefined ? { priceAmount } : {}),
          ...(priceCurrency !== undefined ? { priceCurrency } : {}),
          ...(url !== undefined ? { url } : {}),
          sources: withSource(cur.sources),
          ...(opts.source ? { seenAt: now } : {}),
          ...markManual(cur.manualFields, proposal, manual),
        })
        .where(eq(platformAddon.id, cur.id));
      return true;
    }
    case 'plan_channel':
    case 'plan_service': {
      const isChannel = target.type === 'plan_channel';
      const refId = isChannel ? target.channelId : target.serviceId;
      if (!isUuid(target.planId) || !refId) return false;
      const table = isChannel ? planChannel : planService;
      const planCol = isChannel ? planChannel.planId : planService.planId;
      const refCol = isChannel ? planChannel.channelId : planService.serviceId;
      const where = and(eq(planCol, target.planId), eq(refCol, refId));
      const [cur] = await tx.select().from(table).where(where);
      if (proposal.removed) {
        if (cur && manual)
          await tx
            .update(table)
            .set({
              ...review,
              reviewStatus: 'rejected',
              sources: withSource(cur.sources),
              ...markManual(cur.manualFields, proposal, manual),
            })
            .where(where);
        else if (cur) await tx.delete(table).where(where);
        return true;
      }
      if (!cur) {
        // vínculo novo (pedido da operadora): o plano precisa existir
        if (!opts.source) return false;
        const [plan] = await tx
          .select({ id: platformPlan.id })
          .from(platformPlan)
          .where(eq(platformPlan.id, target.planId));
        if (!plan) return false;
        const base = {
          planId: target.planId,
          access: proposal.access ?? ('included' as const),
          sources: [opts.source],
          seenAt: now,
          reviewStatus: status,
          reviewedBy: by,
          reviewedAt: now,
        };
        if (isChannel) await tx.insert(planChannel).values({ ...base, channelId: refId });
        else await tx.insert(planService).values({ ...base, serviceId: refId });
        return true;
      }
      await tx
        .update(table)
        .set({
          ...review,
          ...(proposal.access !== undefined ? { access: proposal.access } : {}),
          sources: withSource(cur.sources),
          ...(opts.source ? { seenAt: now } : {}),
          ...markManual(cur.manualFields, proposal, manual),
        })
        .where(where);
      return true;
    }
  }
}

async function readTarget(
  tx: Tx,
  target: LineupTarget,
): Promise<{ reviewStatus: LineupReviewStatus; proposedChange: LineupProposedChange | null } | null> {
  const pick = { reviewStatus: platform.reviewStatus, proposedChange: platform.proposedChange };
  switch (target.type) {
    case 'platform':
      if (!isUuid(target.id)) return null;
      return (await tx.select(pick).from(platform).where(eq(platform.id, target.id)))[0] ?? null;
    case 'plan':
      if (!isUuid(target.id)) return null;
      return (
        (
          await tx
            .select({ reviewStatus: platformPlan.reviewStatus, proposedChange: platformPlan.proposedChange })
            .from(platformPlan)
            .where(eq(platformPlan.id, target.id))
        )[0] ?? null
      );
    case 'plan_channel':
      if (!isUuid(target.planId)) return null;
      return (
        (
          await tx
            .select({ reviewStatus: planChannel.reviewStatus, proposedChange: planChannel.proposedChange })
            .from(planChannel)
            .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)))
        )[0] ?? null
      );
    case 'plan_service':
      if (!isUuid(target.planId)) return null;
      return (
        (
          await tx
            .select({ reviewStatus: planService.reviewStatus, proposedChange: planService.proposedChange })
            .from(planService)
            .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)))
        )[0] ?? null
      );
    case 'addon':
      if (!isUuid(target.id)) return null;
      return (
        (
          await tx
            .select({
              reviewStatus: platformAddon.reviewStatus,
              proposedChange: platformAddon.proposedChange,
            })
            .from(platformAddon)
            .where(eq(platformAddon.id, target.id))
        )[0] ?? null
      );
  }
}

/** Converte a mudança pendente (chaves das colunas) nos campos da proposta. */
function pendingToProposal(type: LineupTargetType, change: LineupProposedChange): LineupProposal {
  const { seen_at: _seenAt, ...rest } = change;
  void _seenAt;
  return sanitizeProposal(type, rest);
}

/**
 * Muda o status de revisão de um item. Aprovar um item com mudança pendente (`proposed_change`)
 * aplica a mudança (`removed`: plano sai de vigência hoje, vínculo é apagado). Devolve false se o
 * item não existe.
 */
export async function setLineupReviewStatus(
  db: Database,
  target: LineupTarget,
  status: LineupReviewStatus,
  by: string,
): Promise<boolean> {
  if (!LINEUP_REVIEW_STATUSES.includes(status))
    throw new LineupError('invalid_input', `review_status inválido: ${String(status)}`);
  return db.transaction(async (tx) => {
    const cur = await readTarget(tx, target);
    if (!cur) return false;
    const now = new Date();
    if (status === 'approved' && cur.proposedChange)
      return applyToTarget(tx, target, pendingToProposal(target.type, cur.proposedChange), {
        by,
        now,
        status,
        ...(cur.proposedChange.manual ? { manual: cur.proposedChange.manual } : {}),
      });
    const set = { reviewStatus: status, reviewedBy: by, reviewedAt: now, updatedAt: now };
    switch (target.type) {
      case 'platform':
        await tx.update(platform).set(set).where(eq(platform.id, target.id));
        break;
      case 'plan':
        await tx.update(platformPlan).set(set).where(eq(platformPlan.id, target.id));
        break;
      case 'plan_channel':
        await tx
          .update(planChannel)
          .set(set)
          .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)));
        break;
      case 'plan_service':
        await tx
          .update(planService)
          .set(set)
          .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)));
        break;
      case 'addon':
        await tx.update(platformAddon).set(set).where(eq(platformAddon.id, target.id));
        break;
    }
    return true;
  });
}

/** Descarta a mudança pendente de um item (o dado aprovado fica como está). */
export async function dismissLineupChange(db: Database, target: LineupTarget, by: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const cur = await readTarget(tx, target);
    if (!cur) return false;
    const now = new Date();
    const set = { proposedChange: null, reviewedBy: by, reviewedAt: now, updatedAt: now };
    switch (target.type) {
      case 'platform':
        await tx.update(platform).set(set).where(eq(platform.id, target.id));
        break;
      case 'plan':
        await tx.update(platformPlan).set(set).where(eq(platformPlan.id, target.id));
        break;
      case 'plan_channel':
        await tx
          .update(planChannel)
          .set(set)
          .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)));
        break;
      case 'plan_service':
        await tx
          .update(planService)
          .set(set)
          .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)));
        break;
      case 'addon':
        await tx.update(platformAddon).set(set).where(eq(platformAddon.id, target.id));
        break;
    }
    return true;
  });
}

// ─── edição manual no painel ─────────────────────────────────────────────────────────────────────

/** Tipos que a edição manual pode tirar da grade: só o vínculo do plano com um canal ou streaming. */
export const MANUAL_REMOVABLE_TYPES: readonly LineupTargetType[] = ['plan_channel', 'plan_service'];

export interface ManualLineupEditInput {
  /** Campos editados (ver `LineupProposal`); os que não valem para o tipo de item são ignorados. */
  fields?: LineupProposal | Record<string, unknown> | null;
  /** Tirar o vínculo do plano (só `plan_channel` e `plan_service`). */
  removed?: boolean;
  /** URL da fonte do dado editado (opcional). */
  sourceUrl?: string | null;
  /** Quem editou (e-mail do admin). */
  by: string;
  at?: Date;
}

/**
 * Edição manual de um item da grade, pelo mesmo fluxo de revisão da pesquisa: fica em `proposed_change`
 * (com `manual`: quem, quando e a fonte) até alguém aprovar no painel — aprovar aplica e marca os campos
 * em `manual_fields`, que a pesquisa seguinte não sobrescreve. Só os campos que mudam entram. Devolve
 * false se o item não existe ou se não há nada a mudar.
 */
export async function proposeManualLineupEdit(
  db: Database,
  target: LineupTarget,
  input: ManualLineupEditInput,
): Promise<boolean> {
  const by = input.by?.trim();
  if (!by) throw new LineupError('invalid_input', 'by vazio.');
  if (input.removed && !MANUAL_REMOVABLE_TYPES.includes(target.type))
    throw new LineupError('invalid_input', 'Só o vínculo de um canal ou streaming sai do plano.');
  const { removed: _removed, ...fields } = sanitizeProposal(target.type, input.fields ?? {});
  void _removed;
  if (input.sourceUrl && !cleanUrl(input.sourceUrl))
    throw new LineupError('invalid_input', 'URL da fonte precisa ser http(s).');
  return db.transaction(async (tx) => {
    const cur = await readTargetRow(tx, target);
    if (!cur) return false;
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields))
      if ((cur as Record<string, unknown>)[k] !== v) changed[k] = v;
    if (input.removed) changed.removed = true;
    if (!Object.keys(changed).length) return false;
    const at = (input.at ?? new Date()).toISOString();
    const change: LineupProposedChange = {
      ...changed,
      note: MANUAL_SOURCE_NOTE,
      seen_at: at,
      manual: { by, at, source_url: cleanUrl(input.sourceUrl) },
    };
    await updateTarget(tx, target, { proposedChange: change, updatedAt: new Date() });
    return true;
  });
}

/** Item novo criado à mão no painel. Entra como `draft` (aprovar publica), com fonte `editorial`. */
export type ManualLineupItemInput =
  | {
      type: 'platform';
      name: string;
      kind: PlatformKind;
      country: string;
      website?: string | null;
    }
  | {
      type: 'plan';
      platformId: string;
      name: string;
      priceText?: string | null;
      priceAmount?: number | null;
      priceCurrency?: string | null;
      url?: string | null;
    }
  | { type: 'plan_channel' | 'plan_service'; planId: string; refId: string; access?: LineupAccess }
  | {
      type: 'addon';
      platformId: string;
      kind: AddonKind;
      refId: string;
      name: string;
      channel?: string | null;
      priceText?: string | null;
      priceAmount?: number | null;
      priceCurrency?: string | null;
      commitmentMonths?: number | null;
      url?: string | null;
    };

/**
 * Cria um item da grade à mão (plataforma, plano, vínculo do plano com canal ou streaming, complemento).
 * Todos os campos informados ficam em `manual_fields` (mais `created`): a pesquisa que achar o mesmo item
 * depois só soma a fonte. Erro `invalid_input` se já existe (mesmo slug) ou o dado é inválido;
 * `target_not_found` se a plataforma, o plano ou a entrada da biblioteca não existe.
 */
export async function createManualLineupItem(
  db: Database,
  input: ManualLineupItemInput,
  opts: { by: string; sourceUrl?: string | null; at?: Date },
): Promise<LineupTarget> {
  const by = opts.by?.trim();
  if (!by) throw new LineupError('invalid_input', 'by vazio.');
  if (opts.sourceUrl && !cleanUrl(opts.sourceUrl))
    throw new LineupError('invalid_input', 'URL da fonte precisa ser http(s).');
  const now = opts.at ?? new Date();
  const manual: LineupManualEdit = { by, at: now.toISOString(), source_url: cleanUrl(opts.sourceUrl) };
  const sources = [manualSource(manual)];
  const marks = (keys: string[]): LineupManualFields =>
    Object.fromEntries(['created', ...keys].map((k) => [k, { by, at: manual.at }]));
  const base = {
    sources,
    seenAt: now,
    reviewStatus: 'draft' as const,
    reviewedBy: by,
    reviewedAt: now,
  };
  const price = (v: { priceAmount?: number | null; priceCurrency?: string | null }) => {
    const priceAmount = cleanAmount(v.priceAmount);
    const priceCurrency = priceAmount === null ? null : cleanCurrency(v.priceCurrency);
    if (priceAmount !== null && !priceCurrency)
      throw new LineupError('invalid_input', 'Preço sem moeda (ISO 4217).');
    return { priceAmount, priceCurrency };
  };
  const given = (o: Record<string, unknown>) =>
    Object.keys(o).filter((k) => o[k] !== null && o[k] !== undefined && o[k] !== '');
  return db.transaction(async (tx) => {
    switch (input.type) {
      case 'platform': {
        const country = normalizeCountry(input.country);
        const name = cleanText(input.name, 160);
        if (!name) throw new LineupError('invalid_input', 'name vazio.');
        if (!PLATFORM_KINDS.includes(input.kind))
          throw new LineupError('invalid_input', `kind inválido: ${String(input.kind)}`);
        const slug = platformSlug(country, name);
        const [dup] = await tx.select({ id: platform.id }).from(platform).where(eq(platform.slug, slug));
        if (dup) throw new LineupError('invalid_input', `Plataforma já existe: ${slug}`);
        const fields = { name, kind: input.kind, website: cleanUrl(input.website) };
        const [row] = await tx
          .insert(platform)
          .values({ slug, country, ...fields, ...base, manualFields: marks(given(fields)) })
          .returning({ id: platform.id });
        return { type: 'platform', id: row!.id };
      }
      case 'plan': {
        if (!isUuid(input.platformId)) throw new LineupError('target_not_found', 'Plataforma inexistente.');
        const [p] = await tx.select().from(platform).where(eq(platform.id, input.platformId));
        if (!p) throw new LineupError('target_not_found', 'Plataforma inexistente.');
        const name = cleanText(input.name, 160);
        const slug = name ? lineupSlug(name) : '';
        if (!name || !slug) throw new LineupError('invalid_input', 'name vazio.');
        const [dup] = await tx
          .select({ id: platformPlan.id })
          .from(platformPlan)
          .where(and(eq(platformPlan.platformId, p.id), eq(platformPlan.slug, slug)));
        if (dup) throw new LineupError('invalid_input', `Plano já existe: ${slug}`);
        const fields = {
          name,
          priceText: cleanText(input.priceText, 120),
          ...price(input),
          url: cleanUrl(input.url),
        };
        const [row] = await tx
          .insert(platformPlan)
          .values({
            platformId: p.id,
            slug,
            country: p.country,
            ...fields,
            ...base,
            manualFields: marks(given(fields)),
          })
          .returning({ id: platformPlan.id });
        return { type: 'plan', id: row!.id };
      }
      case 'plan_channel':
      case 'plan_service': {
        if (!isUuid(input.planId)) throw new LineupError('target_not_found', 'Plano inexistente.');
        const [plan] = await tx
          .select({ id: platformPlan.id })
          .from(platformPlan)
          .where(eq(platformPlan.id, input.planId));
        const refId = input.refId?.trim();
        const [ref] = refId
          ? await tx.select({ id: broadcaster.id }).from(broadcaster).where(eq(broadcaster.id, refId))
          : [];
        if (!plan || !ref) throw new LineupError('target_not_found', 'Plano ou canal inexistente.');
        const access = input.access ?? 'included';
        if (!LINEUP_ACCESS.includes(access))
          throw new LineupError('invalid_input', `access inválido: ${access}`);
        const target: LineupTarget =
          input.type === 'plan_channel'
            ? { type: 'plan_channel', planId: plan.id, channelId: ref.id }
            : { type: 'plan_service', planId: plan.id, serviceId: ref.id };
        if (await readTargetRow(tx, target))
          throw new LineupError('invalid_input', 'O canal já está no plano.');
        const values = { planId: plan.id, access, ...base, manualFields: marks(['access']) };
        if (input.type === 'plan_channel')
          await tx.insert(planChannel).values({ ...values, channelId: ref.id });
        else await tx.insert(planService).values({ ...values, serviceId: ref.id });
        return target;
      }
      case 'addon': {
        if (!isUuid(input.platformId)) throw new LineupError('target_not_found', 'Plataforma inexistente.');
        const [p] = await tx
          .select({ id: platform.id })
          .from(platform)
          .where(eq(platform.id, input.platformId));
        const refId = input.refId?.trim();
        const [ref] = refId
          ? await tx.select({ id: broadcaster.id }).from(broadcaster).where(eq(broadcaster.id, refId))
          : [];
        if (!p || !ref) throw new LineupError('target_not_found', 'Plataforma ou serviço inexistente.');
        if (!ADDON_KINDS.includes(input.kind))
          throw new LineupError('invalid_input', `kind inválido: ${String(input.kind)}`);
        const name = cleanText(input.name, 160);
        if (!name) throw new LineupError('invalid_input', 'name vazio.');
        const months =
          input.commitmentMonths && input.commitmentMonths > 0 ? Math.round(input.commitmentMonths) : null;
        const channel = cleanText(input.channel, 80);
        const slug = addonSlug(ref.id, channel, months);
        const [dup] = await tx
          .select({ id: platformAddon.id })
          .from(platformAddon)
          .where(and(eq(platformAddon.platformId, p.id), eq(platformAddon.slug, slug)));
        if (dup) throw new LineupError('invalid_input', `Complemento já existe: ${slug}`);
        const fields = {
          name,
          priceText: cleanText(input.priceText, 120),
          ...price(input),
          url: cleanUrl(input.url),
        };
        const [row] = await tx
          .insert(platformAddon)
          .values({
            platformId: p.id,
            slug,
            kind: input.kind,
            refId: ref.id,
            channel,
            commitmentMonths: months,
            ...fields,
            ...base,
            manualFields: marks(given(fields)),
          })
          .returning({ id: platformAddon.id });
        return { type: 'addon', id: row!.id };
      }
    }
  });
}

/** Linha do item (todas as colunas), ou null. */
async function readTargetRow(tx: Tx, target: LineupTarget): Promise<Record<string, unknown> | null> {
  switch (target.type) {
    case 'platform':
      if (!isUuid(target.id)) return null;
      return (await tx.select().from(platform).where(eq(platform.id, target.id)))[0] ?? null;
    case 'plan':
      if (!isUuid(target.id)) return null;
      return (await tx.select().from(platformPlan).where(eq(platformPlan.id, target.id)))[0] ?? null;
    case 'addon':
      if (!isUuid(target.id)) return null;
      return (await tx.select().from(platformAddon).where(eq(platformAddon.id, target.id)))[0] ?? null;
    case 'plan_channel':
      if (!isUuid(target.planId)) return null;
      return (
        (
          await tx
            .select()
            .from(planChannel)
            .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)))
        )[0] ?? null
      );
    case 'plan_service':
      if (!isUuid(target.planId)) return null;
      return (
        (
          await tx
            .select()
            .from(planService)
            .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)))
        )[0] ?? null
      );
  }
}

/** Grava colunas de controle de um item (mudança pendente, revisão). */
async function updateTarget(
  tx: Tx,
  target: LineupTarget,
  set: { proposedChange?: LineupProposedChange | null; updatedAt: Date },
): Promise<void> {
  switch (target.type) {
    case 'platform':
      await tx.update(platform).set(set).where(eq(platform.id, target.id));
      return;
    case 'plan':
      await tx.update(platformPlan).set(set).where(eq(platformPlan.id, target.id));
      return;
    case 'addon':
      await tx.update(platformAddon).set(set).where(eq(platformAddon.id, target.id));
      return;
    case 'plan_channel':
      await tx
        .update(planChannel)
        .set(set)
        .where(and(eq(planChannel.planId, target.planId), eq(planChannel.channelId, target.channelId)));
      return;
    case 'plan_service':
      await tx
        .update(planService)
        .set(set)
        .where(and(eq(planService.planId, target.planId), eq(planService.serviceId, target.serviceId)));
      return;
  }
}

// ─── pedidos de revisão da operadora ─────────────────────────────────────────────────────────────

/** Plataforma dona do item (o vínculo pode ainda não existir; o plano, sim). null = item inexistente. */
export async function lineupTargetPlatformId(
  db: Database | Tx,
  target: LineupTarget,
): Promise<string | null> {
  const q = db as Database;
  if (target.type === 'platform') {
    if (!isUuid(target.id)) return null;
    const [r] = await q.select({ id: platform.id }).from(platform).where(eq(platform.id, target.id));
    return r?.id ?? null;
  }
  if (target.type === 'addon') {
    if (!isUuid(target.id)) return null;
    const [r] = await q
      .select({ id: platformAddon.platformId })
      .from(platformAddon)
      .where(eq(platformAddon.id, target.id));
    return r?.id ?? null;
  }
  const planId = target.type === 'plan' ? target.id : target.planId;
  if (!isUuid(planId)) return null;
  const [r] = await q
    .select({ id: platformPlan.platformId })
    .from(platformPlan)
    .where(eq(platformPlan.id, planId));
  return r?.id ?? null;
}

export interface CreateLineupReviewRequestInput {
  tenantId: string;
  /** Usuário do portal (id do Better Auth). */
  userId: string;
  target: LineupTarget;
  message: string;
  /** Campos propostos (ver `LineupProposal`); os que não valem para o tipo de item são ignorados. */
  proposed?: LineupProposal | Record<string, unknown> | null;
  /**
   * Exige que o item seja da plataforma do tenant (`operator_platform_id`). Padrão: true — a
   * operadora só pede revisão da própria grade.
   */
  enforceOwnership?: boolean;
}

/** Abre um pedido de revisão da grade (portal da operadora). */
export async function createLineupReviewRequest(
  db: Database,
  input: CreateLineupReviewRequestInput,
): Promise<LineupReviewRequest> {
  const message = cleanText(input.message, 2000);
  if (!message) throw new LineupError('invalid_input', 'Mensagem vazia.');
  const userId = input.userId?.trim();
  if (!userId) throw new LineupError('invalid_input', 'userId vazio.');
  if (!isUuid(input.tenantId)) throw new LineupError('tenant_not_found', 'Tenant inexistente.');
  if (!LINEUP_TARGET_TYPES.includes(input.target.type))
    throw new LineupError('invalid_input', `target_type inválido: ${String(input.target.type)}`);
  const proposed = sanitizeProposal(input.target.type, input.proposed);
  const [t] = await db
    .select({ id: tenant.id, platformId: tenant.operatorPlatformId })
    .from(tenant)
    .where(eq(tenant.id, input.tenantId));
  if (!t) throw new LineupError('tenant_not_found', 'Tenant inexistente.');
  const owner = await lineupTargetPlatformId(db, input.target);
  if (!owner) throw new LineupError('target_not_found', 'Item da grade inexistente.');
  if ((input.enforceOwnership ?? true) && t.platformId !== owner)
    throw new LineupError('forbidden_target', 'O item não é da plataforma do cliente.');
  const [row] = await db
    .insert(lineupReviewRequest)
    .values({
      tenantId: input.tenantId,
      userId,
      targetType: input.target.type,
      targetId: lineupTargetId(input.target),
      message,
      proposed: Object.keys(proposed).length ? (proposed as Record<string, unknown>) : null,
    })
    .returning();
  return row!;
}

/** Pedidos de revisão, do mais novo para o mais antigo. */
export async function listLineupReviewRequests(
  db: Database,
  opts: { tenantId?: string; status?: LineupRequestStatus; limit?: number } = {},
): Promise<LineupReviewRequest[]> {
  const where: SQL[] = [];
  if (opts.tenantId) {
    if (!isUuid(opts.tenantId)) return [];
    where.push(eq(lineupReviewRequest.tenantId, opts.tenantId));
  }
  if (opts.status) {
    if (!LINEUP_REQUEST_STATUSES.includes(opts.status))
      throw new LineupError('invalid_input', `status inválido: ${String(opts.status)}`);
    where.push(eq(lineupReviewRequest.status, opts.status));
  }
  return db
    .select()
    .from(lineupReviewRequest)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(lineupReviewRequest.createdAt), desc(lineupReviewRequest.id))
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 1000));
}

export interface ResolveLineupReviewRequestInput {
  status: Exclude<LineupRequestStatus, 'open'>;
  note?: string | null;
  /** Quem resolveu (handle do painel). */
  by: string;
  /**
   * Com `accepted`, aplica o `proposed` como dado oficial (aprovado), com a fonte "informado pela
   * operadora". Sem `apply`, o pedido só é fechado (o painel corrige à mão).
   */
  apply?: boolean;
}

/** Fecha um pedido de revisão (e aplica a proposta, se pedido). */
export async function resolveLineupReviewRequest(
  db: Database,
  id: string,
  input: ResolveLineupReviewRequestInput,
): Promise<LineupReviewRequest> {
  if (input.status !== 'accepted' && input.status !== 'rejected')
    throw new LineupError('invalid_input', `status inválido: ${String(input.status)}`);
  const by = input.by?.trim();
  if (!by) throw new LineupError('invalid_input', 'by vazio.');
  if (!isUuid(id)) throw new LineupError('request_not_found', 'Pedido inexistente.');
  return db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(lineupReviewRequest)
      .where(eq(lineupReviewRequest.id, id))
      .for('update');
    if (!req) throw new LineupError('request_not_found', 'Pedido inexistente.');
    if (req.status !== 'open')
      throw new LineupError('already_resolved', `Pedido já resolvido (${req.status}).`);
    const now = new Date();
    if (input.status === 'accepted' && input.apply) {
      const target = parseLineupTarget(req.targetType, req.targetId);
      const proposal = sanitizeProposal(target.type, req.proposed);
      const source: LineupSource = {
        url: null,
        seen_at: now.toISOString(),
        kind: 'operator',
        note: OPERATOR_SOURCE_NOTE,
        request_id: req.id,
      };
      const ok = await applyToTarget(tx, target, proposal, { by, now, source, status: 'approved' });
      if (!ok) throw new LineupError('target_not_found', 'Item da grade inexistente.');
    }
    const [row] = await tx
      .update(lineupReviewRequest)
      .set({
        status: input.status,
        resolutionNote: cleanText(input.note, 2000),
        resolvedBy: by,
        resolvedAt: now,
      })
      .where(eq(lineupReviewRequest.id, id))
      .returning();
    return row!;
  });
}

// ─── cliente operadora ───────────────────────────────────────────────────────────────────────────

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Domínios de e-mail normalizados (minúsculas, sem @), sem repetição. */
export function normalizeEmailDomains(domains: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of domains) {
    const d = raw.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, '');
    if (!d) continue;
    if (!DOMAIN_RE.test(d)) throw new LineupError('invalid_input', `Domínio de e-mail inválido: ${raw}`);
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * Liga o tenant a uma plataforma da grade (cliente operadora). Campo ausente = mantém; `platformId`
 * null = desliga. Devolve o estado novo, ou null se o tenant não existe.
 */
export async function setTenantOperator(
  db: Database,
  tenantId: string,
  input: { platformId?: string | null; showOtherOperators?: boolean; emailDomains?: readonly string[] },
): Promise<TenantOperator | null> {
  if (!isUuid(tenantId)) return null;
  const set: Partial<typeof tenant.$inferInsert> = {};
  if (input.platformId !== undefined) {
    if (input.platformId !== null) {
      if (!isUuid(input.platformId)) throw new LineupError('target_not_found', 'Plataforma inexistente.');
      const [p] = await db
        .select({ id: platform.id })
        .from(platform)
        .where(eq(platform.id, input.platformId));
      if (!p) throw new LineupError('target_not_found', 'Plataforma inexistente.');
    }
    set.operatorPlatformId = input.platformId;
  }
  if (input.showOtherOperators !== undefined) set.showOtherOperators = input.showOtherOperators;
  if (input.emailDomains !== undefined) set.operatorEmailDomains = normalizeEmailDomains(input.emailDomains);
  if (Object.keys(set).length) {
    const rows = await db.update(tenant).set(set).where(eq(tenant.id, tenantId)).returning({ id: tenant.id });
    if (!rows.length) return null;
  }
  return getTenantOperator(db, tenantId);
}

/** Estado de operadora do tenant (plataforma ligada, se mostra as outras, domínios). null = tenant inexistente. */
export async function getTenantOperator(db: Database, tenantId: string): Promise<TenantOperator | null> {
  if (!isUuid(tenantId)) return null;
  const [t] = await db
    .select({
      id: tenant.id,
      platformId: tenant.operatorPlatformId,
      showOtherOperators: tenant.showOtherOperators,
      emailDomains: tenant.operatorEmailDomains,
    })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!t) return null;
  const [p] = t.platformId ? await db.select().from(platform).where(eq(platform.id, t.platformId)) : [];
  return {
    tenantId: t.id,
    platformId: t.platformId,
    showOtherOperators: t.showOtherOperators,
    emailDomains: t.emailDomains,
    platform: p ?? null,
  };
}

/** Tenants cujo domínio de e-mail de operadora casa com o do e-mail (ligar usuário do portal). */
export async function findOperatorTenantsByEmail(db: Database, email: string): Promise<string[]> {
  const at = email.lastIndexOf('@');
  if (at < 0) return [];
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!DOMAIN_RE.test(domain)) return [];
  const rows = await db
    .select({ id: tenant.id })
    .from(tenant)
    .where(sql`${domain} = any(${tenant.operatorEmailDomains})`);
  return rows.map((r) => r.id);
}

// ─── rebrand e páginas oficiais ──────────────────────────────────────────────────────────────────

/**
 * Propõe uma mudança num item sem tirar a aprovação: o site oficial passou a redirecionar para outro
 * domínio (rebrand, na plataforma) ou a página oficial do plano mudou (hash, no plano). Fica em
 * `proposed_change` até alguém aprovar ou descartar; na plataforma, também no rascunho; no plano, só no
 * revisado ou aprovado (o rascunho já espera revisão). Devolve false se o item não existe, foi rejeitado
 * ou a mesma mudança já está pendente.
 */
export async function proposeLineupChange(
  db: Database,
  target: { type: 'platform' | 'plan'; id: string },
  change: { website?: string | null; name?: string; note?: string; page_hash?: string; page_url?: string },
  seenAt: Date = new Date(),
): Promise<boolean> {
  if (!isUuid(target.id)) return false;
  const table = target.type === 'platform' ? platform : platformPlan;
  const [cur] =
    target.type === 'platform'
      ? await db.select().from(platform).where(eq(platform.id, target.id))
      : await db.select().from(platformPlan).where(eq(platformPlan.id, target.id));
  if (!cur || cur.reviewStatus === 'rejected') return false;
  if (target.type === 'plan' && cur.reviewStatus === 'draft') return false;
  // edição manual esperando aprovação: a mudança pendente é a do painel
  if (cur.proposedChange?.manual) return false;
  const manual = cur.manualFields ?? {};
  const next: LineupProposedChange = { ...(cur.proposedChange ?? {}) };
  if (change.website !== undefined && !('website' in manual)) next.website = cleanUrl(change.website);
  if (change.name !== undefined && !('name' in manual)) next.name = cleanText(change.name, 160);
  if (change.note) next.note = cleanText(change.note, 300);
  if (change.page_hash) next.page_hash = change.page_hash.slice(0, 64);
  if (change.page_url) next.page_url = cleanUrl(change.page_url);
  const same =
    cur.proposedChange &&
    Object.entries(next).every(([k, v]) => k === 'seen_at' || cur.proposedChange?.[k] === v);
  if (same) return false;
  next.seen_at = seenAt.toISOString();
  await db.update(table).set({ proposedChange: next, updatedAt: new Date() }).where(eq(table.id, target.id));
  return true;
}

/** Guarda as páginas oficiais de planos e ofertas da plataforma (só http/https, sem repetir, até 6). */
export async function setPlatformPlanPages(
  db: Database,
  platformId: string,
  urls: readonly string[],
): Promise<void> {
  if (!isUuid(platformId)) return;
  const clean: string[] = [];
  for (const u of urls) {
    const url = cleanUrl(u);
    if (url && !clean.includes(url)) clean.push(url);
  }
  await db
    .update(platform)
    .set({ planPages: clean.slice(0, 6), updatedAt: new Date() })
    .where(eq(platform.id, platformId));
}

/** Registra o hash das páginas de planos que a extração com IA acabou de ler. */
export async function recordPlanPagesExtraction(
  db: Database,
  platformId: string,
  hash: string,
  at: Date,
): Promise<void> {
  if (!isUuid(platformId)) return;
  await db
    .update(platform)
    .set({ planPagesHash: hash.slice(0, 64), planPagesExtractedAt: at, updatedAt: new Date() })
    .where(eq(platform.id, platformId));
}

/**
 * Página de planos igual à da última extração: a grade gravada continua valendo. Renova o `seen_at` da
 * plataforma e dos planos dela (menos os rejeitados), para a revisita não voltar a eles amanhã.
 */
export async function touchPlatformLineup(db: Database, platformId: string, seenAt: Date): Promise<number> {
  if (!isUuid(platformId)) return 0;
  return db.transaction(async (tx) => {
    await tx.update(platform).set({ seenAt }).where(eq(platform.id, platformId));
    const rows = await tx
      .update(platformPlan)
      .set({ seenAt })
      .where(and(eq(platformPlan.platformId, platformId), ne(platformPlan.reviewStatus, 'rejected')))
      .returning({ id: platformPlan.id });
    return rows.length;
  });
}

/** Leitura em cache de uma página oficial. */
export async function getLineupPage(db: Database, url: string): Promise<LineupPage | null> {
  const [row] = await db.select().from(lineupPage).where(eq(lineupPage.url, url));
  return row ?? null;
}

export interface SaveLineupPageInput {
  url: string;
  platformId?: string | null;
  status: LineupPageStatus;
  via?: LineupPageVia | null;
  httpStatus?: number | null;
  finalUrl?: string | null;
  contentHash?: string | null;
  content?: LineupPageContent | null;
  error?: string | null;
  fetchedAt: Date;
}

/** Grava a leitura; hash diferente do anterior guarda o anterior e a data da mudança. */
export async function saveLineupPage(
  db: Database,
  input: SaveLineupPageInput,
): Promise<{ page: LineupPage; hashChanged: boolean }> {
  const prev = await getLineupPage(db, input.url);
  const hashChanged = !!(prev?.contentHash && input.contentHash && prev.contentHash !== input.contentHash);
  const values = {
    url: input.url,
    platformId: input.platformId ?? prev?.platformId ?? null,
    status: input.status,
    via: input.via ?? null,
    httpStatus: input.httpStatus ?? null,
    finalUrl: input.finalUrl ?? null,
    // leitura que falhou não apaga o último conteúdo bom
    contentHash: input.contentHash ?? prev?.contentHash ?? null,
    content: input.content ?? prev?.content ?? null,
    previousHash: hashChanged ? prev!.contentHash : (prev?.previousHash ?? null),
    hashChangedAt: hashChanged ? input.fetchedAt : (prev?.hashChangedAt ?? null),
    error: input.error ? input.error.slice(0, 500) : null,
    fetchedAt: input.fetchedAt,
    updatedAt: new Date(),
  };
  const [page] = await db
    .insert(lineupPage)
    .values(values)
    .onConflictDoUpdate({ target: lineupPage.url, set: values })
    .returning();
  return { page: page!, hashChanged };
}

// ─── logos enviados no painel ────────────────────────────────────────────────────────────────────

/** Arquivo já gravado no storage (chave no padrão dos logos), para registrar como asset. */
export interface StoredLogoFile {
  storageKey: string;
  sha256: string;
  contentType: 'image/png' | 'image/svg+xml';
  bytes: number;
  width: number | null;
  height: number | null;
}

export interface LogoTargetRef {
  type: LogoUploadTarget;
  /** uuid da plataforma ou id da biblioteca de emissoras. */
  id: string;
}

/** Origem gravada de um logo do painel (como `acervo-oficial://<nó>`): não é URL pública. */
export const panelLogoSourceUrl = (target: LogoTargetRef, sha256: string) =>
  `painel://${target.type}/${target.id}/${sha256.slice(0, 16)}`;

/**
 * Publica que o logo da entidade mudou. A plataforma já publica pelo trigger da grade (`lineup`,
 * `platform:<id>`); a entrada da biblioteca não tem trigger: `broadcaster:<id>` purga /v1/broadcasters,
 * /v1/platforms/{id} e o onde assistir dos jogos que mostram o canal.
 */
async function publishLogoChange(tx: Tx, target: LogoTargetRef): Promise<void> {
  if (target.type !== 'broadcaster') return;
  await publishChange(tx, {
    topic: 'catalog',
    entityType: 'broadcaster',
    entityId: target.id,
    payload: { reason: 'logo' },
  });
}

async function logoTargetExists(tx: Tx, target: LogoTargetRef): Promise<boolean> {
  if (target.type === 'platform') {
    if (!isUuid(target.id)) return false;
    return (await tx.select({ id: platform.id }).from(platform).where(eq(platform.id, target.id))).length > 0;
  }
  return (
    (await tx.select({ id: broadcaster.id }).from(broadcaster).where(eq(broadcaster.id, target.id))).length >
    0
  );
}

async function currentCustomLogo(tx: Tx, target: LogoTargetRef): Promise<string | null> {
  const [row] =
    target.type === 'platform'
      ? await tx
          .select({ id: platform.customLogoAssetId })
          .from(platform)
          .where(eq(platform.id, target.id))
          .for('update')
      : await tx
          .select({ id: broadcaster.customLogoAssetId })
          .from(broadcaster)
          .where(eq(broadcaster.id, target.id))
          .for('update');
  return row?.id ?? null;
}

async function setCustomLogoId(tx: Tx, target: LogoTargetRef, assetId: string | null): Promise<void> {
  const now = new Date();
  if (target.type === 'platform')
    await tx
      .update(platform)
      .set({ customLogoAssetId: assetId, updatedAt: now })
      .where(eq(platform.id, target.id));
  else
    await tx
      .update(broadcaster)
      .set({ customLogoAssetId: assetId, updatedAt: now })
      .where(eq(broadcaster.id, target.id));
}

/**
 * Registra o logo enviado no painel (o arquivo já está no storage) e liga na entidade, no
 * `custom_logo_asset_id`: vale no lugar do logo da origem, sem passo manual. O anterior fica no histórico
 * (`enrich.logo_upload`) para voltar com `revertCustomLogo`. Mesmo arquivo de novo = o mesmo asset.
 */
export async function setCustomLogo(
  db: Database,
  target: LogoTargetRef,
  file: StoredLogoFile,
  by: string,
): Promise<{ assetId: string; previousAssetId: string | null; uploadId: string }> {
  if (!LOGO_UPLOAD_TARGETS.includes(target.type))
    throw new LineupError('invalid_input', `Alvo de logo inválido: ${String(target.type)}`);
  const who = by?.trim();
  if (!who) throw new LineupError('invalid_input', 'by vazio.');
  return db.transaction(async (tx) => {
    if (!(await logoTargetExists(tx, target)))
      throw new LineupError('target_not_found', 'Plataforma ou canal inexistente.');
    const values = {
      storageKey: file.storageKey,
      sha256: file.sha256,
      width: file.width,
      height: file.height,
      bytes: file.bytes,
      fetchedAt: new Date(),
    };
    const [row] = await tx
      .insert(asset)
      .values({ kind: 'broadcaster_logo', sourceUrl: panelLogoSourceUrl(target, file.sha256), ...values })
      .onConflictDoUpdate({ target: asset.sourceUrl, set: values })
      .returning({ id: asset.id });
    const previous = await currentCustomLogo(tx, target);
    await setCustomLogoId(tx, target, row!.id);
    const [upload] = await tx
      .insert(logoUpload)
      .values({
        targetType: target.type,
        targetId: target.id,
        assetId: row!.id,
        previousAssetId: previous,
        uploadedBy: who,
      })
      .returning({ id: logoUpload.id });
    await publishLogoChange(tx, target);
    return { assetId: row!.id, previousAssetId: previous, uploadId: upload!.id };
  });
}

/**
 * Volta ao logo anterior ao último envio ainda valendo (null = sem logo do painel: vale o da origem).
 * Devolve false se não há envio a desfazer.
 */
export async function revertCustomLogo(db: Database, target: LogoTargetRef, by: string): Promise<boolean> {
  const who = by?.trim();
  if (!who) throw new LineupError('invalid_input', 'by vazio.');
  return db.transaction(async (tx) => {
    if (!(await logoTargetExists(tx, target))) return false;
    const current = await currentCustomLogo(tx, target);
    const [last] = await tx
      .select()
      .from(logoUpload)
      .where(
        and(
          eq(logoUpload.targetType, target.type),
          eq(logoUpload.targetId, target.id),
          sql`${logoUpload.revertedAt} is null`,
        ),
      )
      .orderBy(desc(logoUpload.createdAt), desc(logoUpload.id))
      .limit(1);
    if (!last || last.assetId !== current) return false;
    await setCustomLogoId(tx, target, last.previousAssetId);
    await tx
      .update(logoUpload)
      .set({ revertedAt: new Date(), revertedBy: who })
      .where(eq(logoUpload.id, last.id));
    await publishLogoChange(tx, target);
    return true;
  });
}

/** Envios de logo de uma entidade, do mais novo para o mais antigo. */
export async function listLogoUploads(db: Database, target: LogoTargetRef): Promise<LogoUploadRow[]> {
  return db
    .select()
    .from(logoUpload)
    .where(and(eq(logoUpload.targetType, target.type), eq(logoUpload.targetId, target.id)))
    .orderBy(desc(logoUpload.createdAt), desc(logoUpload.id));
}

export type LogoUploadRow = typeof logoUpload.$inferSelect;
