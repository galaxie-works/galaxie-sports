import { describe, expect, it } from 'vitest';
import type { SparqlBinding } from '../multisport/wikidata/sparql-client.js';
import {
  coverageOf,
  isSeniorMenName,
  labelRange,
  normalizeTeamName,
  parseEditions,
  resolveWinners,
  type CoreTeam,
  type MappedTeam,
  type WinnerInfo,
} from './wikidata-titles.js';

const uri = (q: string) => ({ type: 'uri' as const, value: `http://www.wikidata.org/entity/${q}` });
const lit = (v: string) => ({ type: 'literal' as const, value: v });
const date = (d: string) => ({ type: 'literal' as const, value: `${d}T00:00:00Z` });

function row(
  ed: string,
  winner: string,
  opts: {
    label?: string;
    start?: string;
    end?: string;
    pit?: string;
    hasPart?: boolean;
    inPart?: boolean;
  } = {},
): SparqlBinding {
  const r: SparqlBinding = { ed: uri(ed), winner: uri(winner) };
  if (opts.label) r.label = lit(opts.label);
  if (opts.start) r.start = date(opts.start);
  if (opts.end) r.end = date(opts.end);
  if (opts.pit) r.pit = date(opts.pit);
  r.hasPart = lit(String(opts.hasPart ?? false));
  r.inPart = lit(String(opts.inPart ?? false));
  return r;
}

describe('parseEditions — checagens da fonte', () => {
  it('edição comum: ano, rótulo e data da final', () => {
    const [e] = parseEditions('Q184795', [
      row('Q81102404', 'Q80964', { label: '2021 Copa Libertadores', start: '2021-02-23', end: '2021-11-27' }),
    ]);
    expect(e).toMatchObject({
      winners: ['Q80964'],
      seasonYear: 2021,
      seasonLabel: '2021',
      decidedOn: '2021-11-27',
      source: 'wikidata',
    });
    expect(e!.rejected).toBeUndefined();
  });

  it('temporada que cruza o ano usa o ano de início ("2020–21" → 2020)', () => {
    const [e] = parseEditions('Q18756', [
      row('Q1', 'Q9616', { label: '2020–21 UEFA Champions League', pit: '2021-01-01', end: '2021-05-29' }),
    ]);
    expect(e).toMatchObject({ seasonYear: 2020, seasonLabel: '2020–21', decidedOn: '2021-05-29' });
  });

  it.each([
    [
      'dois vencedores sem qualificador',
      [row('Q2', 'Q10', { end: '2008-12-21' }), row('Q2', 'Q11')],
      'several_winners',
    ],
    ['sem data', [row('Q3', 'Q10', { label: 'Liga 1986–87' })], 'no_date'],
    [
      'rótulo e datas divergem (2016 × 2018)',
      [row('Q4', 'Q10', { label: '2016 Copa Libertadores', end: '2018-12-09', pit: '2018-01-01' })],
      'label_year_mismatch',
    ],
    [
      'vencedor fora dos participantes que a edição lista',
      [row('Q5', 'Q10', { end: '1998-08-26', hasPart: true, inPart: false })],
      'winner_not_participant',
    ],
  ])('%s → recusada', (_n, rows, reason) => {
    expect(parseEditions('Q184795', rows)[0]!.rejected?.reason).toBe(reason);
  });

  it('correção curada: vence o erro da fonte e guarda a proveniência', () => {
    const [e] = parseEditions('Q184795', [
      row('Q917635', 'Q719338', {
        label: '1991 Copa Libertadores',
        end: '1991-06-05',
        hasPart: true,
        inPart: true,
      }),
    ]);
    expect(e).toMatchObject({
      winners: ['Q207373'],
      claimed: ['Q719338'],
      seasonYear: 1991,
      source: 'curated',
      sourceRef: expect.stringMatching(/^https:\/\//),
    });
    expect(e!.rejected).toBeUndefined();
  });
});

describe('rótulos de temporada', () => {
  it('labelRange', () => {
    expect(labelRange('1999–2000 Argentine Primera División')).toEqual([1999, 2000]);
    expect(labelRange('2020-21 UEFA Champions League')).toEqual([2020, 2021]);
    expect(labelRange('2021 Copa Libertadores')).toBeNull();
  });
});

describe('casamento estrito dos vencedores', () => {
  it('normalizeTeamName junta siglas e tira acento', () => {
    expect(normalizeTeamName('Estudiantes L.P.')).toBe('estudiantes lp');
    expect(normalizeTeamName('Estudiantes LP')).toBe('estudiantes lp');
    expect(normalizeTeamName('Grêmio Foot-Ball Porto Alegrense')).toBe('gremio foot ball porto alegrense');
  });

  it('isSeniorMenName descarta base, feminino e reserva', () => {
    expect(isSeniorMenName('Palmeiras')).toBe(true);
    for (const n of ['Palmeiras W', 'Palmeiras U20', 'Estudiantes La Plata Res', 'Sporting CP B'])
      expect(isSeniorMenName(n)).toBe(false);
  });

  const estudiantes: WinnerInfo = {
    qid: 'Q214940',
    names: ['Club Estudiantes de La Plata', 'Estudiantes', 'Estudiantes LP', 'Estudiantes de La Plata'],
    countries: ['AR'],
  };
  const teams: CoreTeam[] = [
    { id: 'est-lp', name: 'Estudiantes L.P.', country: 'AR' },
    { id: 'ca-est', name: 'CA Estudiantes', country: 'AR' },
    { id: 'est-fc', name: 'Estudiantes FC', country: 'AR' },
    { id: 'est-rc', name: 'Estudiantes de Rio Cuarto', country: 'AR' },
    { id: 'est-res', name: 'Estudiantes La Plata Res', country: 'AR' },
    { id: 'pal', name: 'Palmeiras', country: 'BR' },
    { id: 'pal-w', name: 'Palmeiras W', country: 'BR' },
    { id: 'boca', name: 'Boca Juniors', country: 'AR' },
  ];

  it('sem ligação: o nome exato do apelido ("Estudiantes LP") resolve o time certo', () => {
    const r = resolveWinners([estudiantes], new Map(), teams);
    expect(r.get('Q214940')).toEqual({ participantId: 'est-lp', via: 'name' });
  });

  it('ligação antiga para o clube errado vira conflito, com a sugestão do nome exato', () => {
    const mapped = new Map<string, MappedTeam>([['Q214940', { id: 'ca-est', name: 'CA Estudiantes' }]]);
    expect(resolveWinners([estudiantes], mapped, teams).get('Q214940')).toMatchObject({
      conflict: expect.stringContaining('Estudiantes L.P.'),
      mappedTo: 'CA Estudiantes',
      suggested: 'est-lp',
    });
  });

  it('QID do clube ligado ao time feminino: conflito; ligação certa vale', () => {
    const palmeiras: WinnerInfo = {
      qid: 'Q80964',
      names: ['Sociedade Esportiva Palmeiras', 'Palmeiras'],
      countries: ['BR'],
    };
    const women = new Map<string, MappedTeam>([['Q80964', { id: 'pal-w', name: 'Palmeiras W' }]]);
    expect(resolveWinners([palmeiras], women, teams).get('Q80964')).toMatchObject({
      conflict: expect.any(String),
    });
    const ok = new Map<string, MappedTeam>([['Q80964', { id: 'pal', name: 'Palmeiras' }]]);
    expect(resolveWinners([palmeiras], ok, teams).get('Q80964')).toEqual({
      participantId: 'pal',
      via: 'provider_map',
    });
  });

  it('país diferente não casa; dois times com o mesmo nome solto são ambíguos', () => {
    const uy: WinnerInfo = { qid: 'Qx', names: ['Estudiantes'], countries: ['UY'] };
    expect(resolveWinners([uy], new Map(), teams).get('Qx')).toEqual({ none: true });
    const loose: WinnerInfo = { qid: 'Qy', names: ['Club Estudiantes'], countries: ['AR'] };
    expect(resolveWinners([loose], new Map(), teams).get('Qy')).toMatchObject({
      ambiguous: expect.any(Array),
    });
  });

  it('o time com o nome exato já tem outro QID (base): conflito com sugestão', () => {
    const boca: WinnerInfo = {
      qid: 'Q170703',
      names: ['Club Atlético Boca Juniors', 'Boca Juniors'],
      countries: ['AR'],
    };
    const mapped = new Map<string, MappedTeam>([['Q4936095', { id: 'boca', name: 'Boca Juniors' }]]);
    expect(resolveWinners([boca], mapped, teams).get('Q170703')).toMatchObject({ suggested: 'boca' });
  });
});

describe('coverageOf — lista completa até a primeira lacuna', () => {
  const ed = (qid: string, year: number, rejected = false) => ({
    qid,
    competitionQid: 'Qc',
    label: null,
    winners: ['Qw'],
    seasonYear: year,
    seasonLabel: String(year),
    decidedOn: `${year}-12-01`,
    winnerInParticipants: null,
    source: 'wikidata' as const,
    ...(rejected ? { rejected: { reason: 'no_date' as const } } : {}),
  });

  it('sem lacunas: completa até a última edição', () => {
    const c = coverageOf({ qid: 'Qc' }, 'comp', [ed('a', 2023), ed('b', 2024), ed('c', 2025)]);
    expect(c).toMatchObject({ firstYear: 2023, latestYear: 2025, completeThrough: 2025, issues: [] });
  });

  it('ano faltando e edição recusada quebram a lista', () => {
    const c = coverageOf({ qid: 'Qc' }, 'comp', [ed('a', 2019), ed('b', 2020), ed('c', 2022), ed('d', 2023)]);
    expect(c.completeThrough).toBe(2020);
    expect(c.issues).toEqual([{ year: 2021, reason: 'missing_year' }]);
    const r = coverageOf({ qid: 'Qc' }, 'comp', [ed('a', 2019), ed('b', 2020, true), ed('c', 2021)]);
    expect(r.completeThrough).toBe(2019);
  });

  it('anos sem edição declarados não contam como lacuna (Mundial de Clubes)', () => {
    const c = coverageOf({ qid: 'Qc', noEditionYears: [2001, 2002, 2003, 2004] }, 'comp', [
      ed('a', 2000),
      ed('b', 2005),
    ]);
    expect(c.completeThrough).toBe(2005);
  });
});
