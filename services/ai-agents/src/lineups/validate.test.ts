import { loadWtwConfig } from '@galaxie/where-to-watch';
import { describe, expect, it } from 'vitest';
import {
  aiStudioPlans,
  aiStudioRedirects,
  readAiStudio,
  type AiStudioOutput,
} from '../testing/ai-studio-lineups.js';
import {
  excerptHasAmount,
  formatPrice,
  includedCheck,
  isPlanPage,
  listPriceCheck,
  mentionsAny,
  namesPlan,
  redirectResolver,
  sourceTier,
  verifyPlans,
  type ModelPlan,
  type VerifyContext,
  type VerifyOutcome,
} from './validate.js';

const config = loadWtwConfig();
const NOW = new Date('2026-10-24T12:00:00Z');
const REDIRECTS = aiStudioRedirects();

/** Plataformas da fixture (nomes e domínios neutros) com o site e os domínios oficiais extras. */
const PLATFORMS: Record<string, VerifyContext['platform']> = {
  'br-plataforma-a': { name: 'Plataforma A', website: 'https://plataforma-a.exemplo', officialDomains: [] },
  'br-plataforma-b': { name: 'Plataforma B', website: 'https://plataforma-b.exemplo', officialDomains: [] },
  'br-plataforma-c': { name: 'Plataforma C', website: 'https://plataforma-c.exemplo', officialDomains: [] },
  'br-plataforma-d': { name: 'Plataforma D', website: 'https://plataforma-d.exemplo', officialDomains: [] },
  'ar-plataforma-e': {
    name: 'Plataforma E',
    website: 'https://plataforma-e.exemplo',
    officialDomains: ['grupo-e.exemplo'],
  },
  // os planos ficam no site do grupo (domínio oficial extra, com caminho)
  'ar-plataforma-f': {
    name: 'Plataforma F',
    website: 'https://plataforma-f.exemplo',
    officialDomains: ['grupo-f.exemplo/plataforma-f'],
  },
  'ar-plataforma-g': { name: 'Plataforma G', website: 'https://plataforma-g.exemplo', officialDomains: [] },
  'ar-plataforma-h': { name: 'Plataforma H', website: 'https://plataforma-h.exemplo', officialDomains: [] },
};

const ctx = (country: string, id: string, extra: Partial<VerifyContext> = {}): VerifyContext => ({
  country,
  platform: PLATFORMS[id]!,
  dir: config.directory(country),
  resolveUrl: async (u) => (REDIRECTS.has(u) ? REDIRECTS.get(u)! : u),
  now: NOW,
  ...extra,
});

const fixtures: Record<'br' | 'ar', AiStudioOutput> = { br: readAiStudio('br'), ar: readAiStudio('ar') };

async function verify(id: string, edit?: (plans: ModelPlan[]) => void, extra?: Partial<VerifyContext>) {
  const country = id.slice(0, 2) as 'br' | 'ar';
  const plans = aiStudioPlans(fixtures[country], id);
  edit?.(plans);
  return verifyPlans(plans, ctx(country.toUpperCase(), id, extra));
}

const plan = (out: VerifyOutcome, name: string) => {
  const p = out.plans.find((x) => x.name === name);
  if (!p) throw new Error(`sem o plano ${name}`);
  return p;
};
const access = (items: { entryId: string; access: string }[]) =>
  Object.fromEntries(items.map((i) => [i.entryId, i.access]));

describe('redirecionamento do grounding', () => {
  const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABC';

  it('lê o Location do 302 sem seguir o redirecionamento, uma vez por link', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const resolve = redirectResolver(async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 302, headers: { location: 'https://plataforma.exemplo/planos' } });
    });
    expect(await resolve(REDIRECT)).toBe('https://plataforma.exemplo/planos');
    expect(await resolve(REDIRECT)).toBe('https://plataforma.exemplo/planos');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init).toMatchObject({ method: 'GET', redirect: 'manual' });
  });

  it('URL que não é do grounding volta igual, sem chamada nenhuma', async () => {
    const resolve = redirectResolver(async () => {
      throw new Error('não deveria buscar');
    });
    expect(await resolve('https://plataforma.exemplo/planos')).toBe('https://plataforma.exemplo/planos');
  });

  it('sem Location, com erro ou com outro redirecionamento do Google, falha (null)', async () => {
    expect(await redirectResolver(async () => new Response('ok', { status: 200 }))(REDIRECT)).toBeNull();
    expect(
      await redirectResolver(async () => {
        throw new Error('tempo esgotado');
      })(REDIRECT),
    ).toBeNull();
    expect(
      await redirectResolver(
        async () => new Response(null, { status: 302, headers: { location: `${REDIRECT}2` } }),
      )(REDIRECT),
    ).toBeNull();
  });
});

describe('nível da fonte pelo domínio final', () => {
  const dir = config.directory('BR');
  const site = { website: 'https://plataforma.exemplo', officialDomains: ['grupo.exemplo/tv'] };

  it('oficial: o site, subdomínio do mesmo domínio e o domínio extra (com caminho)', () => {
    expect(sourceTier('https://plataforma.exemplo/planos', site, dir)).toBe('official');
    expect(sourceTier('https://loja.plataforma.exemplo/x', site, dir)).toBe('official');
    expect(sourceTier('https://grupo.exemplo/tv/planos', site, dir)).toBe('official');
    expect(sourceTier('https://grupo.exemplo/celular', site, dir)).toBe('other');
  });

  it('comparador, imprensa (inclusive site de emissora), descartada e outro', () => {
    expect(sourceTier('https://selectra.com.ar/empresas/x', site, dir)).toBe('comparator');
    expect(sourceTier('https://www.tudocelular.com/noticias/1', site, dir)).toBe('press');
    expect(sourceTier('https://ge.globo.com/futebol/onde-assistir', site, dir)).toBe('press');
    expect(sourceTier('https://es.scribd.com/document/1/grade', site, dir)).toBe('discarded');
    expect(sourceTier('https://play.google.com/store/apps/details?id=x', site, dir)).toBe('discarded');
    expect(sourceTier('https://www.instagram.com/p/1', site, dir)).toBe('discarded');
    expect(sourceTier('https://blog.qualquer.exemplo/post', site, dir)).toBe('other');
  });
});

describe('o trecho contém o dado', () => {
  it('preço em qualquer grafia de milhar e decimal', () => {
    expect(excerptHasAmount('Plano X. R$ 149,90. mês', 149.9)).toBe(true);
    expect(excerptHasAmount('Plan X. $ 34.900. mes', 34900)).toBe(true);
    expect(excerptHasAmount('PRECIO DE LISTA: $41.560', 41560)).toBe(true);
    expect(excerptHasAmount('Depois, 45/mês', 45)).toBe(true);
    expect(excerptHasAmount('Plan X. $ 34.900. mes', 31900)).toBe(false);
  });

  it('nomes sem acento, com apelidos e grafias juntas ou separadas', () => {
    expect(mentionsAny('ESPN 5; BAND SPORTS; SPORTV 2.', ['BandSports'])).toBe(true);
    expect(mentionsAny('acesso a ESPN2, ESPN6 e SportTV2', ['ESPN 6'])).toBe(true);
    expect(mentionsAny('TyC Sports Fan', ['TyC Sports'])).toBe(true);
    expect(mentionsAny('Disney+ Premium e HBO Max inclusos', ['Disney Plus Premium'])).toBe(true);
    expect(mentionsAny('canais de esporte', ['ESPN'])).toBe(false);
  });
});

describe('prova específica do plano', () => {
  const siblings = ['Plano Futebol', 'Plano Futebol Total', 'Plano Streaming'];

  it('o nome do plano no trecho, sem confundir com o plano de nome mais longo', () => {
    expect(namesPlan('Plano Futebol. R$ 149,90.', 'Plano Futebol', siblings)).toBe(true);
    expect(namesPlan('Plano Futebol Total. R$ 219,90.', 'Plano Futebol', siblings)).toBe(false);
    expect(namesPlan('Plano Futebol Total. R$ 219,90.', 'Plano Futebol Total', siblings)).toBe(true);
    // nome de uma palavra só vale depois de "plano/pacote"
    expect(namesPlan('aberto para todo o Brasil no plano Full', 'Full', [])).toBe(true);
    expect(namesPlan('cobertura full de esportes', 'Full', [])).toBe(false);
  });

  it('ou a URL final é a página do plano', () => {
    expect(
      isPlanPage('https://grupo.exemplo/plataforma-f/planes/full', 'Plataforma F Full', 'Plataforma F'),
    ).toBe(true);
    expect(
      isPlanPage('https://grupo.exemplo/plataforma-f/planes/plus', 'Plataforma F Full', 'Plataforma F'),
    ).toBe(false);
    expect(isPlanPage('https://plataforma.exemplo/home/planos', 'Plano Futebol', 'Plataforma A')).toBe(false);
    expect(isPlanPage('https://plataforma.exemplo/plano-futebol', 'Plano Futebol', 'Plataforma A')).toBe(
      true,
    );
  });
});

describe('preço cheio de lista', () => {
  it('o promocional do 1º mês falha; o cheio passa', () => {
    const card = 'Plano Futebol. R$ 149,90. 50% OFF no 1º mês. R$ 74,95por mês.';
    expect(listPriceCheck(card, 149.9)).toBe('pass');
    expect(listPriceCheck(card, 74.95)).toBe('fail');
    // só os dois números, o riscado e o do mês (como na fixture): o segundo é o promocional
    expect(listPriceCheck('Plano Futebol. R$ 149,90. R$ 74,95por mês.', 149.9)).toBe('pass');
    expect(listPriceCheck('Plano Futebol. R$ 149,90. R$ 74,95por mês.', 74.95)).toBe('fail');
    const lite = 'Pacote Lite Plus. INCLUI. 50. canais. R$14,90. no primeiro mês. Depois. R$19,90';
    expect(listPriceCheck(lite, 19.9)).toBe('pass');
    expect(listPriceCheck(lite, 14.9)).toBe('fail');
    const max = 'TV Max. 1 mes gratis. $15.040 x mes. Antes $30.080. Precio sin impuestos nacionales$12.430.';
    expect(listPriceCheck(max, 30080)).toBe('pass');
    expect(listPriceCheck(max, 15040)).toBe('fail');
    const lista =
      'PRECIO DE LISTA PLAN : $41.560, PRECIO DE LISTA SIN IMPUESTOS: $34.347. (*) PRECIO PROMOCIONAL: $19.533';
    expect(listPriceCheck(lista, 41560)).toBe('pass');
    expect(listPriceCheck(lista, 19533)).toBe('fail');
  });

  it('lista de preços de vários planos, sem promoção, passa', () => {
    expect(listPriceCheck('Plan Lite. $ 13.650. Plan Básico. $ 19.200. Plan Full. $ 28.000.', 28000)).toBe(
      'pass',
    );
  });

  it('formata como publicado, na moeda do país', () => {
    expect(formatPrice(149.9, 'BRL', 'BR')).toBe('R$ 149,90/mês');
    expect(formatPrice(34900, 'ARS', 'AR')).toBe('$ 34.900/mes');
  });
});

describe('streaming é complemento pago por padrão', () => {
  it('só é incluso quando o trecho diz que vem incluso', () => {
    expect(includedCheck('São 6 streamings inclusos no seu plano: Paramount+', ['Paramount+'])).toBe('pass');
    expect(includedCheck('Incluído. Amazon Prime. NFL Game Pass.', ['Amazon Prime'])).toBe('pass');
    expect(includedCheck('+120 canais Globoplay Netflix HBO Max', ['Globoplay'])).toBe('fail');
    expect(includedCheck('Plano incluso. Contrate o Premiere adicional por R$ 30', ['Premiere'])).toBe(
      'fail',
    );
  });
});

describe('fixtures do AI Studio (BR e AR com grounding)', () => {
  it('trecho reaproveitado: a lista de canais da página geral não vale para nenhum dos três planos', async () => {
    const out = await verify('br-plataforma-a');
    expect(out.plans.map((p) => p.name)).toEqual(['Plano Futebol', 'Plano Streaming', 'Plano Futebol Total']);
    for (const p of out.plans) {
      expect(p.channels.length).toBeGreaterThan(0);
      for (const c of p.channels) {
        expect(c.access).toBe('unverified');
        expect(c.verification.checks).toMatchObject({
          official: 'pass',
          plan_specific: 'fail',
          not_reused: 'fail',
        });
      }
    }
    // o resto da prova oficial e específica vale: preço cheio e streamings inclusos
    const futebol = plan(out, 'Plano Futebol');
    expect([futebol.priceAmount, futebol.priceCurrency, futebol.priceText]).toEqual([
      149.9,
      'BRL',
      'R$ 149,90/mês',
    ]);
    expect(futebol.verification).toMatchObject({
      tier: 'official',
      final_host: 'plataforma-a.exemplo',
      final_url: 'https://plataforma-a.exemplo/home/planos',
      verified: true,
    });
    expect(access(futebol.services)).toMatchObject({ prime_video: 'included', paramount_plus: 'included' });
    // o trecho que não cita o plano não prova o streaming
    expect(access(plan(out, 'Plano Futebol Total').services)).toMatchObject({ hbo_max: 'unverified' });
  });

  it('fonte de imprensa: o plano entra sem preço (o citado fica para a revisão)', async () => {
    const box = plan(await verify('br-plataforma-b'), 'Plataforma B Box');
    expect(box.verification).toMatchObject({
      tier: 'press',
      final_host: 'tudocelular.com',
      verified: false,
      claimed: { price_amount: 159.9 },
    });
    expect([box.priceAmount, box.priceText]).toEqual([null, null]);
  });

  it('loja de app: fonte descartada, o streaming não entra como incluso', async () => {
    const out = await verify('ar-plataforma-g');
    const max = plan(out, 'Plataforma G TV Max');
    const disney = max.services.find((s) => s.entryId === 'disney_plus')!;
    expect([disney.access, disney.verification.tier, disney.verification.final_host]).toEqual([
      'unverified',
      'discarded',
      'play.google.com',
    ]);
    // "Antes $30.080" é o cheio; o "1 mes gratis" não engana
    expect(max.priceAmount).toBe(30080);
  });

  it('comparador e documento de terceiros não provam nada', async () => {
    const out = await verify('ar-plataforma-h');
    const app = out.plans[0]!;
    expect([app.verification.tier, app.priceAmount]).toEqual(['comparator', null]);
    expect(app.channels.every((c) => c.access === 'unverified')).toBe(true);
    expect(app.channels.map((c) => c.verification.tier).sort()).toEqual(['discarded', 'press', 'press']);
  });

  it('preço promocional: o número do 1º mês não vira preço', async () => {
    const out = await verify('br-plataforma-a', (plans) => {
      plans[0]!.priceAmount = 74.95; // "50% OFF no 1º mês. R$ 74,95"
    });
    const futebol = plan(out, 'Plano Futebol');
    expect(futebol.verification.checks).toMatchObject({ excerpt: 'pass', list_price: 'fail' });
    expect([futebol.priceAmount, futebol.verification.verified]).toEqual([null, false]);
    expect(futebol.verification.claimed).toEqual({ price_amount: 74.95, currency: 'BRL' });

    const lite = plan(
      await verify('br-plataforma-c', (plans) => {
        plans[0]!.priceAmount = 14.9;
      }),
      'Pacote Lite Plus',
    );
    expect(lite.verification.checks.list_price).toBe('fail');
  });

  it('domínio oficial do grupo: o plano com fonte no site do grupo vale', async () => {
    const out = await verify('ar-plataforma-f');
    const full = plan(out, 'Plataforma F Full');
    expect([full.priceAmount, full.verification.tier, full.verification.final_host]).toEqual([
      41560,
      'official',
      'grupo-f.exemplo',
    ]);
    expect(access(full.services)).toEqual({ paramount_plus: 'included' });
    // a mesma lista de logos usada nos dois planos não prova o canal
    expect(access(full.channels)).toMatchObject({ tyc_sports: 'unverified' });
    // sem o domínio do grupo, nada é oficial
    const alone = await verify('ar-plataforma-f', undefined, {
      platform: { name: 'Plataforma F', website: 'https://plataforma-f.exemplo', officialDomains: [] },
    });
    expect(alone.plans.every((p) => p.priceAmount === null && !p.verification.verified)).toBe(true);
  });

  it('prova genérica: trecho oficial que não cita o canal não o prova', async () => {
    const out = await verify('br-plataforma-d');
    const estendido = plan(out, 'Plataforma D TV Estendido');
    expect(estendido.channels.map((c) => [c.entryId, c.access, c.verification.checks.excerpt])).toEqual([
      ['espn', 'unverified', 'fail'],
    ]);
    expect(access(plan(out, 'Plataforma D TV Inicial').channels)).toEqual({ espn: 'included' });
  });

  it('redirecionamento que falha deixa o item sem verificação', async () => {
    const out = await verify('br-plataforma-c', undefined, { resolveUrl: async () => null });
    for (const p of out.plans) {
      expect(p.verification.checks.redirect).toBe('fail');
      expect([p.verification.tier, p.verification.final_url, p.priceAmount]).toEqual([null, null, null]);
      expect(p.channels.every((c) => c.access === 'unverified')).toBe(true);
    }
  });

  it('moeda fora do país: o preço não entra', async () => {
    const out = await verify('br-plataforma-c', (plans) => {
      plans[1]!.currency = 'USD';
    });
    expect(plan(out, 'Pacote Full').verification.checks.currency).toBe('fail');
    expect(plan(out, 'Pacote Full').priceAmount).toBeNull();
  });

  it('sem fonte, sem conteúdo: item sem URL ou sem trecho não entra', async () => {
    const out = await verify('br-plataforma-c', (plans) => {
      plans[1]!.channels = [
        ...plans[1]!.channels.map((c) => ({ ...c, evidence: { url: c.evidence.url, excerpt: null } })),
        // da memória: o trecho do plano não cita
        { name: 'TNT Sports', evidence: { url: null, excerpt: null } },
      ];
      plans[0]!.evidence = { url: null, excerpt: 'Pacote Lite Plus' };
    });
    expect(out.plansWithoutSource).toBe(1);
    // sem trecho próprio, só entra o canal que o trecho do plano cita
    expect(access(plan(out, 'Pacote Full').channels)).toEqual({ espn: 'included', sportv: 'included' });
    expect(out.drops).toContainEqual({ reason: 'no_source', name: 'TNT Sports', plan: 'Pacote Full' });
  });
});

describe('dicionário com validade', () => {
  const evidence = (excerpt: string) => ({ url: 'https://plataforma.exemplo/plano-total', excerpt });
  const one = (channels: string[]): ModelPlan[] => [
    {
      name: 'Plano Total',
      priceAmount: null,
      currency: null,
      planUrl: null,
      evidence: evidence('Plano Total'),
      channels: channels.map((name) => ({
        name,
        evidence: evidence(`Plano Total: ${channels.join(', ')}.`),
      })),
      services: [],
    },
  ];
  const run = (channels: string[], country: string) =>
    verifyPlans(one(channels), {
      country,
      platform: { name: 'Plataforma', website: 'https://plataforma.exemplo', officialDomains: [] },
      dir: config.directory(country),
      resolveUrl: async (u) => u,
      now: NOW,
    });

  it('Fox Sports 2 renomeado para ESPN 6 conta uma vez só', async () => {
    const out = await run(['Fox Sports 2', 'ESPN 6'], 'CL');
    expect(access(out.plans[0]!.channels)).toEqual({ espn: 'included' });
  });

  it('na Argentina a Fox Sports segue existindo', async () => {
    const out = await run(['Fox Sports 2', 'ESPN'], 'AR');
    expect(Object.keys(access(out.plans[0]!.channels)).sort()).toEqual(['espn', 'fox_sports']);
  });

  it('canal extinto (GolPerú, fora das grades desde 01/01/2026) não entra', async () => {
    const out = await run(['GolPerú', 'ESPN'], 'PE');
    expect(access(out.plans[0]!.channels)).toEqual({ espn: 'included' });
    expect(out.drops).toContainEqual({ reason: 'inactive', name: 'GolPerú', plan: 'Plano Total' });
  });
});
