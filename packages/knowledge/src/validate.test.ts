import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeBase,
  DEFAULT_KNOWLEDGE_DIR,
  loadGlossary,
  loadKnowledge,
  parseKnowledgeFile,
} from './load.js';
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
    expect(report.counts.teams).toBe(187);
    expect(report.counts.derbies).toBe(82);
    expect(report.counts.competitions).toBe(43);
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

  it('team_id repetido é erro', async () => {
    const report = await validateFiles({
      'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('alfa').replace('team_id: null', 'team_id: 10')}${team('beta').replace('team_id: null', 'team_id: 10')}`,
    });
    expect(codes(report.errors)).toContain('duplicate-provider-id');
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
