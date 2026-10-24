/**
 * Grade fictícia para os testes (nomes genéricos: nenhuma operadora, streaming ou canal real).
 *
 * Mercado BR: "Operadora Exemplo" (TV paga) com dois planos, "Operadora Exemplo Dois" (concorrente) e
 * "Streaming Exemplo". Canais da biblioteca: `canal_exemplo` (pago) e `canal_aberto_exemplo` (aberto);
 * streaming incluso no plano: `streaming_exemplo`.
 */
import type { PlatformAvailabilityRow, PlatformLineupRow, PlatformRow, TenantOperator } from '@galaxie/db';
import type { LineupSource } from './availability.js';

export const OPERATOR_ID = '0199b000-0000-7000-8000-00000000a001';
export const RIVAL_ID = '0199b000-0000-7000-8000-00000000a002';
export const STREAMING_ID = '0199b000-0000-7000-8000-00000000a003';

const platform = (id: string, slug: string, name: string, kind: PlatformRow['kind']): PlatformRow => ({
  id,
  slug,
  name,
  kind,
  country: 'BR',
  logoAssetId: null,
  broadcasterId: null,
  reviewStatus: 'approved',
});

export const OPERATOR = platform(OPERATOR_ID, 'operadora-exemplo', 'Operadora Exemplo', 'pay_tv_operator');
export const RIVAL = platform(
  RIVAL_ID,
  'operadora-exemplo-dois',
  'Operadora Exemplo Dois',
  'pay_tv_operator',
);
export const STREAMING = platform(STREAMING_ID, 'streaming-exemplo', 'Streaming Exemplo', 'streaming');

export const AVAILABILITY: PlatformAvailabilityRow[] = [
  {
    platform: STREAMING,
    plans: [
      {
        plan: { id: 'plano-streaming', platformId: STREAMING_ID, name: 'Plano Streaming Exemplo' },
        viaChannels: [{ channelId: 'canal_exemplo', access: 'included' }],
        services: [],
      },
    ],
  },
  {
    platform: RIVAL,
    plans: [
      {
        plan: { id: 'plano-rival', platformId: RIVAL_ID, name: 'Plano Completo' },
        viaChannels: [{ channelId: 'canal_exemplo', access: 'addon' }],
        services: [],
      },
    ],
  },
  {
    platform: OPERATOR,
    plans: [
      {
        plan: { id: 'plano-top', platformId: OPERATOR_ID, name: 'Plano Top' },
        viaChannels: [{ channelId: 'canal_exemplo', access: 'included' }],
        services: [
          { serviceId: 'streaming_exemplo', access: 'included' },
          { serviceId: 'streaming_extra_exemplo', access: 'addon' },
        ],
      },
      {
        plan: { id: 'plano-basico', platformId: OPERATOR_ID, name: 'Plano Básico' },
        viaChannels: [{ channelId: 'canal_exemplo', access: 'addon' }],
        services: [],
      },
    ],
  },
];

export const OPERATOR_LINEUP: PlatformLineupRow = {
  platform: OPERATOR,
  plans: [
    {
      plan: { id: 'plano-top', platformId: OPERATOR_ID, name: 'Plano Top' },
      channels: [
        { channelId: 'canal_exemplo', access: 'included' },
        { channelId: 'canal_aberto_exemplo', access: 'included' },
      ],
      services: [{ serviceId: 'streaming_exemplo', access: 'included' }],
    },
  ],
};

/**
 * Fonte da grade em memória: filtra como a consulta real (`onlyPlatformId` + streamings) e grava as
 * chamadas, para o teste conferir o piso e o filtro pedidos.
 */
export function fixtureLineupSource(operators: Record<string, TenantOperator> = {}) {
  const calls: { fn: string; args: unknown }[] = [];
  const all = [OPERATOR, RIVAL, STREAMING];
  const source: LineupSource = {
    async availabilityForChannels(_db, params) {
      calls.push({ fn: 'availabilityForChannels', args: params });
      return AVAILABILITY.filter(
        (r) =>
          r.platform.country === params.country &&
          r.plans.some((p) => p.viaChannels.some((c) => params.channelIds.includes(c.channelId))) &&
          (!params.onlyPlatformId ||
            r.platform.id === params.onlyPlatformId ||
            (params.includeStreaming !== false && r.platform.kind === 'streaming')),
      );
    },
    async listPlatforms(_db, filter = {}) {
      calls.push({ fn: 'listPlatforms', args: filter });
      return all.filter((p) => !filter.country || p.country === filter.country);
    },
    async getPlatformLineup(_db, id, opts = {}) {
      calls.push({ fn: 'getPlatformLineup', args: { id, ...opts } });
      if (id === OPERATOR_ID) return OPERATOR_LINEUP;
      const p = all.find((x) => x.id === id);
      return p ? { platform: p, plans: [] } : null;
    },
    async getTenantOperator(_db, tenantId) {
      calls.push({ fn: 'getTenantOperator', args: tenantId });
      return operators[tenantId] ?? null;
    },
  };
  return { source, calls };
}
