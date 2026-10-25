import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DRIVER_STRENGTHS, DRIVING_STYLES, driverTier } from './editorial.js';
import { checkParagraphs } from './lyrics.js';
import { buildKnowledgeBase, DEFAULT_KNOWLEDGE_DIR, parseKnowledgeFile } from './load.js';
import { applyEditorialOverrides } from './overrides.js';
import { applyEditorialDecisions, buildReviewItems, reviewContent, reviewHash } from './review.js';
import { validateKnowledge } from './validate.js';

const kbOf = (files: Record<string, string>) =>
  buildKnowledgeBase(
    DEFAULT_KNOWLEDGE_DIR,
    Object.entries(files).map(([rel, source]) => parseKnowledgeFile(`/mem/${rel}`, rel, source)),
  );
const codes = async (files: Record<string, string>) => {
  const r = await validateKnowledge(kbOf(files));
  return { errors: r.errors.map((i) => i.code), warnings: r.warnings.map((i) => i.code) };
};

const SRC = 'https://pt.wikipedia.org/wiki/Ayrton_Senna';
const legend = (extra = '') => `
  - slug: f1-ayrton-senna
    name: Ayrton Senna
    f1db: { id: ayrton-senna }
    tier: legend
    bio:
      text: "Tricampeão mundial pela McLaren, Senna fez da volta lançada de classificação uma assinatura."
      sources: ["${SRC}"]
    style: { kind: aggressive, text: "Agressivo e milimétrico na volta lançada.", sources: ["${SRC}"] }
    strengths:
      - { key: wet_weather, text: "Venceu sob chuva em Donington em 1993.", source: "${SRC}" }
    moments:
      - { year: 1993, race: GP da Europa, round: 3, wet: true, text: "Saiu da quarta posição e liderou a primeira volta.", source: "${SRC}" }
    rivalries:
      - { driver: { f1db_id: alain-prost, name: Alain Prost }, text: "Companheiro e maior rival na McLaren.", source: "${SRC}" }
    review_status: draft${extra}`;
const file = (locale: string, body: string) => `schema_version: 1\nlocale: ${locale}\ndrivers:${body}\n`;

describe('driverTier', () => {
  const base = { titles: 0, wins: 0, seasons: 1, winsRank: null, startsRank: null };
  it('campeão, top 20 em vitórias ou em GPs = lenda', () => {
    expect(driverTier({ ...base, titles: 1 })).toBe('legend');
    expect(driverTier({ ...base, wins: 23, winsRank: 20 })).toBe('legend');
    expect(driverTier({ ...base, startsRank: 7, seasons: 19 })).toBe('legend');
    expect(driverTier({ ...base, wins: 22, winsRank: 21 })).toBe('regular');
  });
  it('vencedor de GP ou 3 temporadas = regular; os demais, básico', () => {
    expect(driverTier({ ...base, wins: 1, winsRank: 90 })).toBe('regular');
    expect(driverTier({ ...base, seasons: 3 })).toBe('regular');
    expect(driverTier({ ...base, seasons: 2, startsRank: 300 })).toBe('basic');
  });
});

describe('perfil editorial: schema e regras', () => {
  it('os vocabulários do schema são os do código', () => {
    const schema = JSON.parse(
      readFileSync(join(DEFAULT_KNOWLEDGE_DIR, 'schemas', 'editorial.schema.json'), 'utf8'),
    ) as {
      properties: {
        drivers: {
          items: {
            properties: {
              style: { properties: { kind: { enum: string[] } } };
              strengths: { items: { properties: { key: { enum: string[] } } } };
            };
          };
        };
      };
    };
    const props = schema.properties.drivers.items.properties;
    expect(props.style.properties.kind.enum).toEqual([...DRIVING_STYLES]);
    expect(props.strengths.items.properties.key.enum).toEqual([...DRIVER_STRENGTHS]);
  });

  it('perfil de lenda coerente passa', async () => {
    expect(await codes({ 'formula-1/editorial/pt-BR.yaml': file('pt-BR', legend()) })).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('bio em parágrafos é prosa; quebra de linha dentro do parágrafo parece verso', async () => {
    const paragraphs = legend().replace(
      'text: "Tricampeão mundial pela McLaren, Senna fez da volta lançada de classificação uma assinatura."',
      // no YAML entre aspas duplas, \n é a quebra de linha: três parágrafos
      'text: "Tricampeão mundial pela McLaren em 1988, 1990 e 1991.\\n\\nFez da volta lançada uma assinatura.\\n\\nEm Donington, em 1993, liderou já na primeira volta."',
    );
    expect(paragraphs).not.toBe(legend());
    expect(await codes({ 'formula-1/editorial/pt-BR.yaml': file('pt-BR', paragraphs) })).toEqual({
      errors: [],
      warnings: [],
    });
    expect(checkParagraphs('Primeiro parágrafo.\n\nSegundo.\n\nTerceiro.')).toBeNull();
    expect(checkParagraphs('Verso um\nverso dois\n\nrefrão')?.level).toBe('error');
  });

  it('momento sem fonte é erro de schema', async () => {
    const body = legend().replace(
      `text: "Saiu da quarta posição e liderou a primeira volta.", source: "${SRC}"`,
      'text: "Saiu da quarta posição."',
    );
    expect((await codes({ 'formula-1/editorial/pt-BR.yaml': file('pt-BR', body) })).errors).toContain(
      'schema',
    );
  });

  it('slug fora do F1DB, regular com momentos, tradução sem original e locale errado', async () => {
    const regular = `
  - slug: f1-rubens
    name: Rubens Barrichello
    f1db: { id: rubens-barrichello }
    tier: regular
    bio: { text: "Recordista de largadas por muitos anos, venceu 11 GPs por Ferrari e Brawn.", sources: ["${SRC}"] }
    moments:
      - { year: 2000, race: GP da Alemanha, round: 11, text: "Primeira vitória, saindo de 18º.", source: "${SRC}" }
    review_status: draft`;
    const r = await codes({
      'formula-1/editorial/pt-BR.yaml': file('pt-BR', regular),
      'formula-1/editorial/es.yaml': file('es', legend()),
      'formula-1/editorial/es-AR.yaml': file('es', ''),
    });
    expect(r.errors).toEqual(
      expect.arrayContaining(['editorial-slug', 'editorial-tier', 'editorial-original', 'file-name']),
    );
  });
});

describe('perfil editorial: revisão', () => {
  const kb = kbOf({ 'formula-1/editorial/pt-BR.yaml': file('pt-BR', legend()) });

  it('cada perfil × idioma é um item do painel', () => {
    const item = buildReviewItems(kb).find((i) => i.kind === 'editorial')!;
    expect(item).toMatchObject({
      id: 'editorial:pt-BR.f1-ayrton-senna',
      key: 'pt-BR.f1-ayrton-senna',
      locale: 'pt-BR',
      sport: 'formula-1',
      market: 'BR',
      title: 'Ayrton Senna',
      yamlStatus: 'draft',
      sourceFile: 'data/knowledge/formula-1/editorial/pt-BR.yaml',
    });
  });

  it('a aprovação vale para o conteúdo aprovado; a edição do banco vem antes', () => {
    const [p] = kb.editorial;
    const hash = reviewHash(reviewContent(p!.entry));
    const approved = applyEditorialDecisions(kb.editorial, [
      { itemId: 'editorial:pt-BR.f1-ayrton-senna', status: 'approved', reviewHash: hash },
    ]);
    expect(approved[0]!.entry.review_status).toBe('approved');
    // outro conteúdo (hash diferente): a decisão não vale
    expect(
      applyEditorialDecisions(kb.editorial, [
        { itemId: 'editorial:pt-BR.f1-ayrton-senna', status: 'approved', reviewHash: 'x' },
      ])[0]!.entry.review_status,
    ).toBe('draft');
    const edited = applyEditorialOverrides(kb.editorial, [
      {
        itemId: 'editorial:pt-BR.f1-ayrton-senna',
        fields: {
          bio: { text: 'Bio revisada pela edição do painel, com a fonte de antes.', sources: [SRC] },
        },
        base: { bio: p!.entry.bio },
      },
    ]);
    expect(edited[0]!.entry.bio.text).toMatch(/^Bio revisada/);
    expect(edited[0]!.entry.f1db).toEqual({ id: 'ayrton-senna' });
  });
});
