import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from './openapi.js';
import { PlatformLineup, PlatformParams, WhereToWatch, WhereToWatchAvailability } from './where-to-watch.js';

const operadora = {
  id: '0199b000-0000-7000-8000-00000000a001',
  slug: 'operadora-exemplo',
  name: 'Operadora Exemplo',
  kind: 'pay_tv_operator',
  country: 'BR',
  broadcaster_id: null,
  logo: 'https://cdn.exemplo.test/operadora.png',
  logo_dark: null,
};
const canal = { id: 'canal_exemplo', name: 'Canal Exemplo', logo: null, logo_dark: null };
const streaming = {
  id: 'streaming_exemplo',
  name: 'Streaming Exemplo',
  logo: 'https://cdn.exemplo.test/streaming.png',
  logo_dark: 'https://cdn.exemplo.test/streaming-dark.png',
};

const availability = {
  free_tv: [{ ...canal, id: 'canal_aberto_exemplo', name: 'Canal Aberto Exemplo' }],
  pay_tv_channels: [canal],
  platforms: [
    {
      platform: operadora,
      plans: [
        {
          id: 'plano-top',
          name: 'Plano Top',
          access: 'included',
          via_channels: [{ ...canal, access: 'included' }],
          included_services: [streaming],
        },
      ],
    },
  ],
  your_operator: null,
};

const base = {
  event_id: '0199a5c0-0000-7000-8000-000000000001',
  country: 'BR',
  status: 'resolved',
  message: null,
  options: [],
  to_confirm: [],
  updated_at: null,
};

describe('contrato do onde assistir com a grade (availability)', () => {
  it('aceita TV aberta, canais pagos e plataformas com plano e streamings inclusos', () => {
    expect(WhereToWatch.parse({ ...base, availability })).toMatchObject({
      availability: {
        platforms: [{ platform: { kind: 'pay_tv_operator' }, plans: [{ access: 'included' }] }],
      },
    });
    expect(
      WhereToWatchAvailability.parse({
        ...availability,
        your_operator: { platform: operadora, plans: [] },
      }).your_operator,
    ).toMatchObject({ platform: { slug: 'operadora-exemplo' }, plans: [] });
  });

  it('sem plataforma: listas vazias e your_operator nulo', () => {
    expect(
      WhereToWatchAvailability.parse({
        free_tv: [],
        pay_tv_channels: [],
        platforms: [],
        your_operator: null,
      }),
    ).toEqual({ free_tv: [], pay_tv_channels: [], platforms: [], your_operator: null });
  });

  it('recusa tipo de plataforma e acesso fora do vocabulário', () => {
    const bad = (patch: object) =>
      WhereToWatchAvailability.safeParse({
        ...availability,
        platforms: [{ ...availability.platforms[0], ...patch }],
      }).success;
    expect(bad({ platform: { ...operadora, kind: 'cable' } })).toBe(false);
    expect(bad({ plans: [{ ...availability.platforms[0]!.plans[0], access: 'free' }] })).toBe(false);
    expect(bad({})).toBe(true);
  });

  it('o bloco é parte da resposta (sempre presente)', () => {
    expect(WhereToWatch.safeParse(base).success).toBe(false);
  });

  it('grade da plataforma e id da rota', () => {
    expect(
      PlatformLineup.parse({
        platform: { ...operadora, kind: 'streaming' },
        plans: [{ id: 'p', name: 'Plano', channels: [{ ...canal, access: 'addon' }], services: [] }],
      }).plans[0]!.channels[0]!.access,
    ).toBe('addon');
    expect(PlatformParams.safeParse({ id: operadora.id }).success).toBe(true);
    expect(PlatformParams.safeParse({ id: '../x' }).success).toBe(false);
  });

  it('OpenAPI publica o bloco e as rotas da grade', () => {
    const doc = buildOpenApiDocument();
    const wtw = doc.components?.schemas?.WhereToWatch as { required?: string[] };
    expect(wtw.required).toContain('availability');
    expect(doc.components?.schemas?.Platform).toMatchObject({
      properties: { kind: { enum: ['pay_tv_operator', 'vmvpd', 'telco_bundle', 'streaming'] } },
    });
    expect(doc.paths?.['/v1/platforms']?.get?.tags).toEqual(['Onde assistir']);
    expect(doc.paths?.['/v1/platforms/{id}/lineup']?.get?.responses).toHaveProperty('404');
  });
});
