/**
 * Validador determinístico da grade, depois da IA (código, não prompt). A IA devolve cada plano, canal e
 * streaming com `fonte_url` e `trecho`; aqui se decide o que vale como prova:
 *
 * 1. a URL do grounding (`vertexaisearch.cloud.google.com/grounding-api-redirect/...`) é seguida por um GET
 *    sem seguir o redirecionamento (lê o `Location` do 302) e a URL final é a guardada — o link do Google
 *    expira. Falhou, o item fica não verificado;
 * 2. o nível da fonte sai do domínio final: oficial (site da plataforma ou do grupo), comparador,
 *    imprensa, outro ou descartada (documento de terceiros, loja de app, rede social). Só a oficial vale
 *    para `included` e para o preço cheio;
 * 3. o trecho contém o dado: o número do preço; o nome do canal ou do streaming (sem acento, com os
 *    apelidos do dicionário);
 * 4. a prova é do plano: o trecho cita o nome do plano, ou a URL final é a página dele. Um trecho
 *    reaproveitado em vários planos da plataforma só vale se citar o plano;
 * 5. streaming é complemento pago por padrão: só é `included` com prova oficial e específica do plano
 *    que diga que vem incluso (com a prova, sem dizer incluso, é `addon`).
 *
 * O que não passa entra como `unverified` (nunca sai na leitura pública) e o preço sem prova não é gravado.
 */
import {
  lineupSlug,
  type LineupAccess,
  type LineupCheckResult,
  type LineupPriceObservation,
  type LineupSourceTier,
  type LineupVerification,
} from '@galaxie/db';
import {
  hostOf,
  matchesDomain,
  normalizeName,
  registrableDomain,
  type BroadcasterEntry,
  type CountryDirectory,
} from '@galaxie/where-to-watch';
import { sanitizeText } from '../llm/hygiene.js';

// ─── redirecionamento do grounding ───────────────────────────────────────────────────────────────

/** Host dos links de redirecionamento das citações do grounding. */
export const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com';

export const isGroundingRedirect = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.hostname === GROUNDING_REDIRECT_HOST && u.pathname.startsWith('/grounding-api-redirect/');
  } catch {
    return false;
  }
};

export type RedirectFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Resolve as URLs do grounding: GET sem seguir o redirecionamento, lendo o `Location` (só o host do
 * Google é chamado; nenhuma outra URL é buscada). URL que não é redirecionamento volta igual; falha
 * (sem `Location`, erro, tempo esgotado) volta null. O mesmo link é resolvido uma vez só.
 */
export function redirectResolver(
  fetchImpl: RedirectFetch = (url, init) => fetch(url, init),
  opts: { timeoutMs?: number; max?: number } = {},
): (url: string) => Promise<string | null> {
  const cache = new Map<string, Promise<string | null>>();
  let budget = opts.max ?? 80;
  return (url) => {
    if (!isGroundingRedirect(url)) return Promise.resolve(url);
    const hit = cache.get(url);
    if (hit) return hit;
    const p =
      budget-- <= 0
        ? Promise.resolve(null)
        : fetchImpl(url, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
          })
            .then((r) => {
              const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
              if (!loc || isGroundingRedirect(loc)) return null;
              const u = new URL(loc, url);
              return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
            })
            .catch(() => null);
    cache.set(url, p);
    return p;
  };
}

// ─── nível da fonte ──────────────────────────────────────────────────────────────────────────────

/** Comparadores de planos (o nome aparece no host, em qualquer país). */
const COMPARATOR_LABELS = [
  'selectra',
  'comparaonline',
  'comparaplanos',
  'comparatel',
  'comparamejor',
  'melhorplano',
  'minhaoperadora',
  'mejorplan',
  'rastreator',
  'kelisto',
];

/** Documentos de terceiros, lojas de app e redes sociais: nunca provam a oferta. */
const DISCARDED_DOMAINS = [
  'scribd.com',
  'slideshare.net',
  'issuu.com',
  'docplayer.com.br',
  'docplayer.es',
  'pdfcoffee.com',
  'play.google.com',
  'apps.apple.com',
  'itunes.apple.com',
  'appgallery.huawei.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'reddit.com',
  'threads.net',
  'pinterest.com',
  't.me',
];

/** Imprensa de tecnologia e telecom da região (além da imprensa do dicionário do país). */
const PRESS_DOMAINS = [
  'tecnoblog.net',
  'tudocelular.com',
  'canaltech.com.br',
  'olhardigital.com.br',
  'teletime.com.br',
  'telesintese.com.br',
  'mobiletime.com.br',
  'tavilatam.com',
  'convergencialatina.com',
  'telesemana.com',
  'xataka.com',
  'xataka.com.mx',
  'iprofesional.com',
  'infobae.com',
  'clarin.com',
  'lanacion.com.ar',
  'ambito.com',
  'pagina12.com.ar',
  'perfil.com',
  'eltiempo.com',
  'emol.com',
  'latercera.com',
  'elcomercio.pe',
  'larepublica.pe',
  'elpais.com.uy',
  'eluniverso.com',
  'milenio.com',
  'eluniversal.com.mx',
];

export interface PlatformOfficial {
  website: string | null;
  officialDomains: readonly string[];
}

/** O domínio final é da plataforma (o site, o mesmo domínio registrável ou um domínio oficial extra)? */
export function isOfficialUrl(url: string, platform: PlatformOfficial): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const site = platform.website ? hostOf(platform.website) : null;
  if (site && (host === site || registrableDomain(host) === registrableDomain(site))) return true;
  return platform.officialDomains.some((d) => matchesDomain(url, d));
}

/** Nível da fonte pelo domínio final. */
export function sourceTier(url: string, platform: PlatformOfficial, dir: CountryDirectory): LineupSourceTier {
  const host = hostOf(url);
  if (!host) return 'discarded';
  if (DISCARDED_DOMAINS.some((d) => matchesDomain(url, d))) return 'discarded';
  if (isOfficialUrl(url, platform)) return 'official';
  if (COMPARATOR_LABELS.some((l) => host.includes(l)) || dir.isAggregator(url)) return 'comparator';
  if (
    PRESS_DOMAINS.some((d) => matchesDomain(url, d)) ||
    dir.sources.press.some((d) => matchesDomain(url, d)) ||
    // o site de uma emissora fala da própria grade de terceiros: conta como imprensa
    dir.broadcasters.some((b) => b.domains.some((d) => matchesDomain(url, d)))
  )
    return 'press';
  return 'other';
}

/** Um domínio oficial informado pela IA não pode ser de comparador, imprensa ou rede social. */
export function acceptableOfficialDomain(domain: string, dir: CountryDirectory): boolean {
  const url = `https://${domain.replace(/^https?:\/\//, '')}`;
  return sourceTier(url, { website: null, officialDomains: [] }, dir) === 'other';
}

// ─── texto do trecho ─────────────────────────────────────────────────────────────────────────────

/** Texto comparável com espaços: sem acento, minúsculo, `+` = "plus", letra e número separados. */
export function spaced(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** O trecho cita algum dos nomes? Palavra inteira; nomes longos também casam sem espaços ("BAND SPORTS"). */
export function mentionsAny(excerpt: string, names: readonly string[]): boolean {
  const text = ` ${spaced(excerpt)} `;
  const squashed = normalizeName(excerpt);
  return names.some((n) => {
    const s = spaced(n);
    if (!s) return false;
    if (text.includes(` ${s} `)) return true;
    const k = normalizeName(n);
    return k.length >= 6 && squashed.includes(k);
  });
}

/** Nomes que valem para a entrada no dia: nome, apelidos, canais e apelidos com validade em vigor. */
export function entryNames(entry: BroadcasterEntry, day: string): string[] {
  return [
    entry.name,
    ...entry.aliases,
    ...entry.channels,
    ...entry.regionalVariants.map((v) => v.name),
    ...entry.datedAliases
      .filter((a) => (!a.validFrom || a.validFrom <= day) && (!a.validTo || day <= a.validTo))
      .map((a) => a.name),
  ];
}

const PLAN_WORDS = new Set(['plano', 'plan', 'planes', 'pacote', 'paquete', 'pack']);
const GENERIC_WORDS = new Set([
  ...PLAN_WORDS,
  'tv',
  'app',
  'de',
  'do',
  'da',
  'del',
  'con',
  'com',
  'e',
  'y',
  'mais',
  'plus',
  'mas',
  'the',
]);

/**
 * O trecho cita este plano? O nome inteiro, como palavra; nome de uma palavra só precisa vir depois de
 * "plano/plan/pacote/paquete" ("Futebol" sozinho é genérico). Ocorrência que é o começo do nome de
 * outro plano da plataforma ("Plano Futebol" dentro de "Plano Futebol Total") não conta.
 */
export function namesPlan(excerpt: string, plan: string, siblings: readonly string[]): boolean {
  const text = ` ${spaced(excerpt)} `;
  const name = spaced(plan);
  if (!name) return false;
  const longer = siblings.map(spaced).filter((s) => s !== name && s.startsWith(`${name} `));
  const needles = name.includes(' ') ? [name] : [...PLAN_WORDS].map((w) => `${w} ${name}`);
  for (const needle of needles) {
    let i = text.indexOf(` ${needle} `);
    while (i >= 0) {
      const rest = text.slice(i + 1);
      if (!longer.some((l) => rest.startsWith(`${l} `))) return true;
      i = text.indexOf(` ${needle} `, i + 1);
    }
  }
  return false;
}

/**
 * A URL final é a página deste plano? Um trecho do caminho igual ao slug do plano, ou ao slug das
 * palavras próprias dele (sem o nome da plataforma nem palavras genéricas): `/planes/full` é a página
 * do "Plano Full" da plataforma.
 */
export function isPlanPage(url: string, plan: string, platformName: string): boolean {
  let segments: string[];
  try {
    segments = new URL(url).pathname
      .split('/')
      .map((s) => lineupSlug(decodeURIComponent(s)))
      .filter(Boolean);
  } catch {
    return false;
  }
  const platformWords = new Set(spaced(platformName).split(' '));
  const own = spaced(plan)
    .split(' ')
    .filter((w) => w && !GENERIC_WORDS.has(w) && !platformWords.has(w));
  const candidates = [lineupSlug(plan), own.length ? own.join('-') : ''].filter(Boolean);
  return segments.some((s) => candidates.includes(s));
}

// ─── preço ───────────────────────────────────────────────────────────────────────────────────────

/** Moeda (ISO 4217) de cada país da grade. */
export const COUNTRY_CURRENCY: Record<string, string> = {
  BR: 'BRL',
  AR: 'ARS',
  CL: 'CLP',
  CO: 'COP',
  PE: 'PEN',
  UY: 'UYU',
  MX: 'MXN',
  EC: 'USD',
  PA: 'USD',
};

const COUNTRY_LOCALE: Record<string, string> = {
  BR: 'pt-BR',
  AR: 'es-AR',
  CL: 'es-CL',
  CO: 'es-CO',
  PE: 'es-PE',
  UY: 'es-UY',
  MX: 'es-MX',
  EC: 'es-EC',
  PA: 'es-PA',
};

const NUMBER_RE = /\d{1,3}(?:[.\u00a0 ]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,3})?/g;

/** Leituras possíveis de um número escrito ("34.900" = 34900 ou 34,9; "149,90" = 149,9). */
function readings(token: string): number[] {
  const t = token.replace(/[\u00a0 ]/g, '.');
  const out = new Set<number>();
  // pt/es: ponto de milhar, vírgula decimal
  const ptEs = Number(t.replace(/\./g, '').replace(',', '.'));
  if (Number.isFinite(ptEs)) out.add(ptEs);
  // en: vírgula de milhar, ponto decimal
  const en = Number(t.replace(/,/g, ''));
  if (Number.isFinite(en) && !/\.\d{3}(?:\D|$)/.test(t)) out.add(en);
  if (Number.isFinite(en) && /^\d+\.\d{1,2}$/.test(t)) out.add(en);
  return [...out];
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.005;

export interface AmountAt {
  index: number;
  end: number;
  values: number[];
  /** O número tem símbolo de moeda antes ou "/mês" depois (é um preço, não "50 canais"). */
  money: boolean;
  /** Leitura principal (pt/es). */
  value: number;
}

const CURRENCY_BEFORE = /(?:R\$|US\$|\$U|S\/\.?|\$|USD|BRL|ARS|CLP|COP|PEN|UYU|MXN)\s*$/i;
const PERIOD_AFTER = /^\s*(?:\/\s*m[eê]s|por m[eê]s|x m[eê]s|al mes|mensual|mensais|\/mo\b)/i;

export function amountsIn(excerpt: string): AmountAt[] {
  const out: AmountAt[] = [];
  for (const m of excerpt.matchAll(NUMBER_RE)) {
    const index = m.index ?? 0;
    const end = index + m[0].length;
    const before = excerpt.slice(Math.max(0, index - 6), index);
    const after = excerpt.slice(end, end + 12);
    const values = readings(m[0]);
    if (!values.length) continue;
    out.push({
      index,
      end,
      values,
      money: CURRENCY_BEFORE.test(before) || PERIOD_AFTER.test(after),
      value: values[0]!,
    });
  }
  return out;
}

/** O número do preço aparece no trecho (em qualquer grafia de milhar e decimal)? */
export function excerptHasAmount(excerpt: string, amount: number): boolean {
  return amountsIn(excerpt).some((a) => a.values.some((v) => close(v, amount)));
}

/** Rótulos do preço cheio de lista (antes do número). */
const LIST_LABEL =
  /(precio de lista|pre[cç]o (?:cheio|de lista|normal|regular)|precio (?:regular|normal|final)|valor (?:regular|normal|cheio)|o valor [eé] de|el valor es de|depois|despu[eé]s|ap[oó]s|luego|a partir do \d|a partir del \d|antes)[^\d]{0,30}$/i;
/** Rótulos do preço promocional (antes do número) e marcas de promoção no trecho. */
const PROMO_LABEL =
  /(promo[a-z]*|desconto|descuento|\boff\b|1[º°o]?\s*m[eê]s|primeiros? (?:\d+ )?m[eê]s(?:es)?|primer(?:os)? (?:\d+ )?mes(?:es)?|por \d+ mes(?:es)?|gr[aá]tis|bonifica[a-z]*|oferta)[^\d]{0,30}$/i;
const PROMO_ANYWHERE =
  /promo|desconto|descuento|\boff\b|1[º°o]?\s*m[eê]s|primeiros? (?:\d+ )?m[eê]s|primer(?:os)? (?:\d+ )?mes|por \d+ mes|gr[aá]tis|bonifica/i;

/**
 * O preço é o cheio de lista? Falha quando o número citado é o promocional: o rótulo mais perto antes
 * dele é de promoção ("50% OFF no 1º mês. R$ 74,95"), ou não há rótulo, o trecho fala de promoção e
 * traz um preço maior ("R$14,90 no primeiro mês. Depois R$19,90"). Rótulo de lista ("Depois",
 * "precio de lista", "Antes") vale como cheio.
 */
export function listPriceCheck(excerpt: string, amount: number): LineupCheckResult {
  const all = amountsIn(excerpt);
  const hits = all.filter((a) => a.values.some((v) => close(v, amount)));
  if (!hits.length) return 'skip';
  let promo = false;
  for (const hit of hits) {
    const before = excerpt.slice(Math.max(0, hit.index - 45), hit.index);
    const list = LIST_LABEL.exec(before);
    const promoLabel = PROMO_LABEL.exec(before);
    if (list && (!promoLabel || list.index > promoLabel.index)) return 'pass';
    if (promoLabel) promo = true;
    // "R$ 149,90. R$ 74,95 por mês": logo depois do preço maior (o riscado), sem outro plano no meio
    const prev = all.filter((a) => a.end <= hit.index && a.money).at(-1);
    const gap = prev ? excerpt.slice(prev.end, hit.index) : '';
    if (prev && prev.value > amount * 1.0001 && gap.length <= 30 && !/plan|pacote|paquete|pack/i.test(gap))
      promo = true;
  }
  if (promo) return 'fail';
  const larger = all.some((a) => a.money && a.value > amount * 1.0001);
  return larger && PROMO_ANYWHERE.test(excerpt) ? 'fail' : 'pass';
}

/** Preço como publicado, a partir do número e da moeda ("R$ 149,90/mês"). */
export function formatPrice(amount: number, currency: string, country: string): string {
  const locale = COUNTRY_LOCALE[country] ?? 'es';
  const money = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${money.replace(/\u00a0/g, ' ')}/${locale.startsWith('pt') ? 'mês' : 'mes'}`;
}

// ─── streaming incluso ───────────────────────────────────────────────────────────────────────────

export const INCLUDED_RE =
  /inclus[oa]s?|inclu[ií]d[oa]s?|incluye|incluyen|inclui|incluem|sem custo|sin costo|sin cargo|sem pagar a mais|de regalo|j[aá] vem|viene con|bonificad[oa]/i;
const ADDON_RE =
  /adiciona(?:l|is|les)|add-?on|[àa] parte|aparte|opcional|contrat[eaá]|agreg[aá]|sum[aá]|por \+/i;

/** O trecho diz que o streaming vem incluso (e não fala de adicional perto do nome dele)? */
export function includedCheck(excerpt: string, names: readonly string[]): LineupCheckResult {
  if (!INCLUDED_RE.test(excerpt)) return 'fail';
  // "sem custo adicional" é incluso, não adicional
  const text = spaced(excerpt).replace(
    /\b(?:sem|sin) (?:custo|costo|cargo) (?:adicional|extra)\b/g,
    'incluso',
  );
  for (const n of names) {
    const s = spaced(n);
    const i = s ? text.indexOf(s) : -1;
    if (i < 0) continue;
    // "adicional", "contrate", "à parte" perto do nome: complemento pago, mesmo com "incluso" no plano
    if (ADDON_RE.test(text.slice(Math.max(0, i - 40), i + s.length + 40))) return 'fail';
  }
  return 'pass';
}

// ─── validação de uma resposta ───────────────────────────────────────────────────────────────────

/** Evidência que a IA citou: URL e trecho. */
export interface Evidence {
  url: string | null;
  excerpt: string | null;
}

export interface VerifyContext {
  country: string;
  platform: PlatformOfficial & { name: string };
  dir: CountryDirectory;
  /** URL citada → URL final (redirecionamento seguido) ou null (falhou). */
  resolveUrl: (url: string) => Promise<string | null>;
  /** URL citada aceitável como fonte (ancorada na busca, fora da blocklist)? null = sem fonte. */
  acceptUrl?: (url: string | null) => string | null;
  /**
   * Extração da página lida do nosso lado (sem busca): onde o trecho está na página. Com ela, o trecho
   * precisa estar na página (`checks.page`), o trecho dentro do cartão ou da lista aberta do plano prova
   * o plano, e o item sem trecho não some: entra sem prova (`unverified`), para a revisão no painel.
   */
  pageProof?: (url: string, excerpt: string) => PageProof;
  now: Date;
}

/** Onde o trecho citado está na página oficial lida do nosso lado. */
export interface PageProof {
  /** O trecho (cada pedaço, se cortado com "...") está no texto da página. */
  found: boolean;
  /** Planos cujo cartão ou lista aberta (seção com o nome do plano) contém o trecho. */
  planBlocks: string[];
}

export interface VerifiedEvidence {
  verification: LineupVerification;
  /** URL a gravar como fonte: a final (ou a citada, se o redirecionamento falhou). */
  sourceUrl: string;
  /** O trecho cita o plano pelo nome (não só a URL da página dele). */
  planSpecificByName: boolean;
  /** Trecho inteiro (o guardado é cortado). */
  fullExcerpt: string;
}

/** O trecho é conferido inteiro (até este tamanho) e guardado até `EXCERPT_STORED`. */
const EXCERPT_MAX = 2000;
const EXCERPT_STORED = 600;

/** Chave de reaproveitamento: o trecho normalizado. */
export const excerptKey = (excerpt: string) => spaced(excerpt).slice(0, 300);

export interface CheckInput {
  evidence: Evidence;
  plan: string;
  siblings: readonly string[];
  /** O dado que o trecho precisa conter: nomes (canal/streaming) ou o preço. */
  names?: readonly string[];
  amount?: number | null;
  /** Planos (nomes normalizados) que usaram o mesmo trecho. */
  reusedBy: ReadonlySet<string>;
}

/** Roda as checagens de uma evidência. null = sem fonte (não entra). */
export async function checkEvidence(ctx: VerifyContext, input: CheckInput): Promise<VerifiedEvidence | null> {
  const cited = ctx.acceptUrl ? ctx.acceptUrl(input.evidence.url) : input.evidence.url;
  const excerpt = input.evidence.excerpt ? sanitizeText(input.evidence.excerpt, EXCERPT_MAX).trim() : '';
  // da página lida do nosso lado, o item sem trecho entra sem prova (a revisão decide); da busca, não entra
  if (!cited || (!excerpt && !ctx.pageProof)) return null;
  const redirected = isGroundingRedirect(cited);
  const final = await ctx.resolveUrl(cited);
  const tier = final ? sourceTier(final, ctx.platform, ctx.dir) : null;
  const proof = ctx.pageProof && excerpt ? ctx.pageProof(final ?? cited, excerpt) : null;
  const byName = excerpt ? namesPlan(excerpt, input.plan, input.siblings) : false;
  const byUrl = final ? isPlanPage(final, input.plan, ctx.platform.name) : false;
  // o trecho está no cartão do plano ou na lista de canais aberta pelo botão dele
  const byBlock = !!proof?.planBlocks.some((b) => b === input.plan);
  const reused = input.reusedBy.size > 1;
  const checks: LineupVerification['checks'] = {
    redirect: !redirected ? 'skip' : final ? 'pass' : 'fail',
    // sem URL final não há domínio para conferir: não é oficial
    official: tier === 'official' ? 'pass' : 'fail',
    excerpt: !excerpt
      ? 'fail'
      : input.amount !== undefined
        ? input.amount === null
          ? 'skip'
          : excerptHasAmount(excerpt, input.amount)
            ? 'pass'
            : 'fail'
        : mentionsAny(excerpt, input.names ?? [])
          ? 'pass'
          : 'fail',
    plan_specific: byName || byUrl || byBlock ? 'pass' : 'fail',
    // reaproveitado em outro plano só vale se citar este plano pelo nome (ou estiver no bloco dele)
    not_reused: reused && !byName && !byBlock ? 'fail' : 'pass',
    ...(ctx.pageProof ? { page: proof?.found ? ('pass' as const) : ('fail' as const) } : {}),
  };
  return {
    verification: {
      source_url: cited,
      final_url: final,
      final_host: final ? hostOf(final) : null,
      tier,
      excerpt: excerpt ? excerpt.slice(0, EXCERPT_STORED) : null,
      checks,
      verified: false,
      checked_at: ctx.now.toISOString(),
    },
    sourceUrl: final ?? cited,
    planSpecificByName: byName,
    fullExcerpt: excerpt,
  };
}

export const passed = (checks: LineupVerification['checks']) =>
  Object.values(checks).every((c) => c === undefined || c === 'pass' || c === 'skip') &&
  checks.official === 'pass' &&
  checks.plan_specific === 'pass';

export interface ModelItem {
  name: string;
  evidence: Evidence;
}

/** Um preço citado para o plano, com a fonte, o trecho e a data da fonte (se a fonte diz). */
export interface ModelPlanPrice {
  amount: number;
  currency: string | null;
  /** YYYY-MM ou YYYY-MM-DD. */
  date: string | null;
  evidence: Evidence;
}

export interface ModelPlan {
  name: string;
  /** Preço único (formato do AI Studio); ignorado quando há `prices`. */
  priceAmount: number | null;
  currency: string | null;
  /** Vários preços, cada um com fonte e data (etapa 2): conflito quando divergem. */
  prices?: ModelPlanPrice[];
  planUrl: string | null;
  evidence: Evidence;
  channels: ModelItem[];
  services: ModelItem[];
}

export type ItemDrop = 'no_source' | 'unknown' | 'inactive' | 'blocked' | 'wrong_medium';

export interface VerifiedItem {
  entryId: string;
  access: LineupAccess;
  sources: string[];
  verification: LineupVerification;
}

export interface VerifiedPlan {
  name: string;
  priceAmount: number | null;
  priceCurrency: string | null;
  priceText: string | null;
  url: string | null;
  sources: string[];
  verification: LineupVerification;
  channels: VerifiedItem[];
  services: VerifiedItem[];
}

export interface VerifyOutcome {
  plans: VerifiedPlan[];
  /** Planos sem fonte (não entram). */
  plansWithoutSource: number;
  drops: { reason: ItemDrop; name: string; plan: string }[];
}

/** Canal linear da grade: TV paga, aberta e os canais "especiais" que também saem no YouTube. */
export const GRADE_CHANNEL_MEDIA = new Set(['pay_tv', 'free_tv', 'youtube']);
/**
 * Streaming incluso: os de streaming e os pacotes de TV paga vendidos como serviço (o mesmo nome pode
 * ser canal numa plataforma e serviço noutra, como o Premiere).
 */
const SERVICE_MEDIA = new Set(['streaming_svod', 'streaming_free', 'pay_tv']);

/** Data da fonte comparável (YYYY-MM vira o último dia do mês não importa: só ordena). */
const dateKey = (d: string | null) => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 10) : '');

/**
 * O preço escolhido entre os vistos: o oficial provado com a fonte mais recente; empate, o primeiro.
 * Conflito: mais de um valor entre os preços vistos.
 */
export function choosePrice(prices: readonly LineupPriceObservation[]): {
  chosen: LineupPriceObservation | null;
  conflict: boolean;
} {
  const verified = prices
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.verified)
    .sort(
      (a, b) =>
        dateKey(b.p.source_date ?? b.p.seen_at).localeCompare(dateKey(a.p.source_date ?? a.p.seen_at)) ||
        a.i - b.i,
    );
  const values = new Set(prices.map((p) => Math.round(p.amount * 100)));
  return { chosen: verified[0]?.p ?? null, conflict: values.size > 1 };
}

/**
 * Valida os planos de uma plataforma vindos da IA. Itens são casados com o dicionário do país (meio,
 * canal extinto, apelido com validade) e cada evidência passa pelas checagens. Um canal ou streaming
 * também pode ser provado pelo trecho do próprio plano, quando ele cita o item.
 */
export async function verifyPlans(plans: readonly ModelPlan[], ctx: VerifyContext): Promise<VerifyOutcome> {
  const day = ctx.now.toISOString().slice(0, 10);
  const names = plans.map((p) => p.name);
  // trecho → planos que o usaram (reaproveitamento)
  const usage = new Map<string, Set<string>>();
  const note = (e: Evidence, plan: string) => {
    if (!e.excerpt) return;
    const k = excerptKey(e.excerpt);
    if (!k) return;
    const set = usage.get(k) ?? new Set<string>();
    set.add(spaced(plan));
    usage.set(k, set);
  };
  for (const p of plans) {
    note(p.evidence, p.name);
    for (const pr of p.prices ?? []) note(pr.evidence, p.name);
    for (const i of [...p.channels, ...p.services]) note(i.evidence, p.name);
  }
  const none: ReadonlySet<string> = new Set<string>();
  const reusedBy = (e: Evidence) => (e.excerpt ? (usage.get(excerptKey(e.excerpt)) ?? none) : none);
  const siblingsOf = (plan: string) => names.filter((n) => n !== plan);

  const out: VerifyOutcome = { plans: [], plansWithoutSource: 0, drops: [] };
  for (const p of plans) {
    const siblings = siblingsOf(p.name);
    const currency = COUNTRY_CURRENCY[ctx.country] ?? null;
    // os preços vistos: os da etapa 2, cada um com a fonte dele, ou o único do formato do AI Studio
    const multi = (p.prices?.length ?? 0) > 0;
    const priceInputs: ModelPlanPrice[] = multi
      ? p.prices!
      : p.priceAmount !== null
        ? [{ amount: p.priceAmount, currency: p.currency, date: null, evidence: p.evidence }]
        : [];
    const priceChecks: { input: ModelPlanPrice; checked: VerifiedEvidence }[] = [];
    for (const input of priceInputs) {
      const checked = await checkEvidence(ctx, {
        evidence: input.evidence,
        plan: p.name,
        siblings,
        amount: input.amount,
        reusedBy: reusedBy(input.evidence),
      });
      if (!checked) continue;
      const c = checked.verification.checks;
      c.list_price = c.excerpt === 'pass' ? listPriceCheck(checked.fullExcerpt, input.amount) : 'skip';
      c.currency =
        !input.currency || !currency || input.currency.toUpperCase() === currency ? 'pass' : 'fail';
      checked.verification.verified = passed(c) && currency !== null;
      priceChecks.push({ input, checked });
    }
    const observations: LineupPriceObservation[] = priceChecks.map(({ input, checked }) => ({
      amount: input.amount,
      currency: currency,
      origin: 'research',
      source_url: checked.sourceUrl,
      tier: checked.verification.tier,
      source_date: input.date && /^\d{4}-\d{2}/.test(input.date) ? input.date.slice(0, 10) : null,
      seen_at: ctx.now.toISOString(),
      verified: checked.verification.verified,
    }));
    const { chosen, conflict } = choosePrice(observations);
    const chosenCheck = chosen ? priceChecks[observations.indexOf(chosen)] : priceChecks[0];
    // a prova do plano: o trecho do plano; sem ele, o do preço escolhido
    const planCheck =
      (multi || p.priceAmount === null
        ? await checkEvidence(ctx, {
            evidence: p.evidence,
            plan: p.name,
            siblings,
            amount: null,
            reusedBy: reusedBy(p.evidence),
          })
        : chosenCheck?.checked) ?? chosenCheck?.checked;
    if (!planCheck) {
      out.plansWithoutSource++;
      continue;
    }
    const v: LineupVerification = { ...planCheck.verification, checks: { ...planCheck.verification.checks } };
    if (chosenCheck) {
      const cc = chosenCheck.checked.verification.checks;
      if (cc.list_price) v.checks.list_price = cc.list_price;
      if (cc.currency) v.checks.currency = cc.currency;
      if (!multi) v.checks.excerpt = chosenCheck.checked.verification.checks.excerpt;
    }
    v.verified = passed(v.checks) && (!priceInputs.length || chosen !== null);
    const priceOk = chosen !== null && v.checks.official === 'pass' && v.checks.plan_specific === 'pass';
    if (observations.length) {
      v.prices = observations;
      if (conflict) v.price_conflict = true;
    }
    if (priceInputs.length && !priceOk)
      v.claimed = { price_amount: priceInputs[0]!.amount, currency: priceInputs[0]!.currency };
    const priceAmount = priceOk ? chosen!.amount : null;
    const sources = [planCheck.sourceUrl];
    for (const c of priceChecks)
      if (!sources.includes(c.checked.sourceUrl)) sources.push(c.checked.sourceUrl);
    let url: string | null = null;
    if (p.planUrl) {
      const accepted = ctx.acceptUrl ? ctx.acceptUrl(p.planUrl) : p.planUrl;
      const final = accepted ? await ctx.resolveUrl(accepted) : null;
      if (final && isOfficialUrl(final, ctx.platform)) {
        url = final;
        if (!sources.includes(final)) sources.push(final);
      }
    }

    const items = async (list: readonly ModelItem[], as: 'channel' | 'service') => {
      const byId = new Map<string, VerifiedItem>();
      for (const item of list) {
        const name = item.name.trim();
        if (!name) continue;
        if (ctx.dir.blocklist.isBlockedName(name)) {
          out.drops.push({ reason: 'blocked', name, plan: p.name });
          continue;
        }
        const found = ctx.dir.lookup(name, day);
        if (!found) {
          out.drops.push({ reason: 'unknown', name, plan: p.name });
          continue;
        }
        if (found.status === 'inactive') {
          out.drops.push({ reason: 'inactive', name, plan: p.name });
          continue;
        }
        const entry = found.resolved.entry;
        if (ctx.dir.blocklist.isBlockedName(entry.name)) {
          out.drops.push({ reason: 'blocked', name, plan: p.name });
          continue;
        }
        // o meio vem do dicionário, não do modelo; TV paga vendida como serviço (Premiere) entra nos dois
        const fits =
          as === 'service' ? SERVICE_MEDIA.has(entry.medium) : GRADE_CHANNEL_MEDIA.has(entry.medium);
        if (!fits) {
          out.drops.push({ reason: 'wrong_medium', name, plan: p.name });
          continue;
        }
        const itemNames = [name, ...entryNames(entry, day)];
        // a prova do item: o trecho dele; se não bastar, o trecho do plano (quando cita o item)
        // (o do plano só quando cita o item: sem fonte própria e sem menção, o item não entra)
        const candidates: Evidence[] = [item.evidence];
        if (
          p.evidence.excerpt &&
          p.evidence.excerpt !== item.evidence.excerpt &&
          mentionsAny(p.evidence.excerpt, itemNames)
        )
          candidates.push(p.evidence);
        let best: { checked: VerifiedEvidence; access: LineupAccess } | null = null;
        for (const evidence of candidates) {
          const checked = await checkEvidence(ctx, {
            evidence,
            plan: p.name,
            siblings,
            names: itemNames,
            reusedBy: reusedBy(evidence),
          });
          if (!checked) continue;
          const cv = checked.verification;
          if (as === 'service' && cv.checks.excerpt === 'pass')
            cv.checks.included = includedCheck(checked.fullExcerpt, itemNames);
          const proof = passed({ ...cv.checks, included: 'skip' });
          cv.verified = proof;
          const access: LineupAccess = !proof
            ? 'unverified'
            : as === 'channel' || cv.checks.included === 'pass'
              ? 'included'
              : 'addon';
          if (!best || rank(access) > rank(best.access)) best = { checked, access };
          if (access === 'included') break;
        }
        if (!best) {
          out.drops.push({ reason: 'no_source', name, plan: p.name });
          continue;
        }
        const cur = byId.get(entry.id);
        if (!cur || rank(best.access) > rank(cur.access))
          byId.set(entry.id, {
            entryId: entry.id,
            access: best.access,
            sources: [best.checked.sourceUrl],
            verification: best.checked.verification,
          });
        else if (!cur.sources.includes(best.checked.sourceUrl)) cur.sources.push(best.checked.sourceUrl);
      }
      return [...byId.values()];
    };

    out.plans.push({
      name: p.name,
      priceAmount,
      priceCurrency: priceOk ? currency : null,
      priceText: priceOk ? formatPrice(priceAmount!, currency!, ctx.country) : null,
      url,
      sources,
      verification: v,
      channels: await items(p.channels, 'channel'),
      services: await items(p.services, 'service'),
    });
  }
  return out;
}

const rank = (a: LineupAccess) => (a === 'included' ? 2 : a === 'addon' ? 1 : 0);

// ─── catálogo de complementos (etapa 1) ──────────────────────────────────────────────────────────

/** Oferta de complemento citada pela IA. */
export interface ModelAddon {
  name: string;
  kind: 'service' | 'channel';
  amount: number | null;
  currency: string | null;
  commitmentMonths: number | null;
  evidence: Evidence;
}

export interface VerifiedAddon {
  kind: 'service' | 'channel';
  refId: string;
  channel: string | null;
  name: string;
  priceAmount: number | null;
  priceCurrency: string | null;
  priceText: string | null;
  commitmentMonths: number | null;
  sources: string[];
  verification: LineupVerification;
}

/**
 * Valida o catálogo de complementos: o nome casa com o dicionário (sem a palavra "fidelidade"), a fonte
 * é oficial e o trecho tem o nome e o preço na moeda do país. Sem prova, entra sem preço (rascunho).
 */
export async function verifyAddons(
  addons: readonly ModelAddon[],
  ctx: VerifyContext,
): Promise<{ addons: VerifiedAddon[]; drops: { reason: ItemDrop; name: string }[] }> {
  const day = ctx.now.toISOString().slice(0, 10);
  const currency = COUNTRY_CURRENCY[ctx.country] ?? null;
  const out: VerifiedAddon[] = [];
  const drops: { reason: ItemDrop; name: string }[] = [];
  for (const a of addons) {
    const name = a.name.trim();
    if (!name) continue;
    const bare = name.replace(/\b(fidelidade|permanencia|permanência)\b/gi, '').trim() || name;
    if (ctx.dir.blocklist.isBlockedName(bare)) {
      drops.push({ reason: 'blocked', name });
      continue;
    }
    const found = ctx.dir.lookup(bare, day) ?? ctx.dir.lookup(name, day);
    if (!found || found.status === 'inactive') {
      drops.push({ reason: found ? 'inactive' : 'unknown', name });
      continue;
    }
    const entry = found.resolved.entry;
    const checked = await checkEvidence(ctx, {
      evidence: a.evidence,
      plan: '',
      siblings: [],
      amount: a.amount,
      reusedBy: new Set(),
    });
    if (!checked) {
      drops.push({ reason: 'no_source', name });
      continue;
    }
    const c = checked.verification.checks;
    // o complemento é da plataforma, não do plano: sem prova de plano nem de reaproveitamento
    c.plan_specific = 'skip';
    c.not_reused = 'skip';
    if (!mentionsAny(checked.fullExcerpt, [bare, ...entryNames(entry, day)])) c.excerpt = 'fail';
    c.currency = !a.currency || !currency || a.currency.toUpperCase() === currency ? 'pass' : 'fail';
    const verified =
      c.official === 'pass' &&
      Object.values(c).every((x) => x === undefined || x !== 'fail') &&
      currency !== null;
    checked.verification.verified = verified;
    const priceOk = verified && a.amount !== null;
    if (a.amount !== null && !priceOk)
      checked.verification.claimed = { price_amount: a.amount, currency: a.currency };
    const months = a.commitmentMonths && a.commitmentMonths > 0 ? Math.round(a.commitmentMonths) : null;
    const channel = found.resolved.channel;
    out.push({
      kind: channel ? 'channel' : a.kind,
      refId: entry.id,
      channel,
      name,
      priceAmount: priceOk ? a.amount : null,
      priceCurrency: priceOk ? currency : null,
      priceText: priceOk
        ? `${formatPrice(a.amount!, currency!, ctx.country)}${months ? ` · fidelidade de ${months} meses` : ''}`
        : null,
      commitmentMonths: months,
      sources: [checked.sourceUrl],
      verification: checked.verification,
    });
  }
  return { addons: out, drops };
}
