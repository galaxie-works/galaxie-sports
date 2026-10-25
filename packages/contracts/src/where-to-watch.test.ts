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
  logo_credit: null,
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
  channel_status: 'confirmed',
  match_channel: {
    phase: 'post',
    state: 'confirmed',
    headline: 'Transmitido por Canal Exemplo',
    hint: null,
    channels: [
      {
        id: 'canal_exemplo',
        name: 'Canal Exemplo',
        logo: null,
        logo_dark: null,
        channel: null,
        medium: 'pay_tv',
        confirmed_at: '2026-10-22T12:00:00Z',
        post_match: true,
        source: {
          publisher: 'emissora.exemplo.test',
          url: 'https://emissora.exemplo.test/escala',
          excerpt: 'Time A x Time B no Canal Exemplo',
          kind: 'official',
        },
      },
    ],
  },
};

const noChannel = {
  phase: 'post',
  state: 'not_confirmed',
  headline: 'Não confirmamos o canal deste jogo',
  hint: null,
  channels: [],
} as const;

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
        channel_status: 'confirmed',
        match_channel: noChannel,
      }),
    ).toEqual({
      free_tv: [],
      pay_tv_channels: [],
      platforms: [],
      your_operator: null,
      channel_status: 'confirmed',
      match_channel: noChannel,
    });
  });

  it('canal do jogo: momento, estado e fonte do vocabulário', () => {
    const mc = availability.match_channel;
    expect(WhereToWatchAvailability.parse(availability).match_channel.channels[0]!.source?.kind).toBe(
      'official',
    );
    const bad = (patch: object) =>
      WhereToWatchAvailability.safeParse({ ...availability, match_channel: { ...mc, ...patch } }).success;
    expect(bad({ phase: 'halftime' })).toBe(false);
    expect(bad({ state: 'probable' })).toBe(false);
    expect(
      bad({ channels: [{ ...mc.channels[0]!, source: { ...mc.channels[0]!.source, kind: 'blog' } }] }),
    ).toBe(false);
    expect(WhereToWatchAvailability.safeParse({ ...availability, match_channel: undefined }).success).toBe(
      false,
    );
  });

  it('canal a confirmar: as listas são dos detentores dos direitos', () => {
    expect(
      WhereToWatchAvailability.parse({ ...availability, channel_status: 'to_confirm' }).channel_status,
    ).toBe('to_confirm');
    expect(WhereToWatchAvailability.safeParse({ ...availability, channel_status: 'probable' }).success).toBe(
      false,
    );
  });

  it('logo da plataforma com o crédito da Commons', () => {
    const credit = {
      source: 'Wikimedia Commons',
      title: 'File:Logo de exemplo.svg',
      page_url: 'https://commons.wikimedia.org/wiki/File:Logo_de_exemplo.svg',
      author: null,
      license: 'Public domain',
      license_url: null,
      attribution_required: false,
      text: 'Logo: Wikimedia Commons · Public domain',
    };
    expect(
      WhereToWatchAvailability.parse({
        ...availability,
        your_operator: { platform: { ...operadora, logo_credit: credit }, plans: [] },
      }).your_operator?.platform.logo_credit,
    ).toEqual(credit);
    expect(
      WhereToWatchAvailability.safeParse({
        ...availability,
        your_operator: { platform: { ...operadora, logo_credit: { ...credit, source: 'Outro' } }, plans: [] },
      }).success,
    ).toBe(false);
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
