import { describe, expect, it } from 'vitest';
import { agendaCounts, dayKey, HIGHLIGHT_POOL, highlightCandidates, windowDays } from './agenda.js';
import { countryActivity, exploreWindow, isUpcoming, type WindowEvent } from './summary.js';

const NOW = new Date('2026-10-24T18:00:00Z');
const window = exploreWindow(NOW);
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

const ev = (id: string, over: Partial<WindowEvent> = {}): WindowEvent => ({
  id,
  sport: 'football',
  status: 'scheduled',
  startsAt: at(2),
  importance: 50,
  live: false,
  competition: { sport: 'football', slug: 'liga-a', countryCode: 'BR', id: 'c-a', name: 'Liga A' },
  participantIds: [],
  participantCountries: [],
  ...over,
});

const events = [
  ev('1'),
  ev('2', { startsAt: at(30) }),
  ev('3', {
    sport: 'basketball',
    competition: { sport: 'basketball', slug: 'nbb', countryCode: 'BR', id: 'c-n', name: 'NBB' },
  }),
  // seleção da Argentina numa copa sem país: conta para a Argentina pelo participante
  ev('4', {
    startsAt: at(50),
    competition: { sport: 'football', slug: 'copa', countryCode: null, id: 'c-c', name: 'Copa' },
    participantCountries: ['AR'],
  }),
  ev('5', { status: 'postponed' }),
  ev('6', { startsAt: at(-1), status: 'live', live: true }),
  ev('7', { startsAt: at(24 * 7) }), // exatamente no fim: fora (fim exclusivo)
  ev('8', { sport: 'equestrian', competition: null }), // fora do catálogo: o resumo não conta
];

describe('agenda dos próximos dias', () => {
  it('sem filtro, o total é a soma por esporte que o resumo faz', () => {
    const counts = agendaCounts(events, window, {}, 'UTC', ['BR', 'AR']);
    const perSport = ['football', 'basketball']
      .map((s) => events.filter((e) => e.sport === s && isUpcoming(e, window.from, window.to)).length)
      .reduce((a, b) => a + b, 0);
    expect(counts.total).toBe(perSport);
    expect(counts.matching.map((e) => e.id)).toEqual(['1', '3', '2', '4']);
  });

  it('por país conta igual ao `upcoming` do país no resumo', () => {
    for (const code of ['BR', 'AR']) {
      const resumo = countryActivity(events, code, window, new Set()).upcoming;
      expect(agendaCounts(events, window, { country: code }, 'UTC', ['BR', 'AR']).total).toBe(resumo);
    }
  });

  it('dias no fuso, com zero; contagens de filtro com os outros filtros aplicados', () => {
    const counts = agendaCounts(events, window, { sport: 'football' }, 'America/Sao_Paulo', ['BR', 'AR']);
    expect(counts.days).toHaveLength(8);
    expect(counts.days[0]).toEqual({ date: '2026-10-24', count: 1 });
    expect(counts.days.reduce((n, d) => n + d.count, 0)).toBe(counts.total);
    // o filtro de esporte não limita a contagem de esportes, mas limita a de países e competições
    expect(counts.facets.sports).toEqual([
      { slug: 'football', count: 3 },
      { slug: 'basketball', count: 1 },
    ]);
    expect(counts.facets.countries).toEqual([
      { code: 'BR', count: 2 },
      { code: 'AR', count: 1 },
    ]);
    expect(counts.facets.competitions.map((c) => [c.slug, c.count])).toEqual([
      ['liga-a', 2],
      ['copa', 1],
    ]);
  });

  it('competição por slug ou por id', () => {
    expect(agendaCounts(events, window, { competition: 'copa' }, 'UTC', []).total).toBe(1);
    expect(agendaCounts(events, window, { competition: 'nbb' }, 'UTC', []).total).toBe(1);
  });

  it('dia civil e dias da janela no fuso', () => {
    expect(dayKey(new Date('2026-10-25T02:00:00Z'), 'America/Sao_Paulo')).toBe('2026-10-24');
    expect(windowDays(window, 'UTC')).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
  });

  it('candidatos aos destaques: os mais importantes e, com mercado, os mais importantes do país', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      ev(`x${i}`, { importance: 90 - i, competition: { sport: 'football', slug: 'es', countryCode: 'ES' } }),
    );
    const local = ev('br', { importance: 10 });
    const pool = highlightCandidates([...many, local], 'BR');
    expect(pool).toHaveLength(HIGHLIGHT_POOL + 1);
    expect(pool.map((e) => e.id)).toContain('br');
    expect(highlightCandidates([...many, local], null).map((e) => e.id)).not.toContain('br');
  });

  it('candidatos do mercado GB: liga inglesa e clubes escoceses (GB-ENG, GB-SCT) entram', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      ev(`x${i}`, { importance: 90 - i, competition: { sport: 'football', slug: 'es', countryCode: 'ES' } }),
    );
    const england = ev('eng', {
      importance: 10,
      competition: { sport: 'football', slug: 'premier-league', countryCode: 'GB-ENG' },
    });
    const scotland = ev('sco', {
      importance: 9,
      competition: { sport: 'football', slug: 'europa', countryCode: 'WORLD' },
      participantCountries: ['GB-SCT', 'ES'],
    });
    const ids = highlightCandidates([...many, england, scotland], 'GB').map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['eng', 'sco']));
  });
});
