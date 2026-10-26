import { escapeRegExp, languageOf, normalizeText, type AgentLocale } from './text.js';

/**
 * Filtro de termos proibidos por locale (docs/06 §4.2 e docs/07 §3): ofensas, violência,
 * discriminação e tragédias nunca aparecem em texto gerado; linguagem de rivalidade só quando o
 * `copy_permission` permite (rival declarado).
 *
 * Os termos ficam normalizados (minúsculas, sem acento). `*` no fim = qualquer sufixo
 * (ex.: `humilh*` casa humilhou, humilhação). Termos com espaço casam qualquer espaço.
 * As listas são conservadoras: um falso positivo só derruba o texto para o fallback determinístico.
 */

export const FORBIDDEN_CATEGORIES = ['insult', 'violence', 'discrimination', 'tragedy', 'rivalry'] as const;
export type ForbiddenCategory = (typeof FORBIDDEN_CATEGORIES)[number];

type TermLists = Record<ForbiddenCategory, readonly string[]>;

const PT: TermLists = {
  insult: [
    'idiota*',
    'imbecil*',
    'otario*',
    'babaca*',
    'burro',
    'burros',
    'lixo',
    'vagabund*',
    'safad*',
    'canalha*',
    'ladrao',
    'ladroes',
    'pilantra*',
    'palhaco*',
    'vergonhos*',
    'ridicul*',
    'fdp',
    'filho da puta',
    'porra',
    'merda',
    'caralho',
    'puta',
    'puto',
    'desgracad*',
    'cuzao',
    'arrombad*',
    'mercenari*',
    'pipoqueir*',
  ],
  violence: [
    'mat*r',
    'matou',
    'matam',
    'mataram',
    'morte',
    'mortes',
    'morto',
    'mortos',
    'assassin*',
    'sangue',
    'sangrent*',
    'guerra',
    'batalha campal',
    'briga de torcida*',
    'porrada*',
    'pancadaria*',
    'agred*',
    'agress*',
    'facada*',
    'tiroteio*',
    'emboscada*',
    'espancad*',
    'linchad*',
    'invasao de campo',
    'vandal*',
  ],
  discrimination: [
    'macac*',
    'viado*',
    'bicha',
    'bichas',
    'baitola*',
    'sapatao',
    'bambi',
    'bambis',
    'favelad*',
    'paraiba',
    'baiano burro',
    'crioulo*',
    'neguinho*',
    'judeu*',
    'cigano*',
    'retardad*',
    'mongol*',
    'aleijad*',
    'gordo',
    'gorda',
    'gringo*',
    'mulherzinha*',
  ],
  tragedy: [
    'tragedia*',
    'tragic*',
    'acidente aereo',
    'queda do aviao',
    'aviao caiu',
    'incendio',
    'chape',
    'superga',
    'heysel',
    'hillsborough',
    'puerta 12',
    'ninho do urubu',
    'vitimas',
    'luto',
    'velorio',
    'enterro',
    'cemiterio',
  ],
  rivalry: [
    'secar',
    'secando',
    'secou',
    'secador*',
    'fregues*',
    'chocolate',
    'cheirinho',
    'humilh*',
    'massacr*',
    'surra',
    'surras',
    'atropel*',
    'vexame*',
    'chora',
    'chorar',
    'chorou',
    'choro',
    'zica',
    'pe frio',
    'cai cai',
    'time pequeno',
    'timinho',
    'freguesia',
    'saco de pancada*',
    'gamba*',
    'porcada',
    'urubu*',
    'bacalhau*',
  ],
};

const ES: TermLists = {
  insult: [
    'idiota*',
    'imbecil*',
    'estupid*',
    'boludo*',
    'pelotudo*',
    'pendej*',
    'cabron*',
    'hijo de puta',
    'hijos de puta',
    'hdp',
    'mierda',
    'carajo',
    'puta',
    'concha de',
    'forro*',
    'gil',
    'giles',
    'tarado*',
    'ladron',
    'ladrones',
    'payaso*',
    'verguenza',
    'vergonzos*',
    'ridicul*',
    'mercenari*',
    'pecho frio',
    'pechofrio*',
  ],
  violence: [
    'matar',
    'mato',
    'mataron',
    'muerte',
    'muertes',
    'muerto',
    'muertos',
    'asesin*',
    'sangre',
    'sangrient*',
    'guerra',
    'batalla campal',
    'pelea de hincha*',
    'golpiza*',
    'pinas',
    'trompada*',
    'agred*',
    'agresion*',
    'punalada*',
    'balacera*',
    'tiroteo*',
    'emboscada*',
    'linchad*',
    'barra brava',
    'barras bravas',
    'vandal*',
  ],
  discrimination: [
    'mono',
    'monos',
    'maricon*',
    'marica*',
    'puto',
    'putos',
    'sudaca*',
    'bolita*',
    'paragua',
    'paraguas',
    'negro de mierda',
    'villero*',
    'judio*',
    'gitano*',
    'retrasad*',
    'mongolic*',
    'gordo',
    'gorda',
    'indio de',
    'naco*',
    'gringo*',
  ],
  tragedy: [
    'tragedia*',
    'tragic*',
    'accidente aereo',
    'avion cayo',
    'caida del avion',
    'incendio',
    'chape',
    'superga',
    'heysel',
    'hillsborough',
    'puerta 12',
    'avalancha',
    'victimas',
    'luto',
    'velorio',
    'entierro',
    'cementerio',
  ],
  rivalry: [
    'paternidad',
    'somos tu papa',
    'hijos nuestros',
    'cliente',
    'clientes',
    'humill*',
    'baile',
    'bailaron',
    'masacr*',
    'paliza*',
    'vergueada*',
    'llorar',
    'lloran',
    'lloro',
    'llorones',
    'mufa*',
    'gallina*',
    'bostero*',
    'equipo chico',
    'cuadro chico',
    'descendido*',
    'aguilillas',
    'pumitas',
  ],
};

/** Acréscimos regionais (gírias ofensivas ou discriminatórias de cada mercado). */
const REGIONAL: Partial<Record<AgentLocale, Partial<TermLists>>> = {
  'es-AR': { insult: ['la concha', 'choto*', 'trolo*'], discrimination: ['negro cabeza', 'grasa*'] },
  'es-MX': {
    insult: ['chingad*', 'pinche*', 'culero*', 'ojete*'],
    discrimination: ['joto*', 'indio pata rajada'],
  },
  'es-CO': { insult: ['gonorrea*', 'malparid*', 'hijueputa*', 'carechimba*'], discrimination: ['negro hp'] },
  'es-CL': {
    insult: ['weon*', 'huevon*', 'conchetumadre', 'conchesumadre', 'culiao*', 'aweonao*'],
    discrimination: ['cuico*'],
  },
  'es-PE': {
    insult: ['cojudo*', 'huevon*', 'conchatumadre', 'pendejo*'],
    discrimination: ['cholo de mierda'],
  },
  'es-UY': {
    insult: ['nabo', 'nabos', 'pichi', 'pichis', 'botija de mierda'],
    discrimination: ['negro de mierda'],
  },
  'es-EC': { insult: ['chucha*', 'longo', 'longos', 'verga', 'vergas'], discrimination: ['longo', 'longos'] },
};

export function termsFor(locale: string): TermLists {
  const base = languageOf(locale) === 'pt' ? PT : ES;
  const extra = REGIONAL[locale as AgentLocale] ?? {};
  const out = {} as Record<ForbiddenCategory, string[]>;
  for (const c of FORBIDDEN_CATEGORIES) out[c] = [...base[c], ...(extra[c] ?? [])];
  return out;
}

const cache = new Map<string, { category: ForbiddenCategory; term: string; re: RegExp }[]>();

function compiled(locale: string) {
  let list = cache.get(locale);
  if (!list) {
    const terms = termsFor(locale);
    list = FORBIDDEN_CATEGORIES.flatMap((category) =>
      terms[category].map((term) => {
        const wildcard = term.endsWith('*');
        const body = normalizeText(wildcard ? term.slice(0, -1) : term)
          .split(' ')
          .map(escapeRegExp)
          .join('\\s+')
          // `mat*r` (asterisco no meio) = uma letra qualquer
          .replace(/\\\*/g, '[a-z]');
        const re = new RegExp(`(?<![a-z0-9])${body}${wildcard ? '[a-z]*' : ''}(?![a-z0-9])`, 'g');
        return { category, term, re };
      }),
    );
    cache.set(locale, list);
  }
  return list;
}

export interface TermHit {
  category: ForbiddenCategory;
  /** Termo da lista que casou. */
  term: string;
  /** Trecho normalizado encontrado no texto. */
  match: string;
}

export interface TermCheckOptions {
  /** Libera linguagem de rivalidade (só com rival declarado — ver `rivalryAllowed`). */
  allowRivalry?: boolean;
  /**
   * Trechos legítimos que contêm um termo da lista (ex.: nome oficial de um time ou estádio).
   * São removidos do texto antes da busca, só como palavra inteira.
   */
  allowPhrases?: readonly string[];
}

/** Procura termos proibidos no texto do locale. Lista vazia = aprovado. */
export function findForbiddenTerms(text: string, locale: string, options: TermCheckOptions = {}): TermHit[] {
  let t = normalizeText(text);
  // só a frase inteira sai (fronteira de palavra): o nome "Gil" não apaga parte de "giles"; as mais longas antes
  const phrases = [...new Set((options.allowPhrases ?? []).map(normalizeText).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  for (const p of phrases)
    t = t.replace(new RegExp(`(?<![\\p{L}\\d])${escapeRegExp(p)}(?![\\p{L}\\d])`, 'gu'), ' ');
  const hits: TermHit[] = [];
  for (const { category, term, re } of compiled(locale)) {
    if (category === 'rivalry' && options.allowRivalry) continue;
    re.lastIndex = 0;
    const m = re.exec(t);
    if (m) hits.push({ category, term, match: m[0] });
  }
  return hits;
}
