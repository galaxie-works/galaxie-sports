import { describe, expect, it } from 'vitest';
import {
  announcedCandidates,
  countryActivity,
  pickAnnounced,
  type HighlightPreference,
  type WindowEvent,
} from './choices.js';
import { EXPLORE_SNAPSHOT_VERSION, selectForScope, sportOf, type ExploreSnapshot } from './snapshot.js';
import { ALL, snapshotFromRows, snapshotRows } from './store.js';

const NOW = new Date('2026-10-22T12:00:00Z');
const WINDOW = { from: NOW, to: new Date('2026-10-29T12:00:00Z') };
const at = (h: number) => new Date(NOW.getTime() + h * 3600_000);

const ev = (id: string, over: Partial<WindowEvent> = {}): WindowEvent => ({
  id,
  sport: 'football',
  status: 'scheduled',
  startsAt: at(24),
  importance: 50,
  live: false,
  competition: { sport: 'football', slug: 'brasileirao-serie-a', countryCode: 'BR' },
  participantIds: [`${id}-home`, `${id}-away`],
  participantCountries: ['BR', 'BR'],
  ...over,
});

// futebol e basquete do Brasil, com o melhor jogo de cada esporte em momentos diferentes da janela
const events = [
  ev('liga', { importance: 60, startsAt: at(30) }),
  ev('classico', { importance: 70, startsAt: at(50), participantIds: ['palmeiras', 'corinthians'] }),
  ev('futebol-ao-vivo', { status: 'live', live: true, startsAt: at(-1) }),
  ev('nbb', {
    sport: 'basketball',
    importance: 70,
    startsAt: at(20),
    competition: { sport: 'basketball', slug: 'nbb', countryCode: 'BR' },
  }),
  ev('nbb-2', {
    sport: 'basketball',
    importance: 40,
    startsAt: at(60),
    competition: { sport: 'basketball', slug: 'nbb', countryCode: 'BR' },
  }),
];
const provisional = [
  ev('anunciado-futebol', { startsAt: at(24 * 12) }),
  ev('anunciado-basquete', {
    sport: 'basketball',
    startsAt: at(24 * 8),
    competition: { sport: 'basketball', slug: 'nbb', countryCode: 'BR' },
  }),
];
const prefer: HighlightPreference = { teams: new Set(['palmeiras']), main: null };

/** O resumo como o job grava: cada esporte do país com a conta só dos jogos dele. */
function snapshotOf(list: WindowEvent[], announced: WindowEvent[]): ExploreSnapshot {
  const perSport: ExploreSnapshot['countrySports'][string] = {};
  for (const s of ['football', 'basketball']) {
    perSport[s] = {
      ...countryActivity(
        list.filter((e) => e.sport === s),
        'BR',
        WINDOW,
        new Set(),
        prefer,
      ),
      announced: announcedCandidates(
        announced.filter((e) => e.sport === s),
        'BR',
        NOW,
        new Set(),
      ),
    };
  }
  return {
    version: EXPLORE_SNAPSHOT_VERSION,
    generatedAt: NOW,
    window: WINDOW,
    sports: {
      football: { competitions: 6, participants: 40, upcoming: 2, live: 1, topCompetitions: ['c1', 'c2'] },
      basketball: { competitions: 1, participants: 16, upcoming: 2, live: 0, topCompetitions: ['c3'] },
    },
    countries: { BR: { competitions: 3, mainCompetition: 'c1', topTeams: ['palmeiras', 'corinthians'] } },
    countrySports: { BR: perSport },
  };
}

describe('selectForScope', () => {
  const snapshot = snapshotOf(events, provisional);

  it('sem recorte, somar os esportes dá a mesma conta de todos os jogos juntos', () => {
    const br = selectForScope(snapshot, ['BR'], null).countries.get('BR')!;
    const all = countryActivity(events, 'BR', WINDOW, new Set(), prefer);
    expect(br.upcoming).toBe(all.upcoming);
    expect(br.live).toBe(all.live);
    expect(br.highlight).toEqual(all.highlight);
    // o clássico (70, com clube em destaque) vence o NBB (70, mais cedo)
    expect(br.highlight?.id).toBe('classico');
    expect(br.announced.map((a) => a.id)).toEqual(
      pickAnnounced(announcedCandidates(provisional, 'BR', NOW, new Set()), all.highlight!.id).map(
        (a) => a.id,
      ),
    );
    expect(br).toMatchObject({
      competitions: 3,
      mainCompetition: 'c1',
      topTeams: ['palmeiras', 'corinthians'],
    });
  });

  it('com recorte, fora do plano nenhum jogo conta nem vira destaque; o catálogo continua', () => {
    const sel = selectForScope(snapshot, ['BR', 'UY'], ['basketball']);
    const br = sel.countries.get('BR')!;
    expect(br).toMatchObject({
      upcoming: 2,
      live: 0,
      competitions: 3,
      topTeams: ['palmeiras', 'corinthians'],
    });
    expect(br.highlight?.id).toBe('nbb');
    expect(br.announced.map((a) => a.id)).toEqual(['anunciado-basquete']);
    expect(sportOf(sel, 'football')).toMatchObject({ competitions: 6, upcoming: 0, live: 0 });
    expect(sportOf(sel, 'basketball')).toMatchObject({ upcoming: 2 });
    // país sem linha no resumo e esporte desconhecido: zerados
    expect(sel.countries.get('UY')).toMatchObject({ upcoming: 0, highlight: null, mainCompetition: null });
    expect(sportOf(sel, 'volleyball')).toMatchObject({ competitions: 0, topCompetitions: [] });
  });
});

describe('linhas de core.explore_summary', () => {
  it('uma por esporte e mercado, com a de controle; ida e volta pelo JSON dá o mesmo resumo', () => {
    const snapshot = snapshotOf(events, provisional);
    const rows = snapshotRows(snapshot);
    expect(rows[0]).toMatchObject({ sport: ALL, market: ALL, generatedAt: NOW });
    expect(rows.map((r) => `${r.sport}|${r.market}`).sort()).toEqual(
      ['*|*', 'football|*', 'basketball|*', '*|BR', 'football|BR', 'basketball|BR'].sort(),
    );
    // como volta do banco: jsonb serializado
    const back = snapshotFromRows(
      rows.map((r) => ({
        ...r,
        data: JSON.parse(JSON.stringify(r.data)),
        generatedAt: r.generatedAt as Date,
      })),
    );
    expect(back).toEqual(snapshot);
  });

  it('sem a linha de controle, ou de outra versão do formato, não há resumo', () => {
    const rows = snapshotRows(snapshotOf(events, provisional)).map((r) => ({
      ...r,
      generatedAt: r.generatedAt as Date,
    }));
    expect(snapshotFromRows(rows.slice(1))).toBeNull();
    expect(
      snapshotFromRows([
        { ...rows[0]!, data: { ...(rows[0]!.data as object), version: 0 } },
        ...rows.slice(1),
      ]),
    ).toBeNull();
  });
});
