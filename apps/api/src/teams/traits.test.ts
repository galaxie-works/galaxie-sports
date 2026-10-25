import { describe, expect, it } from 'vitest';
import type { LocatedEditorial } from '@galaxie/knowledge';
import { DRIVER_STRENGTHS, DRIVING_STYLES } from '@galaxie/contracts';
import * as knowledge from '@galaxie/knowledge';
import { pickEditorial } from './editorial.js';
import { computeTraits, qualiRaceLabel, type TraitMateRow, type TraitSessionRow } from './traits.js';

const MONACO = '00000000-0000-0000-0000-00000000000a';
const SPA = '00000000-0000-0000-0000-00000000000b';
const MATE = '00000000-0000-0000-0000-0000000000f1';
let n = 0;
/** Corrida do piloto: chegada (null = abandono), largada e circuito. */
function race(year: number, pos: number | null, grid: number, venue = MONACO): TraitSessionRow {
  n += 1;
  return {
    event_id: `e${n}`,
    starts_at: `${year}-05-${String(n).padStart(2, '0')}T13:00:00Z`,
    year,
    stage: { 'pt-BR': `GP ${n}` },
    type: 'race',
    venue_id: venue,
    circuit_id: venue === MONACO ? 'monaco' : '13',
    circuit_name: venue === MONACO ? 'Circuit de Monaco' : 'Spa',
    position: pos ?? 20,
    result:
      pos == null
        ? { position_text: 'DNF', grid, team: { id: 'mclaren' } }
        : { position_text: String(pos), grid, team: { id: 'mclaren' } },
  };
}
const pole = (r: TraitSessionRow): TraitSessionRow => ({
  ...r,
  event_id: `${r.event_id}q`,
  type: 'qualifying',
  position: 1,
});
const mate = (r: TraitSessionRow, pos: number | null, grid: number): TraitMateRow => ({
  event_id: r.event_id,
  mate_id: MATE,
  mate_name: 'Alain Prost',
  position: pos ?? 20,
  result:
    pos == null
      ? { position_text: 'DNF', grid, team: { id: 'mclaren' } }
      : { position_text: String(pos), grid, team: { id: 'mclaren' } },
});
const teams = new Map([['mclaren', { id: 'team-mclaren', name: 'McLaren', logo: null, colors: null }]]);

describe('computeTraits', () => {
  const r1 = race(1988, 1, 1);
  const r2 = race(1988, 1, 2);
  const r3 = race(1988, null, 1, SPA);
  const r4 = race(1989, 2, 3, SPA);
  const r5 = race(1989, 1, 1);
  const t = computeTraits(
    [r1, r2, r3, r4, r5, pole(r1), pole(r3), pole(r5)],
    [mate(r1, 2, 2), mate(r2, 3, 1), mate(r3, 1, 2), mate(r4, 1, 1), mate(r5, null, 2)],
    teams,
    'pt-BR',
  );

  it('pistas preferidas: vitórias, pódios e poles por circuito, com o critério', () => {
    expect(t.circuits.criterion).toEqual({ order: ['wins', 'podiums', 'poles', 'avg_finish'], min_races: 2 });
    expect(t.circuits.favorites.map((c) => [c.circuit.name, c.races, c.wins, c.podiums, c.poles])).toEqual([
      ['Circuit de Monaco', 3, 3, 3, 2],
      ['Spa', 2, 0, 1, 1],
    ]);
    // id numérico (api-sports) não é id do F1DB
    expect(t.circuits.favorites[1]!.circuit.id).toBeNull();
    expect(t.circuits.favorites[0]!.avg_finish).toBe(1);
  });

  it('sábado × domingo: poles por largada, largada e chegada médias, posições ganhas', () => {
    expect(t.qualifying_vs_race).toMatchObject({
      races: 5,
      poles: 3,
      pole_rate: 0.6,
      avg_grid: 1.6,
      avg_finish: 1.3,
      avg_positions_gained: 0.5,
      // poucos duelos: sem rótulo
      label: null,
    });
  });

  it('companheiro: duelo de grid e de corrida (abandono não entra), por temporada e na carreira', () => {
    expect(t.teammates.career).toEqual({ grid: { won: 3, lost: 2 }, race: { won: 2, lost: 1 } });
    expect(t.teammates.by_season.map((s) => [s.year, s.team.name, s.races, s.grid, s.race])).toEqual([
      [1989, 'McLaren', 2, { won: 1, lost: 1 }, { won: 0, lost: 1 }],
      [1988, 'McLaren', 3, { won: 2, lost: 1 }, { won: 2, lost: 0 }],
    ]);
    expect(t.teammates.by_teammate[0]).toMatchObject({ seasons: [1988, 1989], races: 5 });
  });

  it('consistência: abandonos, pontos por largada e sequências', () => {
    expect(t.consistency).toMatchObject({ races: 5, dnfs: 1, dnf_rate: 0.2 });
    expect(t.consistency.streaks.wins.length).toBe(2);
    expect(t.consistency.streaks.wins.from?.event_id).toBe(r1.event_id);
    expect(t.consistency.streaks.podiums).toMatchObject({ length: 2 });
  });
});

describe('qualiRaceLabel', () => {
  const d = (won: number, lost: number) => ({ won, lost });
  it('compara o duelo de grid com o de corrida, com 20 duelos de cada no mínimo', () => {
    expect(qualiRaceLabel(d(18, 2), d(15, 5))).toBe('qualifier');
    expect(qualiRaceLabel(d(10, 10), d(14, 6))).toBe('racer');
    expect(qualiRaceLabel(d(12, 8), d(13, 7))).toBe('balanced');
    expect(qualiRaceLabel(d(10, 9), d(15, 5))).toBeNull();
  });
});

describe('perfil editorial', () => {
  const profile = (locale: string, status: string): LocatedEditorial => ({
    file: `formula-1/editorial/${locale}.yaml`,
    index: 0,
    locale,
    entry: {
      slug: 'f1-ayrton-senna',
      name: 'Ayrton Senna',
      f1db: { id: 'ayrton-senna' },
      tier: 'legend',
      bio: { text: '...', sources: ['https://pt.wikipedia.org/wiki/Ayrton_Senna'] },
      review_status: status as 'draft',
    },
  });

  it('idioma pedido, depois o idioma e o original, só acima do piso', () => {
    const all = [profile('pt-BR', 'approved'), profile('es', 'draft')];
    expect(pickEditorial(all, 'ayrton-senna', 'es-AR', 'approved').found?.locale).toBe('pt-BR');
    expect(pickEditorial(all, 'ayrton-senna', 'es-AR', 'draft').found?.locale).toBe('es');
    expect(pickEditorial([profile('pt-BR', 'draft')], 'ayrton-senna', 'pt-BR', 'approved')).toEqual({
      found: null,
      below: true,
    });
    expect(pickEditorial(all, 'alain-prost', 'pt-BR', 'draft')).toEqual({ found: null, below: false });
  });

  it('os vocabulários do contrato são os da base semântica', () => {
    expect([...DRIVING_STYLES]).toEqual([...knowledge.DRIVING_STYLES]);
    expect([...DRIVER_STRENGTHS]).toEqual([...knowledge.DRIVER_STRENGTHS]);
  });
});
