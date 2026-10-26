import { describe, expect, it } from 'vitest';
import type { Database } from '@galaxie/db';
import type { PublicOption } from '@galaxie/where-to-watch';
import {
  channelsOf,
  holdersOf,
  Lineup,
  lineupDto,
  lineupTags,
  LogoBook,
  logoCreditText,
  operatorVary,
  type Operator,
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

const credit = {
  source: 'Wikimedia Commons' as const,
  title: 'File:Logo de exemplo.svg',
  page_url: 'https://commons.wikimedia.org/wiki/File:Logo_de_exemplo.svg',
  author: null,
  license: 'Public domain',
  license_url: null,
  attribution_required: false,
  attribution: null,
  text: 'Logo: Wikimedia Commons · Public domain',
};

const own: Operator = { platformId: OPERATOR_ID, showOtherOperators: false };
const ownPlusOthers: Operator = { ...own, showOtherOperators: true };

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
      platform: { id: OPERATOR_ID, slug: 'br-operadora-exemplo', kind: 'pay_tv_operator', logo: null },
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

  it('complemento da plataforma: as ofertas juntas, "a partir de" o menor preço', () => {
    const [operator] = platformAvailability(AVAILABILITY, own, logos);
    expect(operator!.addons).toEqual([
      {
        id: 'canal_exemplo',
        name: 'Canal Exemplo',
        logo: 'https://cdn.test/canal.png',
        logo_dark: 'https://cdn.test/canal-dark.png',
        kind: 'service',
        channel: null,
        price_from: 49.9,
        currency: 'BRL',
        offers: [
          { name: 'Canal Exemplo', price: 59.9, currency: 'BRL', commitment_months: null },
          { name: 'Canal Exemplo Fidelidade', price: 49.9, currency: 'BRL', commitment_months: 12 },
        ],
      },
    ]);
  });

  it('plataforma só com o complemento (nenhum plano tem o canal) vira cartão sem planos', () => {
    const out = platformAvailability(
      [{ platform: RIVAL, plans: [], addons: AVAILABILITY[2]!.addons }],
      null,
      LogoBook.empty(),
    );
    expect(out.map((p) => [p.platform.id, p.plans.length, p.addons?.[0]?.price_from])).toEqual([
      [RIVAL_ID, 0, 49.9],
    ]);
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
        { platform: RIVAL, plans: [], addons: [] },
        {
          platform: STREAMING,
          plans: [
            {
              plan: { ...AVAILABILITY[0]!.plans[0]!.plan, id: 'p', platformId: STREAMING_ID, name: 'Plano' },
              viaChannels: [{ channelId: 'canal_desconhecido', access: 'addon' }],
              services: [],
            },
          ],
          addons: [],
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

  it('vínculo sem prova (unverified) nunca sai, nem como incluso nem como adicional', () => {
    const [card] = platformAvailability(
      [
        {
          platform: STREAMING,
          plans: [
            {
              plan: { ...AVAILABILITY[0]!.plans[0]!.plan, id: 'p', platformId: STREAMING_ID, name: 'Plano' },
              viaChannels: [
                { channelId: 'canal_provado', access: 'addon' },
                { channelId: 'canal_sem_prova', access: 'unverified' },
              ],
              services: [{ serviceId: 'streaming_sem_prova', access: 'unverified' }],
            },
          ],
          addons: [],
        },
      ],
      null,
      LogoBook.empty(),
    );
    const plan = card!.plans[0]!;
    expect(plan.access).toBe('addon');
    expect(plan.via_channels.map((c) => c.id)).toEqual(['canal_provado']);
    expect(plan.included_services).toEqual([]);
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
      new Map([
        ['asset-1', { url: 'https://cdn.test/operadora.png', darkUrl: null, credit }],
        // logo da biblioteca reaproveitado (mesmo site oficial): a versão escura do acervo vem junto
        [
          'asset-2',
          { url: 'https://cdn.test/acervo.svg', darkUrl: 'https://cdn.test/acervo-dark.svg', credit: null },
        ],
        // asset ainda sem arquivo no storage: cai para a entrada da biblioteca
        ['asset-3', { url: null, darkUrl: null, credit: null }],
      ]),
    );
    expect(book.platform({ ...OPERATOR, logoAssetId: 'asset-1' })).toMatchObject({
      logo: 'https://cdn.test/operadora.png',
      logo_dark: null,
      logo_credit: credit,
    });
    expect(book.platform({ ...OPERATOR, logoAssetId: 'asset-2' })).toMatchObject({
      logo: 'https://cdn.test/acervo.svg',
      logo_dark: 'https://cdn.test/acervo-dark.svg',
      logo_credit: null,
    });
    expect(book.platform({ ...STREAMING, broadcasterId: 'streaming_exemplo' })).toMatchObject({
      logo: 'https://cdn.test/s.png',
      logo_dark: 'https://cdn.test/s-dark.png',
      logo_credit: null,
    });
    expect(
      book.platform({ ...STREAMING, broadcasterId: 'streaming_exemplo', logoAssetId: 'asset-3' }).logo,
    ).toBe('https://cdn.test/s.png');
  });

  it('crédito do logo: autor quando há, sempre a fonte e a licença', () => {
    expect(logoCreditText(null, 'Public domain')).toBe('Logo: Wikimedia Commons · Public domain');
    expect(logoCreditText('Fulano', 'CC BY-SA 4.0')).toBe('Logo: Fulano / Wikimedia Commons · CC BY-SA 4.0');
  });

  it('crédito do logo: a atribuição pedida pelo autor, com a licença quando ela não cita', () => {
    expect(logoCreditText('Fulano', 'CC BY 4.0', 'Fulano / Liga Exemplo')).toBe(
      'Logo: Fulano / Liga Exemplo · CC BY 4.0',
    );
    expect(logoCreditText('Fulano', 'CC BY 4.0', 'Fulano, cc by 4.0')).toBe('Logo: Fulano, cc by 4.0');
    // a mesma licença com hífen (o código da Commons) não se repete
    expect(logoCreditText('Fulano', 'CC BY 4.0', 'Fulano (CC-BY-4.0)')).toBe('Logo: Fulano (CC-BY-4.0)');
    expect(logoCreditText('Fulano', 'CC BY-SA 4.0', 'Fulano (CC-BY-4.0)')).toBe(
      'Logo: Fulano (CC-BY-4.0) · CC BY-SA 4.0',
    );
    expect(logoCreditText('Fulano', 'CC BY 4.0', null)).toBe('Logo: Fulano / Wikimedia Commons · CC BY 4.0');
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

  it('canal a confirmar: os detentores dos direitos por meio, sem repetir', () => {
    const holders = [
      {
        broadcasterId: 'canal_exemplo',
        name: 'Canal Exemplo',
        medium: 'pay_tv',
        logo: null,
        logo_dark: null,
      },
      {
        broadcasterId: 'canal_exemplo',
        name: 'Canal Exemplo',
        medium: 'pay_tv',
        logo: null,
        logo_dark: null,
      },
      {
        broadcasterId: 'aberto',
        name: 'Aberto',
        medium: 'free_tv',
        logo: 'https://cdn.test/a.png',
        logo_dark: null,
      },
      {
        broadcasterId: 'streaming_exemplo',
        name: 'Streaming',
        medium: 'streaming_svod',
        logo: null,
        logo_dark: null,
      },
    ] as const;
    expect(holdersOf([...holders], 'pay_tv')).toEqual([
      { id: 'canal_exemplo', name: 'Canal Exemplo', logo: null, logo_dark: null },
    ]);
    expect(holdersOf([...holders], 'free_tv').map((c) => c.id)).toEqual(['aberto']);
  });
});

describe('operadora do tenant', () => {
  it('fica em memória pelo TTL (uma consulta por tenant a cada minuto)', async () => {
    let now = 0;
    const { source, calls } = fixtureLineupSource({
      t1: { platformId: OPERATOR_ID, show: false },
      // tenant sem plataforma ligada: não é operadora
      t3: { platformId: null, show: false },
    });
    const lineup = new Lineup({ source, minReviewStatus: 'reviewed' }, () => now);
    const db = {} as Database;
    expect(await lineup.operatorOf(db, 't1')).toEqual(own);
    expect(await lineup.operatorOf(db, 't1')).toEqual(own);
    expect(await lineup.operatorOf(db, 't2')).toBeNull();
    expect(await lineup.operatorOf(db, undefined)).toBeNull();
    expect(await lineup.operatorOf(db, 't3')).toBeNull();
    expect(calls.filter((c) => c.fn === 'getTenantOperator')).toHaveLength(3);
    now = 61_000;
    await lineup.operatorOf(db, 't1');
    expect(calls.filter((c) => c.fn === 'getTenantOperator')).toHaveLength(4);
    expect(lineup.minReview).toBe('reviewed');
    expect(new Lineup().minReview).toBe('approved');
  });
});
