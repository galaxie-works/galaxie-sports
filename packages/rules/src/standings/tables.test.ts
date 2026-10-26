import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultRulesDir, loadCompetitionRules } from '../config/loader.js';
import { parseCompetitionRules, RulesConfigError, standingsTableOf } from '../config/parse.js';
import {
  autoGroupLabel,
  autoGroupRank,
  currentPhaseKey,
  knockoutSeed,
  standingsGroupLabel,
  standingsGroupPriority,
  unknownRoundPhase,
} from './tables.js';

const base = { slug: 'teste', format: 'league', league: { teams: 10, zones: [] } };

describe('tables: no regulamento', () => {
  it('fase com rodadas é recalculada; promedios e auxiliar, não; a matemática da tabela por cima da liga', () => {
    const rules = parseCompetitionRules({
      ...base,
      tables: [
        {
          key: 'apertura',
          name: 'Apertura',
          groups: '^apertura',
          rounds: '^apertura - \\d+$',
          league: { teams: 5, zones: [{ id: 'playoffs', kind: 'playoff', from: 1, to: 4 }] },
        },
        { key: 'promedios', kind: 'relegation_average', name: 'Promedios', groups: 'promedio' },
        { key: 'quadrangulares', kind: 'other', name: 'Quadrangulares', groups: 'quadrangular' },
      ],
    });
    expect(rules.tables.map((t) => [t.key, t.kind, t.computed])).toEqual([
      ['apertura', 'phase', true],
      ['promedios', 'relegation_average', false],
      ['quadrangulares', 'other', false],
    ]);
    expect(rules.tables[0]!.league).toMatchObject({ teams: 5, zones: [{ id: 'playoffs' }] });
    expect(rules.tables[1]!.league).toBeNull();
    expect(parseCompetitionRules(base).tables).toEqual([]);
  });

  it('recusa regex inválida, chave repetida e promedios recalculados', () => {
    const bad = (tables: unknown) => () => parseCompetitionRules({ ...base, tables });
    expect(bad([{ key: 'a', name: 'A', groups: '(' }])).toThrow(RulesConfigError);
    expect(
      bad([
        { key: 'a', name: 'A', groups: 'a' },
        { key: 'a', name: 'B', groups: 'b' },
      ]),
    ).toThrow(/duplicada/);
    expect(bad([{ key: 'p', kind: 'relegation_average', name: 'P', groups: 'p', computed: true }])).toThrow(
      /recalculadas/,
    );
    expect(bad([{ key: 'a', name: {}, groups: 'a' }])).toThrow(/pt-BR/);
  });

  it('o grupo é da primeira tabela que casa e não é excluído', () => {
    const rules = parseCompetitionRules({
      ...base,
      tables: [
        { key: 'apertura', name: 'Apertura', groups: 'apertura', exclude: 'cuadrangular' },
        { key: 'cuadrangulares', kind: 'other', name: 'Cuadrangulares', groups: 'cuadrangular' },
      ],
    });
    expect(standingsTableOf(rules, 'Apertura')?.key).toBe('apertura');
    expect(standingsTableOf(rules, 'Apertura - Cuadrangular A')?.key).toBe('cuadrangulares');
    expect(standingsTableOf(rules, 'Clausura')).toBeNull();
  });

  it('tabela sem nome (gravada antes do regulamento) é da fase única; com várias fases, de nenhuma', async () => {
    const serieA = await loadCompetitionRules('brasileirao-serie-a', { season: 2026 });
    expect(standingsTableOf(serieA, '')?.key).toBe('regular');
    const argentina = await loadCompetitionRules('argentina-liga-profesional', { season: 2026 });
    expect(standingsTableOf(argentina, '')).toBeNull();
  });
});

describe('regulamentos da América Latina', () => {
  it('Argentina 2026: zonas do Apertura e do Clausura (nomes vistos na API), anual e promedios', async () => {
    const rules = await loadCompetitionRules('argentina-liga-profesional', { season: 2026 });
    expect(rules.tables.map((t) => [t.key, t.kind, t.computed, t.crossGroupMatches])).toEqual([
      ['apertura', 'phase', true, true],
      ['clausura', 'phase', true, true],
      ['annual', 'annual', true, false],
      ['promedios', 'relegation_average', false, false],
    ]);
    const of = (g: string) => standingsTableOf(rules, g)?.key ?? null;
    expect(of('Apertura - Group A')).toBe('apertura');
    expect(of('Clausura - Group B')).toBe('clausura');
    expect(of('Tabla Anual')).toBe('annual');
    expect(of('Annual Table')).toBe('annual');
    expect(of('Promedios')).toBe('promedios');
    expect(of('')).toBeNull();
    const apertura = rules.tables[0]!;
    expect(apertura.rounds!.test('Apertura - 7')).toBe(true);
    expect(apertura.rounds!.test('Clausura - 7')).toBe(false);
    // mata-mata do torneio não entra na tabela
    expect(apertura.rounds!.test('Apertura - Round of 16')).toBe(false);
    expect(apertura.league).toMatchObject({ teams: 15, zones: [{ id: 'playoffs', from: 1, to: 8 }] });
    // até 2024: uma tabela só (sem `tables`), comportamento anterior
    expect((await loadCompetitionRules('argentina-liga-profesional', { season: 2024 })).tables).toEqual([]);
  });

  it('Liga MX: Apertura e Clausura de tabela única; a Liguilla fica fora', async () => {
    const rules = await loadCompetitionRules('liga-mx', { season: 2025 });
    const [apertura, clausura] = rules.tables;
    expect([apertura!.groupName, clausura!.groupName]).toEqual(['Apertura', 'Clausura']);
    expect(standingsTableOf(rules, 'Liga MX: Clausura')?.key).toBe('clausura');
    expect(apertura!.rounds!.test('Apertura - 17')).toBe(true);
    expect(apertura!.rounds!.test('Apertura - Quarter-finals')).toBe(false);
  });

  it('Libertadores e Sul-Americana: rodada da fase de grupos nos dois rótulos da api-sports; mata-mata fora', async () => {
    for (const slug of ['conmebol-libertadores', 'conmebol-sudamericana']) {
      const [groups] = (await loadCompetitionRules(slug, { season: 2026 })).tables;
      for (const label of ['Group Stage - 1', 'Group A - 6', 'Group H - 3'])
        expect(groups!.rounds!.test(label), `${slug} ${label}`).toBe(true);
      for (const label of ['Round of 16', 'Quarter-finals', 'Final', '1st Round'])
        expect(groups!.rounds!.test(label), `${slug} ${label}`).toBe(false);
    }
  });

  it('Uruguai: anual só recalculada quando o id 268 tem a temporada inteira (2026+)', async () => {
    const before = await loadCompetitionRules('uruguay-primera', { season: 2025 });
    const after = await loadCompetitionRules('uruguay-primera', { season: 2026 });
    const annual = (r: typeof before) => r.tables.find((t) => t.key === 'annual')!;
    expect([annual(before).computed, annual(after).computed]).toEqual([false, true]);
    expect(after.tables.map((t) => t.key)).toEqual([
      'apertura',
      'intermedio',
      'clausura',
      'annual',
      'promedios',
    ]);
    expect(standingsTableOf(after, 'Intermedio - Group B')?.key).toBe('intermedio');
  });

  it('todos os regulamentos com tabelas carregam de 2018 a 2027', async () => {
    const files = readdirSync(defaultRulesDir()).filter((f) => f.endsWith('.yaml'));
    for (const f of files)
      for (let season = 2018; season <= 2027; season++)
        await expect(
          loadCompetitionRules(f.replace('.yaml', ''), { season }),
          `${f} ${season}`,
        ).resolves.toBeTruthy();
  });
});

describe('nome exibido, fase em andamento e prioridade', () => {
  it('nome do regulamento com o subgrupo do fornecedor, no idioma pedido', async () => {
    const rules = await loadCompetitionRules('argentina-liga-profesional', { season: 2026 });
    const apertura = rules.tables[0]!;
    expect(standingsGroupLabel(apertura, 'Apertura - Group A', 'es-AR')).toBe('Apertura · Zona A');
    expect(standingsGroupLabel(apertura, 'Apertura - Group A', 'pt-BR')).toBe('Apertura · Grupo A');
    expect(standingsGroupLabel(apertura, 'Apertura - Group A', 'en')).toBe('Apertura · Group A');
    expect(standingsGroupLabel(rules.tables[2]!, 'Tabla Anual', 'es')).toBe('Tabla anual');
    expect(standingsGroupLabel(rules.tables[2]!, 'Tabla Anual', 'pt-BR')).toBe('Tabela anual');
  });

  it('a fase em andamento é a última com jogo; antes de qualquer jogo, a primeira com grupo', async () => {
    const rules = await loadCompetitionRules('argentina-liga-profesional', { season: 2026 });
    const g = (group: string, played: number) => ({ group, played });
    expect(
      currentPhaseKey(rules, [g('Apertura - Group A', 16), g('Clausura - Group A', 9), g('Tabla Anual', 25)]),
    ).toBe('clausura');
    expect(currentPhaseKey(rules, [g('Apertura - Group A', 3), g('Clausura - Group A', 0)])).toBe('apertura');
    expect(currentPhaseKey(rules, [g('Clausura - Group A', 0)])).toBe('clausura');
    expect(currentPhaseKey(rules, [g('Promedios', 30)])).toBeNull();
    const p = (group: string) => standingsGroupPriority(rules, group, 'clausura');
    expect(
      ['Promedios', 'Tabla Anual', 'Apertura - Group A', 'Clausura - Group A', 'Desconhecido'].sort(
        (a, b) => p(a) - p(b),
      ),
    ).toEqual(['Clausura - Group A', 'Apertura - Group A', 'Tabla Anual', 'Desconhecido', 'Promedios']);
  });
});

describe('knockout.seeding e level_advantage no regulamento', () => {
  const ko = (
    knockout: unknown,
    tables: unknown = [{ key: 'apertura', name: 'Apertura', groups: 'apertura' }],
  ) => parseCompetitionRules({ ...base, knockout, tables });

  it('aceita a vantagem da campanha sem prorrogação nem pênaltis e liga a tabela de referência', () => {
    const rules = ko({
      default: { legs: 2, extra_time: false, penalties: false, level_advantage: 'better_seed' },
      seeding: [{ rounds: '^apertura - ', table: 'apertura' }],
    });
    expect(rules.knockout!.default.levelAdvantage).toBe('better_seed');
    expect(rules.knockout!.seeding[0]!.rounds.test('Apertura - Quarter-finals')).toBe(true);
  });

  it('recusa vantagem desconhecida e tabela de referência fora de tables', () => {
    expect(() => ko({ default: { level_advantage: 'home' } })).toThrow(/level_advantage/);
    expect(() => ko({ default: {}, seeding: [{ rounds: 'x', table: 'clausura' }] })).toThrow(
      /não está em tables/,
    );
  });
});

describe('fase de rodada desconhecida (unknownRoundPhase)', () => {
  const rows = (group: string, teams: string[]) => teams.map((participantId) => ({ group, participantId }));

  it('Colômbia: quadrangular "Group A - 1" cabe no Apertura (tabela única) e no quadrangular: nenhuma', async () => {
    const co = await loadCompetitionRules('colombia-primera-a', { season: 2026 });
    const all = ['A', 'B', 'C', 'D', 'E', 'F'];
    const table = [...rows('Apertura', all), ...rows('Reclasificación', all)];
    // só a tabela única do torneio: qualquer dupla "está no mesmo grupo", o que não diz a fase
    expect(unknownRoundPhase(co, table, 'A', 'B')).toBeNull();
    // com os quadrangulares do fornecedor: duas candidatas (o torneio e o quadrangular)
    const withQuad = [
      ...table,
      ...rows('Apertura - Group A', ['A', 'B', 'C']),
      ...rows('Apertura - Group B', ['D', 'E', 'F']),
    ];
    expect(unknownRoundPhase(co, withQuad, 'A', 'B')).toBeNull();
  });

  it('Libertadores: o grupo dos dois separa times e é a única fase: a fase de grupos', async () => {
    const lib = await loadCompetitionRules('conmebol-libertadores', { season: 2026 });
    const table = [...rows('Group A', ['A', 'B']), ...rows('Group B', ['C', 'D'])];
    expect(unknownRoundPhase(lib, table, 'C', 'D')?.key).toBe('group_stage');
    // times de grupos diferentes, ou fora da tabela: nenhuma
    expect(unknownRoundPhase(lib, table, 'A', 'C')).toBeNull();
    expect(unknownRoundPhase(lib, table, 'A', 'Z')).toBeNull();
  });

  it('Argentina: as mesmas zonas no Apertura e no Clausura: ambíguo', async () => {
    const ar = await loadCompetitionRules('argentina-liga-profesional', { season: 2026 });
    const table = [
      ...rows('Apertura - Group A', ['A', 'B']),
      ...rows('Apertura - Group B', ['C', 'D']),
      ...rows('Clausura - Group A', ['A', 'B']),
      ...rows('Clausura - Group B', ['C', 'D']),
      ...rows('Tabla Anual', ['A', 'B', 'C', 'D']),
    ];
    expect(unknownRoundPhase(ar, table, 'A', 'B')).toBeNull();
    // só o Apertura gravado: ele
    expect(
      unknownRoundPhase(
        ar,
        table.filter((r) => !r.group.startsWith('Clausura')),
        'A',
        'B',
      )?.key,
    ).toBe('apertura');
  });
});

describe('posição na tabela de referência do mata-mata (knockoutSeed)', () => {
  it('Liga MX: rodada do Apertura usa a tabela do Apertura; sem os dois nela, nada', async () => {
    const mx = await loadCompetitionRules('liga-mx', { season: 2025 });
    const table = [
      { group: 'Apertura', participantId: 'T', rank: 1 },
      { group: 'Apertura', participantId: 'A', rank: 4 },
      { group: 'Clausura', participantId: 'T', rank: 9 },
    ];
    expect(knockoutSeed(mx, 'Apertura - Quarter-finals', table, 'A', 'T')).toEqual({ home: 4, away: 1 });
    expect(knockoutSeed(mx, 'Clausura - Quarter-finals', table, 'A', 'T')).toBeUndefined();
    expect(knockoutSeed(mx, 'Quarter-finals', table, 'A', 'T')).toBeUndefined();
  });
});

describe('grupos reservados do recálculo sem regulamento', () => {
  it('nome exibido em cada idioma; grupo do fornecedor fica sem', () => {
    expect(autoGroupLabel('annual', 'pt-BR')).toBe('Tabela anual');
    expect(autoGroupLabel('first_phase', 'es')).toBe('Primera fase');
    expect(autoGroupLabel('unnamed:3', 'en')).toBe('Unnamed group 3');
    expect(autoGroupLabel('Group 1', 'pt-BR')).toBeNull();
  });

  it('ordem: 1ª fase, fornecedor, deduzidos e a anual no fim', () => {
    const names = ['annual', 'unnamed:10', 'Clausura', 'first_phase', 'unnamed:2'];
    expect([...names].sort((a, b) => autoGroupRank(a) - autoGroupRank(b))).toEqual([
      'first_phase',
      'Clausura',
      'unnamed:2',
      'unnamed:10',
      'annual',
    ]);
  });
});
