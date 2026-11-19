/**
 * Fuso e moeda por país: um só lugar para a API, os agentes, as regras do jogo, o onde assistir e a demo.
 * Este arquivo não importa nada (roda no navegador pelo subcaminho `@galaxie/geo/country`).
 *
 * - `timeZone`: fuso de referência do país (o da capital ou do maior mercado). É o que decide o dia civil
 *   local (vigência de direitos, mês do Ranking, data do jogo no prompt).
 * - `singleTimeZone`: o fuso cobre praticamente todos os estádios. Falso nos países com vários fusos e sem
 *   um dominante (EUA, Canadá): quem precisa do fuso do *local* só resolve pela cidade.
 * - `currency`: moeda (ISO 4217) em que o país cobra (preço de pacote, complemento de canal).
 *
 * Todo mercado de config/geo (`markets`) tem de estar aqui; o teste do pacote cobra.
 */

export interface CountryFacts {
  timeZone: string;
  singleTimeZone: boolean;
  currency: string;
}

const one = (timeZone: string, currency: string): CountryFacts => ({
  timeZone,
  singleTimeZone: true,
  currency,
});
const many = (timeZone: string, currency: string): CountryFacts => ({
  timeZone,
  singleTimeZone: false,
  currency,
});

const FACTS: Readonly<Record<string, CountryFacts>> = Object.freeze({
  // América do Sul
  AR: one('America/Argentina/Buenos_Aires', 'ARS'),
  BO: one('America/La_Paz', 'BOB'),
  BR: one('America/Sao_Paulo', 'BRL'),
  CL: one('America/Santiago', 'CLP'),
  CO: one('America/Bogota', 'COP'),
  EC: one('America/Guayaquil', 'USD'),
  PE: one('America/Lima', 'PEN'),
  PY: one('America/Asuncion', 'PYG'),
  UY: one('America/Montevideo', 'UYU'),
  VE: one('America/Caracas', 'VES'),
  // América do Norte, Central e Caribe
  CA: many('America/Toronto', 'CAD'),
  CR: one('America/Costa_Rica', 'CRC'),
  CU: one('America/Havana', 'CUP'),
  DO: one('America/Santo_Domingo', 'DOP'),
  GT: one('America/Guatemala', 'GTQ'),
  HN: one('America/Tegucigalpa', 'HNL'),
  JM: one('America/Jamaica', 'JMD'),
  MX: one('America/Mexico_City', 'MXN'),
  NI: one('America/Managua', 'NIO'),
  PA: one('America/Panama', 'USD'),
  PR: one('America/Puerto_Rico', 'USD'),
  SV: one('America/El_Salvador', 'USD'),
  US: many('America/New_York', 'USD'),
  // Europa
  AT: one('Europe/Vienna', 'EUR'),
  BE: one('Europe/Brussels', 'EUR'),
  CH: one('Europe/Zurich', 'CHF'),
  DE: one('Europe/Berlin', 'EUR'),
  ES: one('Europe/Madrid', 'EUR'),
  FR: one('Europe/Paris', 'EUR'),
  GB: one('Europe/London', 'GBP'),
  'GB-ENG': one('Europe/London', 'GBP'),
  'GB-SCT': one('Europe/London', 'GBP'),
  'GB-WLS': one('Europe/London', 'GBP'),
  'GB-NIR': one('Europe/London', 'GBP'),
  GR: one('Europe/Athens', 'EUR'),
  IE: one('Europe/Dublin', 'EUR'),
  IT: one('Europe/Rome', 'EUR'),
  NL: one('Europe/Amsterdam', 'EUR'),
  PT: one('Europe/Lisbon', 'EUR'),
  TR: one('Europe/Istanbul', 'TRY'),
  // Ásia e Oriente Médio
  AE: one('Asia/Dubai', 'AED'),
  JP: one('Asia/Tokyo', 'JPY'),
  QA: one('Asia/Qatar', 'QAR'),
  SA: one('Asia/Riyadh', 'SAR'),
});

/** Países com fuso e moeda conhecidos (códigos da api-sports: ISO2 ou extensão como GB-ENG). */
export const COUNTRIES_WITH_FACTS: readonly string[] = Object.keys(FACTS);

/** Fuso, moeda e se o país tem um fuso só; null para país desconhecido, `WORLD` e regiões. */
export function countryFacts(countryCode: string | null | undefined): CountryFacts | null {
  if (!countryCode) return null;
  return FACTS[countryCode.toUpperCase()] ?? null;
}

/** Fuso de referência do país (capital ou maior mercado); null quando o país não está na lista. */
export function referenceTimeZone(countryCode: string | null | undefined): string | null {
  return countryFacts(countryCode)?.timeZone ?? null;
}

/** Fuso do país só quando ele cobre praticamente todos os estádios; null nos de vários fusos (resolver pela cidade). */
export function singleTimeZone(countryCode: string | null | undefined): string | null {
  const f = countryFacts(countryCode);
  return f?.singleTimeZone ? f.timeZone : null;
}

/** Moeda (ISO 4217) em que o país cobra; null quando o país não está na lista. */
export function countryCurrency(countryCode: string | null | undefined): string | null {
  return countryFacts(countryCode)?.currency ?? null;
}
