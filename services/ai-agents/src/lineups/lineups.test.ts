import { describe, expect, it } from 'vitest';
import { strictSchemaProblems } from '../llm/json-schema.js';
import { catalogPrompt, discoveryPrompt, lineupSystemPrompt, planPrompt } from './prompt.js';
import { anchorResolver, catalogPurpose, comparableUrl, discoveryPurpose, planPurpose } from './research.js';
import { LINEUP_CATALOG_SCHEMA, LINEUP_DISCOVERY_SCHEMA, LINEUP_PLAN_SCHEMA } from './schema.js';

describe('schemas da grade', () => {
  it('são compatíveis com o modo estrito', () => {
    expect(strictSchemaProblems(LINEUP_DISCOVERY_SCHEMA)).toEqual([]);
    expect(strictSchemaProblems(LINEUP_CATALOG_SCHEMA)).toEqual([]);
    expect(strictSchemaProblems(LINEUP_PLAN_SCHEMA)).toEqual([]);
  });
});

describe('fontes ancoradas', () => {
  it('só passam URLs que vieram da busca (groundedUrls), devolvendo a URL real', () => {
    const anchor = anchorResolver({
      groundedUrls: ['https://Operadora.Exemplo/planos/', 'https://operadora.exemplo/grade?x=1'],
      citations: [{ url: 'https://citada.exemplo/a' }],
    });
    expect(anchor('https://operadora.exemplo/planos#topo')).toBe('https://Operadora.Exemplo/planos/');
    expect(anchor('https://operadora.exemplo/grade?x=1')).toBe('https://operadora.exemplo/grade?x=1');
    // com groundedUrls, a citação solta não vale
    expect(anchor('https://citada.exemplo/a')).toBeNull();
    expect(anchor('https://inventada.exemplo/x')).toBeNull();
    expect(anchor(null)).toBeNull();
  });

  it('sem groundedUrls, valem as citações do provedor; sem nada, nada passa', () => {
    expect(
      anchorResolver({ citations: [{ url: 'https://citada.exemplo/a' }] })('https://citada.exemplo/a/'),
    ).toBe('https://citada.exemplo/a');
    expect(anchorResolver({ citations: [] })('https://citada.exemplo/a')).toBeNull();
  });

  it('comparableUrl ignora fragmento, barra final e caixa do host', () => {
    expect(comparableUrl('https://A.Exemplo/x/#y')).toBe('https://a.exemplo/x');
    expect(comparableUrl('não é url')).toBe('não é url');
  });
});

describe('prompts e purposes', () => {
  it('purpose termina no país (localização da busca) e o agente é `lineups`', () => {
    expect(discoveryPurpose('BR')).toBe('lineups:discover:BR');
    expect(catalogPurpose('br-operadora-exemplo', 'BR')).toBe('lineups:catalog:br-operadora-exemplo:BR');
    expect(planPurpose('br-operadora-exemplo', 'BR')).toBe('lineups:plan:br-operadora-exemplo:BR');
  });

  it('a descoberta não leva lista de nomes além dos já conhecidos no banco', () => {
    const p = discoveryPrompt({ country: 'AR', known: [] });
    expect(p).toContain('Argentina');
    expect(p).toContain('espanhol');
    expect(p).toContain('(nenhum)');
    expect(discoveryPrompt({ country: 'BR', known: ['Operadora Exemplo'] })).toContain('- Operadora Exemplo');
    expect(lineupSystemPrompt()).toContain('DADO');
  });

  it('etapa 1: lista todos os planos (só nome e fonte) e o catálogo de complementos com fidelidade', () => {
    const p = catalogPrompt({
      country: 'BR',
      platform: { name: 'Operadora Exemplo', kind: 'pay_tv_operator', website: 'https://operadora.exemplo' },
      knownPlans: ['Plano Exemplo'],
      services: ['Streaming Exemplo'],
    });
    for (const s of ['Operadora Exemplo', 'Plano Exemplo', 'Streaming Exemplo', 'Brasil', 'TODOS os planos'])
      expect(p).toContain(s);
    expect(p).toContain('fidelidade de 12 meses são duas linhas');
  });

  it('etapa 2: um plano por vez, sem misturar a grade dos outros, preço cheio, um preço por fonte', () => {
    const p = planPrompt({
      country: 'AR',
      platform: {
        name: 'Operadora Exemplo',
        kind: 'telco_bundle',
        website: 'https://operadora.exemplo',
        officialDomains: ['grupo.exemplo'],
      },
      plan: 'Plano Exemplo Total',
      siblings: ['Plano Exemplo'],
      channels: ['Canal Exemplo'],
      services: [],
    });
    expect(p).toContain('só este país');
    expect(p).toContain('Plano: Plano Exemplo Total. Pesquise só este plano.');
    expect(p).toContain('- Plano Exemplo');
    expect(p).toContain('CHEIO de lista');
    expect(p).toContain('promocional');
    expect(p).toContain('um por fonte, com a data da fonte');
    expect(p).toContain('outros domínios oficiais: grupo.exemplo');
    expect(p).toContain('de marketing');
    expect(lineupSystemPrompt()).toContain('Sem fonte, sem conteúdo');
  });
});
