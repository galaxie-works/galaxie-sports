/**
 * Normalização do nome do canal do cliente, antes de qualquer casamento: prefixo de país ("BR:",
 * "ARG |", "[MEX]"), marca de praça ("|SP|", "GLOBO RJ"), qualidade (HD/SD/4K/FHD), "VOD" e número de
 * feed ("ESPN 2"). Praça não vira dado: só sai do nome (a geolocalização é da operadora).
 */
import type { WtwCountry } from '../config/types.js';
import type { ChannelFacts, ClientChannel } from './types.js';

const COUNTRY_TOKENS: Record<string, WtwCountry> = {
  BR: 'BR',
  BRA: 'BR',
  BRASIL: 'BR',
  BRAZIL: 'BR',
  AR: 'AR',
  ARG: 'AR',
  ARGENTINA: 'AR',
  MX: 'MX',
  MEX: 'MX',
  MEXICO: 'MX',
  CO: 'CO',
  COL: 'CO',
  COLOMBIA: 'CO',
  CL: 'CL',
  CHI: 'CL',
  CHL: 'CL',
  CHILE: 'CL',
  PE: 'PE',
  PER: 'PE',
  PERU: 'PE',
  UY: 'UY',
  URU: 'UY',
  URUGUAY: 'UY',
  EC: 'EC',
  ECU: 'EC',
  ECUADOR: 'EC',
};
/** País por extenso no fim do nome ("FOX SPORTS ARGENTINA"). */
const COUNTRY_WORDS = new Set([
  'BRASIL',
  'BRAZIL',
  'ARGENTINA',
  'MEXICO',
  'COLOMBIA',
  'CHILE',
  'PERU',
  'URUGUAY',
  'ECUADOR',
]);
/** Pan-regional no meio ou no fim do nome (sem as siglas curtas, que só valem como prefixo). */
const PAN_WORDS = new Set(['LATAM', 'LATINOAMERICA', 'PANREGIONAL']);
const PAN_TOKENS = new Set([
  'LATAM',
  'LAT',
  'LATIN',
  'LATINO',
  'LATINOAMERICA',
  'LA',
  'INT',
  'INTL',
  'PANREGIONAL',
]);
/** UFs do Brasil (marca de praça). "PE" também é o Peru: como prefixo vale o país, no fim vale a praça. */
const UFS = new Set(
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '),
);
/** Praças por extenso que aparecem nas listas (só BR; o resto do nome continua). */
const PRACA_WORDS = [
  'SAO PAULO',
  'RIO DE JANEIRO',
  'RIO',
  'MINAS',
  'MINAS GERAIS',
  'BRASILIA',
  'NORDESTE',
  'CAMPINAS',
  'RECIFE',
  'SALVADOR',
  'BELO HORIZONTE',
  'PORTO ALEGRE',
  'CURITIBA',
  'FORTALEZA',
  'GOIANIA',
  'BELEM',
  'MANAUS',
].map((w) => w.split(' '));
const QUALITY = new Set([
  'HD',
  'SD',
  'FHD',
  'UHD',
  'HQ',
  'LQ',
  '4K',
  '8K',
  'HEVC',
  'H265',
  'H264',
  '1080P',
  '720P',
  '1080',
  '720',
  '60FPS',
  'FULLHD',
]);

/** Maiúsculas sem acento, com o `+` colado ("WIN SPORTS +" → "WIN SPORTS+"). */
function fold(s: string): string {
  return s
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+\+/g, '+');
}

const tokensOf = (s: string) =>
  s
    .replace(/[|[\](){}_,;/\\•·»«*~"']+/g, ' ')
    .replace(/(^|\s)[-:.]+(?=\s|$)/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[-:.]+|[-:.]+$/g, ''))
    .filter(Boolean);

/** Prefixo "XX:", "XX |", "XX -", "[XX]", "(XX)" ou "|XX|" no início; null se não houver. */
const PREFIX =
  /^\s*(?:\[([^\]]{1,20})\]|\(([^)]{1,20})\)|\|([^|]{1,20})\||([A-Z0-9]{2,14})\s*(?::|\||-(?=\s)|»))\s*/;

interface Classified {
  country: WtwCountry | null;
  pan: boolean;
  vod: boolean;
  praca: string | null;
  quality: string | null;
}

function classifyPrefixToken(token: string, acc: Classified): boolean {
  const t = token.trim().replace(/\s+/g, ' ');
  if (COUNTRY_TOKENS[t] && !acc.country) acc.country = COUNTRY_TOKENS[t]!;
  else if (PAN_TOKENS.has(t)) acc.pan = true;
  else if (t === 'VOD') acc.vod = true;
  else if (QUALITY.has(t)) acc.quality ??= t;
  else if (UFS.has(t) && (acc.country === 'BR' || !acc.country)) acc.praca ??= t;
  else return false;
  return true;
}

/** País de um `group-title` ("BRASIL | ESPORTES", "ARG - DEPORTES"), se houver. */
export function countryOfGroup(group: string | null): { country: WtwCountry | null; vod: boolean } {
  if (!group) return { country: null, vod: false };
  const toks = tokensOf(fold(group));
  const country = toks.map((t) => COUNTRY_TOKENS[t]).find(Boolean) ?? null;
  return { country, vod: toks.includes('VOD') };
}

/** Fatos do canal: país, pan-regional, VOD, praça, qualidade, feed e o nome limpo. */
export function analyzeChannel(
  channel: ClientChannel,
  defaultCountry: WtwCountry | null = null,
): ChannelFacts {
  const acc: Classified = { country: null, pan: false, vod: false, praca: null, quality: null };
  let rest = fold(channel.name);
  // prefixos em sequência: "BR: |SP| GLOBO", "[LATAM] ESPN"
  for (let i = 0; i < 4; i++) {
    const m = PREFIX.exec(rest);
    if (!m) break;
    const token = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (!classifyPrefixToken(token, acc)) break;
    rest = rest.slice(m[0].length);
  }
  let tokens = tokensOf(rest);
  // VOD e qualidade em qualquer posição; marcas entre barras no meio ("GLOBO |SP| HD") viram praça
  tokens = tokens.filter((t) => {
    if (t === 'VOD') return !(acc.vod = true);
    // pan-regional em qualquer posição ("ESPN 2 LATAM")
    if (PAN_WORDS.has(t)) return !(acc.pan = true);
    if (QUALITY.has(t) || /^(HD|FHD|UHD)\+?$/.test(t)) {
      acc.quality ??= t;
      return false;
    }
    return true;
  });
  // fim do nome: praça (BR ou sem país), país por extenso; o que sobrar é a marca
  let brandTokens = [...tokens];
  for (let changed = true; changed && brandTokens.length > 1;) {
    changed = false;
    const last = brandTokens.at(-1)!;
    const brOrUnknown = acc.country === 'BR' || !acc.country;
    if (brOrUnknown && UFS.has(last)) {
      acc.praca ??= last;
      brandTokens.pop();
      changed = true;
      continue;
    }
    if (brOrUnknown) {
      const w = PRACA_WORDS.find(
        (p) =>
          p.length < brandTokens.length &&
          p.every((x, i) => brandTokens[brandTokens.length - p.length + i] === x),
      );
      if (w) {
        acc.praca ??= w.join(' ');
        brandTokens = brandTokens.slice(0, -w.length);
        changed = true;
        continue;
      }
    }
    if (COUNTRY_WORDS.has(last)) {
      acc.country ??= COUNTRY_TOKENS[last]!;
      // a marca segue sem o país; `base` mantém ("SEÑAL COLOMBIA" casa pelo nome inteiro)
      brandTokens.pop();
      changed = true;
    }
  }
  const base = tokens.join(' ') || fold(channel.name);
  const brand = brandTokens.join(' ') || base;
  const feedMatch = /^(.+?)\s([1-9])$/.exec(brand);

  const group = countryOfGroup(channel.group);
  let countryFrom: ChannelFacts['countryFrom'] = acc.country ? 'nome' : null;
  let country = acc.country;
  if (!country && !acc.pan && group.country) {
    country = group.country;
    countryFrom = 'grupo';
  }
  if (!country && !acc.pan && defaultCountry) {
    country = defaultCountry;
    countryFrom = 'lista';
  }
  return {
    ...channel,
    country,
    countryFrom,
    pan: acc.pan,
    vod: acc.vod || group.vod,
    praca: acc.praca,
    quality: acc.quality,
    feed: feedMatch?.[2] ?? null,
    base,
    brand,
    brandNoFeed: feedMatch?.[1] ?? brand,
  };
}
