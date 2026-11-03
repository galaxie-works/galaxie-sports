/**
 * Nome de competição: nome de campeonato não se traduz nem se inventa.
 *
 * - Competição **nacional** (com país) sai com o nome no idioma do próprio país em qualquer locale: Copa do
 *   Brasil, Brasileirão Série A, Primera División, Premier League, Bundesliga — para quem lê em pt-BR, es-XX
 *   ou en. País sem idioma mapeado (Japão, Arábia Saudita…) usa o rótulo `en` e, sem ele, o nome oficial do
 *   fornecedor.
 * - Competição **continental ou mundial** (país `WORLD`, região ou nenhum) continua com o rótulo oficial da
 *   entidade em cada idioma, pela cadeia dos campos i18n (`es-XX → es → en`, `pt-BR → pt → en`): Copa
 *   Sul-Americana em pt-BR, Copa Sudamericana em es e en.
 *
 * O apelido (`nickname`) segue localizado como antes; a mudança é só na escolha do nome.
 */

/** Idiomas em que os rótulos (`labels`) são escritos. */
export type LabelLanguage = 'pt' | 'es' | 'en';

/**
 * Idioma dos nomes de competição por país (código da api-sports: ISO 3166-1 alfa-2 ou extensão como GB-ENG).
 * Um só lugar: a API e os agentes de IA leem daqui.
 */
const COUNTRIES_BY_LANGUAGE: Record<LabelLanguage, readonly string[]> = {
  pt: ['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL'],
  es: [
    'AR',
    'BO',
    'CL',
    'CO',
    'CR',
    'CU',
    'DO',
    'EC',
    'SV',
    'GT',
    'HN',
    'MX',
    'NI',
    'PA',
    'PY',
    'PE',
    'PR',
    'ES',
    'UY',
    'VE',
    'GQ',
  ],
  en: [
    'GB',
    'GB-ENG',
    'GB-SCT',
    'GB-WLS',
    'GB-NIR',
    'IE',
    'US',
    'CA',
    'AU',
    'NZ',
    'JM',
    'TT',
    'BB',
    'BS',
    'BZ',
    'GY',
    'AG',
    'DM',
    'GD',
    'KN',
    'LC',
    'VC',
    'ZA',
    'NG',
    'GH',
    'KE',
    'UG',
    'ZM',
    'ZW',
    'MW',
    'BW',
    'NA',
    'LR',
    'SL',
    'GM',
    'IN',
    'PK',
    'SG',
    'PH',
    'MT',
    'FJ',
    'PG',
  ],
};

const LANGUAGE_BY_COUNTRY = new Map<string, LabelLanguage>(
  (Object.keys(COUNTRIES_BY_LANGUAGE) as LabelLanguage[]).flatMap((lang) =>
    COUNTRIES_BY_LANGUAGE[lang].map((code) => [code, lang] as const),
  ),
);

/** Código de país (ISO2 ou extensão GB-ENG), e não `WORLD` nem região (`SOUTH-AMERICA`, `EUROPE`). */
const NATIONAL_CODE = /^[A-Z]{2}(-[A-Z]{3})?$/;

/** Idioma dos nomes de competição do país; null para país sem idioma mapeado, `WORLD` e regiões. */
export function countryLanguage(countryCode: string | null | undefined): LabelLanguage | null {
  if (!countryCode) return null;
  return LANGUAGE_BY_COUNTRY.get(countryCode.toUpperCase()) ?? null;
}

/** A competição é de um país (doméstica)? `WORLD`, regiões e sem país contam como internacional. */
export function isNationalCompetition(countryCode: string | null | undefined): boolean {
  return !!countryCode && NATIONAL_CODE.test(countryCode.toUpperCase());
}

type Labels = Record<string, string | null | undefined> | null | undefined;

const pick = (labels: Labels, keys: Iterable<string>): string | null => {
  if (!labels) return null;
  for (const k of keys) {
    const v = labels[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
};

/**
 * Nome da competição para o locale pedido (regra no topo do arquivo). `labels` é o mapa i18n já mesclado
 * (catálogo + perfil semântico); `officialName` é o nome do fornecedor (`core.competition.name`).
 */
export function competitionName(
  labels: Labels,
  countryCode: string | null | undefined,
  officialName: string,
  locale: string,
): string {
  if (!isNationalCompetition(countryCode)) {
    // internacional: a cadeia dos campos i18n (a mesma de `fallbackChain` em packages/knowledge)
    const lang = locale.split('-')[0]!;
    return pick(labels, new Set([locale, lang, 'en'])) ?? officialName;
  }
  const code = countryCode!.toUpperCase();
  const lang = countryLanguage(code);
  if (!lang) return pick(labels, ['en']) ?? officialName;
  // dentro do idioma do país: a variante do país (es-AR), o idioma (es), qualquer outra variante (es-MX)
  const iso2 = code.split('-')[0]!;
  const variants = Object.keys(labels ?? {}).filter((k) => k.startsWith(`${lang}-`));
  return pick(labels, new Set([`${lang}-${iso2}`, lang, ...variants, 'en'])) ?? officialName;
}
