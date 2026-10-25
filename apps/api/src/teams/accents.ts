/**
 * Corretor de acentos dos nomes de time do fornecedor, para os times sem nome curado na base semântica.
 *
 * O fornecedor manda muitos nomes sem acento ("Sao Paulo", "Gremio", "Leon"). Aqui só se corrige o que está
 * numa lista explícita, por idioma do país do time: português (Brasil, Portugal, Angola, Moçambique) ou
 * espanhol (Espanha e América hispânica). Nunca há heurística aberta: palavra fora da lista fica como veio,
 * e time de país de outro idioma (ou sem país) também.
 *
 * Cada entrada é uma palavra inteira, sem acento, em minúsculas, e o seu acento no idioma. A palavra só é
 * trocada quando aparece inteira e só com letras ASCII (não encosta em outra letra): "Atlético" já
 * acentuado não muda, e "Saoense" não vira "Sãoense". A caixa do original é mantida (SAO → SÃO).
 */

type Lang = 'pt' | 'es';

/** Países de língua portuguesa com times na base. */
const PT_COUNTRIES = new Set(['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL']);
/** Países de língua espanhola (Espanha e América hispânica). */
const ES_COUNTRIES = new Set([
  'ES',
  'AR',
  'BO',
  'CL',
  'CO',
  'CR',
  'CU',
  'DO',
  'EC',
  'GQ',
  'GT',
  'HN',
  'MX',
  'NI',
  'PA',
  'PE',
  'PR',
  'PY',
  'SV',
  'UY',
  'VE',
]);

/** Palavras com a mesma grafia no Brasil e em Portugal. */
const PT_WORDS: Record<string, string> = {
  agua: 'água',
  aguia: 'águia',
  aimore: 'aimoré',
  alianca: 'aliança',
  america: 'américa',
  anapolis: 'anápolis',
  andre: 'andré',
  araguaina: 'araguaína',
  araucaria: 'araucária',
  atletica: 'atlética',
  atletico: 'atlético',
  avai: 'avaí',
  batalhao: 'batalhão',
  bonifacio: 'bonifácio',
  brandao: 'brandão',
  brasilia: 'brasília',
  caete: 'caeté',
  camacari: 'camaçari',
  camboriu: 'camboriú',
  cameta: 'cametá',
  canaa: 'canaã',
  capitao: 'capitão',
  carmopolis: 'carmópolis',
  ceara: 'ceará',
  ceilandia: 'ceilândia',
  concordia: 'concórdia',
  confianca: 'confiança',
  coracoes: 'corações',
  covilha: 'covilhã',
  criciuma: 'criciúma',
  cuiaba: 'cuiabá',
  decisao: 'decisão',
  esperanca: 'esperança',
  famalicao: 'famalicão',
  ferroviaria: 'ferroviária',
  ferroviario: 'ferroviário',
  gaucho: 'gaúcho',
  gaviao: 'gavião',
  gloria: 'glória',
  goianesia: 'goianésia',
  goiania: 'goiânia',
  goias: 'goiás',
  guaratingueta: 'guaratinguetá',
  guimaraes: 'guimarães',
  hercilio: 'hercílio',
  humaita: 'humaitá',
  iguacu: 'iguaçu',
  ilheus: 'ilhéus',
  independencia: 'independência',
  itaborai: 'itaboraí',
  jatai: 'jataí',
  jau: 'jaú',
  jequie: 'jequié',
  joao: 'joão',
  jose: 'josé',
  legiao: 'legião',
  leixoes: 'leixões',
  lusitania: 'lusitânia',
  luziania: 'luziânia',
  macae: 'macaé',
  maraba: 'marabá',
  maracana: 'maracanã',
  maranhao: 'maranhão',
  marcilio: 'marcílio',
  marica: 'maricá',
  marilia: 'marília',
  maringa: 'maringá',
  maritimo: 'marítimo',
  maua: 'mauá',
  mazagao: 'mazagão',
  mourao: 'mourão',
  nautico: 'náutico',
  olimpica: 'olímpica',
  olimpico: 'olímpico',
  operario: 'operário',
  pacos: 'paços',
  parana: 'paraná',
  paranoa: 'paranoá',
  parnaiba: 'parnaíba',
  paulinia: 'paulínia',
  petropolis: 'petrópolis',
  piaui: 'piauí',
  placido: 'plácido',
  pocone: 'poconé',
  quixada: 'quixadá',
  redencao: 'redenção',
  rondonia: 'rondônia',
  rondonopolis: 'rondonópolis',
  sao: 'são',
  sertaozinho: 'sertãozinho',
  setubal: 'setúbal',
  solimoes: 'solimões',
  tapajos: 'tapajós',
  taua: 'tauá',
  taubate: 'taubaté',
  tiangua: 'tianguá',
  tocantinopolis: 'tocantinópolis',
  tres: 'três',
  tupa: 'tupã',
  uberlandia: 'uberlândia',
  unai: 'unaí',
  uniao: 'união',
  vitoria: 'vitória',
};

/** Grafias que mudam entre o Brasil (ê, ô) e Portugal (é, ó). */
const PT_BR_WORDS: Record<string, string> = { antonio: 'antônio', gremio: 'grêmio' };
const PT_PT_WORDS: Record<string, string> = {
  academica: 'académica',
  academico: 'académico',
  antonio: 'antónio',
  gremio: 'grémio',
};

const ES_WORDS: Record<string, string> = {
  aguila: 'águila',
  aguilas: 'águilas',
  alaves: 'alavés',
  alcorcon: 'alcorcón',
  almeria: 'almería',
  america: 'américa',
  ancash: 'áncash',
  anzoategui: 'anzoátegui',
  arabe: 'árabe',
  asuncion: 'asunción',
  atletico: 'atlético',
  avila: 'ávila',
  bogota: 'bogotá',
  bolivar: 'bolívar',
  boyaca: 'boyacá',
  caacupe: 'caacupé',
  cadiz: 'cádiz',
  cancun: 'cancún',
  cartagines: 'cartaginés',
  castellon: 'castellón',
  catolica: 'católica',
  colon: 'colón',
  concepcion: 'concepción',
  copiapo: 'copiapó',
  cordoba: 'córdoba',
  cortulua: 'cortuluá',
  coruna: 'coruña',
  cristobal: 'cristóbal',
  cucuta: 'cúcuta',
  cumbaya: 'cumbayá',
  curico: 'curicó',
  delfin: 'delfín',
  encarnacion: 'encarnación',
  espanol: 'español',
  espanola: 'española',
  fenix: 'fénix',
  fernandez: 'fernández',
  fundacion: 'fundación',
  gijon: 'gijón',
  guabira: 'guabirá',
  guaira: 'guairá',
  guarani: 'guaraní',
  guemes: 'güemes',
  huracan: 'huracán',
  inclan: 'inclán',
  jose: 'josé',
  juarez: 'juárez',
  junin: 'junín',
  lanus: 'lanús',
  leganes: 'leganés',
  leon: 'león',
  logrones: 'logroñés',
  lujan: 'luján',
  luqueno: 'luqueño',
  macara: 'macará',
  malaga: 'málaga',
  mazatlan: 'mazatlán',
  medellin: 'medellín',
  merida: 'mérida',
  mexico: 'méxico',
  mirandes: 'mirandés',
  moron: 'morón',
  mostoles: 'móstoles',
  nublense: 'ñublense',
  olimpico: 'olímpico',
  pacifico: 'pacífico',
  panama: 'panamá',
  parana: 'paraná',
  paysandu: 'paysandú',
  penarol: 'peñarol',
  perez: 'pérez',
  peru: 'perú',
  porteno: 'porteño',
  potosi: 'potosí',
  queretaro: 'querétaro',
  quindio: 'quindío',
  ramon: 'ramón',
  rincon: 'rincón',
  rio: 'río',
  suarez: 'suárez',
  tachira: 'táchira',
  tacuarembo: 'tacuarembó',
  tecnico: 'técnico',
  tristan: 'tristán',
  tucuman: 'tucumán',
  union: 'unión',
  valparaiso: 'valparaíso',
  velez: 'vélez',
  vigia: 'vigía',
  vina: 'viña',
  xelaju: 'xelajú',
  zeledon: 'zeledón',
};

/**
 * Expressões de mais de uma palavra, quando a palavra sozinha é ambígua (Martin é nome comum; San Martín,
 * não). Aplicadas antes das palavras soltas, com a mesma regra de palavra inteira.
 */
const ES_PHRASES: Record<string, string> = { 'san martin': 'san martín' };
const PT_PHRASES: Record<string, string> = { 'sampaio correa': 'sampaio corrêa' };

interface Dictionary {
  words: Record<string, string>;
  phrases: Record<string, string>;
}

const DICTIONARIES: Record<string, Dictionary> = {
  'pt-BR': { words: { ...PT_WORDS, ...PT_BR_WORDS }, phrases: PT_PHRASES },
  'pt-PT': { words: { ...PT_WORDS, ...PT_PT_WORDS }, phrases: {} },
  es: { words: ES_WORDS, phrases: ES_PHRASES },
};

/** Dicionário do país do time: português (de Portugal ou do Brasil) ou espanhol; null nos outros. */
function dictionaryOf(countryCode: string | null | undefined): Dictionary | null {
  const code = countryCode?.toUpperCase();
  if (!code) return null;
  if (code === 'PT') return DICTIONARIES['pt-PT']!;
  if (PT_COUNTRIES.has(code)) return DICTIONARIES['pt-BR']!;
  if (ES_COUNTRIES.has(code)) return DICTIONARIES.es!;
  return null;
}

/** Idioma do corretor para o país (pt, es) ou null quando ele não se aplica. */
export function accentLanguage(countryCode: string | null | undefined): Lang | null {
  const code = countryCode?.toUpperCase();
  if (!code) return null;
  if (PT_COUNTRIES.has(code)) return 'pt';
  return ES_COUNTRIES.has(code) ? 'es' : null;
}

/** Aplica ao acento a caixa do original: tudo maiúsculo, primeira maiúscula ou tudo minúsculo. */
function withCase(original: string, accented: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return accented.toUpperCase();
  const first = original[0]!;
  return first === first.toUpperCase() ? accented[0]!.toUpperCase() + accented.slice(1) : accented;
}

/** Palavra inteira de letras ASCII: não pode encostar em outra letra (acentuada ou não). */
const WORD = /(?<!\p{L})[A-Za-z]+(?!\p{L})/gu;

function replacePhrases(name: string, phrases: Record<string, string>): string {
  let out = name;
  for (const [plain, accented] of Object.entries(phrases)) {
    const re = new RegExp(`(?<!\\p{L})${plain.replace(/ /g, '\\s+')}(?!\\p{L})`, 'giu');
    out = out.replace(re, (m) => {
      const parts = m.split(/(\s+)/);
      const target = accented.split(' ');
      let i = 0;
      return parts.map((p) => (/^\s+$/.test(p) ? p : withCase(p, target[i++] ?? p))).join('');
    });
  }
  return out;
}

/**
 * Nome do fornecedor com os acentos da lista do idioma do país (pt ou es). País de outro idioma ou
 * desconhecido: o nome volta igual.
 */
export function accentTeamName(name: string, countryCode: string | null | undefined): string {
  const dict = dictionaryOf(countryCode);
  if (!dict || !name) return name;
  return replacePhrases(name, dict.phrases).replace(WORD, (token) => {
    const accented = dict.words[token.toLowerCase()];
    return accented ? withCase(token, accented) : token;
  });
}
