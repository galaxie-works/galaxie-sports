import { describe, expect, it } from 'vitest';
import { strictSchemaProblems } from '../llm/json-schema.js';
import { discoveryPrompt, lineupSystemPrompt, plansPrompt } from './prompt.js';
import { anchorResolver, comparableUrl, discoveryPurpose, plansPurpose } from './research.js';
import { LINEUP_DISCOVERY_SCHEMA, LINEUP_PLANS_SCHEMA } from './schema.js';

describe('schemas da grade', () => {
  it('são compatíveis com o modo estrito', () => {
    expect(strictSchemaProblems(LINEUP_DISCOVERY_SCHEMA)).toEqual([]);
    expect(strictSchemaProblems(LINEUP_PLANS_SCHEMA)).toEqual([]);
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
    expect(plansPurpose('br-operadora-exemplo', 'BR')).toBe('lineups:plans:br-operadora-exemplo:BR');
  });

  it('a descoberta não leva lista de nomes além dos já conhecidos no banco', () => {
    const p = discoveryPrompt({ country: 'AR', known: [] });
    expect(p).toContain('Argentina');
    expect(p).toContain('espanhol');
    expect(p).toContain('(nenhum)');
    expect(discoveryPrompt({ country: 'BR', known: ['Operadora Exemplo'] })).toContain('- Operadora Exemplo');
    expect(lineupSystemPrompt()).toContain('DADO');
  });

  it('o pedido de planos leva a plataforma e os nomes da biblioteca', () => {
    const p = plansPrompt({
      country: 'BR',
      platform: { name: 'Operadora Exemplo', kind: 'pay_tv_operator', website: 'https://operadora.exemplo' },
      knownPlans: ['Plano Exemplo'],
      channels: ['Canal Exemplo'],
      services: ['Streaming Exemplo'],
    });
    for (const s of ['Operadora Exemplo', 'Plano Exemplo', 'Canal Exemplo', 'Streaming Exemplo', 'Brasil'])
      expect(p).toContain(s);
  });
});
