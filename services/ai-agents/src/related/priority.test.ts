import { describe, expect, it } from 'vitest';
import {
  capPublished,
  DEFAULT_RELATED_MARKETS,
  fullSearchDue,
  nextMode,
  rankRelatedCandidates,
  relatedPolicyFromEnv,
  videoLocale,
} from './priority.js';
import { capQueries, languagesForMarkets, type RelatedQuery } from './queries.js';

const at = (iso: string) => new Date(iso);

describe('fila do conteúdo relacionado', () => {
  // o caso de 22–23/10: a Champions de dois dias antes gastou a cota e a semi da Libertadores ficou sem vídeo
  const champions = {
    id: 'ucl',
    startsAt: at('2026-10-21T19:00:00Z'),
    relevance: 82,
    firstSearchPending: true,
  };
  const libertadores = {
    id: 'lib',
    startsAt: at('2026-10-23T00:30:00Z'),
    relevance: 100,
    firstSearchPending: true,
  };
  const ligaMenor = {
    id: 'small',
    startsAt: at('2026-10-23T01:00:00Z'),
    relevance: 30,
    firstSearchPending: true,
  };
  const jaBuscado = {
    id: 'done',
    startsAt: at('2026-10-22T22:00:00Z'),
    relevance: 100,
    firstSearchPending: false,
  };

  it('relevância nos mercados manda: Libertadores antes da Champions; abaixo do mínimo fica de fora', () => {
    const ranked = rankRelatedCandidates([champions, ligaMenor, libertadores], 50);
    expect(ranked.map((c) => c.id)).toEqual(['lib', 'ucl']);
  });

  it('jogo que acabou de terminar (primeira busca pendente) vem antes de quem já foi buscado', () => {
    const ranked = rankRelatedCandidates([jaBuscado, champions], 50);
    expect(ranked.map((c) => c.id)).toEqual(['ucl', 'done']);
  });
});

describe('quando buscar de novo', () => {
  const now = at('2026-10-23T03:00:00Z');
  const base = { now, researchMs: 12 * 3_600_000, secondSearchMs: 30 * 60_000 };

  it('primeira busca sempre', () => {
    expect(fullSearchDue({ ...base, fullRuns: 0, lastFull: null })).toBe(true);
  });

  it('segunda busca 30 min depois da primeira (melhores momentos saem depois do apito)', () => {
    expect(fullSearchDue({ ...base, fullRuns: 1, lastFull: at('2026-10-23T02:40:00Z') })).toBe(false);
    expect(fullSearchDue({ ...base, fullRuns: 1, lastFull: at('2026-10-23T02:30:00Z') })).toBe(true);
  });

  it('a partir da terceira, uma a cada janela de revalidação', () => {
    expect(fullSearchDue({ ...base, fullRuns: 2, lastFull: at('2026-10-23T02:00:00Z') })).toBe(false);
    expect(fullSearchDue({ ...base, fullRuns: 2, lastFull: at('2026-10-22T14:00:00Z') })).toBe(true);
  });
});

describe('o que fazer em cada execução do cron', () => {
  const now = at('2026-10-24T03:00:00Z');
  const base = {
    now,
    fullDue: false,
    searchAllowance: 2,
    hasChannels: true,
    hasAlive: true,
    lastChannels: at('2026-10-24T02:30:00Z'),
    lastAny: at('2026-10-24T02:30:00Z'),
    channelRefreshMs: 60 * 60_000,
    revalidateMs: 120 * 60_000,
  };

  it('busca completa só quando devida e com consulta disponível', () => {
    expect(nextMode({ ...base, fullDue: true })).toBe('full');
    // sem consulta: lê os canais (barato) e a busca fica devida para depois
    expect(nextMode({ ...base, fullDue: true, searchAllowance: 0, lastChannels: null })).toBe('channels');
  });

  it('canais a cada hora, revalidação a cada 2 h; no meio, nada (nenhuma chamada)', () => {
    expect(nextMode(base)).toBeNull();
    expect(nextMode({ ...base, lastChannels: at('2026-10-24T01:59:00Z') })).toBe('channels');
    expect(nextMode({ ...base, hasChannels: false, lastAny: at('2026-10-24T00:59:00Z') })).toBe('revalidate');
    expect(nextMode({ ...base, hasChannels: false, hasAlive: false, lastAny: null })).toBeNull();
  });
});

describe('grupos da fila', () => {
  it('mercados ativos → fora dos mercados → rendimento zero; dentro do grupo, a prioridade', () => {
    const c = (id: string, group: 0 | 1 | 2, score: number, firstSearchPending = true) => ({
      id,
      startsAt: at('2026-10-24T00:00:00Z'),
      relevance: 90,
      score,
      group,
      firstSearchPending,
    });
    const ranked = rankRelatedCandidates(
      [c('europa', 1, 65), c('colombia', 2, 40), c('mx', 0, 30), c('vasco', 0, 95), c('br-2a', 0, 99, false)],
      50,
    );
    expect(ranked.map((x) => x.id)).toEqual(['vasco', 'mx', 'br-2a', 'europa', 'colombia']);
  });
});

describe('idiomas e teto de buscas', () => {
  it('idiomas dos mercados relevantes, com o país mais relevante de cada idioma', () => {
    const plans = languagesForMarkets({ BR: 100, AR: 100, MX: 72, CO: 60, PE: 40 }, 50);
    expect(plans).toEqual([
      { language: 'es', locale: 'es-AR', regionCode: 'AR' },
      { language: 'pt', locale: 'pt-BR', regionCode: 'BR' },
    ]);
    expect(languagesForMarkets({ BR: 30 }, 50)).toBeNull();
  });

  it('o teto alterna os idiomas: o resumo de cada mercado vem antes dos shorts', () => {
    const q = (language: 'pt' | 'es', label: RelatedQuery['label']): RelatedQuery => ({
      language,
      label,
      params: { q: `${language}:${label}`, publishedAfter: new Date('2026-10-23T00:30:00Z') },
    });
    const all = [
      q('pt', 'highlights'),
      q('pt', 'shorts'),
      q('pt', 'goals'),
      q('es', 'highlights'),
      q('es', 'shorts'),
    ];
    expect(capQueries(all, 3).map((x) => x.params.q)).toEqual([
      'pt:highlights',
      'es:highlights',
      'pt:shorts',
    ]);
  });
});

describe('localização dos vídeos', () => {
  it('país do canal quando ele fala o idioma do vídeo; senão o da busca; sem país, só o idioma', () => {
    expect(videoLocale({ language: 'es', channelCountry: 'AR', queryRegion: 'MX' })).toBe('es-AR');
    // canal brasileiro com vídeo em espanhol: vale o país da busca (o canal não fala o idioma)
    expect(videoLocale({ language: 'es', channelCountry: 'BR', queryRegion: 'AR' })).toBe('es-AR');
    expect(videoLocale({ language: 'pt', channelCountry: 'BR' })).toBe('pt-BR');
    expect(videoLocale({ language: 'pt', channelCountry: 'US' })).toBe('pt');
    expect(videoLocale({ language: null, channelCountry: 'AR' })).toBe('es-AR');
    expect(videoLocale({ language: null, channelCountry: 'US' })).toBeNull();
  });
});

describe('teto de vídeos por jogo', () => {
  it('publica os de maior ranking por idioma e marca o excedente', () => {
    const v = (id: string, language: string, rankScore: number) => ({
      id,
      language,
      rankScore,
      status: 'published' as const,
      flags: [] as string[],
    });
    const items = [v('a', 'pt-BR', 5), v('b', 'pt-BR', 4), v('c', 'pt-BR', 3), v('d', 'es-AR', 1)];
    capPublished(items, 2);
    expect(items.filter((i) => i.status === 'published').map((i) => i.id)).toEqual(['a', 'b', 'd']);
    expect(items.find((i) => i.id === 'c')).toMatchObject({ status: 'pending', flags: ['over_limit'] });
  });
});

describe('política pelo ambiente', () => {
  it('mercados de RELATED_MARKETS, senão WTW_MARKETS, senão a América Latina', () => {
    expect(relatedPolicyFromEnv({}).markets).toEqual(DEFAULT_RELATED_MARKETS);
    expect(relatedPolicyFromEnv({ WTW_MARKETS: 'BR,AR' }).markets).toEqual(['BR', 'AR']);
    expect(relatedPolicyFromEnv({ RELATED_MARKETS: 'ar mx', WTW_MARKETS: 'BR' }).markets).toEqual([
      'AR',
      'MX',
    ]);
  });

  it('valores do painel e limites', () => {
    const p = relatedPolicyFromEnv({
      RELATED_MAX_VIDEOS: '6',
      RELATED_RESERVE_MAX_PERCENT: '200',
      RELATED_MAX_SEARCHES_PER_EVENT: '-1',
      RELATED_MAX_SEARCHES_PER_RUN: '1',
      RELATED_MARKET_WEIGHTS: 'br:1, ar:0.5',
    });
    expect(p).toMatchObject({
      maxVideos: 6,
      reserveMaxPercent: 90,
      maxSearchesPerEvent: 4,
      maxSearchesPerRun: 1,
      marketWeights: { BR: 1, AR: 0.5 },
      channelsFirst: true,
    });
    expect(relatedPolicyFromEnv({ RELATED_MARKET_WEIGHTS: 'lixo' }).marketWeights.BR).toBe(1);
  });
});
