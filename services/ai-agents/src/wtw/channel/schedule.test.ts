import { describe, expect, it } from 'vitest';
import { Blocklist, parseCountryConfig, ResearchedRightsIndex, WtwConfig } from '@galaxie/where-to-watch';
import { channelPurpose } from './agent.js';
import { buildChannelPlan, type ChannelEvent } from './plan.js';
import {
  channelMoments,
  channelScheduleFromEnv,
  dayBucket,
  dueChannelWindow,
  parseRetryOffsets,
  type ChannelSchedule,
} from './windows.js';

const H = 3_600_000;
const D = 24 * H;
const at = (iso: string) => new Date(iso);
const DEFAULT = channelScheduleFromEnv({});

describe('momentos do canal do jogo: leitura das flags', () => {
  it('padrão: consulta semanal segunda 06:00 UTC, retentativas 3d, 1d e 6h, pós-jogo ligado', () => {
    expect(DEFAULT).toEqual({
      weeklyCron: '0 6 * * 1',
      retries: [
        { label: 'retry-3d', ms: 3 * D },
        { label: 'retry-1d', ms: D },
        { label: 'retry-6h', ms: 6 * H },
      ],
      post: true,
    });
    // env vazio (o compose repassa `${X:-}`) também é o padrão
    expect(
      channelScheduleFromEnv({
        WTW_CHANNEL_WEEKLY_CRON: '',
        WTW_CHANNEL_RETRY_OFFSETS: ' ',
        WTW_CHANNEL_POST: '',
      }),
    ).toEqual(DEFAULT);
  });

  it('retentativas: dias e horas, sem repetidas, da mais cedo para a mais tarde; off desliga', () => {
    expect(parseRetryOffsets('1d, 6h,3d,72h')!.map((r) => r.label)).toEqual([
      'retry-3d',
      'retry-1d',
      'retry-6h',
    ]);
    expect(parseRetryOffsets('36h')).toEqual([{ label: 'retry-36h', ms: 36 * H }]);
    expect(parseRetryOffsets('off')).toEqual([]);
    for (const bad of ['3', '3x', '0h', '15d', '3d,,x', '']) expect(parseRetryOffsets(bad), bad).toBeNull();
  });

  it('consulta e pós-jogo desligáveis; valor inválido derruba a partida com mensagem legível', () => {
    expect(
      channelScheduleFromEnv({
        WTW_CHANNEL_WEEKLY_CRON: 'off',
        WTW_CHANNEL_RETRY_OFFSETS: 'off',
        WTW_CHANNEL_POST: 'off',
      }),
    ).toEqual({ weeklyCron: null, retries: [], post: false });
    expect(channelScheduleFromEnv({ WTW_CHANNEL_WEEKLY_CRON: '30  7 * * 4' }).weeklyCron).toBe('30 7 * * 4');
    expect(() => channelScheduleFromEnv({ WTW_CHANNEL_WEEKLY_CRON: 'toda segunda' })).toThrow(
      /WTW_CHANNEL_WEEKLY_CRON inválido/,
    );
    expect(() => channelScheduleFromEnv({ WTW_CHANNEL_RETRY_OFFSETS: '3 dias' })).toThrow(
      /WTW_CHANNEL_RETRY_OFFSETS inválido/,
    );
    expect(() => channelScheduleFromEnv({ WTW_CHANNEL_POST: 'talvez' })).toThrow(/WTW_CHANNEL_POST/);
  });

  it('tick vigente e o próximo (o próprio instante do tick já conta)', () => {
    const m = channelMoments(DEFAULT, at('2026-10-28T12:00:00Z'));
    expect(m.leadMs).toBe(3 * D);
    expect(m.sweep).toEqual({ current: at('2026-10-26T06:00:00Z'), next: at('2026-11-02T06:00:00Z') });
    expect(channelMoments(DEFAULT, at('2026-11-02T06:00:00Z')).sweep!.current).toEqual(
      at('2026-11-02T06:00:00Z'),
    );
    expect(channelMoments({ ...DEFAULT, weeklyCron: null }, at('2026-10-28T12:00:00Z')).sweep).toBeNull();
  });
});

describe('momento vigente de um jogo', () => {
  // semana: consulta na segunda 02/11 06:00 (cobre as rodadas que começam de 05/11 06:00 a 12/11 06:00)
  const due = (
    startsAt: string,
    now: string,
    opts: { status?: string; roundStart?: string; schedule?: ChannelSchedule } = {},
  ) => {
    const start = at(startsAt);
    return dueChannelWindow(
      { startsAt: start, status: opts.status ?? 'scheduled' },
      { roundStart: at(opts.roundStart ?? startsAt), dayLastStart: start },
      channelMoments(opts.schedule ?? DEFAULT, at(now)),
      at(now),
    );
  };

  it('consulta semanal: rodadas de 3 a 10 dias à frente, uma consulta por rodada', () => {
    expect(due('2026-11-07T19:00:00Z', '2026-11-02T06:10:00Z')).toEqual({
      window: 'weekly',
      phase: 'pre',
      bucket: '2026-11-02T06h00',
      opensAt: at('2026-11-02T06:00:00Z'),
    });
    // jogo de segunda de uma rodada que começa no sábado: vai junto com a rodada
    expect(
      due('2026-11-09T23:00:00Z', '2026-11-02T06:10:00Z', { roundStart: '2026-11-07T19:00:00Z' }),
    ).toMatchObject({ window: 'weekly' });
    // rodada da semana seguinte: fica para a próxima consulta
    expect(due('2026-11-13T00:30:00Z', '2026-11-02T06:10:00Z')).toBeNull();
    // antes da consulta, nada (a do domingo anterior era de outra semana)
    expect(due('2026-11-07T19:00:00Z', '2026-11-01T23:00:00Z')).toBeNull();
  });

  it('retentativas de 3 dias e 1 dia antes do primeiro jogo da rodada', () => {
    // até a primeira retentativa abrir, a consulta da semana segue vigente (mesma chave: não repete)
    expect(due('2026-11-07T19:00:00Z', '2026-11-04T18:00:00Z')).toMatchObject({
      window: 'weekly',
      bucket: '2026-11-02T06h00',
    });
    expect(due('2026-11-07T19:00:00Z', '2026-11-05T10:00:00Z')).toMatchObject({
      window: 'retry-3d',
      bucket: 'round',
      opensAt: at('2026-11-04T19:00:00Z'),
    });
    expect(due('2026-11-07T19:00:00Z', '2026-11-06T20:00:00Z')).toMatchObject({ window: 'retry-1d' });
    expect(due('2026-11-07T19:00:00Z', '2026-11-07T19:00:00Z')).toBeNull();
  });

  it('a retentativa que abriria menos de 24 h depois da consulta da rodada não roda', () => {
    // rodada de quinta 05/11 12:00: consulta na segunda 06:00; a de 3 dias abriria seis horas depois
    expect(due('2026-11-05T12:00:00Z', '2026-11-02T06:10:00Z')).toMatchObject({ window: 'weekly' });
    expect(due('2026-11-05T12:00:00Z', '2026-11-02T13:00:00Z')).toBeNull();
    expect(due('2026-11-05T12:00:00Z', '2026-11-04T13:00:00Z')).toMatchObject({ window: 'retry-1d' });
  });

  it('rodada da faixa da consulta anterior: só as retentativas', () => {
    expect(due('2026-11-03T20:00:00Z', '2026-11-02T06:10:00Z')).toMatchObject({ window: 'retry-3d' });
  });

  it('sem consulta semanal, só as retentativas; sem retentativas, a consulta cobre os próximos 7 dias', () => {
    const noSweep = { ...DEFAULT, weeklyCron: null };
    expect(due('2026-11-07T19:00:00Z', '2026-11-02T06:10:00Z', { schedule: noSweep })).toBeNull();
    expect(due('2026-11-07T19:00:00Z', '2026-11-05T10:00:00Z', { schedule: noSweep })).toMatchObject({
      window: 'retry-3d',
    });
    const noRetry = { ...DEFAULT, retries: [] };
    expect(due('2026-11-03T20:00:00Z', '2026-11-02T06:10:00Z', { schedule: noRetry })).toMatchObject({
      window: 'weekly',
    });
    expect(due('2026-11-07T19:00:00Z', '2026-11-06T20:00:00Z', { schedule: noRetry })).toMatchObject({
      window: 'weekly',
      bucket: '2026-11-02T06h00',
    });
  });

  it('depois do jogo: 3 h depois do último jogo do dia, até 72 h; desligável', () => {
    const start = '2026-11-07T19:00:00Z';
    expect(due(start, '2026-11-07T21:00:00Z', { status: 'finished' })).toBeNull();
    expect(due(start, '2026-11-07T22:30:00Z', { status: 'finished' })).toMatchObject({
      window: 'post',
      phase: 'post',
      bucket: '2026-11-07',
    });
    expect(due(start, '2026-11-10T20:00:00Z', { status: 'finished' })).toBeNull();
    expect(
      due(start, '2026-11-07T22:30:00Z', { status: 'finished', schedule: { ...DEFAULT, post: false } }),
    ).toBeNull();
    expect(due(start, '2026-11-07T20:00:00Z', { status: 'live' })).toBeNull();
  });

  it('o momento fica visível no purpose (ops.llm_usage)', () => {
    const p = (w: string, c: string[]) => channelPurpose('brasileirao-serie-a', 'Regular Season - 32', w, c);
    expect(p('weekly', ['BR', 'MX'])).toBe('wtw:channel:brasileirao-serie-a:Regular_Season_-_32:weekly');
    expect(p('retry-3d', ['BR'])).toBe('wtw:channel:brasileirao-serie-a:Regular_Season_-_32:retry-3d:BR');
    expect(p('post', ['MX'])).toBe('wtw:channel:brasileirao-serie-a:Regular_Season_-_32:post:MX');
  });

  it('o dia do jogo das 21h30 de Brasília (00h30 UTC) é o dia em que é jogado', () => {
    expect(dayBucket(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-24');
  });
});

describe('quem entra em cada momento (plano puro)', () => {
  const broadcasters = {
    country: 'BR',
    broadcasters: [
      {
        id: 'emissora_a',
        name: 'Emissora A',
        medium: 'free_tv',
        access_model: 'free',
        domains: ['a.example'],
      },
      {
        id: 'streaming_b',
        name: 'Streaming B',
        medium: 'streaming_svod',
        access_model: 'subscription',
        domains: ['b.example'],
      },
    ],
  };
  const line = (competition: string, distribution: string, holders: string[]) => ({
    competition,
    season: 2026,
    valid_from: '2026-01-01',
    valid_to: '2026-12-31',
    distribution,
    holders,
    sources: ['https://organizador.example/direitos'],
  });
  const config = new WtwConfig(
    [
      parseCountryConfig(
        'BR',
        broadcasters,
        {
          country: 'BR',
          rights: [
            line('liga-dividida', 'split', ['emissora_a', 'streaming_b']),
            line('liga-escolhida', 'selected', ['emissora_a', 'streaming_b']),
            line('liga-exclusiva', 'exclusive', ['streaming_b']),
            line('liga-todos', 'all_matches', ['emissora_a', 'streaming_b']),
          ],
        },
        { organizers: ['organizador.example'], press: ['imprensa.example'], aggregators: [] },
      ),
    ],
    new Blocklist([]),
  );
  let n = 0;
  const ev = (slug: string, startsAt: string, status = 'scheduled'): ChannelEvent => ({
    id: `e${++n}`,
    startsAt: at(startsAt),
    status,
    tier: 1,
    sport: 'football',
    slug,
    name: slug,
    type: 'league',
    countryCode: 'BR',
    round: 'Regular Season - 32',
    season: 2026,
    importance: 70,
    participantCountries: [],
  });
  // rodada de sábado 07/11 em quatro competições, dois jogos cada (o 2º no domingo)
  const slugs = ['liga-dividida', 'liga-escolhida', 'liga-exclusiva', 'liga-todos'];
  const build = (
    now: string,
    opts: { status?: string; confirmed?: string[]; schedule?: ChannelSchedule } = {},
  ) => {
    n = 0;
    const events = slugs.flatMap((s) => [
      ev(s, '2026-11-07T19:00:00Z', opts.status),
      ev(s, '2026-11-08T19:00:00Z', opts.status),
    ]);
    const plan = buildChannelPlan(events, {
      now: at(now),
      markets: ['BR'],
      config,
      researched: new ResearchedRightsIndex([]),
      policy: { minRelevance: 0, dailyUsdPerMarket: null },
      moments: channelMoments(opts.schedule ?? DEFAULT, at(now)),
      confirmed: new Set((opts.confirmed ?? []).map((id) => `${id}:BR`)),
    });
    return {
      plan,
      researched: Object.fromEntries(
        plan.groups.map((g) => [
          `${g.competition.slug}|${g.window.window}`,
          g.targets.map((t) => t.event.id),
        ]),
      ),
    };
  };

  it('consulta semanal: split e selected, a rodada inteira numa pesquisa; exclusivo e todos os jogos nunca', () => {
    const { plan, researched } = build('2026-11-02T06:10:00Z');
    expect(researched).toEqual({
      'liga-dividida|weekly': ['e1', 'e2'],
      'liga-escolhida|weekly': ['e3', 'e4'],
    });
    expect(plan.groups.map((g) => g.key)).toContain(
      'liga-dividida|Regular Season - 32|weekly|2026-11-02T06h00',
    );
    expect(plan.skipped.deterministic).toBe(4);
  });

  it('com canal confirmado no mercado, o jogo não entra na consulta semanal', () => {
    expect(build('2026-11-02T06:10:00Z', { confirmed: ['e1', 'e3', 'e4'] }).researched).toEqual({
      'liga-dividida|weekly': ['e2'],
    });
  });

  it('retentativa de 3 dias: só quem segue sem canal confirmado', () => {
    const { plan, researched } = build('2026-11-05T10:00:00Z', { confirmed: ['e1', 'e3'] });
    expect(researched).toEqual({ 'liga-dividida|retry-3d': ['e2'], 'liga-escolhida|retry-3d': ['e4'] });
    expect(plan.skipped).toMatchObject({ already_confirmed: 2, deterministic: 4 });
  });

  it('retentativa de 1 dia: rodada toda confirmada não gasta nada', () => {
    expect(build('2026-11-06T20:00:00Z', { confirmed: ['e2'] }).researched).toEqual({
      'liga-dividida|retry-1d': ['e1'],
      'liga-escolhida|retry-1d': ['e3', 'e4'],
    });
    const done = build('2026-11-06T20:00:00Z', { confirmed: ['e1', 'e2', 'e3', 'e4'] });
    expect(done.plan.groups).toEqual([]);
    expect(done.plan.skipped.already_confirmed).toBe(4);
  });

  it('entre os momentos, a chave do grupo não muda: um jogo sem canal não é pesquisado a cada execução', () => {
    const keys = (now: string) => build(now).plan.groups.map((g) => g.key);
    expect(keys('2026-11-03T12:00:00Z')).toEqual(keys('2026-11-02T06:10:00Z'));
    expect(keys('2026-11-06T10:00:00Z')).toEqual(keys('2026-11-05T10:00:00Z'));
    // fora de qualquer momento (sem consulta e antes das retentativas): nada
    const off = build('2026-11-03T12:00:00Z', { schedule: { ...DEFAULT, weeklyCron: null } }).plan;
    expect(off.groups).toEqual([]);
    expect(off.skipped.no_window).toBe(4);
  });

  it('pós-jogo: só os encerrados sem canal confirmado; exclusivo e todos os jogos nunca; desligável', () => {
    const now = '2026-11-08T23:30:00Z';
    expect(build(now, { status: 'finished', confirmed: ['e1', 'e2', 'e4'] }).researched).toEqual({
      'liga-escolhida|post': ['e3'],
    });
    expect(build(now, { status: 'finished' }).plan.skipped.deterministic).toBe(4);
    expect(build(now, { status: 'finished', schedule: { ...DEFAULT, post: false } }).plan.groups).toEqual([]);
  });
});
