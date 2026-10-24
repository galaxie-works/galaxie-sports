import { describe, expect, it } from 'vitest';
import type { CareerSeason, RaceCareer } from '@galaxie/contracts';
import { onePerSession } from './career.js';
import {
  auditDriver,
  contrastWithWhite,
  textBackdrop,
  type AuditContext,
  type F1dbDriverTruth,
} from './f1-audit.js';

const season = (over: Partial<CareerSeason> = {}): CareerSeason => ({
  year: 2026,
  position: 3,
  final: false,
  points: 229,
  races: 17,
  wins: 1,
  poles: 0,
  podiums: 6,
  fastest_laps: 1,
  top10: 16,
  dnfs: 1,
  sprint: { races: 6, points: 27, wins: 0, podiums: 3, poles: 1, top10: 6 },
  number: 44,
  teams: [
    {
      id: 'ferrari-core',
      name: 'Scuderia Ferrari',
      logo: null,
      livery: { primary: '#dc0000', secondary: '#ffeb00', gradient: 'x', source: 'https://example.org' },
    },
  ],
  car: null,
  ...over,
});

const career = (over: Partial<RaceCareer> = {}): RaceCareer =>
  ({
    participant_id: 'ham',
    kind: 'driver',
    profile: {
      first_name: 'Lewis',
      last_name: 'Hamilton',
      number: 44,
      birth_date: '1985-01-07',
      birth_place: 'Stevenage',
      birth_country: { code: 'GB', name: 'Reino Unido' },
    },
    current_season: 2026,
    competition: null,
    totals: {
      seasons: 20,
      races: 397,
      wins: 106,
      poles: 104,
      podiums: 208,
      fastest_laps: 69,
      points: 5248,
      titles: 7,
      top10: 350,
      dnfs: 31,
      best_finish: { position: 1, count: 106 },
      best_grid: { position: 1, count: 104 },
      sprint: { races: 30, points: 90, wins: 1, podiums: 9, poles: 2, top10: 25 },
    },
    titles: [2008, 2014, 2015, 2017, 2018, 2019, 2020],
    best_finish: 1,
    first_race: null,
    first_win: null,
    last_race: null,
    teams: [],
    teammates: [],
    seasons: [season()],
    portrait: null,
    highlight: null,
    ...over,
  }) as RaceCareer;

const truth: F1dbDriverTruth = {
  id: 'lewis-hamilton',
  name: 'Lewis Hamilton',
  firstName: 'Lewis',
  lastName: 'Hamilton',
  nationality: { code: 'GB', name: 'United Kingdom' },
  birthDate: '1985-01-07',
  birthPlace: 'Stevenage',
  birthCountry: { code: 'GB', name: 'United Kingdom' },
  permanentNumber: 44,
  starts: 397,
  wins: 106,
  podiums: 208,
  poles: 104,
  points: 5248,
  dnfs: 31,
  bestFinish: { position: 1, count: 106 },
  titles: [2008, 2014, 2015, 2017, 2018, 2019, 2020],
  numberBySeason: new Map([[2026, 44]]),
  teamBySeason: new Map([[2026, ['ferrari']]]),
};

const ctx: AuditContext = {
  countryName: (code) => new Intl.DisplayNames(['pt-BR'], { type: 'region' }).of(code) ?? null,
  f1dbConstructorsOf: (id) => (id === 'ferrari-core' ? ['ferrari'] : []),
  liveryOf: (c) => (c === 'ferrari' ? { colors: ['#dc0000', '#ffeb00'] } : null),
  racesLeftInCurrentSeason: 6,
  currentYear: 2026,
};

const fields = (issues: { field: string; outOfScope?: boolean }[], inScope = true) =>
  issues.filter((i) => !i.outOfScope === inScope).map((i) => i.field);

describe('auditoria do perfil de piloto contra o F1DB', () => {
  it('perfil certo: só as frentes de foto ficam listadas (fora do escopo)', () => {
    const issues = auditDriver(
      truth,
      {
        name: 'Lewis Hamilton',
        country: { code: 'GB', name: 'Reino Unido' },
        career: career(),
        competitions: [],
      },
      ctx,
    );
    expect(fields(issues)).toEqual([]);
    expect(fields(issues, false)).toEqual(['retrato', 'fundo_heading']);
  });

  it('os erros do Hamilton antes da correção, campo a campo', () => {
    const wrong = career({
      totals: { ...career().totals, races: 400, podiums: 209, poles: 105, dnfs: 32 },
    });
    const issues = auditDriver(
      truth,
      {
        name: 'Lewis Hamilton',
        country: { code: 'GB', name: 'Wales' },
        career: wrong,
        competitions: [
          {
            competition: { id: 'c', slug: 'f1', name: 'F1', logo: null },
            season: { year: 2026, label: '2026' },
            group: 'drivers',
            campaign: { status: 'finished_league', label: { 'pt-BR': 'Terminou em 3º' }, ongoing: false },
          } as never,
        ],
      },
      ctx,
    );
    expect(fields(issues)).toEqual(['gps', 'podios', 'poles', 'abandonos', 'campanha_temporada']);
    // o rótulo do GB é o caso GB/Wales da outra frente: listado, não corrigido aqui
    expect(issues.find((i) => i.field === 'pais')).toMatchObject({
      current: 'GB Wales',
      expected: 'GB Reino Unido',
      outOfScope: true,
    });
  });

  it('nome: o de uso do F1DB, com sufixo e partícula ("Sainz Jr.", "de Vries")', () => {
    const sainz = {
      ...truth,
      name: 'Carlos Sainz Jr.',
      firstName: 'Carlos',
      lastName: 'Sainz Jr.',
    };
    const served = (first: string, last: string) =>
      career({ profile: { ...career().profile!, first_name: first, last_name: last } });
    const run = (t: F1dbDriverTruth, c: RaceCareer) =>
      fields(
        auditDriver(
          t,
          { name: '', country: { code: 'GB', name: 'Reino Unido' }, career: c, competitions: [] },
          ctx,
        ),
      );
    expect(run(sainz, served('Carlos Sainz', 'Jr'))).toContain('nome');
    expect(run(sainz, served('Carlos', 'Sainz Jr.'))).not.toContain('nome');
    const geoff = { ...truth, name: 'Geoff Lees', firstName: 'Geoffrey', lastName: 'Lees' };
    expect(run(geoff, served('Geoff', 'Lees'))).not.toContain('nome');
  });

  it('país: grafias consagradas valem (Holanda), o nome em inglês não', () => {
    const nl = {
      ...truth,
      nationality: { code: 'NL', name: 'Netherlands' },
      birthCountry: null,
      birthDate: null,
      birthPlace: null,
    };
    const c = career({
      profile: { ...career().profile!, birth_date: null, birth_place: null, birth_country: null },
    });
    const run = (name: string) =>
      fields(auditDriver(nl, { name: '', country: { code: 'NL', name }, career: c, competitions: [] }, ctx));
    expect(run('Holanda')).not.toContain('pais');
    expect(run('Países Baixos')).not.toContain('pais');
    expect(run('Netherlands')).toContain('pais');
  });

  it('o texto branco do heading lê sobre a pintura escurecida, mesmo nas claras', () => {
    // a Mercedes turquesa é clara (1,9:1 pura), mas o nome fica sobre a mistura com preto e o véu
    expect(contrastWithWhite('#00d2be')).toBeLessThan(3);
    expect(contrastWithWhite(textBackdrop('#00d2be'))).toBeGreaterThan(4.5);
    expect(contrastWithWhite(textBackdrop('#ffffff'))).toBeGreaterThan(4.5);
  });
});

describe('retrato e pintura', () => {
  const portrait = (license: string) =>
    ({
      url: 'https://example.org/p.jpg',
      width: 1,
      height: 1,
      role: 'portrait',
      season: 2026,
      credit: { license, share_alike: license.includes('SA') },
    }) as RaceCareer['portrait'];
  const run = (c: RaceCareer, t: F1dbDriverTruth = truth) =>
    auditDriver(
      t,
      { name: '', country: { code: 'GB', name: 'Reino Unido' }, career: c, competitions: [] },
      ctx,
    );

  it('licença portada ("CC BY-SA 2.0 de") é livre; NC não', () => {
    expect(fields(run(career({ portrait: portrait('CC BY-SA 2.0 de') })))).not.toContain('retrato');
    expect(fields(run(career({ portrait: portrait('CC BY-NC 2.0') })))).toContain('retrato');
  });

  it('época sem pintura curada é lacuna da curadoria, listada como de outra frente', () => {
    const noLivery = { ...ctx, liveryOf: () => null };
    const issues = auditDriver(
      truth,
      { name: '', country: { code: 'GB', name: 'Reino Unido' }, career: career(), competitions: [] },
      noLivery,
    );
    expect(issues.find((i) => i.field === 'cor_sem_curadoria')).toMatchObject({ outOfScope: true });
  });
});

describe('uma linha por sessão de cada GP', () => {
  it('a do F1DB vence a da api-sports; a classificação inteira e o Q3 são a mesma pole', () => {
    const rows = [
      { event_id: 'q-f1db', stage_id: 'gp', provider: 'f1db', type: 'Qualifying', participant_id: 'p' },
      {
        event_id: 'q3-aps',
        stage_id: 'gp',
        provider: 'api-sports',
        type: '3rd Qualifying',
        participant_id: 'p',
      },
      { event_id: 'r-aps', stage_id: 'gp', provider: 'api-sports', type: 'Race', participant_id: 'p' },
      { event_id: 'r-f1db', stage_id: 'gp', provider: 'f1db', type: 'Race', participant_id: 'p' },
      { event_id: 'r-f1db', stage_id: 'gp', provider: 'f1db', type: 'Race', participant_id: 'q' },
      { event_id: 'other', stage_id: null, provider: 'api-sports', type: 'Race', participant_id: 'p' },
    ];
    expect(onePerSession(rows).map((r) => `${r.event_id}|${r.participant_id}`)).toEqual([
      'q-f1db|p',
      'r-f1db|p',
      'r-f1db|q',
      'other|p',
    ]);
  });
});
