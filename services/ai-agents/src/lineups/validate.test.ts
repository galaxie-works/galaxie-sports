import { Blocklist, loadWtwConfig, type CountryDirectory } from '@galaxie/where-to-watch';
import { describe, expect, it } from 'vitest';
import {
  aiStudioPlans,
  aiStudioRedirects,
  readAiStudio,
  type AiStudioOutput,
} from '../testing/ai-studio-lineups.js';
import { gabaritoIds, readGabarito } from '../testing/lineup-gabarito.js';
import {
  acceptableOfficialDomain,
  currencyCheck,
  excerptCurrencies,
  excerptHasAmount,
  formatPrice,
  includedCheck,
  isPlanPage,
  listPriceCheck,
  mentionsAny,
  namesPlan,
  redirectResolver,
  sourceTier,
  verifyAddons,
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

describe('blocklist no destino do redirecionamento', () => {
  // o dicionário do BR com um domínio bloqueado de exemplo
  const blocked: CountryDirectory = Object.create(config.directory('BR'), {
    blocklist: {
      value: new Blocklist([{ name: 'Bloqueada Exemplo', aliases: [], domains: ['bloqueada.exemplo'] }]),
    },
  });
  const R1 = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BLOQ-1';
  const R2 = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BLOQ-2';
  const OK = 'https://operadora.exemplo/planos';
  const vctx: VerifyContext = {
    country: 'BR',
    // o domínio bloqueado informado como oficial: sem a checagem, a fonte contaria como oficial
    platform: {
      name: 'Operadora Exemplo',
      website: 'https://operadora.exemplo',
      officialDomains: ['bloqueada.exemplo'],
    },
    dir: blocked,
    resolveUrl: async (u) => (u === R1 || u === R2 ? 'https://www.bloqueada.exemplo/plano' : u),
    now: NOW,
  };
  const model = (planUrl: string, channelUrl: string): ModelPlan => ({
    name: 'Plano Exemplo',
    priceAmount: null,
    currency: null,
    planUrl: null,
    evidence: { url: planUrl, excerpt: 'Plano Exemplo' },
    channels: [{ name: 'Globo', evidence: { url: channelUrl, excerpt: 'Plano Exemplo: Globo' } }],
    services: [],
  });

  it('o link do Google que leva a domínio bloqueado não vira fonte (nem oficial)', async () => {
    const out = await verifyPlans([model(R1, OK)], vctx);
    expect([out.plans.length, out.plansWithoutSource]).toEqual([0, 1]);
    const ok = await verifyPlans([model(OK, R2)], vctx);
    expect(ok.plans.map((p) => [p.name, p.channels.length])).toEqual([['Plano Exemplo', 0]]);
    expect(ok.drops).toContainEqual({ reason: 'no_source', name: 'Globo', plan: 'Plano Exemplo' });
  });

  it('domínio bloqueado não é aceito como domínio oficial da plataforma', () => {
    expect(acceptableOfficialDomain('bloqueada.exemplo', blocked)).toBe(false);
    expect(acceptableOfficialDomain('operadora.exemplo', blocked)).toBe(true);
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

  it('a moeda escrita junto do número no trecho vale, mesmo sem a moeda do modelo', () => {
    expect(excerptCurrencies('Plan Fútbol US$ 29,99 por mes', 29.99)).toEqual(['USD']);
    expect(excerptCurrencies('Plan Fútbol U$S 29,99', 29.99)).toEqual(['USD']);
    expect(excerptCurrencies('Plan Fútbol 29,99 USD al mes', 29.99)).toEqual(['USD']);
    expect(excerptCurrencies('Plan Fútbol 29,99 dólares', 29.99)).toEqual(['USD']);
    expect(excerptCurrencies('Plan Fútbol $U 990 por mes', 990)).toEqual(['UYU']);
    expect(excerptCurrencies('Plan Fútbol S/ 49,90', 49.9)).toEqual(['PEN']);
    expect(excerptCurrencies('Plano Futebol R$ 149,90', 149.9)).toEqual(['BRL']);
    // "$" sozinho é ambíguo; e a moeda de outro número do trecho não conta
    expect(excerptCurrencies('Plan Fútbol $ 990 por mes', 990)).toEqual([null]);
    expect(excerptCurrencies('Plan Fútbol $ 990 (o US$ 25)', 990)).toEqual([null]);
  });

  it('letra colada antes do símbolo não é moeda: AR$, MX$, "Open 249", "12x s/ juros"', () => {
    for (const [excerpt, amount] of [
      ['Plan Full AR$ 15.999 por mes', 15999],
      ['Plan Full AR$15.999 por mes', 15999],
      ['Plan Full ARS$ 15.999', 15999],
      ['Plan MX$ 299 al mes', 299],
      ['Plan Mex$299 al mes', 299],
      ['Plan COL$ 49.900', 49900],
      ['Plan CLP$ 9.990', 9990],
      ['Plan UYU$ 590', 590],
      ['HBO Max Open 249 al mes', 249],
      ['Plano 12x s/ 49,90', 49.9],
      ['Plano 49,90 PENDENTE', 49.9],
    ] as const)
      expect(excerptCurrencies(excerpt, amount), excerpt).toEqual([null]);
    expect(currencyCheck(null, 'Plan Full AR$ 15.999 por mes', 15999, 'ARS')).toBe('pass');
    expect(currencyCheck('ARS', 'Plan Full AR$15.999', 15999, 'ARS')).toBe('pass');
    expect(currencyCheck(null, 'HBO Max Open 249 al mes', 249, 'MXN')).toBe('pass');
    expect(currencyCheck(null, 'Plano 12x s/ 49,90', 49.9, 'BRL')).toBe('pass');
  });

  it('checagem de moeda: o modelo e o trecho; basta uma ocorrência na moeda do país', () => {
    expect(currencyCheck(null, 'Plan Fútbol US$ 29,99 por mes', 29.99, 'UYU')).toBe('fail');
    expect(currencyCheck(null, 'Plan Fútbol $ 990 por mes', 990, 'UYU')).toBe('pass');
    expect(currencyCheck('UYU', 'Plan Fútbol US$ 29,99', 29.99, 'UYU')).toBe('fail');
    expect(currencyCheck('USD', 'Plan Fútbol $ 990', 990, 'UYU')).toBe('fail');
    expect(currencyCheck(null, 'Plan Fútbol US$ 29,99', 29.99, 'USD')).toBe('pass');
    // o modelo escreve o símbolo em vez do código
    expect(currencyCheck('R$', 'Plano R$ 49,90/mês', 49.9, 'BRL')).toBe('pass');
    // o mesmo número em dólar e em peso: vale a do país
    expect(currencyCheck(null, 'Plan Lite USD 15 o $ 15 por mes', 15, 'UYU')).toBe('pass');
    expect(currencyCheck(null, 'Plan Lite USD 15 o $U 15 por mes', 15, 'UYU')).toBe('pass');
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

  it('moeda nula e o trecho em dólar: o preço não sai na moeda do país', async () => {
    const out = await verifyPlans(
      [
        {
          name: 'Plan Lite',
          priceAmount: null,
          currency: null,
          prices: [
            {
              amount: 29.99,
              currency: null,
              date: null,
              evidence: {
                url: 'https://plataforma-e.exemplo/planes/lite',
                excerpt: 'Plan Lite US$ 29,99 por mes',
              },
            },
          ],
          planUrl: null,
          evidence: { url: 'https://plataforma-e.exemplo/planes/lite', excerpt: 'Plan Lite' },
          channels: [],
          services: [],
        },
      ],
      { ...ctx('AR', 'ar-plataforma-e'), resolveUrl: async (u) => u },
    );
    const p = out.plans[0]!;
    expect([p.verification.checks.currency, p.priceAmount, p.priceText]).toEqual(['fail', null, null]);
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
    expect(access(plan(out, 'Pacote Full').channels)).toEqual({
      bandsports: 'included',
      espn: 'included',
      sportv: 'included',
    });
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

describe('vários preços: conflito e o oficial mais recente', () => {
  const PDF = 'https://plataforma-e.exemplo/documentos/precios-noviembre-diciembre-2025';
  const SITE = 'https://plataforma-e.exemplo/planes/lite';
  const lite = (prices: NonNullable<ModelPlan['prices']>): ModelPlan[] => [
    {
      name: 'Plan Lite',
      priceAmount: null,
      currency: null,
      prices,
      planUrl: null,
      evidence: { url: SITE, excerpt: 'Plan Lite. Solo. $ 12.900. mes.' },
      channels: [],
      services: [],
    },
  ];
  const run = (prices: NonNullable<ModelPlan['prices']>) =>
    verifyPlans(lite(prices), {
      ...ctx('AR', 'ar-plataforma-e'),
      resolveUrl: async (u) => u,
    });

  it('PDF de nov/dez 2025 × site de hoje: guarda os dois, marca conflito e vale o mais recente', async () => {
    const out = await run([
      {
        amount: 13650,
        currency: 'ARS',
        date: '2025-11',
        evidence: { url: PDF, excerpt: 'Lista de precios. Plan Lite. $ 13.650. Plan Básico. $ 19.200.' },
      },
      {
        amount: 12900,
        currency: 'ARS',
        date: '2026-10',
        evidence: { url: SITE, excerpt: 'Plan Lite. $ 12.900. mes.' },
      },
    ]);
    const p = out.plans[0]!;
    expect(p.priceAmount).toBe(12900);
    expect(p.verification.price_conflict).toBe(true);
    expect(p.verification.prices?.map((o) => [o.amount, o.source_date, o.verified])).toEqual([
      [13650, '2025-11', true],
      [12900, '2026-10', true],
    ]);
  });

  it('o preço sem prova (comparador) entra na lista, mas não vence o oficial', async () => {
    const out = await run([
      {
        amount: 11000,
        currency: 'ARS',
        date: '2026-10',
        evidence: { url: 'https://selectra.com.ar/planes', excerpt: 'Plan Lite $ 11.000' },
      },
      {
        amount: 12900,
        currency: 'ARS',
        date: '2026-09',
        evidence: { url: SITE, excerpt: 'Plan Lite. $ 12.900.' },
      },
    ]);
    expect(out.plans[0]!.priceAmount).toBe(12900);
    expect(out.plans[0]!.verification.price_conflict).toBe(true);
  });
});

describe('catálogo de complementos (etapa 1)', () => {
  const offer = (
    name: string,
    amount: number,
    months: number | null,
    excerpt: string,
    url = 'https://plataforma-a.exemplo/home/planos',
  ) => ({
    name,
    kind: 'service' as const,
    amount,
    currency: 'BRL',
    commitmentMonths: months,
    evidence: { url, excerpt },
  });

  it('mesmo serviço com duas ofertas; canal numerado vira canal; sem fonte oficial, sem preço', async () => {
    const { addons, drops } = await verifyAddons(
      [
        offer('Premiere', 59.9, null, 'Premiere R$ 59,90 por mês'),
        offer('Premiere Fidelidade', 49.9, 12, 'FIDELIDADE 12 MESES Premiere Fidelidade R$ 49,90 por mês'),
        offer('ESPN 6 Fidelidade', 4.9, 12, 'FIDELIDADE 12 MESES ESPN 6 Fidelidade R$ 4,90 por mês'),
        offer('Paramount+', 34.9, null, 'Paramount+ R$ 34,90', 'https://selectra.com.br/x'),
        offer('Streaming Inexistente', 29.9, null, 'Streaming Inexistente R$ 29,90'),
      ],
      ctx('BR', 'br-plataforma-a', { resolveUrl: async (u) => u }),
    );
    expect(addons.map((a) => [a.refId, a.kind, a.channel, a.priceAmount, a.commitmentMonths])).toEqual([
      ['premiere', 'service', null, 59.9, null],
      ['premiere', 'service', null, 49.9, 12],
      ['espn', 'channel', 'ESPN 6', 4.9, 12],
      ['paramount_plus', 'service', null, null, null],
    ]);
    expect(addons[1]!.priceText).toBe('R$ 49,90/mês · fidelidade de 12 meses');
    expect(drops).toEqual([{ reason: 'unknown', name: 'Streaming Inexistente' }]);
  });
});

describe('gabarito do dono do produto × resposta do AI Studio (plataforma A, BR)', () => {
  it('o validador não aceita nada que o gabarito não tem, e o Plano TV ficou de fora da resposta', async () => {
    const gabarito = readGabarito();
    const out = await verify('br-plataforma-a');
    const dir = config.directory('BR');
    for (const plan of out.plans) {
      const g = gabarito.planos.find((x) => x.nome === plan.name)!;
      expect(plan.priceAmount, plan.name).toBe(g.preco_mensal);
      const okServices = gabaritoIds(g.streamings_inclusos, dir, '2026-10-24').ids;
      const okChannels = gabaritoIds(g.canais, dir, '2026-10-24').ids;
      for (const s of plan.services.filter((x) => x.access === 'included'))
        expect(okServices, `${plan.name}: ${s.entryId}`).toContain(s.entryId);
      for (const c of plan.channels.filter((x) => x.access === 'included'))
        expect(okChannels, `${plan.name}: ${c.entryId}`).toContain(c.entryId);
    }
    // a prova genérica (ESPN, SporTV e BandSports da página geral) não entra em nenhum plano
    for (const name of ['Plano Futebol', 'Plano Streaming'])
      expect(plan(out, name).channels.filter((c) => c.access !== 'unverified')).toEqual([]);
    // plano que o gabarito tem e a resposta não trouxe (a 2ª etapa, por plano, existe para isto)
    expect(gabarito.planos.map((p) => p.nome).filter((n) => !out.plans.some((p) => p.name === n))).toEqual([
      'Plano TV',
    ]);
  });
});
