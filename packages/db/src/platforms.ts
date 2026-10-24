/**
 * Grade de canais e ofertas das operadoras e streamings — INTERFACE (stub).
 *
 * As tabelas (`enrich.platform`, `enrich.platform_plan`, `enrich.plan_channel`, `enrich.plan_service`), as
 * colunas novas de `api.tenant` (`operator_platform_id`, `show_other_operators`, `operator_email_domains`)
 * e as consultas reais chegam pelo PR do banco da grade. Até lá, este arquivo só fixa os nomes, as
 * assinaturas e as formas de retorno que a API e a demo usam, e responde "sem grade": nenhuma plataforma,
 * nenhuma operadora no tenant. Trocar = substituir este arquivo pelas consultas reais com os mesmos nomes.
 *
 * `channelId` e `serviceId` são ids da biblioteca de emissoras (config/broadcasters, `enrich.broadcaster`).
 */
import type { Database } from './client.js';

export const PLATFORM_KINDS = ['pay_tv_operator', 'vmvpd', 'telco_bundle', 'streaming'] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];

export const PLAN_ACCESS = ['included', 'addon'] as const;
export type PlanAccess = (typeof PLAN_ACCESS)[number];

/** Status editorial da grade, do menos ao mais revisado. */
export const LINEUP_REVIEW_STATUSES = ['draft', 'reviewed', 'approved'] as const;
export type LineupReviewStatus = (typeof LINEUP_REVIEW_STATUSES)[number];

/** Linha de `enrich.platform`. */
export interface PlatformRow {
  id: string;
  slug: string;
  name: string;
  kind: PlatformKind;
  country: string;
  logoAssetId: string | null;
  /** Entrada da biblioteca de emissoras da própria plataforma (logo de reserva). */
  broadcasterId: string | null;
  reviewStatus: LineupReviewStatus;
}

/** Linha de `enrich.platform_plan`. */
export interface PlatformPlanRow {
  id: string;
  platformId: string;
  name: string;
}

export interface PlanChannelRef {
  channelId: string;
  access: PlanAccess;
}

export interface PlanServiceRef {
  serviceId: string;
  access: PlanAccess;
}

/** Plataforma que leva ao menos um dos canais pedidos, com os planos em que eles estão. */
export interface PlatformAvailabilityRow {
  platform: PlatformRow;
  plans: { plan: PlatformPlanRow; viaChannels: PlanChannelRef[]; services: PlanServiceRef[] }[];
}

/** Grade completa da plataforma: cada plano com os canais e os streamings. */
export interface PlatformLineupRow {
  platform: PlatformRow;
  plans: { plan: PlatformPlanRow; channels: PlanChannelRef[]; services: PlanServiceRef[] }[];
}

/** Operadora do tenant (colunas de `api.tenant`). */
export interface TenantOperator {
  platformId: string;
  showOtherOperators: boolean;
  emailDomains: string[];
}

export interface AvailabilityForChannelsParams {
  channelIds: string[];
  country: string;
  /** Piso editorial (padrão `approved`). */
  minReview?: LineupReviewStatus;
  /** Só esta plataforma (somada aos streamings quando `includeStreaming`). */
  onlyPlatformId?: string;
  /** Inclui as plataformas `streaming` (padrão true). */
  includeStreaming?: boolean;
}

/** Plataformas e planos (no país, acima do piso) que levam os canais pedidos. Stub: nenhuma. */
export async function availabilityForChannels(
  _db: Database,
  _params: AvailabilityForChannelsParams,
): Promise<PlatformAvailabilityRow[]> {
  return [];
}

/** Plataformas da grade, opcionalmente de um país. Stub: nenhuma. */
export async function listPlatforms(
  _db: Database,
  _filter: { country?: string; minReview?: LineupReviewStatus } = {},
): Promise<PlatformRow[]> {
  return [];
}

/** Grade de uma plataforma; null se não existe ou está abaixo do piso. Stub: null. */
export async function getPlatformLineup(
  _db: Database,
  _platformId: string,
  _opts: { minReview?: LineupReviewStatus } = {},
): Promise<PlatformLineupRow | null> {
  return null;
}

/** Operadora do tenant; null quando ele não é uma operadora. Stub: null. */
export async function getTenantOperator(_db: Database, _tenantId: string): Promise<TenantOperator | null> {
  return null;
}
