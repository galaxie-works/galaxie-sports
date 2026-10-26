import { describe, expect, it } from 'vitest';
import { textCoverage } from './i18n.js';
import { buildKnowledgeBase, DEFAULT_KNOWLEDGE_DIR, loadKnowledge, parseKnowledgeFile } from './load.js';

const kbOf = (files: Record<string, string>) =>
  buildKnowledgeBase(
    DEFAULT_KNOWLEDGE_DIR,
    Object.entries(files).map(([rel, source]) => parseKnowledgeFile(`/mem/${rel}`, rel, source)),
  );

const team = (slug: string, identity: string) => `
  - slug: ${slug}
    names: { official: ${slug}, short: ${slug} }
    api_sports: { team_id: null, match: { name: "${slug}", country: "X" } }
    nicknames: []
    identity: ["${identity}"]
    sources: ["https://example.org/${slug}"]
    review_status: draft`;

describe('textCoverage', () => {
  const kb = kbOf({
    'football/teams/br.yaml': `schema_version: 1\ncountry: BR\nteams:${team('alfa', 'Fundado em 1900.')}${team('beta', 'Fundado em 1901.')}`,
    'football/teams/ar.yaml': `schema_version: 1\ntext_locale: es\ncountry: AR\nteams:${team('gama', 'Fundado en 1902.')}`,
    'i18n/es.yaml': `schema_version: 1\nlocale: es\nteams:\n  - slug: alfa\n    identity: ["Fundado en 1900."]\n    review_status: draft\n`,
    'i18n/es-AR.yaml': `schema_version: 1\nlocale: es-AR\nteams:\n  - slug: gama\n    identity: ["Fundado en 1902."]\n    review_status: draft\n`,
  });

  it('conta só o que está em outro idioma; es-XX herda a tradução do es', () => {
    expect(textCoverage(kb, 'es')).toMatchObject({ total: 2, translated: 1, own: 1 });
    expect(textCoverage(kb, 'es').missing.map((m) => m.slug)).toEqual(['beta']);
    // gama já é espanhol: a variante es-AR existe, mas não entra na conta do que falta
    expect(textCoverage(kb, 'es-AR')).toMatchObject({ total: 2, translated: 1, own: 1 });
    expect(textCoverage(kb, 'pt-BR')).toMatchObject({ total: 1, translated: 0 });
    expect(textCoverage(kb, 'es', 'football/teams/ar.yaml').total).toBe(0);
  });

  it('com o arquivo, as traduções próprias contam só os itens dele', () => {
    // a tradução es do alfa (br.yaml) não conta no relatório do ar.yaml, e a es-AR do gama não conta no br.yaml
    expect(textCoverage(kb, 'es', 'football/teams/ar.yaml').own).toBe(0);
    expect(textCoverage(kb, 'es', 'football/teams/br.yaml').own).toBe(1);
    expect(textCoverage(kb, 'es-AR', 'football/teams/ar.yaml').own).toBe(1);
    expect(textCoverage(kb, 'es-AR', 'football/teams/br.yaml').own).toBe(0);
  });

  it('base real: todo texto livre tem tradução es e pt-BR', async () => {
    const real = await loadKnowledge();
    expect(textCoverage(real, 'es').missing).toEqual([]);
    expect(textCoverage(real, 'pt-BR').missing).toEqual([]);
  });
});
