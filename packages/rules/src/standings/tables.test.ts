import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultRulesDir, loadCompetitionRules } from '../config/loader.js';
import { parseCompetitionRules, RulesConfigError, standingsTableOf } from '../config/parse.js';
import { currentPhaseKey, standingsGroupLabel, standingsGroupPriority } from './tables.js';

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
