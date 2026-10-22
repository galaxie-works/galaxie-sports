/**
 * Fuso IANA do local da partida, só para exibição (docs/05 §3.2.1): os instantes da API vêm sempre em
 * UTC e o relógio de jogo em campos separados. O banco não guarda o fuso do local; ele sai do país (do
 * local ou, sem ele, do mandante/competição) e, nos países com mais de um fuso, da cidade. Sem certeza
 * (país com vários fusos e cidade desconhecida) → null.
 */

/** País com um fuso só (ou um fuso que cobre praticamente todos os estádios). */
const COUNTRY_TZ: Readonly<Record<string, string>> = {
  AR: 'America/Argentina/Buenos_Aires',
  BO: 'America/La_Paz',
  CL: 'America/Santiago',
  CO: 'America/Bogota',
  EC: 'America/Guayaquil',
  PY: 'America/Asuncion',
  PE: 'America/Lima',
  UY: 'America/Montevideo',
  VE: 'America/Caracas',
  CR: 'America/Costa_Rica',
  GT: 'America/Guatemala',
  HN: 'America/Tegucigalpa',
  SV: 'America/El_Salvador',
  NI: 'America/Managua',
  PA: 'America/Panama',
  DO: 'America/Santo_Domingo',
  JM: 'America/Jamaica',
  BR: 'America/Sao_Paulo',
  MX: 'America/Mexico_City',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon',
  IT: 'Europe/Rome',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  CH: 'Europe/Zurich',
  AT: 'Europe/Vienna',
  GR: 'Europe/Athens',
  TR: 'Europe/Istanbul',
  SA: 'Asia/Riyadh',
  QA: 'Asia/Qatar',
  AE: 'Asia/Dubai',
  JP: 'Asia/Tokyo',
};

/**
 * Cidades fora do fuso padrão do país (nome sem acento, minúsculo). Para os EUA (vários fusos e sem
 * padrão), só as cidades listadas resolvem.
 */
const CITY_TZ: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  BR: {
    manaus: 'America/Manaus',
    cuiaba: 'America/Cuiaba',
    'varzea grande': 'America/Cuiaba',
    'campo grande': 'America/Campo_Grande',
    'porto velho': 'America/Porto_Velho',
    'rio branco': 'America/Rio_Branco',
    'boa vista': 'America/Boa_Vista',
    belem: 'America/Belem',
    fortaleza: 'America/Fortaleza',
    recife: 'America/Recife',
    salvador: 'America/Bahia',
    maceio: 'America/Maceio',
  },
  MX: {
    tijuana: 'America/Tijuana',
    hermosillo: 'America/Hermosillo',
    mazatlan: 'America/Mazatlan',
    culiacan: 'America/Mazatlan',
    chihuahua: 'America/Chihuahua',
    'ciudad juarez': 'America/Ciudad_Juarez',
    cancun: 'America/Cancun',
    monterrey: 'America/Monterrey',
  },
  ES: { 'las palmas': 'Atlantic/Canary', 'santa cruz de tenerife': 'Atlantic/Canary' },
  PT: { funchal: 'Atlantic/Madeira', 'ponta delgada': 'Atlantic/Azores' },
  US: {
    'new york': 'America/New_York',
    'east rutherford': 'America/New_York',
    harrison: 'America/New_York',
    philadelphia: 'America/New_York',
    chester: 'America/New_York',
    foxborough: 'America/New_York',
    boston: 'America/New_York',
    washington: 'America/New_York',
    atlanta: 'America/New_York',
    miami: 'America/New_York',
    'miami gardens': 'America/New_York',
    'fort lauderdale': 'America/New_York',
    orlando: 'America/New_York',
    charlotte: 'America/New_York',
    columbus: 'America/New_York',
    cincinnati: 'America/New_York',
    nashville: 'America/Chicago',
    chicago: 'America/Chicago',
    bridgeview: 'America/Chicago',
    houston: 'America/Chicago',
    dallas: 'America/Chicago',
    frisco: 'America/Chicago',
    arlington: 'America/Chicago',
    'kansas city': 'America/Chicago',
    'saint paul': 'America/Chicago',
    'st. louis': 'America/Chicago',
    austin: 'America/Chicago',
    denver: 'America/Denver',
    'commerce city': 'America/Denver',
    sandy: 'America/Denver',
    'salt lake city': 'America/Denver',
    'los angeles': 'America/Los_Angeles',
    carson: 'America/Los_Angeles',
    inglewood: 'America/Los_Angeles',
    pasadena: 'America/Los_Angeles',
    'santa clara': 'America/Los_Angeles',
    'san jose': 'America/Los_Angeles',
    seattle: 'America/Los_Angeles',
    portland: 'America/Los_Angeles',
    'san diego': 'America/Los_Angeles',
  },
};

function cityKey(city: string): string {
  return (city.split(',')[0] ?? city)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Fuso de um país (e cidade), ou null sem certeza. `GB-ENG` e afins usam o fuso do Reino Unido. */
export function timezoneOf(country: string | null | undefined, city?: string | null): string | null {
  if (!country) return null;
  const code = country.toUpperCase().startsWith('GB') ? 'GB' : country.toUpperCase();
  const byCity = city ? CITY_TZ[code]?.[cityKey(city)] : undefined;
  return byCity ?? COUNTRY_TZ[code] ?? null;
}

/**
 * Fuso do local: o primeiro país conhecido da lista (local, mandante, competição), com a cidade do local.
 * "WORLD" e afins (competições internacionais) não contam.
 */
export function venueTimezone(countries: (string | null | undefined)[], city: string | null | undefined) {
  for (const c of countries) {
    if (!c || c.toUpperCase() === 'WORLD') continue;
    return timezoneOf(c, city);
  }
  return null;
}
