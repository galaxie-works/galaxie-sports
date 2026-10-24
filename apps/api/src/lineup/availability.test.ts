import { describe, expect, it } from 'vitest';
import type { Database, TenantOperator } from '@galaxie/db';
import type { PublicOption } from '@galaxie/where-to-watch';
import {
  channelsOf,
  Lineup,
  lineupDto,
  lineupTags,
  LogoBook,
  operatorVary,
  platformAvailability,
  visibleTo,
} from './availability.js';
import {
  AVAILABILITY,
  fixtureLineupSource,
  OPERATOR,
  OPERATOR_ID,
  OPERATOR_LINEUP,
  RIVAL,
  RIVAL_ID,
  STREAMING,
  STREAMING_ID,
} from './fixtures.js';

const own: TenantOperator = { platformId: OPERATOR_ID, showOtherOperators: false, emailDomains: [] };
const ownPlusOthers: TenantOperator = { ...own, showOtherOperators: true };

const logos = new LogoBook(
  new Map([
    [
      'canal_exemplo',
      {
        name: 'Canal Exemplo',
        logo: 'https://cdn.test/canal.png',
        logo_dark: 'https://cdn.test/canal-dark.png',
      },
    ],
    [
      'streaming_exemplo',
      { name: 'Streaming Exemplo', logo: 'https://cdn.test/streaming.png', logo_dark: null },
    ],
  ]),
  new Map(),
);

describe('regra por tenant', () => {
  it('sem operadora (demo, outros tenants) vê todas as plataformas', () => {
    expect([OPERATOR, RIVAL, STREAMING].filter((p) => visibleTo(null, p))).toHaveLength(3);
  });

  it('operadora com show_other_operators = false vê só a dela e os streamings', () => {
    expect([OPERATOR, RIVAL, STREAMING].filter((p) => visibleTo(own, p)).map((p) => p.id)).toEqual([
      OPERATOR_ID,
      STREAMING_ID,
    ]);
  });

  it('operadora com show_other_operators = true vê as concorrentes', () => {
    expect([OPERATOR, RIVAL, STREAMING].filter((p) => visibleTo(ownPlusOthers, p))).toHaveLength(3);
  });

  it('o cache varia pela operadora e pelo filtro só quando o tenant tem operadora', () => {
    expect(operatorVary(null)).toEqual([]);
    expect(operatorVary(own)).toEqual([`op:${OPERATOR_ID}:own`]);
    expect(operatorVary(ownPlusOthers)).toEqual([`op:${OPERATOR_ID}:all`]);
    expect(lineupTags([OPERATOR_ID, OPERATOR_ID])).toEqual(['platform', `platform:${OPERATOR_ID}`]);
  });
});

describe('montagem das plataformas', () => {
  it('a operadora do tenant vem primeiro; depois por tipo (TV paga antes de streaming) e nome', () => {
    const out = platformAvailability(AVAILABILITY, ownPlusOthers, logos);
    expect(out.map((p) => p.platform.name)).toEqual([
      'Operadora Exemplo',
      'Operadora Exemplo Dois',
      'Streaming Exemplo',
    ]);
    expect(platformAvailability(AVAILABILITY, null, logos).map((p) => p.platform.id)).toEqual([
      OPERATOR_ID,
      RIVAL_ID,
      STREAMING_ID,
    ]);
  });

  it('cada plano traz o acesso, os canais por onde o jogo passa e os streamings inclusos', () => {
    const [operator] = platformAvailability(AVAILABILITY, own, logos);
    expect(operator).toMatchObject({
      platform: { id: OPERATOR_ID, slug: 'operadora-exemplo', kind: 'pay_tv_operator', logo: null },
      plans: [
        {
          id: 'plano-top',
          name: 'Plano Top',
          access: 'included',
          via_channels: [
            {
              id: 'canal_exemplo',
              name: 'Canal Exemplo',
              logo: 'https://cdn.test/canal.png',
              logo_dark: 'https://cdn.test/canal-dark.png',
              access: 'included',
            },
          ],
          // o adicional pago não é "incluso"
          included_services: [
            {
              id: 'streaming_exemplo',
              name: 'Streaming Exemplo',
              logo: 'https://cdn.test/streaming.png',
              logo_dark: null,
            },
          ],
        },
        { id: 'plano-basico', access: 'addon', included_services: [] },
      ],
    });
  });

  it('filtra as concorrentes mesmo se a consulta devolver todas (show_other_operators = false)', () => {
    expect(platformAvailability(AVAILABILITY, own, logos).map((p) => p.platform.id)).toEqual([
      OPERATOR_ID,
      STREAMING_ID,
    ]);
  });

  it('plataforma sem plano não vira cartão; canal sem entrada na biblioteca usa o id', () => {
    const out = platformAvailability(
      [
        { platform: RIVAL, plans: [] },
        {
          platform: STREAMING,
          plans: [
            {
              plan: { id: 'p', platformId: STREAMING_ID, name: 'Plano' },
              viaChannels: [{ channelId: 'canal_desconhecido', access: 'addon' }],
              services: [],
            },
          ],
        },
      ],
      null,
      LogoBook.empty(),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.plans[0]!.via_channels[0]).toEqual({
      id: 'canal_desconhecido',
      name: 'canal_desconhecido',
      logo: null,
      logo_dark: null,
      access: 'addon',
    });
  });

  it('logo da plataforma: o asset dela; senão, o da entrada dela na biblioteca', () => {
    const book = new LogoBook(
      new Map([
        [
          'streaming_exemplo',
          {
            name: 'Streaming Exemplo',
            logo: 'https://cdn.test/s.png',
            logo_dark: 'https://cdn.test/s-dark.png',
          },
        ],
      ]),
      new Map([['asset-1', 'https://cdn.test/operadora.png']]),
    );
    expect(book.platform({ ...OPERATOR, logoAssetId: 'asset-1' })).toMatchObject({
      logo: 'https://cdn.test/operadora.png',
      logo_dark: null,
    });
    expect(book.platform({ ...STREAMING, broadcasterId: 'streaming_exemplo' })).toMatchObject({
      logo: 'https://cdn.test/s.png',
      logo_dark: 'https://cdn.test/s-dark.png',
    });
  });

  it('grade da plataforma no contrato', () => {
    expect(lineupDto(OPERATOR_LINEUP, logos).plans[0]).toMatchObject({
      id: 'plano-top',
      channels: [
        { id: 'canal_exemplo', access: 'included' },
        { id: 'canal_aberto_exemplo', name: 'canal_aberto_exemplo', access: 'included' },
      ],
      services: [{ id: 'streaming_exemplo', access: 'included' }],
    });
  });
});

describe('TV aberta e canais pagos', () => {
  const option = (
    id: string,
    medium: 'free_tv' | 'pay_tv' | 'streaming_svod',
    broadcasterId: string,
    region: string | null,
  ) =>
    ({
      row: { id, medium, broadcasterId, channelName: null, providerName: `Nome ${broadcasterId}`, region },
      sources: [],
      logo: null,
    }) as unknown as PublicOption;

  it('agrupa por meio, sem repetir o canal de várias praças', () => {
    const options = [
      option('1', 'free_tv', 'canal_aberto_exemplo', 'SP'),
      option('2', 'free_tv', 'canal_aberto_exemplo', 'RJ'),
      option('3', 'pay_tv', 'canal_exemplo', null),
      option('4', 'streaming_svod', 'streaming_exemplo', null),
    ];
    const logo = () => ({ logo: 'https://cdn.test/x.png', logo_dark: null });
    expect(channelsOf(options, 'free_tv', logo)).toEqual([
      {
        id: 'canal_aberto_exemplo',
        name: 'Nome canal_aberto_exemplo',
        logo: 'https://cdn.test/x.png',
        logo_dark: null,
      },
    ]);
    expect(channelsOf(options, 'pay_tv', logo).map((c) => c.id)).toEqual(['canal_exemplo']);
  });
});

describe('operadora do tenant', () => {
  it('fica em memória pelo TTL (uma consulta por tenant a cada minuto)', async () => {
    let now = 0;
    const { source, calls } = fixtureLineupSource({ t1: own });
    const lineup = new Lineup({ source, minReviewStatus: 'reviewed' }, () => now);
    const db = {} as Database;
    expect(await lineup.operatorOf(db, 't1')).toEqual(own);
    expect(await lineup.operatorOf(db, 't1')).toEqual(own);
    expect(await lineup.operatorOf(db, 't2')).toBeNull();
    expect(await lineup.operatorOf(db, undefined)).toBeNull();
    expect(calls.filter((c) => c.fn === 'getTenantOperator')).toHaveLength(2);
    now = 61_000;
    await lineup.operatorOf(db, 't1');
    expect(calls.filter((c) => c.fn === 'getTenantOperator')).toHaveLength(3);
    expect(lineup.minReview).toBe('reviewed');
    expect(new Lineup().minReview).toBe('approved');
  });
});
