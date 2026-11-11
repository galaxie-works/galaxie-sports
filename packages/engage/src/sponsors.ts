/**
 * Patrocinadores do cliente (#1021, B10): um cadastro só, usado pela campanha de bolão (#945), pela sala do chat
 * (#985) e pelas recompensas (#931). Aqui só as regras, sem banco nem HTTP:
 *
 * - casa de aposta não existe como categoria, e nome ou link que o filtro reconhece como aposta (lista da
 *   Galaxie, Ajustes → Conformidade → Moderação) é recusado;
 * - peça de patrocinador não aparece para `under13`, nem para `13_17` quando a ficha do país proíbe publicidade a
 *   menores (`adsToMinors`, B5);
 * - bebida alcoólica (`alcohol`) só aparece para `18plus`, em qualquer país, mesmo com `adsToMinors`; o filtro
 *   sugere a categoria pelo nome ou pelo link (`suggestsAlcohol`), mas quem cadastra decide;
 * - fora da vigência ou fora dos países do patrocinador, não aparece.
 */
import type { CountryPolicy } from './country-policy.js';
import { normalizeDomain, screen, type CompiledLists } from './moderation.js';

/**
 * Categorias do cadastro. Aposta, cassino e loteria não existem aqui, de propósito. `alcohol` (bebida alcoólica) é
 * separada de `beverage` (bebida sem álcool) porque só aparece para maiores de 18 anos.
 */
export const SPONSOR_CATEGORIES = [
  'alcohol',
  'apparel',
  'automotive',
  'beverage',
  'education',
  'energy',
  'finance',
  'food',
  'health',
  'media',
  'retail',
  'technology',
  'telecom',
  'travel',
  'other',
] as const;
export type SponsorCategory = (typeof SPONSOR_CATEGORIES)[number];

export const isSponsorCategory = (v: unknown): v is SponsorCategory =>
  typeof v === 'string' && (SPONSOR_CATEGORIES as readonly string[]).includes(v);

/** Onde a peça aparece; é a chave das impressões agregadas. */
export const SPONSOR_SURFACES = ['chat_room', 'prediction_campaign', 'reward'] as const;
export type SponsorSurface = (typeof SPONSOR_SURFACES)[number];

export interface SponsorInput {
  name: string;
  category: string;
  linkUrl: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  /** ISO 3166-1 alfa-2; vazio = todos os países do cliente. */
  countries: string[];
  startsAt: string | null;
  endsAt: string | null;
}

export interface Sponsor {
  name: string;
  category: SponsorCategory;
  linkUrl: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  countries: string[];
  startsAt: string | null;
  endsAt: string | null;
}

export type SponsorIssueCode = 'name' | 'category' | 'betting' | 'url' | 'shortener' | 'countries' | 'dates';

export interface SponsorIssue {
  field: keyof SponsorInput;
  code: SponsorIssueCode;
}

const COUNTRY = /^[A-Z]{2}$/;
/** Códigos que o `Intl` conhece mas não são país do ISO 3166-1 (UK é GB). */
const NOT_COUNTRIES = new Set([
  ...['UK', 'EU', 'EZ', 'UN', 'ZZ', 'QO', 'XA', 'XB'],
  // reservas excepcionais e códigos extintos
  ...['AC', 'CP', 'DG', 'EA', 'IC', 'TA', 'AN', 'BU', 'CS', 'DD', 'FX', 'SU', 'TP', 'YU', 'ZR'],
]);
let regionNames: Intl.DisplayNames | null = null;
const isCountry = (c: string): boolean => {
  if (!COUNTRY.test(c) || NOT_COUNTRIES.has(c)) return false;
  regionNames ??= new Intl.DisplayNames(['en'], { type: 'region' });
  return regionNames.of(c) !== c;
};

/** Encurtadores e agregadores de link: escondem o destino, então o link da peça tem de ir direto ao patrocinador. */
const LINK_HIDERS = [
  'bit.ly',
  'bitly.com',
  'beacons.ai',
  'buff.ly',
  'rb.gy',
  'tiny.cc',
  'cutt.ly',
  'goo.gl',
  'is.gd',
  'linkin.bio',
  'linktr.ee',
  'lnk.bio',
  'ow.ly',
  'rebrand.ly',
  'shorturl.at',
  't.co',
  't.ly',
  'tinyurl.com',
];
const MAX_COUNTRIES = 60;

/** Link ou logo maior que isto é recusado (e o host em punycode não vira conta cara). */
const MAX_URL_LENGTH = 2048;

function httpsUrl(v: string | null): string | null | undefined {
  if (v === null || v.trim() === '') return null;
  if (v.trim().length > MAX_URL_LENGTH) return undefined;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' || u.username || u.password) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Letras gregas e cirílicas que imitam as latinas (`Βet365` com beta). */
const LOOKALIKE: Record<string, string> = {
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  а: 'a',
  в: 'b',
  е: 'e',
  і: 'i',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  ѕ: 's',
};

/** Palavra de aposta no caminho ou na query do link (`/apostas`, `?utm_campaign=betting`). */
const BET_PATH =
  /(?:^|[^a-z])(?:apostas|apuestas|apostar|apostes|betting|(?:casino|cassino)[-_ ]?(?:online|ao[-_ ]?vivo|en[-_ ]?vivo))(?:[^a-z]|$)/;

/** Maiúsculas gregas cuja minúscula vira outra letra na tabela (`Ν` parece N, mas `ν` parece v). */
const LOOKALIKE_UPPER: Record<string, string> = { Ν: 'n', Η: 'h', Μ: 'm', Ζ: 'z', Υ: 'y' };

/**
 * Troca grega e cirílica (`Βet365`, `ВЕТ365`). `strict`: troca a palavra que mistura com letra latina ou dígito e a
 * palavra feita só de letras da tabela quando vem antes de um número no mesmo trecho (`ВЕТ 365`, não `/вет/2024`);
 * `context`: também quando o texto tem palavra latina (`Vai de ВЕТ`); `all`: toda palavra feita só de letras da
 * tabela (usado só contra os nomes completos de marca). `Привет` e `Вет Клиника` ficam como estão.
 */
function foldLookalikes(text: string, mode: 'strict' | 'context' | 'all' = 'strict'): string {
  const base = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ΝΗΜΖΥ]/gu, (c) => LOOKALIKE_UPPER[c] ?? c)
    .toLowerCase();
  const withLatin = mode === 'context' && /[a-z]/.test(base);
  const fold = (w: string) => [...w].map((c) => LOOKALIKE[c] ?? c).join('');
  return base.replace(/[\p{L}\p{N}]+/gu, (w, offset: number) => {
    if (/[a-z0-9]/.test(w)) return fold(w);
    if (![...w].every((c) => c in LOOKALIKE)) return w;
    if (mode === 'all' || withLatin) return fold(w);
    // o número tem de vir no mesmo trecho: não atravessa `/ ? # & =` de um link
    const next = /^[^\p{L}\p{N}/?#&=]*([\p{L}\p{N}]+)/u.exec(base.slice(offset + w.length))?.[1];
    return next !== undefined && /^\p{N}+$/u.test(next) ? fold(w) : w;
  });
}

/** Nome de domínio de aposta sem o TLD (`estrelabet`), escrito em palavras seguidas; só a palavra inteira conta. */
function hasBrandSpan(folded: string, lists: CompiledLists): boolean {
  const labels = new Set(lists.betDomains.map((d) => d.split('.')[0] ?? '').filter((l) => l.length >= 4));
  const ws = folded.split(/[^a-z0-9]+/).filter(Boolean);
  for (let i = 0; i < ws.length; i += 1) {
    let span = '';
    for (let j = i; j < ws.length && span.length < 40; j += 1) {
      span += ws[j];
      if (labels.has(span)) return true;
    }
  }
  return false;
}

function hostLatinContext(host: string): boolean {
  const ls = host.split('.');
  if (ls.some((l) => /[a-z]/.test(l) && /[^\p{Script=Latin}\P{L}]/u.test(l))) return true;
  return (
    ls.some((l) => l.length > 1 && [...l].every((c) => c in LOOKALIKE)) &&
    ls.slice(0, -1).some((l) => /[a-z]/.test(l))
  );
}

/** Host em Unicode: o `URL` devolve `xn--…` (punycode) e esconde a letra cirílica de `bеt365.com`. */
function unicodeHost(host: string): string {
  return host
    .split('.')
    .map((label) => {
      if (!label.startsWith('xn--')) return label;
      try {
        return decodePunycode(label.slice(4));
      } catch {
        return label;
      }
    })
    .join('.');
}

/** Decodificador de punycode (RFC 3492), sem depender de `node:url` (a tela do Cliente usa este arquivo). */
function decodePunycode(input: string): string {
  const base = 36;
  const tMin = 1;
  const tMax = 26;
  const adapt = (delta: number, points: number, first: boolean) => {
    let d = first ? Math.floor(delta / 700) : delta >> 1;
    d += Math.floor(d / points);
    let k = 0;
    while (d > ((base - tMin) * tMax) >> 1) {
      d = Math.floor(d / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * d) / (d + 38));
  };
  const digit = (c: number) => (c >= 48 && c <= 57 ? c - 22 : c >= 97 && c <= 122 ? c - 97 : -1);
  const src = input.toLowerCase();
  const out: number[] = [];
  const dash = src.lastIndexOf('-');
  for (let j = 0; j < Math.max(dash, 0); j += 1) out.push(src.charCodeAt(j));
  let n = 128;
  let i = 0;
  let bias = 72;
  for (let idx = dash > 0 ? dash + 1 : 0; idx < input.length;) {
    const old = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (idx >= src.length) throw new Error('punycode');
      const d = digit(src.charCodeAt(idx++));
      if (d < 0) throw new Error('punycode');
      i += d * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (d < t) break;
      w *= base - t;
    }
    bias = adapt(i - old, out.length + 1, old === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    out.splice(i, 0, n);
    i += 1;
  }
  return String.fromCodePoint(...out);
}

/** `bet` como palavra solta (`Vai de Bet`, `Bet 365`, `/bet`). */
const LOOSE_BET = /(?:^|[^a-z0-9])bet(?:[^a-z]|$)/;

const betScreen = (text: string, lists: CompiledLists) =>
  screen(text, { kind: 'wall_post' }, lists).reasons.includes('betting');

/**
 * Aposta no nome ou no link, pelas listas da Galaxie (termos de aposta e domínios de aposta). Mais rígido que o chat:
 * confere também o texto todo junto (`Estrela Bet` → `estrelabet`) contra os termos e os nomes dos domínios de
 * aposta, e `bet` como palavra solta (`Vai de Bet`, `Bet 365`).
 */
export function looksLikeBetting(text: string, lists: CompiledLists, latinContext = true): boolean {
  if (!text.trim()) return false;
  if (betScreen(text, lists)) return true;
  const folded = foldLookalikes(text, latinContext ? 'context' : 'strict');
  if (LOOSE_BET.test(folded)) return true;
  const joined = folded.replace(/[^a-z0-9]+/g, '');
  if (joined && betScreen(joined, lists)) return true;
  // `Estrela Bet`, e a marca toda em letras parecidas (`ЅТАКЕ`), só contra o nome completo
  return hasBrandSpan(folded, lists) || hasBrandSpan(foldLookalikes(text, 'all'), lists);
}

function hostOf(url: string): string {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return '';
  }
}

/**
 * Confere e normaliza o cadastro. Devolve o patrocinador pronto para gravar ou a lista de problemas. A tela
 * mostra os problemas; o servidor chama de novo antes de gravar.
 */
export function validateSponsor(
  input: SponsorInput,
  lists: CompiledLists,
): { ok: true; sponsor: Sponsor } | { ok: false; issues: SponsorIssue[] } {
  const issues: SponsorIssue[] = [];
  const name = String(input.name ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) issues.push({ field: 'name', code: 'name' });
  else if (looksLikeBetting(name, lists)) issues.push({ field: 'name', code: 'betting' });

  // categoria fora da lista é recusada, inclusive `betting` mandado à mão
  if (!isSponsorCategory(input.category))
    issues.push({
      field: 'category',
      code: /bet|aposta|apuesta|casino|cassino|loter/i.test(String(input.category)) ? 'betting' : 'category',
    });

  const urls = {} as Record<'linkUrl' | 'logoLightUrl' | 'logoDarkUrl', string | null>;
  for (const field of ['linkUrl', 'logoLightUrl', 'logoDarkUrl'] as const) {
    const v = httpsUrl(input[field]);
    if (v === undefined) issues.push({ field, code: 'url' });
    else urls[field] = v;
  }
  // link e logos: domínio de aposta, aposta no caminho ou na query (`?r=https://bet365.com`) e, no link, encurtador
  for (const field of ['linkUrl', 'logoLightUrl', 'logoDarkUrl'] as const) {
    const url = urls[field];
    if (!url) continue;
    const host = hostOf(url);
    const inList = (list: readonly string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));
    // decodifica até três vezes (`%2562` → `%62` → `b`)
    let decoded = url;
    for (let k = 0; k < 3; k += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    // domínio em punycode também dentro da query (`?r=https://xn--bt365-zwe.com`)
    const rest = decoded
      .replace(/^https:\/\/[^/?#]+/i, '')
      .replace(/xn--[a-z0-9-]+/gi, (label) => unicodeHost(label.toLowerCase()));
    const path = foldLookalikes(rest);
    const uHost = unicodeHost(host);
    if (
      inList(lists.betDomains) ||
      // contexto latino: rótulo que mistura escritas (`bеt365`), ou rótulo só de letras parecidas ao lado de um
      // rótulo latino fora o TLD (`вет.estrela.com`); `shop.вет-клиника.com` e `вет.com` ficam como estão
      looksLikeBetting(uHost, lists, hostLatinContext(uHost)) ||
      // caminho e query só no link da peça (nome de arquivo de logo em CDN é aleatório): termo de aposta, o termo
      // escrito em palavras (`?y=estrela%20bet`), `bet` solto, palavra de aposta (`/apostas`) e marca inteira
      (field === 'linkUrl' &&
        // redirecionamento para domínio de aposta (`?r=https://stake.com`)
        ([...rest.matchAll(/(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}/gu)].some((m) => {
          const d = normalizeDomain(foldLookalikes(m[0], 'all'));
          return lists.betDomains.some((b) => d === b || d.endsWith(`.${b}`));
        }) ||
          betScreen(path.replace(/[^\p{L}\p{N}]+/gu, ' '), lists) ||
          LOOSE_BET.test(path) ||
          path
            .split(/[/?#&=]+/)
            .some((seg) => seg.length > 3 && betScreen(seg.replace(/[^\p{L}\p{N}]+/gu, ''), lists)) ||
          BET_PATH.test(path) ||
          // a marca inteira só quando há letra fora do latino: `/produtos/blaze-ipa` é palavra comum
          (/[^\p{Script=Latin}\P{L}]/u.test(rest) && hasBrandSpan(foldLookalikes(rest, 'all'), lists))))
    )
      issues.push({ field, code: 'betting' });
    else if (field === 'linkUrl' && inList(LINK_HIDERS)) issues.push({ field, code: 'shortener' });
  }

  const countries = [...new Set((input.countries ?? []).map((c) => String(c).trim().toUpperCase()))];
  if (countries.length > MAX_COUNTRIES || countries.some((c) => !isCountry(c)))
    issues.push({ field: 'countries', code: 'countries' });

  const date = (v: string | null) => {
    if (v === null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    // `2026-02-30` vira 2 de março no `Date`: o dia escrito tem de ser o mesmo
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (ymd) {
      const [y, m, day] = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3])];
      const probe = new Date(Date.UTC(y, m - 1, day));
      if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== day) return undefined;
    }
    return d.toISOString();
  };
  const startsAt = date(input.startsAt);
  const endsAt = date(input.endsAt);
  if (startsAt === undefined) issues.push({ field: 'startsAt', code: 'dates' });
  if (endsAt === undefined) issues.push({ field: 'endsAt', code: 'dates' });
  if (startsAt && endsAt && endsAt <= startsAt) issues.push({ field: 'endsAt', code: 'dates' });

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    sponsor: {
      name,
      category: input.category as SponsorCategory,
      linkUrl: urls.linkUrl ?? null,
      logoLightUrl: urls.logoLightUrl ?? null,
      logoDarkUrl: urls.logoDarkUrl ?? null,
      countries: countries.sort(),
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
    },
  };
}

/** Categorias que só aparecem para `18plus`, em qualquer país e qualquer que seja a ficha. */
export const ADULT_ONLY_SPONSOR_CATEGORIES: readonly SponsorCategory[] = ['alcohol'];

/**
 * Palavras de bebida alcoólica em pt, es e en, sem marca. `exact`: só a palavra inteira (`gin`, não `ginástica`);
 * `stems`: o começo da palavra (`cervejaria`, `wines`).
 */
const ALCOHOL_EXACT = new Set([
  'gin',
  'rum',
  'ron',
  'sake',
  'vino',
  'vinos',
  'pisco',
  'mezcal',
  'fernet',
  'chope',
]);
const ALCOHOL_STEMS = [
  'cervej',
  'cervec',
  'beer',
  'brew',
  'chopp',
  'vinho',
  'vinic',
  'wine',
  'whisk',
  'vodk',
  'tequil',
  'cachac',
  'aguardent',
  'licor',
  'liqueur',
  'liquor',
  'destil',
  'distill',
  'sidra',
  'cider',
  'champag',
  'espumant',
  'prosecc',
];

/**
 * O nome ou o link parecem de bebida alcoólica? É só sugestão para a tela marcar `alcohol`: quem cadastra decide, e
 * nada é recusado por isso.
 */
export function suggestsAlcohol(name: string, linkUrl: string | null = null): boolean {
  const words = `${name} ${linkUrl ?? ''}`
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((w) => ALCOHOL_EXACT.has(w) || ALCOHOL_STEMS.some((stem) => w.startsWith(stem)));
}

/**
 * A peça do patrocinador pode aparecer para este torcedor agora? `policy` é a ficha do país do torcedor
 * (B5); sem ficha, menores ficam de fora. Bebida alcoólica (`alcohol`) só para `18plus`, mesmo com `adsToMinors`.
 */
export function sponsorVisible(
  sponsor: Pick<Sponsor, 'category' | 'countries' | 'startsAt' | 'endsAt'> & { archived?: boolean },
  viewer: { country: string; ageBand: 'under13' | '13_17' | '18plus'; now: Date },
  policy: Pick<CountryPolicy, 'adsToMinors'> | null,
): boolean {
  if (sponsor.archived) return false;
  if (viewer.ageBand === 'under13') return false;
  // bebida alcoólica: só maiores de 18, em qualquer país, mesmo onde a ficha permite publicidade a menores
  if (viewer.ageBand !== '18plus' && ADULT_ONLY_SPONSOR_CATEGORIES.includes(sponsor.category)) return false;
  if (viewer.ageBand === '13_17' && !policy?.adsToMinors) return false;
  const country = viewer.country.toUpperCase();
  if (sponsor.countries.length && !sponsor.countries.includes(country)) return false;
  const t = viewer.now.getTime();
  if (sponsor.startsAt && t < new Date(sponsor.startsAt).getTime()) return false;
  if (sponsor.endsAt && t >= new Date(sponsor.endsAt).getTime()) return false;
  return true;
}
