import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeBase,
  DEFAULT_KNOWLEDGE_DIR,
  loadGlossary,
  loadKnowledge,
  loadLiveries,
  parseKnowledgeFile,
} from './load.js';
import { guessLanguage } from './language.js';
import { liveryFor } from './liveries.js';
import { checkChant, checkProse } from './lyrics.js';
import { validateKnowledge, type Issue } from './validate.js';

/** Base em memória com os JSON Schemas reais (data/knowledge/schemas). */
async function validateFiles(files: Record<string, string>) {
  const parsed = Object.entries(files).map(([rel, source]) => parseKnowledgeFile(`/mem/${rel}`, rel, source));
  return validateKnowledge(buildKnowledgeBase(DEFAULT_KNOWLEDGE_DIR, parsed));
}
const codes = (list: Issue[]) => list.map((i) => i.code);

const team = (slug: string, extra = '') => `
  - slug: ${slug}
    names: { official: ${slug} FC, short: ${slug}, abbreviation: ABC }
    api_sports: { team_id: null, match: { name: "${slug}", country: "Brazil" } }
    nicknames: []
    sources: ["https://example.org/${slug}"]
    review_status: draft${extra}`;

describe('validateKnowledge — base real', () => {
  it('data/knowledge não tem erros', async () => {
    const report = await validateKnowledge(await loadKnowledge());
    expect(report.errors).toEqual([]);
    // futebol 187 times/seleções e 82 clássicos + basquete, vôlei e F1 (issue #44)
    expect(report.counts.teams).toBe(218);
    expect(report.counts.derbies).toBe(93);
    expect(report.counts.competitions).toBe(58);
    expect(report.counts.copyTemplates).toBeGreaterThanOrEqual(8 * 24);
    expect(report.counts.glossaryTerms).toBeGreaterThanOrEqual(8 * 3);
  });
});

describe('validateKnowledge — regras', () => {
  it('aceita uma base mínima coerente', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('alfa', `\n    rivals:\n      - { team: beta, derby: classico-ab, intensity: 3 }`)}${team('beta', `\n    rivals:\n      - { team: alfa, derby: classico-ab, intensity: 3 }`)}`,
      'football/derbies/br.yaml': `schema_version: 1\nregion: br\nderbies:\n  - slug: classico-ab\n    name: Clássico AB\n    teams: [alfa, beta]\n    scope: city\n    intensity: 3\n    sources: ["https://example.org/ab"]\n    review_status: draft\n`,
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('YAML quebrado falha com linha', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': 'schema_version: 1\nteams: [\n  - a: b\n',
    });
    expect(report.errors[0]).toMatchObject({ code: 'yaml', file: 'football/teams/br.yaml' });
  });

  it('erros de schema trazem caminho, slug e linha', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('alfa', '\n    mascote: Porco')}${team(
        'beta',
      )
        .replace('review_status: draft', 'review_status: aprovado')
        .replace(/sources: \[.*\]/, 'sources: []')}`,
    });
    const messages = report.errors.map((e) => e.message);
    expect(messages).toContain('teams[0] alfa: campo não previsto no schema: mascote');
    expect(messages.some((m) => m.startsWith('teams[1] beta › review_status: valor fora da lista'))).toBe(
      true,
    );
    expect(messages).toContain('teams[1] beta › sources: lista precisa de pelo menos 1 item(ns)');
    expect(report.errors.every((e) => e.line !== null)).toBe(true);
  });

  it('locale inválido em copy_hints', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('alfa', '\n    copy_hints:\n      pt-PT:\n        cheer: ["Força!"]')}`,
    });
    expect(report.errors.map((e) => e.message)).toContain(
      'teams[0] alfa › copy_hints: chave não permitida: pt-PT',
    );
  });

  it('slugs e IDs duplicados, referências quebradas e simetria', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('alfa', `\n    rivals:\n      - { team: beta, derby: classico-ab, intensity: 5 }\n      - { team: gama }\n      - { team: delta, derby: nao-existe }`)}${team('beta')}${team('alfa')}${team('delta')}`,
      'football/derbies/br.yaml': `schema_version: 1\nregion: br\nderbies:\n  - slug: classico-ab\n    name: AB\n    teams: [alfa, omega]\n    scope: city\n    intensity: 3\n    sources: ["https://example.org/ab"]\n    review_status: draft\n`,
    });
    expect(codes(report.errors)).toEqual(
      expect.arrayContaining(['duplicate-slug', 'unknown-team', 'unknown-derby', 'derby-mismatch']),
    );
    expect(codes(report.warnings)).toContain('rival-not-symmetric');
  });

  it('all_time: aceita o histórico geral coerente e barra soma, times, gols de um lado só e data futura', async () => {
    const teams = `schema_version: 1\ncountry: BR\nteams:${team('alfa', `\n    rivals:\n      - { team: beta, derby: classico-ab, intensity: 3 }`)}${team('beta', `\n    rivals:\n      - { team: alfa, derby: classico-ab, intensity: 3 }`)}`;
    const derbyWith = (allTime: string) =>
      `schema_version: 1\nregion: br\nderbies:\n  - slug: classico-ab\n    name: AB\n    teams: [alfa, beta]\n    scope: city\n    intensity: 3\n    all_time:\n${allTime}\n    sources: ["https://example.org/ab"]\n    review_status: draft\n`;
    const block = (o: { matches?: number; a?: string; b?: string; asOf?: string } = {}) =>
      [
        `      matches: ${o.matches ?? 10}`,
        '      draws: 2',
        '      teams:',
        `        - ${o.a ?? '{ team: alfa, wins: 5, goals: 15 }'}`,
        `        - ${o.b ?? '{ team: beta, wins: 3, goals: 9 }'}`,
        '      basis: all',
        `      as_of: ${o.asOf ?? '2025-11-01'}`,
        '      sources: ["https://example.org/ab-historico"]',
        '      review_status: draft',
      ].join('\n');
    const ok = await validateFiles({
      'football/teams/br.yaml': teams,
      'football/derbies/br.yaml': derbyWith(block()),
    });
    expect(ok.errors).toEqual([]);
    const bad = await validateFiles({
      'football/teams/br.yaml': teams,
      'football/derbies/br.yaml': derbyWith(
        block({
          matches: 11,
          a: '{ team: alfa, wins: 5, goals: 15 }',
          b: '{ team: gama, wins: 3 }',
          asOf: '2999-01-01',
        }),
      ),
    });
    expect(codes(bad.errors)).toEqual(
      expect.arrayContaining(['all-time-sum', 'all-time-teams', 'all-time-goals', 'all-time-future']),
    );
    const noSources = await validateFiles({
      'football/teams/br.yaml': teams,
      'football/derbies/br.yaml': derbyWith(block().replace(/\n {6}sources:.*$/m, '')),
    });
    expect(codes(noSources.errors)).toContain('schema');
  });

  it('head-to-head: par curado fora dos clássicos; repetir um clássico ou time inexistente é erro', async () => {
    const teams = `schema_version: 1\ncountry: BR\nteams:${team('alfa', `\n    rivals:\n      - { team: beta, derby: classico-ab, intensity: 3 }`)}${team('beta', `\n    rivals:\n      - { team: alfa, derby: classico-ab, intensity: 3 }`)}${team('gama')}`;
    const derbies = `schema_version: 1\nregion: br\nderbies:\n  - slug: classico-ab\n    name: AB\n    teams: [alfa, beta]\n    scope: city\n    intensity: 3\n    sources: ["https://example.org/ab"]\n    review_status: draft\n`;
    const pair = (slug: string, a: string, b: string) =>
      [
        `  - slug: ${slug}`,
        `    teams: [${a}, ${b}]`,
        '    all_time:',
        '      matches: 3',
        '      draws: 1',
        '      teams:',
        `        - { team: ${a}, wins: 1, goals: 4 }`,
        `        - { team: ${b}, wins: 1, goals: 4 }`,
        '      basis: all',
        '      as_of: 2025-11-01',
        '      sources: ["https://example.org/par"]',
        '      review_status: draft',
      ].join('\n');
    const ok = await validateFiles({
      'football/teams/br.yaml': teams,
      'football/derbies/br.yaml': derbies,
      'football/head-to-head/br.yaml': `schema_version: 1\nregion: br\npairs:\n${pair('alfa-gama', 'alfa', 'gama')}\n`,
    });
    expect(ok.errors).toEqual([]);
    expect(ok.counts.headToHead).toBe(1);
    const bad = await validateFiles({
      'football/teams/br.yaml': teams,
      'football/derbies/br.yaml': derbies,
      'football/head-to-head/br.yaml': `schema_version: 1\nregion: br\npairs:\n${pair('alfa-beta', 'alfa', 'beta')}\n${pair('alfa-omega', 'alfa', 'omega')}\n`,
    });
    expect(codes(bad.errors)).toEqual(expect.arrayContaining(['head-to-head-is-derby', 'unknown-team']));
  });

  it('team_id repetido é erro', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('alfa').replace('team_id: null', 'team_id: 10')}${team('beta').replace('team_id: null', 'team_id: 10')}`,
    });
    expect(codes(report.errors)).toContain('duplicate-provider-id');
  });

  it('competição: apelido igual ao rótulo do mesmo idioma é erro', async () => {
    const competition = (nicknames: string) => ({
      'competitions/football.yaml': `schema_version: 1
competitions:
  - slug: copa-x
    api_sports_league_id: null
    labels: { pt-BR: "Copa X", es: "Copa X" }
    nicknames: ${nicknames}
    sources: ["https://example.org/copa-x"]
    review_status: draft`,
    });
    const bad = await validateFiles(competition('{ pt-BR: ["copa x", "Xzão"] }'));
    expect(codes(bad.errors)).toContain('nickname-is-label');
    // o mesmo texto como apelido de outro idioma sem rótulo próprio não conta
    const ok = await validateFiles(competition('{ pt-BR: ["Xzão"], es-AR: ["Copa X"] }'));
    expect(codes(ok.errors)).not.toContain('nickname-is-label');
  });

  it('estádio: nomes anteriores e api_sports_venue_id', async () => {
    const stadium = (name: string, extra: string) =>
      `\n    stadium:\n      name: ${name}\n      nicknames: ["Arena"]\n      city: Cidade${extra}`;
    const ok = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team(
        'alfa',
        stadium(
          'Nova Arena',
          '\n      former_names:\n        - { name: Velha Arena, until: 2026-05-03 }\n      api_sports_venue_id: 7',
        ),
      )}${team('beta', stadium('Nova Arena', '\n      api_sports_venue_id: 7'))}`,
    });
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual([]);

    const bad = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team(
        'alfa',
        stadium(
          'Nova Arena',
          '\n      former_names:\n        - { name: nova arena, until: 2026-05-03 }\n        - { name: Arena, until: 2020-01-01 }\n      api_sports_venue_id: 7',
        ),
      )}${team('beta', stadium('Outra Arena', '\n      api_sports_venue_id: 7'))}${team(
        'gama',
        stadium('Arena Gama', '\n      former_names:\n        - { name: Velha, until: 2026-13-01 }'),
      )}`,
    });
    expect(codes(bad.errors)).toEqual(
      expect.arrayContaining(['stadium-former-name', 'stadium-conflict', 'schema']),
    );
    expect(codes(bad.warnings)).toContain('stadium-former-nickname');
  });

  it('barra texto com cara de letra de música', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('alfa', '\n    rallying_cries: ["Primeiro verso / segundo verso / terceiro verso"]')}`,
    });
    expect(codes(report.errors)).toContain('lyric-like');
  });

  it('arquivo fora da estrutura é erro', async () => {
    const report = await validateFiles({ 'outros/x.yaml': 'a: 1\n' });
    expect(codes(report.errors)).toEqual(['layout']);
  });

  it('copy: placeholder desconhecido e rivalidade para afinidade inferida', async () => {
    const report = await validateFiles({
      'copy/pt-BR.yaml': `schema_version: 1\nlocale: pt-BR\nsport: football\ntemplates:\n  - { key: rivalry-2, intent: rivalry, tone: 2, affinity_type: rival, affinity_source: inferred, template: "Seque o {rival}", confidence: HIGH, review_status: draft }\n  - { key: inform-1, intent: inform, tone: 1, template: "Jogo de {time}", confidence: HIGH, review_status: draft }\n`,
    });
    expect(codes(report.errors)).toEqual(expect.arrayContaining(['copy-permission', 'copy-placeholder']));
    expect(codes(report.warnings)).toContain('copy-coverage');
  });

  it('copy: locale diferente do nome do arquivo', async () => {
    const report = await validateFiles({
      'copy/es-AR.yaml': `schema_version: 1\nlocale: es-MX\nsport: football\ntemplates:\n  - { key: inform-1, intent: inform, tone: 1, template: "Hoy juega {team}", confidence: HIGH, review_status: draft }\n`,
    });
    expect(codes(report.errors)).toContain('file-name');
  });

  const glossary = (locale: string, terms: string) =>
    `schema_version: 1\nlocale: ${locale}\nsport: football\nterms:\n${terms}`;
  const term = (key: string, extra = '') =>
    `  - key: ${key}\n    term: ${key}\n    meaning: "Significado curto do termo ${key}."\n    category: support\n    sources: ["https://example.org/${key}"]\n    review_status: draft\n${extra}`;

  it('glossário: aceita termo positivo e lê pelo loadGlossary', async () => {
    const report = await validateFiles({
      'glossary/pt-BR.yaml': glossary(
        'pt-BR',
        term('torcer', '    copy_intents: [cheer]\n    requires: declared_affinity\n'),
      ),
    });
    expect(report.errors).toEqual([]);
    expect(report.counts.glossaryTerms).toBe(1);
    expect(codes(report.warnings)).toContain('glossary-coverage');
  });

  it('glossário: rivalidade sem rival declarado, chave duplicada e locale trocado são erro', async () => {
    const rivalry = term('secar').replace('category: support', 'category: rivalry');
    const report = await validateFiles({
      'glossary/pt-BR.yaml': glossary('pt-BR', rivalry + term('torcer') + term('torcer')),
      'glossary/es-AR.yaml': glossary('es-MX', term('alentar')),
    });
    expect(codes(report.errors)).toEqual(
      expect.arrayContaining(['copy-permission', 'duplicate-key', 'file-name']),
    );
  });

  it('glossário: termo de torcida sem restrição é aviso', async () => {
    const report = await validateFiles({
      'glossary/es-AR.yaml': glossary('es-AR', term('alentar', '    copy_intents: [cheer]\n')),
    });
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings)).toContain('copy-permission');
  });
});

describe('pinturas da F1 (formula-1/liveries.yaml)', () => {
  const era = (from: number, to: number | null, color = '#ff8000') =>
    `      - { from: ${from}, to: ${to}, colors: ["${color}"], livery: "laranja", sources: ["https://example.org/${from}"] }
`;
  const file = (slug: string, eras: string) =>
    `schema_version: 1
constructors:
  - slug: ${slug}
    name: ${slug}
    eras:
${eras}    review_status: draft
`;

  it('épocas em ordem; invertida, sobreposta, em aberto no meio e hex fora do padrão são erro', async () => {
    expect(
      (await validateFiles({ 'formula-1/liveries.yaml': file('mclaren', era(1968, 1971) + era(2018, null)) }))
        .errors,
    ).toEqual([]);
    const report = await validateFiles({
      'formula-1/liveries.yaml': file(
        'mclaren',
        era(1974, 1972) + era(1973, null) + era(1980, 1990, '#FF8000'),
      ),
    });
    expect(report.errors.filter((e) => e.code === 'livery-years')).toHaveLength(3);
    expect(codes(report.errors)).toContain('schema');
  });

  it('a McLaren de 1988 é vermelha e branca; a de 2024, papaia; ano sem curadoria fica sem cor', async () => {
    const entries = await loadLiveries();
    expect(liveryFor(entries, 'mclaren', 1988)?.colors).toEqual(['#e4002b', '#ffffff']);
    expect(liveryFor(entries, 'mclaren', 2024)?.colors[0]).toBe('#ff8000');
    expect(liveryFor(entries, 'mclaren', 1966)).toBeNull();
    expect(liveryFor(entries, 'equipe-que-nao-existe', 2024)).toBeNull();
    expect(await loadLiveries('/caminho/que/nao/existe')).toEqual([]);
  });
});

describe('loadGlossary', () => {
  it('lê só data/knowledge/glossary (8 mercados) e devolve vazio sem a pasta', async () => {
    const terms = await loadGlossary();
    expect(new Set(terms.map((t) => t.locale)).size).toBe(8);
    expect(terms.find((t) => t.locale === 'pt-BR' && t.entry.key === 'secar')?.entry.requires).toBe(
      'declared_rival',
    );
    expect(await loadGlossary('/caminho/que/nao/existe')).toEqual([]);
  });
});

describe('validateKnowledge — outros esportes (issue #44)', () => {
  it('pastas por esporte: times, clássicos e participantes (F1) com o esporte do caminho', async () => {
    const kb = await loadKnowledge();
    const bySport = (sport: string) => kb.teams.filter((t) => t.sport === sport).length;
    expect(bySport('basketball')).toBeGreaterThan(0);
    expect(bySport('volleyball')).toBeGreaterThan(0);
    const drivers = kb.teams.filter((t) => t.sport === 'formula-1' && t.kind === 'driver');
    expect(drivers.map((d) => d.entry.slug)).toContain('f1-sergio-perez');
    expect(drivers.every((d) => d.listKey === 'participants' && d.countryCode)).toBe(true);
    expect(kb.derbies.filter((d) => d.sport === 'basketball').length).toBeGreaterThan(0);
  });

  it('arquivo de participantes exige kind e country em cada item', async () => {
    const ok = await validateFiles({
      'formula-1/participants/drivers.yaml': `schema_version: 1\nkind: driver\nparticipants:${team('f1-piloto', '\n    country: MX')}`,
    });
    expect(ok.errors).toEqual([]);
    const bad = await validateFiles({
      'formula-1/participants/drivers.yaml': `schema_version: 1\nkind: piloto\nparticipants:${team('f1-piloto')}`,
    });
    expect(codes(bad.errors)).toEqual(['schema', 'schema']);
  });

  it('clássico e rival só entre times do mesmo esporte', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('alfa', `\n    rivals:\n      - { team: basketball-beta, derby: misto, intensity: 3 }`)}`,
      'basketball/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('basketball-beta', `\n    rivals:\n      - { team: alfa, derby: misto, intensity: 3 }`)}`,
      'basketball/derbies/br.yaml': `schema_version: 1\nregion: br\nderbies:\n  - slug: misto\n    name: Misto\n    teams: [alfa, basketball-beta]\n    scope: city\n    intensity: 3\n    sources: ["https://example.org/m"]\n    review_status: draft\n`,
    });
    expect(codes(report.errors)).toEqual(expect.arrayContaining(['derby-cross-sport', 'rival-cross-sport']));
  });

  it('api_sports.team_id fora do futebol é erro (a vinculação ainda é só no futebol)', async () => {
    const report = await validateFiles({
      'volleyball/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('volleyball-alfa').replace('team_id: null', 'team_id: 25')}`,
    });
    expect(codes(report.errors)).toEqual(['provider-id-sport']);
  });

  it('pasta de esporte desconhecido é erro de layout', async () => {
    const report = await validateFiles({
      'curling/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('curling-alfa')}`,
    });
    expect(codes(report.errors)).toEqual(['layout']);
  });
});

describe('heurística de letra', () => {
  it('aceita gritos curtos', () => {
    expect(checkChant('Avanti, Palestra!')).toBeNull();
    expect(checkChant('¡Vamos, Brasil!')).toBeNull();
  });
  it('rejeita versos e textos longos', () => {
    expect(checkChant('linha um\nlinha dois')?.level).toBe('error');
    expect(checkChant(Array(16).fill('palavra').join(' '))?.level).toBe('error');
    expect(checkChant(Array(12).fill('palavra').join(' '))?.level).toBe('warning');
    expect(checkProse('a\nb\nc')?.level).toBe('error');
    expect(checkProse('x'.repeat(301))?.level).toBe('warning');
    expect(checkProse('Fundado em 1914 por imigrantes italianos.')).toBeNull();
  });
});

describe('validateKnowledge — textos por idioma (docs/06 §3.3)', () => {
  const br = `schema_version: 1\ncountry: BR\nteams:${team(
    'alfa',
    '\n    mascot: Porco\n    identity:\n      - "Fundado em 1914 por imigrantes italianos."\n      - "O apelido nasceu como provocação dos rivais."',
  )}${team('beta')}`;
  const derbies = `schema_version: 1\nregion: br\nderbies:\n  - slug: classico-ab\n    name: Clássico AB\n    teams: [alfa, beta]\n    scope: city\n    intensity: 3\n    origin: "Nome dado pela imprensa nos anos 1940."\n    sources: ["https://example.org/ab"]\n    review_status: draft\n`;

  it('aceita tradução es e variante regional, com o locale no topo', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': br,
      'i18n/es.yaml': `schema_version: 1\nlocale: es\nteams:\n  - slug: alfa\n    identity:\n      - "Fundado en 1914 por inmigrantes italianos."\n      - "El apodo nació como una provocación de los rivales."\n    mascot: Cerdo\n    review_status: draft\n`,
      'i18n/es-AR.yaml': `schema_version: 1\nlocale: es-AR\nteams:\n  - slug: alfa\n    mascot: Chancho\n    fans: { group_nicknames: [La hinchada del Chancho] }\n    review_status: draft\n`,
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.counts.texts).toBe(2);
  });

  it('slug inexistente, tradução repetida, idioma-base repetido e locale trocado são erro', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': br,
      'football/derbies/br.yaml': derbies,
      'i18n/pt-BR.yaml': `schema_version: 1\nlocale: pt-BR\nteams:\n  - slug: alfa\n    mascot: Porquinho\n    review_status: draft\n`,
      'i18n/es.yaml': `schema_version: 1\nlocale: es-MX\nteams:\n  - slug: gama\n    mascot: Gato\n    review_status: draft\n  - slug: beta\n    colors: [verde]\n    review_status: draft\n  - slug: beta\n    colors: [blanco]\n    review_status: draft\nderbies:\n  - slug: classico-xy\n    origin: "Nombre dado por la prensa."\n    review_status: draft\n`,
    });
    expect(codes(report.errors).sort()).toEqual(
      ['duplicate-key', 'file-name', 'i18n-redundant', 'i18n-unknown-slug', 'i18n-unknown-slug'].sort(),
    );
  });

  it('clube na voz do país (es-AR) não aceita es neutro por cima; clássico declara a própria voz', async () => {
    const report = await validateFiles({
      'football/teams/ar.yaml': `schema_version: 1
text_locale: es-AR
country: AR
teams:${team(
        'gama',
        `
    identity:
      - "Es local en una de las canchas más lindas del país."`,
      )}${team('delta')}`,
      'football/derbies/south-america.yaml': `schema_version: 1
text_locale: es
region: south-america
derbies:
  - slug: classico-gd
    name: Clásico GD
    teams: [gama, delta]
    scope: city
    intensity: 3
    text_locale: es-AR
    origin: "Los dos nacieron en el mismo barrio."
    sources: ["https://example.org/gd"]
    review_status: draft
`,
      'i18n/es.yaml': `schema_version: 1
locale: es
teams:
  - slug: gama
    identity: ["Juega como local en uno de los estadios más bonitos del país."]
    review_status: draft
derbies:
  - slug: classico-gd
    origin: "Ambos nacieron en el mismo barrio."
    review_status: draft
`,
    });
    expect(codes(report.errors)).toEqual(['i18n-redundant', 'i18n-redundant']);
  });

  it('tradução sem campo traduzível é erro de schema', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': br,
      'i18n/es.yaml': `schema_version: 1\nlocale: es\nteams:\n  - slug: alfa\n    review_status: draft\n`,
    });
    expect(codes(report.errors)).toContain('schema');
  });

  it('avisa fatos a mais ou a menos, texto no idioma errado e tradução mais revisada que o original', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': br,
      'football/derbies/br.yaml': derbies,
      'i18n/es.yaml': `schema_version: 1\nlocale: es\nteams:\n  - slug: alfa\n    identity:\n      - "Fundado em 1914 por imigrantes italianos, é um dos maiores do país."\n    review_status: approved\n  - slug: beta\n    mascot: Gato\n    review_status: draft\nderbies:\n  - slug: classico-ab\n    trivia: ["El primer partido terminó empatado."]\n    review_status: draft\n`,
    });
    expect(report.errors).toEqual([]);
    expect(codes(report.warnings).sort()).toEqual(
      // derby-without-rival: o par mínimo do teste não declara rivals
      [
        'derby-without-rival',
        'i18n-drift',
        'i18n-drift',
        'i18n-drift',
        'i18n-review',
        'text-language',
      ].sort(),
    );
  });

  it('texto original fora do text_locale do arquivo é aviso', async () => {
    const report = await validateFiles({
      'football/teams/ar.yaml': `schema_version: 1\ntext_locale: es\ncountry: AR\nteams:${team(
        'alfa',
        '\n    identity:\n      - "Fundado em 1905 no bairro da Boca, é o time do povo."',
      )}`,
    });
    expect(codes(report.warnings)).toEqual(['text-language']);
  });
});

describe('guessLanguage', () => {
  it('distingue português de espanhol pelas palavras funcionais, ignorando nomes próprios', () => {
    expect(
      guessLanguage('Fundado por imigrantes italianos como Palestra Italia; adotou o nome em 1942.'),
    ).toBe('pt');
    expect(guessLanguage('El apodo Porco nació como una burla de los rivales y la hinchada lo adoptó.')).toBe(
      'es',
    );
    expect(guessLanguage('Verdão, São Paulo e Peñarol')).toBeNull();
    expect(guessLanguage('Fue campeón de la Copa Libertadores en 1985.')).toBe('es');
  });
});
