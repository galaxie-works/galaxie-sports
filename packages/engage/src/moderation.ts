/**
 * Base de regras de moderação (#969, B7): o mínimo legal, sempre ligado, para **todo texto do torcedor** (mensagem
 * do chat, post do mural, opção de enquete, Apelido, nome de comunidade e de liga). Roda no nosso servidor, sem
 * custo de tokens, e é o passo 1 do motor da Cosmos (#998).
 *
 * `screen(text, ctx)` devolve o que fazer com o texto:
 * - `allow`: publica;
 * - `block`: não publica e o autor recebe um aviso curto com o motivo, sem punição (link fora da lista, dado pessoal,
 *   menção de aposta, modo lento). Em Apelido, nome e opção de enquete, qualquer achado bloqueia;
 * - `shadow`: abuso (ódio, racismo, ameaça, assédio, conteúdo sexual): some só para os outros, o autor continua vendo.
 *
 * `suspect` marca o texto para a Cosmos (#998) e para a fila humana (B8, #953), mesmo quando publica.
 *
 * As listas base são da Galaxie (Ajustes → Conformidade → Moderação, versionadas); o cliente só acrescenta termos e
 * domínios permitidos. As exceções (falso positivo comum: nome de jogador, cidade) são só da Galaxie.
 */

export const SCREEN_KINDS = [
  'chat_message',
  'wall_post',
  'poll_option',
  'nickname',
  'community_name',
  'league_name',
] as const;
export type ScreenKind = (typeof SCREEN_KINDS)[number];

/** Categorias das listas de palavras. As três primeiras e `sexual` são abuso (`shadow`). */
export const TERM_CATEGORIES = ['hate', 'threat', 'harassment', 'sexual', 'profanity', 'betting'] as const;
export type TermCategory = (typeof TERM_CATEGORIES)[number];

/** Idioma de uma lista de termos. `all` vale em qualquer idioma. */
export const LIST_LOCALES = ['all', 'pt', 'es', 'en'] as const;
export type ListLocale = (typeof LIST_LOCALES)[number];

/** Listas que não são de termos. */
export const DOMAIN_LISTS = ['allowed_domains', 'bet_domains'] as const;
export type DomainList = (typeof DOMAIN_LISTS)[number];

export type ModerationListName = TermCategory | DomainList | 'exceptions';
export const MODERATION_LISTS: readonly ModerationListName[] = [
  ...TERM_CATEGORIES,
  ...DOMAIN_LISTS,
  'exceptions',
];

/** Listas que o cliente pode acrescentar por cima da base. Exceções ficam só com a Galaxie. */
export const TENANT_LISTS: readonly ModerationListName[] = [
  ...TERM_CATEGORIES,
  'allowed_domains',
  'bet_domains',
];

export type ScreenReason =
  'link' | 'personal_data' | 'betting' | 'abuse' | 'profanity' | 'slow_mode' | 'too_long' | 'empty';

export interface ModerationListSet {
  /** Termos por categoria e idioma. Termo com `*` no fim casa com o começo da palavra (`macac*`). */
  terms: Partial<Record<TermCategory, Partial<Record<ListLocale, string[]>>>>;
  allowedDomains?: string[];
  betDomains?: string[];
  exceptions?: string[];
}

export interface ScreenContext {
  kind: ScreenKind;
  /** Idioma do torcedor (`pt-BR`, `es-AR`, `en`...). As listas `all` e a do idioma valem; as outras também, porque
   *  torcedor escreve em mais de um idioma, mas só as do idioma marcam `profanity`. */
  locale?: string;
  /** Modo lento da sala: segundos entre mensagens do mesmo torcedor e quando ele mandou a última. */
  rate?: { intervalS: number; lastSentAt: number | null; now: number };
}

export interface ScreenResult {
  action: 'allow' | 'block' | 'shadow';
  /** Motivos, do mais grave para o mais leve. O primeiro vai no aviso ao autor (`screenNotice`). */
  reasons: ScreenReason[];
  /** Categorias de termos que casaram. */
  categories: TermCategory[];
  /** Vai para a Cosmos e para a fila humana. */
  suspect: boolean;
  /** O texto só casou depois de desfazer grafia trocada (`m4c4co`, `m a c a c o`): sinal de drible do filtro. */
  evasion: boolean;
  /** Em modo lento: segundos até poder mandar de novo. */
  retryAfterS?: number;
}

export const MAX_LENGTH: Record<ScreenKind, number> = {
  chat_message: 500,
  wall_post: 5000,
  poll_option: 120,
  nickname: 32,
  community_name: 80,
  league_name: 80,
};

const IDENTITY_KINDS: ReadonlySet<ScreenKind> = new Set([
  'nickname',
  'community_name',
  'league_name',
  'poll_option',
]);
const ABUSE: ReadonlySet<TermCategory> = new Set(['hate', 'threat', 'harassment', 'sexual']);

/**
 * Palavra que é ofensa e também nome comum de futebol: `macaca` é insulto racista e o apelido da Ponte Preta. Escrita
 * normal, não esconde a mensagem: publica e vai para a Cosmos e a fila humana (`suspect`), que decidem pelo contexto.
 * Com grafia trocada (`m4c4c4`) conta como ofensa; em Apelido e nome, bloqueia.
 */
const AMBIGUOUS_WORDS: ReadonlySet<string> = new Set(['macaca', 'macacas']);
const AMBIGUOUS_JOIN = new RegExp(String.raw`(?<![a-z0-9ñ])(${[...AMBIGUOUS_WORDS].join('|')})[-_!|]+`, 'g');

// ---------------------------------------------------------------------------------------------------------------
// Normalização

const LEET: Record<string, string> = {
  '4': 'a',
  '@': 'a',
  '3': 'e',
  '€': 'e',
  '1': 'i',
  '!': 'i',
  '|': 'i',
  '0': 'o',
  '5': 's',
  $: 's',
  '7': 't',
  '+': 't',
  '8': 'b',
  '9': 'g',
};

/** Cirílico e grego que se parecem com letras latinas (`mаcaco` com `а` cirílico). Só no caminho do drible. */
const HOMOGLYPHS: Record<string, string> = {
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  к: 'k',
  м: 'm',
  т: 't',
  в: 'b',
  н: 'h',
  і: 'i',
  ѕ: 's',
  ј: 'j',
  ԁ: 'd',
  ӏ: 'l',
  α: 'a',
  ο: 'o',
  ε: 'e',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  β: 'b',
  γ: 'y',
  η: 'n',
  μ: 'u',
};

/** Minúsculas, sem acento, sem caractere invisível (zero-width, hífen suave) e com os pontos de outras escritas
 *  (`。`) trocados por `.`. */
function fold(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      // invisíveis: formatação (zero-width, hífen suave) e os preenchimentos Hangul e Braille
      .replace(/[\p{Cf}\u3164\u115f\u1160\u2800\uffa0]/gu, '')
      .replace(/ı/g, 'i')
      .replace(/[。｡︒]/g, '.')
      .toLowerCase()
  );
}

/** Letras repetidas viram uma só (`maaacaaco` → `macaco`). Só para achar candidatos: a confirmação exige no texto
 *  pelo menos as letras dobradas do termo (`nigger` não casa com `nigeria`). */
function squeeze(word: string): string {
  return word.replace(/(.)\1+/g, '$1');
}

/** Regex do termo que aceita letra repetida a mais, mas não a menos: `rr` em `morrer` pede ao menos dois `r`. */
function termPattern(term: string): string {
  let out = '';
  for (const m of term.matchAll(/(.)\1*/g)) {
    const c = m[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out += m[0].length > 1 ? `${c}{${m[0].length},}` : `${c}+`;
  }
  return out;
}

/** Palavras do texto, já sem acento. `leet` troca números e símbolos por letras. Sequências de letras soltas
 *  (`m a c a c o`, `m.a.c.a.c.o`) viram uma palavra só. */
function words(folded: string, leet: boolean): string[] {
  // apóstrofo dentro da palavra some (`I'll` → `ill`, `d'água` → `dagua`)
  let mapped = folded.replace(/(?<=[a-z0-9ñ])['’`´](?=[a-z0-9ñ])/g, '');
  // no caminho do drible: homóglifo, leet e hífen ou sublinhado no meio da palavra (`maca-co`)
  if (leet) {
    // a palavra ambígua escrita igual não se junta à seguinte (`macaca-fc` e `macaca!!fc` não viram `macacafc`);
    // homóglifo primeiro, para a letra de outra escrita contar como letra na regra do `!` (`v!аdo` com `а` cirílico)
    const chars = [...mapped.replace(AMBIGUOUS_JOIN, '$1 ')].map((c) => HOMOGLYPHS[c] ?? c);
    // da direita para a esquerda: depois deste caractere, passando só por símbolos leet, vem letra ou número?
    const letterAhead: boolean[] = new Array<boolean>(chars.length).fill(false);
    for (let k = chars.length - 2; k >= 0; k -= 1) {
      const next = chars[k + 1]!;
      letterAhead[k] = /[a-z0-9ñ]/.test(next) || (/[!|@$€+]/.test(next) && letterAhead[k + 1]!);
    }
    mapped = chars
      // `!` e `|` são pontuação de verdade: só viram letra quando vem letra ou número depois, mesmo passando por
      // outro símbolo (`v!@d0`); no fim da palavra não (`Vamos Macaca!!` não vira `macacai`); os outros símbolos
      // viram letra também no fim (`senzal@`)
      .map((c, k) => ((c !== '!' && c !== '|') || letterAhead[k] ? LEET[c] : undefined) ?? c)
      .join('')
      .replace(/(?<=[a-z0-9ñ])[-_]+(?=[a-z0-9ñ])/g, '');
  }
  const raw = mapped.split(/[^a-z0-9ñ]+/).filter(Boolean);
  const out: string[] = [];
  let singles = '';
  for (const w of raw) {
    if (w.length === 1) {
      singles += w;
      continue;
    }
    if (singles.length >= 3) out.push(singles);
    else if (singles) out.push(...singles);
    singles = '';
    out.push(w);
  }
  if (singles.length >= 3) out.push(singles);
  else if (singles) out.push(...singles);
  return out;
}

/** Forma canônica de um termo da lista (o que a tela grava e o que o filtro compara). Guarda as letras dobradas:
 *  `nigger` e `niger` são palavras diferentes. */
export function normalizeTerm(term: string): string {
  const t = fold(term.trim()).replace(/(?<=[a-z0-9ñ])['’`´](?=[a-z0-9ñ])/g, '');
  const prefix = t.endsWith('*');
  const body = (prefix ? t.slice(0, -1) : t)
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean)
    .join(' ');
  return body ? (prefix ? `${body}*` : body) : '';
}

export function normalizeDomain(domain: string): string {
  return fold(domain.trim())
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

// ---------------------------------------------------------------------------------------------------------------
// Listas compiladas

/** Termo compilado: a forma sem letra repetida acha o candidato rápido; a regex confirma. */
interface Term {
  key: string;
  re: RegExp;
}

interface CompiledTerms {
  exact: Map<string, RegExp[]>;
  prefixes: Term[];
  phrases: Term[];
}

const emptyTerms = (): CompiledTerms => ({ exact: new Map(), prefixes: [], phrases: [] });

export interface CompiledLists {
  byCategory: Map<TermCategory, { any: CompiledTerms; byLocale: Map<ListLocale, CompiledTerms> }>;
  allowedDomains: string[];
  betDomains: string[];
  exceptions: Set<string>;
}

function compileTerms(terms: string[]): CompiledTerms {
  const out = emptyTerms();
  for (const raw of terms) {
    const t = normalizeTerm(raw);
    if (!t) continue;
    const prefix = t.endsWith('*');
    const body = prefix ? t.slice(0, -1) : t;
    if (body.includes(' ')) {
      // frase: começa e (sem `*`) termina em fronteira de palavra; `se mata` não casa com `se matava`
      const pattern = ` ${body.split(' ').map(termPattern).join(' ')}${prefix ? '' : ' '}`;
      out.phrases.push({ key: ` ${squeeze(body)}${prefix ? '' : ' '}`, re: new RegExp(pattern) });
    } else if (prefix) out.prefixes.push({ key: squeeze(body), re: new RegExp(`^${termPattern(body)}`) });
    else {
      const key = squeeze(body);
      out.exact.set(key, [...(out.exact.get(key) ?? []), new RegExp(`^${termPattern(body)}$`)]);
    }
  }
  return out;
}

function mergeTerms(a: CompiledTerms, b: CompiledTerms): CompiledTerms {
  const exact = new Map(a.exact);
  for (const [k, v] of b.exact) exact.set(k, [...(exact.get(k) ?? []), ...v]);
  return { exact, prefixes: [...a.prefixes, ...b.prefixes], phrases: [...a.phrases, ...b.phrases] };
}

/**
 * Junta a base da Galaxie com o que o cliente acrescentou. O cliente nunca tira termo, nunca põe exceção e nunca
 * libera domínio de aposta (o domínio permitido que também é de aposta continua bloqueado).
 */
export function compileLists(base: ModerationListSet, tenant?: ModerationListSet | null): CompiledLists {
  const byCategory: CompiledLists['byCategory'] = new Map();
  for (const cat of TERM_CATEGORIES) {
    const byLocale = new Map<ListLocale, CompiledTerms>();
    let any = emptyTerms();
    for (const loc of LIST_LOCALES) {
      const terms = [...(base.terms[cat]?.[loc] ?? []), ...(tenant?.terms[cat]?.[loc] ?? [])];
      const c = compileTerms(terms);
      byLocale.set(loc, c);
      any = mergeTerms(any, c);
    }
    byCategory.set(cat, { any, byLocale });
  }
  const domains = (list: string[] | undefined) => [
    ...new Set((list ?? []).map(normalizeDomain).filter(Boolean)),
  ];
  return {
    byCategory,
    allowedDomains: domains([...(base.allowedDomains ?? []), ...(tenant?.allowedDomains ?? [])]),
    betDomains: domains([...(base.betDomains ?? []), ...(tenant?.betDomains ?? [])]),
    exceptions: new Set((base.exceptions ?? []).map(normalizeTerm).filter(Boolean)),
  };
}

interface Text {
  words: string[];
  squeezed: string[];
  joined: string;
  joinedSqueezed: string;
}

function textOf(ws: string[]): Text {
  const squeezed = ws.map(squeeze);
  return { words: ws, squeezed, joined: ` ${ws.join(' ')} `, joinedSqueezed: ` ${squeezed.join(' ')} ` };
}

function matches(c: CompiledTerms, t: Text): boolean {
  for (let i = 0; i < t.words.length; i += 1) {
    const w = t.words[i]!;
    const sq = t.squeezed[i]!;
    const exact = c.exact.get(sq);
    if (exact?.some((re) => re.test(w))) return true;
    for (const p of c.prefixes) if (sq.startsWith(p.key) && p.re.test(w)) return true;
  }
  for (const p of c.phrases) if (t.joinedSqueezed.includes(p.key) && p.re.test(t.joined)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Detectores

const TLDS =
  'com|net|org|br|bet|io|me|gg|tv|xyz|app|ly|co|ar|mx|cl|pe|uy|ec|py|bo|ve|us|ca|info|site|online|vip|win|club|live|link|top|fun|games|casino|pro|biz|cc|to|in|pt|es|de|uk|ru|fr|it|eu|shop|store|dev|ai|tech|website|space|page|stream';
const URL_RE = new RegExp(
  String.raw`(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,8}(?:${TLDS})\b(?:\/[^\s<>"']*)?`,
  'gi',
);
/** Ponto escondido entre parênteses ou colchetes: `site(.)com`, `site [dot] com`, `site (ponto) com`. */
const BRACKET_DOT = /\s*[([{]\s*(?:\.|ponto|punto|dot)\s*[)\]}]\s*/gi;
/** TLDs que quase nunca são palavra de frase (`top`, `fun`, `live`, `me`, `in`, `to` são). */
const STRONG_TLDS = 'com|net|org|br|bet|io|xyz|app|ar|mx|cl|uy|site|online|casino|games|shop|store';
/** Ponto com espaço (`betano . com`, `site. com`): só com TLD forte e o domínio fechando o trecho (`Que jogo. Top!`
 *  e "Ganhamos o jogo. Com certeza" são texto comum). */
const SPACED_DOT_HOST = new RegExp(
  String.raw`(?<![a-z0-9.-])([a-z0-9][a-z0-9-]{1,62})(?:\s+\.\s*|\s*\.\s+)(${STRONG_TLDS})(?![\p{L}\p{N}])(?!\s*[\p{L}\p{N}])`,
  'giu',
);
/** TLDs fortes que começam frase depois de ponto final ("Ganhamos o jogo. Com certeza", "Jogou bem. Br demais"). */
const SENTENCE_TLDS = new Set(['com', 'br', 'site', 'online', 'games', 'shop', 'store']);
/** O mesmo ponto com espaço, com texto depois (`meusite . com agora`): só marca para a Cosmos. Com o espaço só
 *  depois do ponto (`jogo. Com certeza`), os TLDs que começam frase ficam de fora. */
const SPACED_DOT_MID = new RegExp(
  String.raw`(?<![a-z0-9.-])([a-z0-9][a-z0-9-]{1,62})(\s+\.\s*|\s*\.\s+)(${STRONG_TLDS})(?![\p{L}\p{N}])(?=\s*[\p{L}\p{N}])`,
  'giu',
);
/** Ponto por extenso (`site ponto com`, `site dot com ponto br`). No fim do trecho é link; no meio da frase ("um
 *  ponto com o empate") pode ser texto comum, então só marca para a Cosmos. */
const SPELLED_HOST = new RegExp(
  String.raw`(?<![a-z0-9.-])([a-z0-9][a-z0-9-]{1,62})\s+(?:ponto|punto|dot)\s+(${TLDS})(?:\s+(?:ponto|punto|dot)\s+(${TLDS}))?(?![\p{L}\p{N}])`,
  'giu',
);
// limites de tamanho: sem eles, `a.a.a…` e `a@a@a…` custam tempo quadrático
const EMAIL_RE = /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,6}\.[a-z]{2,24}\b/i;
const UUID_RE = /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/i;
const CPF_RE = /(?<!\d)(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-.\s]?(\d{2})(?!\d)/g;
const CNPJ_RE = /(?<!\d)(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-.\s]?(\d{2})(?!\d)/g;
/** Telefone: 10 a 13 dígitos com separadores comuns, com ou sem DDI. */
const PHONE_RE =
  /(?<![\d\w])(?:\+\s?\d{1,3}[\s.-]?)?(?:\(\s?\d{2,3}\s?\)|\d{2,3})[\s.-]?\d{4,5}[\s.-]?\d{4}(?!\d)/g;

function cpfValid(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

function cnpjValid(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < n; i += 1) s += Number(d[i]) * w[i]!;
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

function hasPersonalData(text: string): boolean {
  if (EMAIL_RE.test(text) || UUID_RE.test(text)) return true;
  for (const m of text.matchAll(CPF_RE)) if (cpfValid(m.slice(1).join(''))) return true;
  for (const m of text.matchAll(CNPJ_RE)) if (cnpjValid(m.slice(1).join(''))) return true;
  for (const m of text.matchAll(PHONE_RE)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13) return true;
  }
  return false;
}

function hostOf(url: string): string {
  return normalizeDomain(url.replace(/^[a-z]+:\/\//i, ''));
}

const domainIn = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

const spelledHost = (m: RegExpMatchArray) => (m[3] ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}`);
/** Depois do domínio por extenso vem mais texto? Então pode ser frase comum. */
const textAfter = (folded: string, m: RegExpMatchArray) =>
  /^\s*[\p{L}\p{N}]/u.test(folded.slice(m.index! + m[0].length));

/** Palavra de chamada antes do domínio por extenso (`acessa meusite ponto com agora`, `entra no meusite ponto com
 *  hoje`): é link, mesmo no meio. */
const CALL_BEFORE =
  /(?:^|[^\p{L}\p{N}])(?:(?:acessa|acesse|acessem|entra|visita|visite|confere|confira|clica|clique|ingresa|ingresen|visit|go to|check out)(?:\s+(?:o|a|os|as|no|na|nos|nas|em|ao|el|la|en|al|the|on|to))?|(?:site|link|siga|segue|entre|entrem)(?:\s+(?:no|na|em|en|on|al))?)\s+$/u;
const calledHost = (folded: string, m: RegExpMatchArray) => CALL_BEFORE.test(folded.slice(0, m.index!));

/** Domínio por extenso ou com ponto e espaço no meio da frase: talvez link, talvez texto comum (`um ponto com o
 *  empate`). Não bloqueia, mas vai para a Cosmos. */
function midHosts(folded: string): string[] {
  return [
    ...[...folded.matchAll(SPELLED_HOST)]
      .filter((m) => textAfter(folded, m) && !calledHost(folded, m))
      .map(spelledHost),
    ...[...folded.matchAll(SPACED_DOT_MID)]
      .filter((m) => /^\s/.test(m[2]!) || !SENTENCE_TLDS.has(m[3]!))
      .map((m) => `${m[1]}.${m[3]}`),
  ];
}

/** Hosts dos links do texto, inclusive os escritos com "ponto com". */
function hostsIn(folded: string): string[] {
  const hosts = new Set<string>();
  for (const m of folded.matchAll(SPACED_DOT_HOST)) hosts.add(`${m[1]}.${m[2]}`);
  for (const m of folded.matchAll(SPELLED_HOST))
    if (!textAfter(folded, m) || calledHost(folded, m)) hosts.add(spelledHost(m));
  for (const variant of [folded, folded.replace(BRACKET_DOT, '.')])
    for (const m of variant.matchAll(URL_RE)) {
      // e-mail não é link (cai em dado pessoal)
      const before = variant[m.index! - 1];
      if (before === '@') continue;
      const h = hostOf(m[0]);
      if (h && /\.[a-z]{2,}$/.test(h) && !/^\d+(\.\d+)+$/.test(h)) hosts.add(h);
    }
  return [...hosts];
}

/** Modo lento: quanto falta para o torcedor poder mandar de novo (0 = pode). */
export function slowModeWait(rate: { intervalS: number; lastSentAt: number | null; now: number }): number {
  if (!rate.intervalS || rate.lastSentAt === null) return 0;
  const wait = rate.lastSentAt + rate.intervalS * 1000 - rate.now;
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

/**
 * Modo lento automático por volume: a sala começa no intervalo configurado e sobe um degrau a cada faixa de
 * mensagens por minuto. Os degraus e o teto vêm de Ajustes (`runtime_setting`); o cliente só endurece.
 */
export function autoSlowMode(input: {
  configuredS: number;
  messagesPerMinute: number;
  steps: ReadonlyArray<{ perMinute: number; intervalS: number }>;
  maxS: number;
}): number {
  let s = input.configuredS;
  for (const step of input.steps)
    if (input.messagesPerMinute >= step.perMinute) s = Math.max(s, step.intervalS);
  return Math.min(Math.max(s, input.configuredS), Math.max(input.maxS, input.configuredS));
}

// ---------------------------------------------------------------------------------------------------------------
// screen

const ORDER: ScreenReason[] = [
  'abuse',
  'betting',
  'personal_data',
  'link',
  'profanity',
  'slow_mode',
  'too_long',
  'empty',
];

function localeKey(locale: string | undefined): 'pt' | 'es' | 'en' | null {
  const l = (locale ?? '').slice(0, 2).toLowerCase();
  return l === 'pt' || l === 'es' || l === 'en' ? l : null;
}

export function screen(text: string, ctx: ScreenContext, lists: CompiledLists): ScreenResult {
  const reasons = new Set<ScreenReason>();
  const categories = new Set<TermCategory>();
  let evasion = false;
  let retryAfterS: number | undefined;

  const trimmed = text.trim();
  if (!trimmed) reasons.add('empty');
  if ([...trimmed].length > MAX_LENGTH[ctx.kind]) reasons.add('too_long');
  if (ctx.rate) {
    const wait = slowModeWait(ctx.rate);
    if (wait > 0) {
      reasons.add('slow_mode');
      retryAfterS = wait;
    }
  }

  // longo demais não é publicado: nem passa pelo resto (as regex de link e e-mail custam com texto enorme)
  if (reasons.has('too_long') || reasons.has('empty')) {
    const sorted = ORDER.filter((r) => reasons.has(r));
    return {
      action: 'block',
      reasons: sorted,
      categories: [],
      suspect: false,
      evasion: false,
      ...(retryAfterS !== undefined ? { retryAfterS } : {}),
    };
  }

  const folded = fold(trimmed);
  const notException = (w: string) => !lists.exceptions.has(w) && !lists.exceptions.has(squeeze(w));
  const plainWords = words(folded, false).filter(notException);
  const ambiguous = plainWords.filter((w) => AMBIGUOUS_WORDS.has(squeeze(w)));
  const written = new Set(ambiguous);
  const plain = textOf(plainWords.filter((w) => !written.has(w)));
  // no caminho do drible, a palavra ambígua só sai tantas vezes quantas foi escrita igual (`macaca`): a escrita com
  // leet (`macaca m4c4c4`) continua lá
  const left = new Map<string, number>();
  for (const w of ambiguous) left.set(w, (left.get(w) ?? 0) + 1);
  const leet = textOf(
    words(folded, true).filter((w) => {
      if (!notException(w)) return false;
      const n = left.get(w) ?? 0;
      if (n > 0) {
        left.set(w, n - 1);
        return false;
      }
      return true;
    }),
  );
  const loc = localeKey(ctx.locale);

  for (const [cat, c] of lists.byCategory) {
    // palavrão só conta no idioma do torcedor (e nas listas `all`); os outros valem em qualquer idioma
    const terms =
      cat === 'profanity' ? mergeTerms(c.byLocale.get('all')!, loc ? c.byLocale.get(loc)! : c.any) : c.any;
    if (matches(terms, plain)) categories.add(cat);
    else if (matches(terms, leet)) {
      categories.add(cat);
      evasion = true;
    }
  }

  // palavra ambígua que casaria com ofensa: não esconde, mas vai para a Cosmos
  const ambiguousHit =
    ambiguous.length > 0 &&
    [...lists.byCategory].some(([cat, c]) => ABUSE.has(cat) && matches(c.any, textOf(ambiguous)));
  const maybeLink = midHosts(folded).some((h) => !domainIn(h, lists.allowedDomains));

  const hosts = hostsIn(folded);
  const betHost = hosts.some((h) => domainIn(h, lists.betDomains));
  if (betHost || categories.has('betting')) reasons.add('betting');
  if (hosts.some((h) => !domainIn(h, lists.allowedDomains))) reasons.add('link');
  if (hasPersonalData(trimmed)) reasons.add('personal_data');
  if ([...categories].some((c) => ABUSE.has(c))) reasons.add('abuse');
  if (categories.has('profanity')) reasons.add('profanity');

  const sorted = ORDER.filter((r) => reasons.has(r));
  const identity = IDENTITY_KINDS.has(ctx.kind);
  let action: ScreenResult['action'] = 'allow';
  if (reasons.has('abuse')) action = identity ? 'block' : 'shadow';
  else if (sorted.some((r) => r !== 'profanity')) action = 'block';
  else if (reasons.has('profanity') && identity) action = 'block';

  if (identity && ambiguousHit && action === 'allow') action = 'block';
  const suspect =
    reasons.has('abuse') ||
    evasion ||
    (reasons.has('profanity') && !identity) ||
    reasons.has('betting') ||
    ambiguousHit ||
    maybeLink;
  return {
    action,
    reasons: sorted,
    categories: TERM_CATEGORIES.filter((c) => categories.has(c)),
    suspect,
    evasion,
    ...(retryAfterS !== undefined ? { retryAfterS } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Aviso ao autor

type NoticeLocale = 'pt' | 'es' | 'en';
const NOTICES: Record<NoticeLocale, Record<ScreenReason, string>> = {
  pt: {
    abuse: 'Sua mensagem fere as regras da comunidade.',
    betting: 'Não é permitido divulgar apostas.',
    personal_data: 'Não compartilhe telefone, e-mail, CPF ou chave Pix.',
    link: 'Links para fora não são permitidos aqui.',
    profanity: 'Escolha outras palavras.',
    slow_mode: 'Modo lento: espere {s} s para mandar de novo.',
    too_long: 'Texto longo demais.',
    empty: 'Escreva alguma coisa.',
  },
  es: {
    abuse: 'Tu mensaje no cumple las reglas de la comunidad.',
    betting: 'No se permite promocionar apuestas.',
    personal_data: 'No compartas teléfono, correo ni documentos.',
    link: 'No se permiten enlaces externos aquí.',
    profanity: 'Elige otras palabras.',
    slow_mode: 'Modo lento: espera {s} s para volver a enviar.',
    too_long: 'Texto demasiado largo.',
    empty: 'Escribe algo.',
  },
  en: {
    abuse: 'Your message breaks the community rules.',
    betting: 'Betting promotion is not allowed.',
    personal_data: "Don't share phone numbers, emails or IDs.",
    link: 'External links are not allowed here.',
    profanity: 'Please choose other words.',
    slow_mode: 'Slow mode: wait {s} s before sending again.',
    too_long: 'Text is too long.',
    empty: 'Write something.',
  },
};

/** Aviso curto ao autor para o motivo mais grave. `shadow` não avisa (o autor continua vendo). */
export function screenNotice(result: ScreenResult, locale?: string): string | null {
  if (result.action !== 'block') return null;
  const reason = result.reasons[0];
  if (!reason) return null;
  const l = localeKey(locale) ?? 'pt';
  return NOTICES[l][reason].replace('{s}', String(result.retryAfterS ?? 0));
}
