/**
 * Grades e ofertas (portal do cliente e Ajustes → Grades e ofertas): tipos que vão ao navegador e as regras
 * puras (campos que a operadora pode corrigir, domínios de e-mail, filtros da URL, achatar a grade). Puro:
 * serve ao servidor, aos componentes e aos testes. O modelo é o de `@galaxie/db/lineups`.
 */

/** draft = da pesquisa · reviewed = conferido · approved = publicado na API · rejected = descartado. */
export const REVIEW_STATUSES = ['draft', 'reviewed', 'approved', 'rejected'] as const;
export type LineupStatus = (typeof REVIEW_STATUSES)[number];

export const TARGET_TYPES = ['platform', 'plan', 'plan_channel', 'plan_service', 'addon'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const REQUEST_STATUSES = ['open', 'accepted', 'rejected'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const PLATFORM_KINDS = ['pay_tv_operator', 'vmvpd', 'telco_bundle', 'streaming'] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];

/** included = vem no plano · addon = pacote adicional pago à parte (o que a operadora pode propor). */
export const ACCESS = ['included', 'addon'] as const;
export type Access = (typeof ACCESS)[number];

/**
 * Nível da fonte pelo domínio final (validador da pesquisa). Só a oficial e específica do plano prova
 * `included` e o preço cheio; o resto entra como `unverified` e não sai na API.
 */
export const SOURCE_TIERS = ['official', 'comparator', 'press', 'other', 'discarded'] as const;
export type SourceTier = (typeof SOURCE_TIERS)[number];

/** Checagens do validador, na ordem em que aparecem no painel. */
export const CHECK_KEYS = [
  'page',
  'details',
  'redirect',
  'official',
  'excerpt',
  'plan_specific',
  'not_reused',
  'list_price',
  'currency',
  'included',
] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];
export type CheckResult = 'pass' | 'fail' | 'skip';

/** Resultado do validador para um plano ou vínculo (do jsonb `verification`). */
export interface VerificationView {
  tier: SourceTier | null;
  finalUrl: string | null;
  finalHost: string | null;
  excerpt: string | null;
  checks: Partial<Record<CheckKey, CheckResult>>;
  verified: boolean;
  /** O que a IA afirmou e não foi aceito (o preço sem prova). */
  claimed: { amount: number | null; currency: string | null } | null;
  /** Todos os preços vistos do plano (pesquisa, página oficial, curadoria). */
  prices: {
    amount: number;
    currency: string | null;
    origin: string;
    sourceUrl: string | null;
    tier: SourceTier | null;
    sourceDate: string | null;
    verified: boolean;
  }[];
  priceConflict: boolean;
  /** Página oficial lida do nosso lado (proveniência da grade). */
  page: { url: string; fetchedAt: string; hash: string; via: string } | null;
  checkedAt: string | null;
}

/** Piso do que a API publica da grade: o portal mostra exatamente isto. */
export const PUBLISHED_MIN_REVIEW = 'approved' as const;

/**
 * Campos que a operadora pode propor em cada tipo de item (a correção por campo do pedido de revisão), os
 * mesmos que o banco aceita (`sanitizeProposal`). Plano, canal e streaming também podem sair da grade.
 */
export const PROPOSABLE_FIELDS = {
  platform: ['name', 'website'],
  plan: ['name', 'priceText', 'url'],
  plan_channel: ['access'],
  plan_service: ['access'],
  // complemento: a operadora não propõe correção por campo (pede revisão pela mensagem)
  addon: [],
} as const satisfies Record<TargetType, readonly string[]>;
export type ProposableField = (typeof PROPOSABLE_FIELDS)[TargetType][number];
export const REMOVABLE_TYPES: readonly TargetType[] = ['plan', 'plan_channel', 'plan_service'];

export const MESSAGE_MAX = 2000;
export const NOTE_MAX = 1000;
export const FIELD_MAX = 200;
export const DOMAINS_MAX = 20;

export interface SourceView {
  url: string | null;
  seenAt: string;
  /** Veio da própria operadora (pedido aceito), não de uma página pública. */
  operator: boolean;
  note: string | null;
}

/** Item da grade como vai ao navegador (datas em ISO). */
export interface ItemView {
  type: TargetType;
  /** Id do item no pedido de revisão: uuid (operadora, plano) ou `<plano>:<canal|streaming>`. */
  id: string;
  name: string;
  status: LineupStatus;
  /** Campos que a operadora pode corrigir, com o valor atual. */
  fields: Partial<Record<ProposableField, string | null>>;
  logoUrl: string | null;
  sources: SourceView[];
  /** Quando a pesquisa (ou a operadora) confirmou o item pela última vez. */
  seenAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** Mudança encontrada pela pesquisa num item já revisado ou aprovado (aprovar aplica; descartar ignora). */
  pendingChange: Record<string, unknown> | null;
  /** Checagens do validador (planos e vínculos); null = sem checagem (pesquisa anterior ou operadora). */
  verification?: VerificationView | null;
}

export interface PlanView extends ItemView {
  type: 'plan';
  validFrom: string | null;
  validTo: string | null;
  /** Preço cheio de lista provado (fonte oficial), com a moeda ISO 4217. */
  price: { amount: number; currency: string } | null;
  channels: ItemView[];
  services: ItemView[];
}

/** Complemento da plataforma (contratado à parte), uma oferta por linha. */
export interface AddonView extends ItemView {
  type: 'addon';
  kind: 'service' | 'channel';
  price: { amount: number; currency: string } | null;
  commitmentMonths: number | null;
}

export interface LineupView {
  platform: ItemView & { country: string; kind: PlatformKind };
  plans: PlanView[];
  addons: AddonView[];
}

export interface RequestView {
  id: string;
  targetType: TargetType;
  targetId: string;
  /** Nome do item quando o pedido foi lido (o item pode ter mudado, saído ou ainda não existir). */
  targetName: string | null;
  message: string;
  proposed: Record<string, string | boolean> | null;
  status: RequestStatus;
  resolutionNote: string | null;
  resolvedBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Entrada da biblioteca de emissoras (canal ou streaming), para nomes, logos e a inclusão no plano. */
export interface LibraryEntry {
  id: string;
  name: string;
  kind: string;
  logoUrl: string | null;
}

/** Tipos de emissora que entram num plano: canal de TV (aberta ou paga) ou streaming. Rádio não. */
export const PLAN_LIBRARY_KINDS = ['free_tv', 'pay_tv', 'streaming'] as const;

/**
 * Como uma entrada da biblioteca entra num plano: canal de TV vira `plan_channel`, streaming vira
 * `plan_service`; rádio (ou tipo desconhecido) não entra → null.
 */
export function libraryTargetType(kind: string): 'plan_channel' | 'plan_service' | null {
  if (kind === 'streaming') return 'plan_service';
  return kind === 'free_tv' || kind === 'pay_tv' ? 'plan_channel' : null;
}

// ─── conversão do que vem do banco ───────────────────────────────────────────────────────────────

interface SourceLike {
  url: string | null;
  seen_at: string;
  kind?: string;
  note?: string;
}

interface ReviewedLike {
  reviewStatus: string;
  sources: SourceLike[];
  proposedChange?: Record<string, unknown> | null;
  reviewedBy: string | null;
  reviewedAt: Date | string | null;
  seenAt?: Date | string | null;
  verification?: unknown;
}

export interface LineupLike {
  platform: ReviewedLike & {
    id: string;
    name: string;
    kind: string;
    country: string;
    website: string | null;
    logoAssetId?: string | null;
    broadcasterId?: string | null;
  };
  plans: {
    plan: ReviewedLike & {
      id: string;
      name: string;
      priceText: string | null;
      priceAmount?: number | string | null;
      priceCurrency?: string | null;
      url: string | null;
      validFrom: string | null;
      validTo: string | null;
    };
    channels: (ReviewedLike & { planId: string; channelId: string; access: string })[];
    services: (ReviewedLike & { planId: string; serviceId: string; access: string })[];
  }[];
  addons?: (ReviewedLike & {
    id: string;
    refId: string;
    name: string;
    kind: string;
    channel: string | null;
    priceAmount: number | string | null;
    priceCurrency: string | null;
    commitmentMonths: number | null;
  })[];
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

const isCheck = (v: unknown): v is CheckResult => v === 'pass' || v === 'fail' || v === 'skip';
const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
const amount = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** jsonb `verification` → visão do painel (só campos conhecidos; formato inválido = sem checagem). */
export function verificationView(raw: unknown): VerificationView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const checksRaw = (v.checks && typeof v.checks === 'object' ? v.checks : {}) as Record<string, unknown>;
  const checks: VerificationView['checks'] = {};
  for (const k of CHECK_KEYS) if (isCheck(checksRaw[k])) checks[k] = checksRaw[k];
  const claimedRaw =
    v.claimed && typeof v.claimed === 'object' ? (v.claimed as Record<string, unknown>) : null;
  const pageRaw = v.page && typeof v.page === 'object' ? (v.page as Record<string, unknown>) : null;
  const prices = (Array.isArray(v.prices) ? v.prices : []).flatMap((x) => {
    if (!x || typeof x !== 'object') return [];
    const o = x as Record<string, unknown>;
    const a = amount(o.amount);
    if (a === null) return [];
    return [
      {
        amount: a,
        currency: text(o.currency),
        origin: text(o.origin) ?? 'research',
        sourceUrl: text(o.source_url),
        tier: (SOURCE_TIERS as readonly string[]).includes(o.tier as string) ? (o.tier as SourceTier) : null,
        sourceDate: text(o.source_date),
        verified: o.verified === true,
      },
    ];
  });
  return {
    tier: (SOURCE_TIERS as readonly string[]).includes(v.tier as string) ? (v.tier as SourceTier) : null,
    finalUrl: text(v.final_url),
    finalHost: text(v.final_host),
    excerpt: text(v.excerpt),
    checks,
    verified: v.verified === true,
    claimed: claimedRaw
      ? { amount: amount(claimedRaw.price_amount), currency: text(claimedRaw.currency) }
      : null,
    prices,
    priceConflict: v.price_conflict === true,
    page:
      pageRaw && text(pageRaw.url)
        ? {
            url: text(pageRaw.url)!,
            fetchedAt: text(pageRaw.fetched_at) ?? '',
            hash: text(pageRaw.hash) ?? '',
            via: text(pageRaw.via) ?? 'static',
          }
        : null,
    checkedAt: text(v.checked_at),
  };
}
const asStatus = (v: string): LineupStatus =>
  (REVIEW_STATUSES as readonly string[]).includes(v) ? (v as LineupStatus) : 'draft';

function reviewed(row: ReviewedLike) {
  return {
    status: asStatus(row.reviewStatus),
    sources: (row.sources ?? []).map((s) => ({
      url: s.url ?? null,
      seenAt: new Date(s.seen_at).toISOString(),
      operator: s.kind === 'operator',
      note: s.note ?? null,
    })),
    seenAt: iso(row.seenAt),
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: iso(row.reviewedAt),
    pendingChange: row.proposedChange && Object.keys(row.proposedChange).length ? row.proposedChange : null,
  };
}

/**
 * Grade do banco → grade do navegador. `library` dá nome e logo de canais e streamings (biblioteca de
 * emissoras); `platformLogo`, o logo da plataforma.
 */
export function lineupView(
  lineup: LineupLike,
  library: ReadonlyMap<string, LibraryEntry>,
  platformLogo: string | null = null,
): LineupView {
  const p = lineup.platform;
  const ref = (id: string) => library.get(id);
  return {
    platform: {
      type: 'platform',
      id: p.id,
      name: p.name,
      country: p.country,
      kind: (PLATFORM_KINDS as readonly string[]).includes(p.kind)
        ? (p.kind as PlatformKind)
        : 'pay_tv_operator',
      fields: { name: p.name, website: p.website },
      logoUrl: platformLogo ?? (p.broadcasterId ? (ref(p.broadcasterId)?.logoUrl ?? null) : null),
      ...reviewed(p),
    },
    plans: lineup.plans.map(({ plan, channels, services }) => ({
      type: 'plan' as const,
      id: plan.id,
      name: plan.name,
      fields: { name: plan.name, priceText: plan.priceText, url: plan.url },
      logoUrl: null,
      validFrom: plan.validFrom,
      validTo: plan.validTo,
      price:
        amount(plan.priceAmount) !== null && plan.priceCurrency
          ? { amount: amount(plan.priceAmount)!, currency: plan.priceCurrency }
          : null,
      ...reviewed(plan),
      verification: verificationView(plan.verification),
      channels: channels.map((c) => ({
        type: 'plan_channel' as const,
        id: `${c.planId}:${c.channelId}`,
        name: ref(c.channelId)?.name ?? c.channelId,
        fields: { access: c.access },
        logoUrl: ref(c.channelId)?.logoUrl ?? null,
        ...reviewed(c),
        verification: verificationView(c.verification),
      })),
      services: services.map((s) => ({
        type: 'plan_service' as const,
        id: `${s.planId}:${s.serviceId}`,
        name: ref(s.serviceId)?.name ?? s.serviceId,
        fields: { access: s.access },
        logoUrl: ref(s.serviceId)?.logoUrl ?? null,
        ...reviewed(s),
        verification: verificationView(s.verification),
      })),
    })),
    addons: (lineup.addons ?? []).map((a) => ({
      type: 'addon' as const,
      id: a.id,
      name: a.name,
      kind: a.kind === 'channel' ? ('channel' as const) : ('service' as const),
      fields: {},
      logoUrl: ref(a.refId)?.logoUrl ?? null,
      price:
        amount(a.priceAmount) !== null && a.priceCurrency
          ? { amount: amount(a.priceAmount)!, currency: a.priceCurrency }
          : null,
      commitmentMonths: a.commitmentMonths,
      ...reviewed(a),
      verification: verificationView(a.verification),
    })),
  };
}

/** Plano vigente no dia (`YYYY-MM-DD`): a API pública só mostra estes. */
export const planCurrentAt = (plan: Pick<PlanView, 'validFrom' | 'validTo'>, day: string) =>
  (!plan.validFrom || plan.validFrom <= day) && (!plan.validTo || plan.validTo >= day);

/** Itens da grade numa lista (operadora, planos, canais e streamings), com o plano de cada um. */
export function flattenLineup(lineup: LineupView): (ItemView & { planName: string | null })[] {
  return [
    { ...lineup.platform, planName: null },
    ...lineup.plans.flatMap((p) => [
      { ...p, planName: null },
      ...p.channels.map((c) => ({ ...c, planName: p.name })),
      ...p.services.map((s) => ({ ...s, planName: p.name })),
    ]),
    ...lineup.addons.map((a) => ({ ...a, planName: null })),
  ];
}

/** O item `{type, id}` está nesta grade? (a operadora só pede revisão do que é dela). */
export function findInLineup(lineup: LineupView, type: TargetType, id: string): ItemView | null {
  return flattenLineup(lineup).find((i) => i.type === type && i.id === id) ?? null;
}

/** Itens que ainda esperam a Galaxie: rascunho, conferido (não publicado) ou com mudança encontrada. */
export const awaitsDecision = (item: Pick<ItemView, 'status' | 'pendingChange'>) =>
  item.status === 'draft' || item.status === 'reviewed' || item.pendingChange !== null;

// ─── correção proposta ───────────────────────────────────────────────────────────────────────────

const clean = (v: string) =>
  v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, FIELD_MAX);

/**
 * Correção proposta pela operadora: só os campos do tipo (texto aparado, até `FIELD_MAX`; `access` só
 * `included`/`addon`), sem vazios e sem repetir o valor atual, mais `removed` quando o item pode sair da
 * grade. null = nada a propor.
 */
export function parseProposed(
  type: TargetType,
  raw: unknown,
  current: ItemView['fields'] = {},
): Record<string, string | boolean> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  if (src.removed === true && REMOVABLE_TYPES.includes(type)) return { removed: true };
  const out: Record<string, string> = {};
  for (const field of PROPOSABLE_FIELDS[type]) {
    const v = src[field];
    if (typeof v !== 'string') continue;
    const value = clean(v);
    if (!value || value === (current as Record<string, string | null | undefined>)[field]) continue;
    if (field === 'access' && !(ACCESS as readonly string[]).includes(value)) continue;
    out[field] = value;
  }
  return Object.keys(out).length ? out : null;
}

/** Correção já gravada (jsonb) → só os campos conhecidos. */
export function proposedView(type: TargetType, raw: unknown): Record<string, string | boolean> | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, string | boolean> = {};
  for (const field of PROPOSABLE_FIELDS[type]) {
    const v = src[field];
    if (v !== null && v !== undefined && v !== '') out[field] = String(v);
  }
  if (src.removed === true) out.removed = true;
  return Object.keys(out).length ? out : null;
}

// ─── domínios de e-mail da operadora ─────────────────────────────────────────────────────────────

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Lista de domínios digitada pelo admin (vírgula, espaço ou linha): minúsculos, sem `@` nem `*.` na
 * frente, sem repetidos. Os inválidos voltam à parte.
 */
export function parseDomains(text: string): { domains: string[]; invalid: string[] } {
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const d = part
      .trim()
      .toLowerCase()
      .replace(/^@|^\*\./, '')
      .replace(/\.$/, '');
    if (!d) continue;
    if (!DOMAIN_RE.test(d)) invalid.push(part.trim());
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains, invalid };
}

/** Domínio do e-mail (minúsculo), ou null. */
export const emailDomain = (email: string) => {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  return at > 0 ? e.slice(at + 1) || null : null;
};

/**
 * O e-mail é de um domínio da operadora (o próprio ou subdomínio)? Sem domínios cadastrados não há o
 * que conferir: conta como sim.
 */
export function emailMatchesDomains(email: string, domains: readonly string[]): boolean {
  if (!domains.length) return true;
  const d = emailDomain(email);
  if (!d) return false;
  return domains.some((x) => d === x || d.endsWith(`.${x}`));
}

// ─── filtros da revisão (URL) ────────────────────────────────────────────────────────────────────

export const ADMIN_TABS = ['revisao', 'pedidos', 'tenants'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** `pending` = espera decisão (rascunho, conferido ou com mudança encontrada); null = todos. */
export const STATUS_FILTERS = ['pending', ...REVIEW_STATUSES] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export interface LineupFilters {
  country: string | null;
  platform: string | null;
  type: TargetType | null;
  status: StatusFilter | null;
}

export interface RequestFilters {
  status: RequestStatus | null;
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

const getter = (params: Params) => (k: string) => {
  if (params instanceof URLSearchParams) return params.get(k);
  const v = params[k];
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
};

const pick = <T extends string>(list: readonly T[], value: string | null): T | null =>
  value && (list as readonly string[]).includes(value) ? (value as T) : null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Id de item no formato do banco: uuid (operadora, plano) ou `<uuid do plano>:<id da biblioteca>`. */
export function isTargetId(type: TargetType, id: unknown): id is string {
  if (typeof id !== 'string') return false;
  if (type === 'platform' || type === 'plan' || type === 'addon') return isId(id);
  const i = id.indexOf(':');
  return i > 0 && isId(id.slice(0, i)) && /^[a-z0-9][a-z0-9._-]{0,119}$/i.test(id.slice(i + 1));
}

export function parseAdminTab(params: Params): AdminTab {
  return pick(ADMIN_TABS, getter(params)('aba')) ?? 'revisao';
}

/** Filtros da revisão. Sem situação escolhida, a lista abre no que espera decisão. */
export function parseLineupFilters(params: Params): LineupFilters {
  const get = getter(params);
  const country = get('pais')?.trim().toUpperCase() ?? '';
  const platform = get('plataforma');
  const status = get('status');
  return {
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    platform: isId(platform) ? platform : null,
    type: pick(TARGET_TYPES, get('tipo')),
    status: status === 'todos' ? null : (pick(STATUS_FILTERS, status) ?? 'pending'),
  };
}

export function lineupFiltersQuery(filters: LineupFilters): string {
  const q = new URLSearchParams({ aba: 'revisao' });
  if (filters.country) q.set('pais', filters.country);
  if (filters.platform) q.set('plataforma', filters.platform);
  if (filters.type) q.set('tipo', filters.type);
  q.set('status', filters.status ?? 'todos');
  return `?${q.toString()}`;
}

/** Fila de pedidos: abre nos em aberto. */
export function parseRequestFilters(params: Params): RequestFilters {
  const status = getter(params)('status');
  return { status: status === 'todos' ? null : (pick(REQUEST_STATUSES, status) ?? 'open') };
}

export function matchesFilters(
  item: ItemView,
  platform: { id: string; country: string },
  filters: LineupFilters,
): boolean {
  return (
    (!filters.country || platform.country === filters.country) &&
    (!filters.platform || platform.id === filters.platform) &&
    (!filters.type || item.type === filters.type) &&
    (!filters.status ||
      (filters.status === 'pending' ? awaitsDecision(item) : item.status === filters.status))
  );
}
