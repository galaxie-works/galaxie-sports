import type { LogoCredit, WhereToWatch, WhereToWatchOption } from '@galaxie/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { getDictionary } from '@/lib/i18n/dictionary';
import { groupWhereToWatch, hasGroups } from '@/lib/where-to-watch';

import { WhereToWatchGroups } from './where-to-watch-groups';

const option = (patch: Partial<WhereToWatchOption>): WhereToWatchOption => ({
  id: '0199a5c0-0000-7000-8000-0000000000f1',
  provider: 'Canal Exemplo',
  provider_id: 'canal_exemplo',
  channel: null,
  medium: 'pay_tv',
  access_model: 'subscription',
  region: null,
  watch_url: null,
  confidence: 0.95,
  status: 'confirmed',
  last_verified_at: '2026-10-24T12:00:00Z',
  sources: [],
  logo: 'https://cdn.exemplo.test/canal.png',
  logo_dark: 'https://cdn.exemplo.test/canal-dark.png',
  ...patch,
});

const operadora = {
  id: 'op-1',
  slug: 'operadora-exemplo',
  name: 'Operadora Exemplo',
  kind: 'pay_tv_operator' as const,
  country: 'BR',
  broadcaster_id: null,
  logo: 'https://cdn.exemplo.test/operadora.png',
  logo_dark: null,
  logo_credit: null,
};
const streaming = {
  id: 'st-1',
  slug: 'streaming-exemplo',
  name: 'Streaming Exemplo',
  kind: 'streaming' as const,
  country: 'BR',
  broadcaster_id: 'streaming_exemplo',
  logo: 'https://cdn.exemplo.test/streaming.png',
  logo_dark: 'https://cdn.exemplo.test/streaming-dark.png',
  logo_credit: null,
};
const canal = {
  id: 'canal_exemplo',
  name: 'Canal Exemplo',
  logo: 'https://cdn.exemplo.test/canal.png',
  logo_dark: 'https://cdn.exemplo.test/canal-dark.png',
};

const wtw: WhereToWatch = {
  event_id: '0199a5c0-0000-7000-8000-000000000001',
  country: 'BR',
  status: 'resolved',
  message: null,
  options: [
    option({
      id: '0199a5c0-0000-7000-8000-0000000000f2',
      provider: 'Canal Aberto Exemplo',
      provider_id: 'canal_aberto_exemplo',
      medium: 'free_tv',
      access_model: 'free',
      region: 'SP',
      watch_url: 'https://canal-aberto.exemplo.test/ao-vivo',
      logo: 'https://cdn.exemplo.test/aberto.png',
      logo_dark: null,
    }),
    option({}),
    option({
      id: '0199a5c0-0000-7000-8000-0000000000f3',
      provider: 'Streaming Exemplo',
      provider_id: 'streaming_exemplo',
      medium: 'streaming_svod',
    }),
  ],
  to_confirm: [],
  availability: {
    free_tv: [
      {
        id: 'canal_aberto_exemplo',
        name: 'Canal Aberto Exemplo',
        logo: 'https://cdn.exemplo.test/aberto.png',
        logo_dark: null,
      },
    ],
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
            included_services: [
              {
                id: 'streaming_exemplo',
                name: 'Streaming Exemplo',
                logo: streaming.logo,
                logo_dark: streaming.logo_dark,
              },
            ],
          },
          {
            id: 'plano-basico',
            name: 'Plano Básico',
            access: 'addon',
            via_channels: [{ ...canal, access: 'addon' }],
            included_services: [],
          },
        ],
      },
      {
        platform: streaming,
        plans: [
          {
            id: 'plano-st',
            name: 'Plano Streaming',
            access: 'included',
            via_channels: [{ ...canal, access: 'included' }],
            included_services: [],
          },
        ],
      },
    ],
    your_operator: null,
    channel_status: 'confirmed',
    match_channel: {
      phase: 'pre',
      state: 'confirmed',
      headline: 'Passa em Canal Aberto Exemplo e Canal Exemplo',
      hint: null,
      channels: [
        {
          id: 'canal_aberto_exemplo',
          name: 'Canal Aberto Exemplo',
          logo: null,
          logo_dark: null,
          channel: null,
          medium: 'free_tv',
          confirmed_at: '2026-10-22T12:00:00Z',
          post_match: false,
          source: {
            publisher: 'canalaberto.exemplo.test',
            url: 'https://canalaberto.exemplo.test/escala-rodada-32',
            excerpt: 'Time A x Time B, sábado, no Canal Aberto Exemplo',
            kind: 'official',
          },
        },
        {
          id: 'canal_exemplo',
          name: 'Canal Exemplo',
          logo: null,
          logo_dark: null,
          channel: null,
          medium: 'pay_tv',
          confirmed_at: '2026-10-22T12:00:00Z',
          post_match: false,
          source: null,
        },
      ],
    },
  },
  updated_at: null,
};

const t = getDictionary('pt-BR').event.whereToWatch;
const TO_CONFIRM_PRE: WhereToWatch['availability']['match_channel'] = {
  phase: 'pre',
  state: 'to_confirm',
  headline: 'Canal deste jogo a confirmar',
  hint: 'O canal do jogo sai mais perto da partida.',
  channels: [],
};

const render = (data: WhereToWatch, dict = t, relatedHref?: string) =>
  renderToStaticMarkup(
    <WhereToWatchGroups groups={groupWhereToWatch(data)} t={dict} relatedHref={relatedHref ?? null} />,
  );
const cards = (html: string) => html.split('data-testid="platform-card"').length - 1;

describe('onde assistir agrupado (página do jogo)', () => {
  it('TV aberta, canais pagos e um cartão por plataforma com plano e streamings inclusos', () => {
    const html = render(wtw);
    expect(html).toContain('TV aberta');
    expect(html).toContain('Canais pagos');
    expect(html).toContain('Disponível também em');
    expect(cards(html)).toBe(2);
    expect(html).toContain('Operadora Exemplo');
    expect(html).toContain('Operadora de TV paga');
    expect(html).toContain('Plano Top');
    expect(html).toContain('Incluso');
    expect(html).toContain('Adicional');
    expect(html).toContain('Streamings inclusos');
    // o logo do streaming incluso aparece dentro do cartão da operadora
    const operatorCard = html.split('data-testid="platform-card"')[1]!;
    expect(operatorCard).toContain('https://cdn.exemplo.test/streaming-dark.png');
    // a opção de streaming já tem cartão próprio: não repete solta
    expect(groupWhereToWatch(wtw).others).toEqual([]);
    // link e praça da opção publicada no logo da TV aberta
    expect(html).toContain('href="https://canal-aberto.exemplo.test/ao-vivo"');
    expect(html).toContain('Praças: SP');
  });

  it('logo claro no tema claro e escuro no escuro', () => {
    const html = render(wtw);
    expect(html).toMatch(/src="https:\/\/cdn\.exemplo\.test\/canal\.png"[^>]*dark:hidden/);
    expect(html).toMatch(/src="https:\/\/cdn\.exemplo\.test\/canal-dark\.png"[^>]*dark:block/);
  });

  it('sem plataforma, os cartões não aparecem e o resto segue', () => {
    const html = render({
      ...wtw,
      availability: { ...wtw.availability, platforms: [] },
    });
    expect(cards(html)).toBe(0);
    expect(html).toContain('Canais pagos');
    // o streaming das opções volta como logo solto em "disponível também em"
    expect(html).toContain('Streaming Exemplo · Streaming por assinatura');
  });

  it('resposta antiga sem availability: agrupa pelas opções', () => {
    const { availability: _omit, ...old } = wtw;
    const groups = groupWhereToWatch(old as WhereToWatch);
    expect(groups.platforms).toEqual([]);
    expect(groups.freeTv.map((c) => c.name)).toEqual(['Canal Aberto Exemplo']);
    expect(groups.payTv.map((c) => c.name)).toEqual(['Canal Exemplo']);
    expect(hasGroups(groups)).toBe(true);
    expect(cards(render(old as WhereToWatch))).toBe(0);
  });

  it('sem nada publicado não há grupos (a página mostra os a confirmar ou a mensagem)', () => {
    const empty = {
      ...wtw,
      options: [],
      availability: {
        free_tv: [],
        pay_tv_channels: [],
        platforms: [],
        your_operator: null,
        channel_status: 'confirmed' as const,
        match_channel: TO_CONFIRM_PRE,
      },
    };
    expect(hasGroups(groupWhereToWatch(empty))).toBe(false);
  });

  it('logo da plataforma com o crédito da Commons: no tooltip; visível quando a licença exige', () => {
    const credit: LogoCredit = {
      source: 'Wikimedia Commons',
      title: 'File:Operadora Exemplo logo.svg',
      page_url: 'https://commons.wikimedia.org/wiki/File:Operadora_Exemplo_logo.svg',
      author: null,
      license: 'Public domain',
      license_url: null,
      attribution_required: false,
      text: 'Logo: Wikimedia Commons · Public domain',
    };
    const withCredit = (c: LogoCredit) => ({
      ...wtw,
      availability: {
        ...wtw.availability,
        platforms: [{ ...wtw.availability.platforms[0]!, platform: { ...operadora, logo_credit: c } }],
      },
    });
    const pd = render(withCredit(credit));
    expect(pd).toContain('title="Logo: Wikimedia Commons · Public domain"');
    expect(pd).not.toContain('href="https://commons.wikimedia.org/wiki/File:Operadora_Exemplo_logo.svg"');
    const by = render(
      withCredit({
        ...credit,
        author: 'Fulano',
        license: 'CC BY-SA 4.0',
        attribution_required: true,
        text: 'Logo: Fulano / Wikimedia Commons · CC BY-SA 4.0',
      }),
    );
    expect(by).toContain('href="https://commons.wikimedia.org/wiki/File:Operadora_Exemplo_logo.svg"');
    expect(by).toContain('>Logo: Fulano / Wikimedia Commons · CC BY-SA 4.0</a>');
  });

  it('canal a confirmar: aviso, detentores tracejados e os cartões das plataformas que os carregam', () => {
    const probable: WhereToWatch = {
      ...wtw,
      status: 'unknown',
      options: [],
      to_confirm: [
        {
          provider: 'Canal Exemplo',
          provider_id: 'canal_exemplo',
          medium: 'pay_tv',
          access_model: 'subscription',
          logo: canal.logo,
          logo_dark: canal.logo_dark,
          sources: [],
        },
        {
          provider: 'Streaming Solto',
          provider_id: 'streaming_solto',
          medium: 'streaming_svod',
          access_model: 'subscription',
          logo: null,
          logo_dark: null,
          sources: [],
        },
      ],
      availability: {
        free_tv: [],
        pay_tv_channels: [canal],
        platforms: [wtw.availability.platforms[0]!],
        your_operator: null,
        channel_status: 'to_confirm',
        match_channel: TO_CONFIRM_PRE,
      },
    };
    const groups = groupWhereToWatch(probable);
    expect(groups.toConfirm).toBe(true);
    expect(hasGroups(groups)).toBe(true);
    // o streaming detentor sem cartão vem solto em "disponível também em"
    expect(groups.others.map((o) => o.name)).toEqual(['Streaming Solto']);
    const html = render(probable);
    expect(html).toContain('data-testid="channel-to-confirm"');
    expect(html).toContain('Canal deste jogo a confirmar');
    expect(html).toContain('Canais pagos');
    expect(html).toContain('border-dashed');
    expect(cards(html)).toBe(1);
    expect(render(wtw)).not.toContain('data-testid="channel-to-confirm"');
    expect(render(probable, getDictionary('es-AR').event.whereToWatch)).toContain(
      'Canal de este partido a confirmar',
    );
  });

  it('canal do jogo por momento: "Passa em", "Ao vivo em" e "Transmitido por", com a fonte', () => {
    const pre = render(wtw);
    expect(pre).toContain('data-testid="match-channel"');
    expect(pre).toContain('Passa em Canal Aberto Exemplo e Canal Exemplo');
    expect(pre).toContain('href="https://canalaberto.exemplo.test/escala-rodada-32"');
    expect(pre).toContain('Fonte: canalaberto.exemplo.test');
    expect(pre).toContain('fonte oficial');
    const at = (phase: 'pre' | 'live' | 'post') => ({
      ...wtw,
      availability: { ...wtw.availability, match_channel: { ...wtw.availability.match_channel, phase } },
    });
    expect(render(at('live'))).toContain('Ao vivo em Canal Aberto Exemplo e Canal Exemplo');
    const post = render(at('post'), t, '#conteudo-relacionado');
    expect(post).toContain('Transmitido por Canal Aberto Exemplo e Canal Exemplo');
    // reprise não é inventada: só o link para os vídeos relacionados que existem
    expect(post).toContain('href="#conteudo-relacionado"');
    expect(post).toContain('Melhores momentos e vídeos do jogo');
    expect(render(at('post'))).not.toContain('Melhores momentos');
    const es = renderToStaticMarkup(
      <WhereToWatchGroups
        groups={groupWhereToWatch(at('pre'))}
        t={getDictionary('es-AR').event.whereToWatch}
        listLocale="es-AR"
      />,
    );
    expect(es).toContain('Se ve por Canal Aberto Exemplo y Canal Exemplo');
  });

  it('jogo encerrado sem canal: "Não confirmamos o canal", nunca "sai mais perto da partida"', () => {
    const base: WhereToWatch = {
      ...wtw,
      status: 'unknown',
      options: [],
      to_confirm: [
        {
          provider: 'Canal Exemplo',
          provider_id: 'canal_exemplo',
          medium: 'pay_tv',
          access_model: 'subscription',
          logo: canal.logo,
          logo_dark: canal.logo_dark,
          sources: [],
        },
      ],
      availability: {
        free_tv: [],
        pay_tv_channels: [canal],
        platforms: [],
        your_operator: null,
        channel_status: 'to_confirm',
        match_channel: TO_CONFIRM_PRE,
      },
    };
    const withState = (mc: WhereToWatch['availability']['match_channel']) => ({
      ...base,
      availability: { ...base.availability, match_channel: mc },
    });
    const post = render(
      withState({
        phase: 'post',
        state: 'not_confirmed',
        headline: 'Não confirmamos o canal deste jogo',
        hint: null,
        channels: [],
      }),
    );
    expect(post).toContain('Não confirmamos o canal deste jogo');
    expect(post).toContain('data-state="not_confirmed"');
    expect(post).not.toContain('sai mais perto da partida');
    expect(post).not.toContain('Canal deste jogo a confirmar');
    const live = render(withState({ ...TO_CONFIRM_PRE, phase: 'live', hint: null }));
    expect(live).toContain('Canal deste jogo a confirmar');
    expect(live).not.toContain('sai mais perto da partida');
    expect(render(base)).toContain('sai mais perto da partida');
  });

  it('com a lista de canais do tenant confirmada: os canais dele embaixo de cada emissora', () => {
    const withList: WhereToWatch = {
      ...wtw,
      options: wtw.options.map((o) =>
        o.provider_id === 'canal_aberto_exemplo'
          ? {
              ...o,
              client_channels: [
                { index: 0, name: 'BR: |SP| CANAL ABERTO HD', match: 'exato' },
                { index: 1, name: 'CANAL ABERTO RJ', match: 'exato' },
              ],
            }
          : { ...o, client_channels: [] },
      ),
    };
    const g = groupWhereToWatch(withList);
    expect(g.freeTv[0]!.clientChannels).toEqual(['BR: |SP| CANAL ABERTO HD', 'CANAL ABERTO RJ']);
    expect(g.payTv[0]!.clientChannels).toEqual([]);
    const html = renderToStaticMarkup(<WhereToWatchGroups groups={g} t={t} />);
    expect(html).toContain('Na sua lista: BR: |SP| CANAL ABERTO HD, CANAL ABERTO RJ');
  });

  it('a operadora do tenant ganha o selo; sem o jogo na grade, o aviso', () => {
    const mine = render({
      ...wtw,
      availability: { ...wtw.availability, your_operator: wtw.availability.platforms[0]! },
    });
    expect(mine).toContain('Sua operadora');
    expect(cards(mine)).toBe(2);
    const missing = render({
      ...wtw,
      availability: {
        ...wtw.availability,
        platforms: [wtw.availability.platforms[1]!],
        your_operator: { platform: operadora, plans: [] },
      },
    });
    expect(cards(missing)).toBe(2);
    expect(missing).toContain('Este jogo não está na grade da sua operadora.');
  });

  it.each([
    ['en', 'Also available on', 'Included'],
    ['es-AR', 'Disponible también en', 'Incluido'],
  ] as const)('%s', (locale, alsoOn, included) => {
    const html = render(wtw, getDictionary(locale).event.whereToWatch);
    expect(html).toContain(alsoOn);
    expect(html).toContain(included);
  });
});
