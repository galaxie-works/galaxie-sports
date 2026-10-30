/**
 * Grade fictícia para os testes unitários (nomes genéricos: nenhuma operadora, streaming ou canal real).
 *
 * Mercado BR: "Operadora Exemplo" (TV paga) com dois planos, "Operadora Exemplo Dois" (concorrente) e
 * "Streaming Exemplo". Canais da biblioteca: `canal_exemplo` (pago) e `canal_aberto_exemplo` (aberto);
 * streaming incluso no plano: `streaming_exemplo`.
 */
import type {
  ChannelAvailability,
  LineupAccess,
  LineupAddon,
  LineupPlan,
  LineupPlanChannel,
  LineupPlanService,
  LineupPlatform,
  PlatformKind,
  PlatformLineup,
  TenantOperator,
} from '@galaxie/db';
import type { LineupSource } from './availability.js';

export const OPERATOR_ID = '0199b000-0000-7000-8000-00000000a001';
export const RIVAL_ID = '0199b000-0000-7000-8000-00000000a002';
export const STREAMING_ID = '0199b000-0000-7000-8000-00000000a003';

const T0 = new Date('2026-10-01T00:00:00Z');
const review = {
  reviewStatus: 'approved' as const,
  sources: [],
  proposedChange: null,
  reviewedBy: 'editor.teste',
  reviewedAt: T0,
  seenAt: T0,
  manualFields: {},
  createdAt: T0,
  updatedAt: T0,
};

const platform = (id: string, slug: string, name: string, kind: PlatformKind): LineupPlatform => ({
  id,
  slug,
  name,
  kind,
  country: 'BR',
  website: null,
  officialDomains: [],
  logoAssetId: null,
  customLogoAssetId: null,
  customLogoDarkAssetId: null,
  broadcasterId: null,
  planPages: [],
  planPagesHash: null,
  planPagesExtractedAt: null,
  ...review,
});

const plan = (id: string, platformId: string, name: string): LineupPlan => ({
  id,
  platformId,
  slug: id,
  name,
  country: 'BR',
  priceText: null,
  priceAmount: null,
  priceCurrency: null,
  url: null,
  verification: null,
  validFrom: null,
  validTo: null,
  ...review,
});

const channel = (planId: string, channelId: string, access: LineupAccess): LineupPlanChannel => ({
  planId,
  channelId,
  access,
  verification: null,
  ...review,
});

const addon = (refId: string, name: string, price: number, months: number | null): LineupAddon => ({
  id: `${refId}-${months ?? 0}`,
  platformId: OPERATOR_ID,
  slug: `${refId}${months ? `-f${months}` : ''}`,
  kind: 'service',
  refId,
  channel: null,
  name,
  priceAmount: price,
  priceCurrency: 'BRL',
  priceText: null,
  commitmentMonths: months,
  url: null,
  verification: null,
  ...review,
});

const service = (planId: string, serviceId: string, access: LineupAccess): LineupPlanService => ({
  planId,
  serviceId,
  access,
  verification: null,
  ...review,
});

export const OPERATOR = platform(OPERATOR_ID, 'br-operadora-exemplo', 'Operadora Exemplo', 'pay_tv_operator');
export const RIVAL = platform(
  RIVAL_ID,
  'br-operadora-exemplo-dois',
  'Operadora Exemplo Dois',
  'pay_tv_operator',
);
export const STREAMING = platform(STREAMING_ID, 'br-streaming-exemplo', 'Streaming Exemplo', 'streaming');

export const AVAILABILITY: ChannelAvailability[] = [
  {
    platform: STREAMING,
    plans: [
      {
        plan: plan('plano-streaming', STREAMING_ID, 'Plano Streaming Exemplo'),
        viaChannels: [{ channelId: 'canal_exemplo', access: 'included' }],
        services: [],
      },
    ],
    addons: [],
  },
  {
    platform: RIVAL,
    plans: [
      {
        plan: plan('plano-rival', RIVAL_ID, 'Plano Completo'),
        viaChannels: [{ channelId: 'canal_exemplo', access: 'addon' }],
        services: [],
      },
    ],
    addons: [],
  },
  {
    platform: OPERATOR,
    plans: [
      {
        plan: plan('plano-top', OPERATOR_ID, 'Plano Top'),
        viaChannels: [{ channelId: 'canal_exemplo', access: 'included' }],
        services: [
          { serviceId: 'streaming_exemplo', access: 'included' },
          { serviceId: 'streaming_extra_exemplo', access: 'addon' },
        ],
      },
      {
        plan: plan('plano-basico', OPERATOR_ID, 'Plano Básico'),
        viaChannels: [{ channelId: 'canal_exemplo', access: 'addon' }],
        services: [],
      },
    ],
    // o canal também vendido à parte: mensal e com fidelidade
    addons: [
      addon('canal_exemplo', 'Canal Exemplo', 59.9, null),
      addon('canal_exemplo', 'Canal Exemplo Fidelidade', 49.9, 12),
    ],
  },
];

export const OPERATOR_LINEUP: PlatformLineup = {
  platform: OPERATOR,
  plans: [
    {
      plan: plan('plano-top', OPERATOR_ID, 'Plano Top'),
      channels: [
        channel('plano-top', 'canal_exemplo', 'included'),
        channel('plano-top', 'canal_aberto_exemplo', 'included'),
      ],
      services: [service('plano-top', 'streaming_exemplo', 'included')],
    },
  ],
  addons: [addon('streaming_extra_exemplo', 'Streaming Extra Exemplo', 29.9, null)],
};

/** Fonte da grade em memória, que grava as chamadas (o teste confere o piso e o filtro pedidos). */
export function fixtureLineupSource(
  operators: Record<string, { platformId: string | null; show: boolean }> = {},
) {
  const calls: { fn: string; args: unknown }[] = [];
  const all = [OPERATOR, RIVAL, STREAMING];
  const source: LineupSource = {
    async availabilityForChannels(_db, opts) {
      calls.push({ fn: 'availabilityForChannels', args: opts });
      return AVAILABILITY.filter(
        (r) =>
          r.platform.country === opts.country &&
          (!opts.onlyPlatformId ||
            r.platform.id === opts.onlyPlatformId ||
            (opts.includeStreaming !== false && r.platform.kind === 'streaming')),
      );
    },
    async listPlatforms(_db, opts = {}) {
      calls.push({ fn: 'listPlatforms', args: opts });
      return all.filter((p) => !opts.country || p.country === opts.country);
    },
    async getPlatformLineup(_db, id, opts = {}) {
      calls.push({ fn: 'getPlatformLineup', args: { id, ...opts } });
      if (id === OPERATOR_ID) return OPERATOR_LINEUP;
      const p = all.find((x) => x.id === id);
      return p ? { platform: p, plans: [], addons: [] } : null;
    },
    async getTenantOperator(_db, tenantId): Promise<TenantOperator | null> {
      calls.push({ fn: 'getTenantOperator', args: tenantId });
      const op = operators[tenantId];
      return op
        ? {
            tenantId,
            platformId: op.platformId,
            showOtherOperators: op.show,
            emailDomains: [],
            platform: all.find((p) => p.id === op.platformId) ?? null,
          }
        : null;
    },
  };
  return { source, calls };
}
