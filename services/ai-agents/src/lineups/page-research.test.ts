import { loadWtwConfig } from '@galaxie/where-to-watch';
import { describe, expect, it } from 'vitest';
import { strictSchemaProblems } from '../llm/json-schema.js';
import { readRenderedPage } from '../testing/lineup-gabarito.js';
import {
  excerptChunks,
  extractedPlanNames,
  modelsFromExtraction,
  needsExtraction,
  pageLocator,
  pagesHash,
  pageVerifyContext,
  type ReadablePage,
} from './page-research.js';
import { contentHashOf, memoryPageStore, OfficialPageReader } from './pages.js';
import { pageExtractPrompt, pageExtractSystemPrompt, planPagesPrompt } from './prompt.js';
import { enoughForExtraction, extractPurpose, planPagesPurpose } from './research.js';
import {
  LINEUP_PAGE_EXTRACT_SCHEMA,
  LINEUP_PLAN_PAGES_SCHEMA,
  type LineupPageExtractOutput,
} from './schema.js';
import { verifyAddons, verifyPlans } from './validate.js';

const dir = loadWtwConfig().directory('BR');
const NOW = new Date('2026-10-25T12:00:00Z');
/** Página de planos renderizada de uma plataforma brasileira (nomes da plataforma neutros). */
const page = readRenderedPage();
const PLATFORM = {
  name: 'Plataforma A',
  website: 'https://plataforma-a.exemplo',
  officialDomains: [] as string[],
};
const read: ReadablePage = {
  url: page.url,
  content: { text: page.text, sections: page.sections },
  hash: contentHashOf(page),
  via: 'render',
  fetchedAt: new Date(page.lida_em),
};

/** Resposta do modelo como ela vem (trechos copiados da página; alguns errados de propósito). */
const output: LineupPageExtractOutput = {
  planos: [
    {
      plano_nome: 'Plano Futebol',
      trecho_do_plano: 'Plano Futebol',
      precos: [
        { preco_mensal: 149.9, moeda_iso: 'BRL', trecho: 'Plano Futebol\nR$ 149,90\nR$ 74,95\npor mês' },
        // o promocional do 1º mês: o validador recusa como preço cheio
        { preco_mensal: 74.95, moeda_iso: 'BRL', trecho: 'R$ 149,90 R$ 74,95 por mês' },
      ],
      canais: [
        // linhas da lista aberta no cartão do Plano Futebol
        { canal_nome: 'Globo', trecho: 'GLOBO' },
        { canal_nome: 'CazéTV', trecho: 'CazéTV' },
        // trecho que cita o plano mas não está na página (inventado): fica sem prova
        { canal_nome: 'ESPN', trecho: 'ESPN ao vivo no Plano Futebol' },
        // linha que só existe na lista de outros planos: não prova este plano
        { canal_nome: 'SPORTV', trecho: 'SPORTV' },
        // sem trecho: não some, entra sem prova
        { canal_nome: 'BAND SPORTS', trecho: null },
        { canal_nome: 'Canal Inventado', trecho: 'Canal Inventado' },
      ],
      streamings_inclusos: [
        {
          streaming_nome: 'Premiere',
          trecho:
            'São 6 streamings inclusos no seu plano para você curtir o melhor do futebol e do entretenimento: Amazon Prime, Paramount+, Disney+ Premium, Premiere, SportyNet e NFL Game Pass.',
        },
      ],
    },
    {
      plano_nome: 'Plano TV',
      trecho_do_plano: 'Plano TV',
      precos: [{ preco_mensal: 99.9, moeda_iso: 'BRL', trecho: 'Plano TV R$ 99,90 R$ 49,95 por mês' }],
      canais: [
        { canal_nome: 'ESPN', trecho: 'ESPN' },
        { canal_nome: 'SPORTV', trecho: 'SPORTV' },
      ],
      streamings_inclusos: [
        {
          streaming_nome: 'Amazon Prime',
          trecho: 'Com Amazon Prime e NFL Game Pass inclusos curta o melhor do entretenimento e esporte.',
        },
      ],
    },
    // o mesmo plano repetido pelo modelo: entra uma vez
    { plano_nome: 'Plano  TV ', trecho_do_plano: null, precos: [], canais: [], streamings_inclusos: [] },
  ],
  complementos: [
    {
      nome: 'Premiere Fidelidade',
      tipo: 'streaming',
      preco_mensal: 49.9,
      moeda_iso: 'BRL',
      fidelidade_meses: 12,
      trecho: 'Premiere Fidelidade R$ 49,90 por mês',
    },
    {
      nome: 'Telecine',
      tipo: 'streaming',
      preco_mensal: 39.9,
      moeda_iso: 'BRL',
      fidelidade_meses: null,
      // o número não bate com a página (R$ 29,90): sem prova, sem preço
      trecho: 'Telecine R$ 39,90 por mês',
    },
  ],
  notas: null,
};

async function validate(out: LineupPageExtractOutput = output) {
  const names = extractedPlanNames(out);
  const locator = pageLocator([read], names, PLATFORM.name);
  const models = modelsFromExtraction(out, { pages: [read], locator, platformName: PLATFORM.name });
  const ctx = pageVerifyContext({ country: 'BR', platform: PLATFORM, dir, pages: [read], locator, now: NOW });
  return {
    models,
    plans: await verifyPlans(models.plans, ctx),
    addons: await verifyAddons(models.addons, ctx),
  };
}

describe('extração pela página oficial: schemas e prompts', () => {
  it('schemas compatíveis com o modo estrito', () => {
    expect(strictSchemaProblems(LINEUP_PLAN_PAGES_SCHEMA)).toEqual([]);
    expect(strictSchemaProblems(LINEUP_PAGE_EXTRACT_SCHEMA)).toEqual([]);
  });

  it('o prompt da extração leva a página como dado, com a lista aberta de cada plano rotulada', () => {
    const prompt = pageExtractPrompt({
      country: 'BR',
      platform: { name: PLATFORM.name, kind: 'streaming', website: PLATFORM.website },
      pages: [{ url: read.url, text: read.content.text, sections: read.content.sections }],
      knownPlans: ['Plano Futebol'],
      channels: ['Globo', 'ESPN'],
      services: ['Premiere'],
    });
    expect(prompt).toContain('<dados_externos>');
    expect(prompt).toContain(`página P1: ${read.url}`);
    expect(prompt).toContain('### Lista aberta no cartão: Plano TV');
    expect(prompt).toContain('São 6 streamings inclusos no seu plano');
    expect(prompt).toContain('- Plano Futebol');
    // sem busca: nada de pedir pesquisa na web
    expect(prompt).not.toMatch(/pesquise|busca de hoje/i);
    expect(pageExtractSystemPrompt()).toMatch(/Não há busca/);
    expect(pageExtractSystemPrompt()).toMatch(/LITERALMENTE/);
  });

  it('o texto das páginas no prompt tem teto', () => {
    const big = { url: read.url, text: 'x'.repeat(500_000), sections: [] };
    const prompt = pageExtractPrompt({
      country: 'BR',
      platform: { name: PLATFORM.name, kind: 'streaming', website: PLATFORM.website },
      pages: [big, big],
      knownPlans: [],
      channels: [],
      services: [],
    });
    expect(prompt.length).toBeLessThan(160_000);
  });

  it('a descoberta das URLs pede no máximo 3 buscas, só no site oficial', () => {
    const prompt = planPagesPrompt({
      country: 'AR',
      platform: { name: 'Operadora Exemplo', kind: 'pay_tv_operator', website: 'https://operadora.exemplo' },
    });
    expect(prompt).toMatch(/no máximo 3 buscas/);
    expect(prompt).toContain('site oficial: https://operadora.exemplo');
    expect(prompt).toMatch(/Não levante planos, preços nem canais/);
    expect(planPagesPurpose('ar-operadora-exemplo', 'AR')).toBe('lineups:pages-url:ar-operadora-exemplo:AR');
    expect(extractPurpose('ar-operadora-exemplo', 'AR')).toBe('lineups:extract:ar-operadora-exemplo:AR');
  });
});

describe('extração pela página oficial: resposta do modelo → validador', () => {
  it('trecho cortado com "..." vale por pedaços', () => {
    expect(excerptChunks('Plano Futebol ... R$ 149,90')).toEqual(['plano futebol', 'r 149 90']);
    const locator = pageLocator([read], ['Plano Futebol', 'Plano TV'], PLATFORM.name);
    expect(locator.locate('Plano Futebol ... São 6 streamings inclusos')).toBe(read.url);
    expect(locator.locate('Plano Inventado R$ 1,00')).toBeNull();
    // a linha "ESPN" está na lista aberta do Plano TV, não na do Plano Futebol
    expect(locator.proof(read.url, 'ESPN').planBlocks).toContain('Plano TV');
    expect(locator.proof(read.url, 'ESPN').planBlocks).not.toContain('Plano Futebol');
  });

  it('planos sem repetir, a URL de cada evidência é a da página (o modelo não escreve URL)', async () => {
    const { models } = await validate();
    expect(models.plans.map((p) => p.name)).toEqual(['Plano Futebol', 'Plano TV']);
    for (const p of models.plans) {
      expect(p.evidence.url).toBe(read.url);
      for (const c of p.channels) expect(c.evidence.url).toBe(read.url);
    }
  });

  it('preço cheio provado pela página; o promocional fica de fora', async () => {
    const { plans } = await validate();
    const futebol = plans.plans.find((p) => p.name === 'Plano Futebol')!;
    expect([futebol.priceAmount, futebol.priceText]).toEqual([149.9, 'R$ 149,90/mês']);
    expect(futebol.verification).toMatchObject({
      tier: 'official',
      verified: true,
      checks: { page: 'pass', plan_specific: 'pass', list_price: 'pass' },
    });
    // as duas observações ficam (conflito para a revisão); vale a provada
    expect(futebol.verification.prices?.map((o) => [o.amount, o.verified])).toEqual([
      [149.9, true],
      [74.95, false],
    ]);
    expect(futebol.verification.price_conflict).toBe(true);
    const tv = plans.plans.find((p) => p.name === 'Plano TV')!;
    expect(tv.priceAmount).toBe(99.9);
  });

  it('grade: a linha da lista aberta do plano prova o canal; o resto entra sem prova, nada some', async () => {
    const { plans } = await validate();
    const futebol = plans.plans.find((p) => p.name === 'Plano Futebol')!;
    const access = Object.fromEntries(futebol.channels.map((c) => [c.entryId, c.access]));
    expect(access).toEqual({
      globo: 'included',
      cazetv: 'included',
      // trecho inventado (não está na página): sem prova
      espn: 'unverified',
      // a linha só está na lista de outros planos: sem prova deste plano
      sportv: 'unverified',
      // sem trecho: entra sem prova (não é descartado)
      bandsports: 'unverified',
    });
    const espn = futebol.channels.find((c) => c.entryId === 'espn')!;
    expect(espn.verification.checks).toMatchObject({ page: 'fail', plan_specific: 'pass' });
    const sportv = futebol.channels.find((c) => c.entryId === 'sportv')!;
    expect(sportv.verification.checks).toMatchObject({ page: 'pass', plan_specific: 'fail' });
    const band = futebol.channels.find((c) => c.entryId === 'bandsports')!;
    expect(band.verification).toMatchObject({ excerpt: null, checks: { excerpt: 'fail' } });
    // fora da biblioteca: só para a curadoria (não há entrada para ligar)
    expect(plans.drops).toContainEqual({ reason: 'unknown', name: 'Canal Inventado', plan: 'Plano Futebol' });

    const tv = plans.plans.find((p) => p.name === 'Plano TV')!;
    expect(tv.channels.map((c) => [c.entryId, c.access])).toEqual([
      ['espn', 'included'],
      ['sportv', 'included'],
    ]);
  });

  it('streaming incluso pela frase do cartão do plano', async () => {
    const { plans } = await validate();
    const futebol = plans.plans.find((p) => p.name === 'Plano Futebol')!;
    expect(futebol.services.map((s) => [s.entryId, s.access])).toEqual([['premiere', 'included']]);
    const tv = plans.plans.find((p) => p.name === 'Plano TV')!;
    expect(tv.services.map((s) => [s.entryId, s.access])).toEqual([['prime_video', 'included']]);
  });

  it('complementos: o preço só com o trecho igual à página', async () => {
    const { addons } = await validate();
    expect(
      addons.addons.map((a) => [a.refId, a.priceAmount, a.commitmentMonths, a.verification.verified]),
    ).toEqual([
      ['premiere', 49.9, 12, true],
      ['telecine', null, null, false],
    ]);
    expect(addons.addons[1]!.verification.claimed).toEqual({ price_amount: 39.9, currency: 'BRL' });
  });
});

describe('revisita pelo hash da página', () => {
  it('o hash do conjunto não depende da ordem das páginas', () => {
    const a = { url: 'https://op.exemplo/planos', hash: 'h1' };
    const b = { url: 'https://op.exemplo/planos/futebol', hash: 'h2' };
    expect(pagesHash([a, b])).toBe(pagesHash([b, a]));
    expect(pagesHash([a, b])).not.toBe(pagesHash([a, { ...b, hash: 'h3' }]));
    expect(pagesHash([a])).not.toBe(pagesHash([a, b]));
  });

  it('página igual à da última extração: nenhuma chamada ao modelo; mudou, sem extração anterior ou forçado: extrai', () => {
    const h = pagesHash([read]);
    expect(needsExtraction(h, h)).toBe(false);
    expect(needsExtraction(h, h, true)).toBe(true);
    expect(needsExtraction(null, h)).toBe(true);
    expect(needsExtraction(h, pagesHash([{ ...read, hash: 'outro' }]))).toBe(true);
  });

  it('reler a mesma página (espaços e caixa diferentes) dá o mesmo hash; preço novo muda o hash', async () => {
    const html = (price: string, pad = '') =>
      `<html><body><h1>Planos</h1><div>Plano Exemplo${pad}</div><p>R$ ${price} por mês</p><p>Canal Exemplo, Canal Exemplo 2</p></body></html>`;
    let body = html('99,90');
    const store = memoryPageStore();
    const reader = new OfficialPageReader({
      fetch: async (url) =>
        url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : new Response(body, { status: 200 }),
      store,
      sleep: async () => undefined,
      minIntervalMs: 0,
    });
    const platform = { website: 'https://op.exemplo', officialDomains: [] };
    const hashOf = async () => {
      const r = await reader.read('https://op.exemplo/planos', platform, { force: true, enough: () => true });
      return pagesHash([{ url: r.finalUrl ?? r.url, hash: r.hash! }]);
    };
    const first = await hashOf();
    body = html('99,90', '   ').toUpperCase().replace('<HTML>', '<html>');
    expect(needsExtraction(first, await hashOf())).toBe(false);
    body = html('109,90');
    expect(needsExtraction(first, await hashOf())).toBe(true);
  });

  it('a página só basta para a extração com preço e a grade (fora o streaming)', () => {
    const tv = enoughForExtraction(dir, 'pay_tv_operator');
    expect(tv({ text: page.text, sections: page.sections })).toBe(true);
    // sem a lista aberta, o cartão não tem canais bastantes: o leitor tenta o navegador
    expect(tv({ text: 'Plano X\nR$ 99,90 por mês\nGlobo e muito mais', sections: [] })).toBe(false);
    expect(enoughForExtraction(dir, 'streaming')({ text: 'Mensal R$ 29,90 por mês', sections: [] })).toBe(
      true,
    );
    expect(enoughForExtraction(dir, 'streaming')({ text: 'Assine já', sections: [] })).toBe(false);
  });
});
