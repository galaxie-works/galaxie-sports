/**
 * Perfil editorial de piloto de F1 (`formula-1/editorial/<locale>.yaml`, perfis `draft` revisados no painel):
 * lenda = bio, estilo, pontos fortes, momentos marcantes e rivalidades; regular = bio curta.
 *
 * O LLM (tier `research`, com busca na web) recebe os fatos do F1DB e a lista de corridas do piloto e devolve uma
 * estrutura fixa em pt-BR, cada item com a URL da fonte. **O validador nunca barra e ninguém mexe na resposta antes
 * dele**: cada problema vira um achado (`findings`: campo, trecho, regra, motivo e gravidade) e o perfil vai como
 * rascunho para a revisão humana, que vê o trecho destacado no painel.
 * - grave: número fora do F1DB (FactSheet), corrida que o piloto não disputou (fora da lista `<ano>-<rodada>`), rival
 *   que não largou junto (vínculo pelo F1DB, nunca pelo LLM), prompt injection e fonte sem a busca por trás (sem fonte,
 *   fora dos `groundedUrls` do Gemini ou de domínio não permitido);
 * - alerta: termo da lista de proibidos, cara de letra de música, outro idioma, tamanho, item repetido, lenda sem
 *   momento e tradução com outro número de itens.
 * Só não há proposta sem bio. Depois, um segundo pedido (tier `standard`, sem busca) traduz o perfil para o espanhol
 * neutro (`es`), item a item e com as mesmas fontes; a tradução passa pelo mesmo validador.
 */
import {
  checkParagraphs,
  checkProse,
  DRIVER_STRENGTHS,
  DRIVING_STYLES,
  driverSlug,
  type DriverEditorialEntry,
  type EditorialFinding,
} from '@galaxie/knowledge';
import {
  checkFacts,
  detectLanguage,
  detectPromptInjection,
  FactSheetBuilder,
  findForbiddenTerms,
  isAllowedUrl,
  normalizeText,
  UNTRUSTED_DATA_RULE,
  type FactSheet,
} from '../guardrails/index.js';
import type { LlmClient, LlmUsage } from '../llm/types.js';
import type { ProfileFacts } from './profile-facts.js';

export type ProfileLocale = 'pt-BR' | 'es';

export interface ProfileProposal {
  f1dbId: string;
  name: string;
  tier: 'legend' | 'regular';
  status: 'accepted' | 'rejected';
  reasons: string[];
  /** As entradas com os achados do validador (`findings`); nada é descartado. */
  entries: Record<ProfileLocale, DriverEditorialEntry | null>;
  model?: string;
  usage?: LlmUsage;
}

/** Tamanhos pedidos ao modelo; passar deles é alerta, não corte. */
const LIMITS = { legendBio: 1500, regularBio: 450, style: 400, item: 280 } as const;
const MAX = { strengths: 5, moments: 6, rivalries: 3 } as const;

const sourced = (description: string) => ({
  type: 'object',
  additionalProperties: false,
  required: ['text', 'source'],
  properties: {
    text: { type: 'string', description },
    source: { type: 'string', description: 'URL da fonte que sustenta o item.' },
  },
});

const LEGEND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bio', 'style', 'strengths', 'moments', 'rivalries'],
  properties: {
    bio: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'sources'],
      properties: {
        text: {
          type: 'string',
          description: `Bio editorial em português, até ${LIMITS.legendBio} caracteres.`,
        },
        sources: { type: 'array', items: { type: 'string' } },
      },
    },
    style: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['kind', 'text', 'sources'],
      properties: {
        kind: { type: 'string', enum: [...DRIVING_STYLES] },
        text: { type: 'string', description: 'Uma ou duas frases sobre o modo de pilotagem.' },
        sources: { type: 'array', items: { type: 'string' } },
      },
    },
    strengths: {
      type: 'array',
      items: {
        ...sourced('Uma frase concreta.'),
        required: ['key', 'text', 'source'],
        properties: {
          key: { type: 'string', enum: [...DRIVER_STRENGTHS] },
          ...sourced('').properties,
        },
      },
    },
    moments: {
      type: 'array',
      items: {
        ...sourced('O que aconteceu, em uma ou duas frases.'),
        required: ['race_key', 'race', 'wet', 'text', 'source'],
        properties: {
          race_key: { type: 'string', description: 'A chave da corrida na lista (ex.: 1993-03).' },
          race: { type: 'string', description: 'Nome do GP em português (ex.: GP da Europa).' },
          wet: { type: 'boolean', description: 'A corrida teve chuva (segundo a fonte).' },
          ...sourced('').properties,
        },
      },
    },
    rivalries: {
      type: 'array',
      items: {
        ...sourced('Por que foram rivais, com um fato.'),
        required: ['driver', 'text', 'source'],
        properties: {
          driver: { type: 'string', description: 'Nome completo do piloto rival.' },
          ...sourced('').properties,
        },
      },
    },
  },
} as const;

const REGULAR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bio'],
  properties: { bio: LEGEND_SCHEMA.properties.bio },
} as const;

export type LegendReply = {
  bio: { text: string; sources: string[] };
  style: { kind: string; text: string; sources: string[] } | null;
  strengths: { key: string; text: string; source: string }[];
  moments: { race_key: string; race: string; wet: boolean; text: string; source: string }[];
  rivalries: { driver: string; text: string; source: string }[];
};

/** Números e nomes que o texto pode citar: tudo o que veio do F1DB. */
export function profileFactSheet(f: ProfileFacts): FactSheet {
  const b = new FactSheetBuilder();
  b.number(1, f.races, f.wins, f.poles, f.podiums, f.points, Math.round(f.points), f.titles.length);
  b.number(...f.titles);
  if (f.seasons) b.number(f.seasons.first, f.seasons.last, f.seasons.last - f.seasons.first + 1);
  b.number(f.seasonStats.length);
  for (const s of f.seasonStats) {
    b.number(s.year, s.position, s.points, s.wins, s.podiums);
    // a década da temporada ("anos 1980", "anos 80")
    b.number(Math.floor(s.year / 10) * 10, Math.floor((s.year % 100) / 10) * 10);
  }
  for (const c of f.circuits) b.number(c.races, c.wins, c.podiums);
  // datas (dia e ano) das corridas e do nascimento, e a idade em cada temporada
  for (const r of f.racesList) b.number(r.round, r.grid, r.finish, Number(r.date.slice(8, 10)));
  if (f.birthDate) {
    const born = Number(f.birthDate.slice(0, 4));
    b.number(born, Number(f.birthDate.slice(8, 10)));
    for (const s of f.seasonStats) b.number(s.year - born, s.year - born - 1);
  }
  for (const t of f.teammates) b.number(t.races);
  b.name(f.name, ...f.teams, ...f.teammates.map((t) => t.name), ...f.contemporaries.map((c) => c.name));
  b.name(...f.racesList.flatMap((r) => [r.gp, r.circuit]));
  return b.build();
}

export function profilePrompt(f: ProfileFacts): string {
  const legend = f.tier === 'legend';
  const facts = [
    `Nome: ${f.name}${f.country ? ` (${f.country})` : ''}${f.birthDate ? `; nascimento: ${f.birthDate}` : ''}`,
    f.seasons
      ? `Temporadas na F1: ${f.seasons.first}–${f.seasons.last} (${f.seasonStats.length} temporadas)`
      : null,
    f.teams.length ? `Equipes: ${f.teams.join(', ')}` : null,
    `GPs: ${f.races}; vitórias: ${f.wins}; poles: ${f.poles}; pódios: ${f.podiums}; pontos: ${f.points}`,
    f.titles.length ? `Títulos mundiais: ${f.titles.length} (${f.titles.join(', ')})` : 'Sem título mundial',
    f.circuits.length
      ? `Pistas com mais vitórias/pódios: ${f.circuits
          .slice(0, 6)
          .map((c) => `${c.name} (${c.wins} vitória(s), ${c.podiums} pódio(s) em ${c.races} largada(s))`)
          .join('; ')}`
      : null,
    f.teammates.length
      ? `Companheiros de equipe: ${f.teammates
          .slice(0, 8)
          .map((t) => `${t.name} (${t.races} GPs juntos)`)
          .join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
  if (!legend)
    return [
      'Escreva a bio curta do piloto de Fórmula 1 abaixo para uma base de dados esportiva (TV e streaming na América Latina).',
      `Fatos do F1DB (confiáveis):\n${facts}`,
      `Pesquise na web e devolva bio.text: 2 ou 3 frases em português do Brasil (até ${LIMITS.regularBio} caracteres) sobre quem é o piloto e o que marcou a carreira dele na F1, e bio.sources: as URLs que sustentam o texto.`,
      'Regras: só fatos com fonte; todo número citado tem de bater com os fatos acima (na dúvida, não cite o número); nada de exagero nem especulação; não copie texto literal das páginas.',
    ].join('\n\n');
  const races = f.racesList
    .map(
      (r) =>
        `${r.key} · ${r.date} · ${r.gp}${r.circuit ? ` (${r.circuit})` : ''} · largou ${r.grid ?? '—'} · ${r.finish != null ? `chegou ${r.finish}º` : (r.status ?? 'não terminou')}`,
    )
    .join('\n');
  return [
    'Escreva o perfil editorial do piloto de Fórmula 1 abaixo, uma lenda do esporte, para uma base de dados esportiva (TV e streaming na América Latina).',
    `Fatos do F1DB (confiáveis; todo número que você citar tem de bater com eles):\n${facts}`,
    `Corridas do piloto (chave · GP · largada · chegada):\n${races}`,
    [
      'Pesquise na web e devolva, em português do Brasil, cada item com a URL da fonte que o sustenta:',
      `- bio: um texto editorial de 3 a 5 parágrafos curtos, separados por linha em branco (até ${LIMITS.legendBio} caracteres), com sources. A bio conta a carreira por momentos: cite ao menos três corridas da lista pelo GP e pelo ano, dizendo o que aconteceu nelas, e mostre o estilo do piloto na pista;`,
      `- style: o modo de pilotagem (kind, da lista) e uma ou duas frases que o mostrem na pista, com sources;`,
      `- strengths: até ${MAX.strengths} pontos fortes reconhecidos (key, da lista: perspicácia = race_intelligence; controle do carro = car_control; chuva = wet_weather), cada um com um fato;`,
      `- moments: de 3 a ${MAX.moments} momentos marcantes, cada um numa corrida da lista (race_key), com o nome do GP em português, se choveu (wet) e o que aconteceu;`,
      `- rivalries: até ${MAX.rivalries} rivalidades com outros pilotos, com o que as definiu.`,
    ].join('\n'),
    [
      'Tom: o de um bom texto de transmissão esportiva. Narre com momentos concretos (a corrida, o ano, o que aconteceu) e traços de estilo que dão para ver na pista — como, no caso do Senna, a chuva de Donington em 1993, Mônaco, Interlagos em 1991 ou a "obsessão pelo milésimo" na classificação.',
      'Não é para copiar esse exemplo: é o nível de detalhe esperado. Nem toda frase precisa de adjetivo; prefira o fato que impressiona.',
      'Evite frases genéricas que serviriam para qualquer campeão ("redefiniu o patamar", "deixou um legado", "hall da fama", "um dos maiores de todos os tempos"): troque por um fato que só esse piloto tem.',
    ].join(' '),
    'Regras: só fatos com fonte; número que não esteja nos fatos acima fica de fora (na dúvida, descreva sem o número); mortes e acidentes graves, com sobriedade (sem "tragédia", "trágico" ou "luto"); nada de especulação; não copie texto literal das páginas; prefira fontes de referência (enciclopédias, imprensa esportiva, sites oficiais).',
  ].join('\n\n');
}

export interface Ctx {
  facts: ProfileFacts;
  sheet: FactSheet;
  grounded: Set<string> | null;
  cited: Set<string>;
}

/** Regras graves: pedem conferência do fato. As demais são alertas sobre o texto. Nenhuma descarta. */
export const SEVERE_RULES: ReadonlySet<string> = new Set([
  'unknown_number',
  'race_not_driven',
  'rival_not_in_race',
  'prompt_injection',
  'source_not_grounded',
  'source_domain',
  'missing_source',
]);

const finding = (
  field: string,
  start: number,
  end: number,
  rule: string,
  reason: string,
): EditorialFinding => ({
  field,
  start,
  end,
  rule,
  reason,
  severity: SEVERE_RULES.has(rule) ? 'severe' : 'alert',
});

/**
 * "Agressivo" em contexto de pilotagem, que a lista de termos proibidos (feita para torcida e violência) pegaria:
 * "pilotagem agressiva", "ultrapassagens agressivas", "agressivo nas freadas" descrevem estilo, não agressão. Fora
 * desses contextos (ex.: "agressivo com o rival"), o termo segue virando alerta. Sobre o texto normalizado.
 */
const RACING_AGGRESSION = new RegExp(
  [
    '\\b(?:pilotagem|estilo|conducao|manobras?|ultrapassagens?|freadas?|frenagens?|largadas?|ritmo|defesas?|ataques?|tocadas?|voltas?)\\s+(?:(?:mais|muito|tao|bem|bastante|sempre)\\s+)?agressiv[a-z]*',
    '\\bagressiv[a-z]*\\s+(?:na|nas|no|nos|em|ao|aos)\\s+(?:pista|entradas?|curvas?|ultrapassagens?|freadas?|frenagens?|largadas?|volante|defesas?|disputas?)\\b',
    '\\b(?:pilotar|pilotava|pilotou|pilota|guiava|conduzia|freava|atacava|largava|defendia)\\s+(?:(?:de forma|de maneira|com)\\s+(?:[a-z]+\\s+)?)?agressiv[a-z]*',
    '\\bagressividade\\s+(?:controlada|calculada|medida)\\b',
  ].join('|'),
  'g',
);

/** O texto normalizado sem o "agressivo" de pilotagem (para a lista de termos proibidos; também na revisão). */
export const withoutRacingAggression = (text: string) => normalizeText(text).replace(RACING_AGGRESSION, ' ');

/** Nome de modelo com número (Brabham BT52, McLaren MP4/4, Ferrari F2004): o número é do nome, não estatística. */
const MODEL_CODE = /\b\p{L}+\d+(?:[/-]\d+)*\p{L}*\b/gu;

/**
 * Tira os nomes de modelo antes de conferir os números. "P2" e "Q3" (posição, sessão de classificação) não são
 * chassi: ficam, e o número passa pelo F1DB, salvo logo depois do nome de uma equipe do piloto (Tyrrell P34).
 */
function stripModelCodes(text: string, teams: readonly string[]): string {
  const teamWords = new Set(teams.flatMap((t) => normalizeText(t).split(/\s+/)));
  return text.replace(MODEL_CODE, (token: string, offset: number) => {
    if (!/^[PQ]\d{1,2}$/i.test(token)) return ' ';
    const prev = /([\p{L}\d-]+)\s*$/u.exec(normalizeText(text.slice(0, offset)))?.[1];
    return prev && teamWords.has(prev) ? ' ' : token;
  });
}

/**
 * Como o nome do GP do F1DB (inglês, sem "Grand Prix") aparece em pt-BR e em es: o rótulo do momento precisa citar o
 * GP da corrida da chave. Fora da tabela, vale o próprio nome (Miami, Las Vegas, Eifel...).
 */
const GP_LABEL_WORDS: Record<string, readonly string[]> = {
  '70th anniversary': ['aniversario'],
  'abu dhabi': ['abu dabi'],
  argentine: ['argentina'],
  australia: ['australia'],
  australian: ['australia'],
  austria: ['austria'],
  austrian: ['austria'],
  azerbaijan: ['azerbaijao', 'azerbaiyan', 'baku'],
  bahrain: ['bahrein', 'barein'],
  'barcelona catalunya': ['espanha', 'espana', 'barcelona', 'catalunha', 'cataluna'],
  belgian: ['belgica'],
  belgium: ['belgica'],
  brazil: ['brasil'],
  brazilian: ['brasil'],
  british: ['gra bretanha', 'gran bretana', 'inglaterra', 'britanico'],
  canada: ['canada'],
  canadian: ['canada'],
  china: ['china'],
  chinese: ['china'],
  dutch: ['holanda', 'paises baixos', 'paises bajos'],
  'emilia romagna': ['emilia romanha', 'emilia romana', 'imola'],
  european: ['europa'],
  france: ['franca', 'francia'],
  french: ['franca', 'francia'],
  german: ['alemanha', 'alemania'],
  'great britain': ['gra bretanha', 'gran bretana', 'inglaterra'],
  hungarian: ['hungria'],
  hungary: ['hungria'],
  indian: ['india'],
  italian: ['italia'],
  italy: ['italia'],
  japan: ['japao', 'japon'],
  japanese: ['japao', 'japon'],
  korean: ['coreia', 'corea'],
  luxembourg: ['luxemburgo'],
  malaysian: ['malasia'],
  mexican: ['mexico'],
  mexico: ['mexico'],
  'mexico city': ['mexico'],
  monaco: ['monaco'],
  moroccan: ['marrocos', 'marruecos'],
  netherlands: ['holanda', 'paises baixos', 'paises bajos'],
  pacific: ['pacifico'],
  portuguese: ['portugal'],
  qatar: ['catar'],
  russian: ['russia', 'rusia'],
  'sao paulo': ['brasil', 'interlagos'],
  'saudi arabia': ['arabia saudita', 'arabia saudi'],
  'saudi arabian': ['arabia saudita', 'arabia saudi'],
  singapore: ['singapura', 'singapur'],
  'south african': ['africa do sul', 'sudafrica'],
  spanish: ['espanha', 'espana'],
  styrian: ['estiria'],
  swedish: ['suecia'],
  swiss: ['suica', 'suiza'],
  turkish: ['turquia'],
  tuscan: ['toscana'],
  usa: ['estados unidos', 'eua', 'eeuu', 'ee uu'],
  'united states': ['estados unidos', 'eua', 'eeuu', 'ee uu'],
};

const labelText = (s: string) =>
  ` ${normalizeText(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

/** O rótulo da corrida cita o GP do F1DB (`race.gp`)? GP sem nome reconhecível não é conferido. */
export function raceLabelMatches(label: string, gp: string): boolean {
  const key = labelText(gp)
    .replace(/\bgrand prix\b.*$/, '')
    .trim();
  if (!key) return true;
  const text = labelText(label);
  return [key, ...(GP_LABEL_WORDS[key] ?? [])].some((w) => text.includes(` ${w} `));
}

/** Frases do texto com a posição de cada uma (o parágrafo não junta frases). */
export function sentenceSpans(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const m of text.matchAll(/[^.!?…\n]+[.!?…]*/gu)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = m.index + lead;
    out.push({ start, end: start + trimmed.length, text: trimmed });
  }
  return out;
}

/**
 * Achados de um texto do perfil: por frase, número fora do F1DB (grave) e termo proibido (alerta); no texto todo,
 * prompt injection (grave), tamanho, cara de letra de música e idioma (alertas). O texto não muda.
 */
function textFindings(
  text: string,
  field: string,
  locale: ProfileLocale,
  ctx: Ctx,
  max: number,
): EditorialFinding[] {
  const out: EditorialFinding[] = [];
  const all = (rule: string, reason: string) => out.push(finding(field, 0, text.length, rule, reason));
  if (detectPromptInjection(text).length) all('prompt_injection', 'padrão de prompt injection');
  if (text.length > max) all('too_long', `texto longo demais (${text.length} de ${max} caracteres)`);
  const prose = /\n\s*\n/.test(text) ? checkParagraphs(text) : checkProse(text);
  if (prose?.level === 'error') all('lyric_like', `cara de letra de música (${prose.reason})`);
  const lang = detectLanguage(text);
  if (lang && lang !== (locale === 'pt-BR' ? 'pt' : 'es'))
    all('wrong_language', `texto em ${lang === 'pt' ? 'português' : 'espanhol'}, não no idioma do arquivo`);
  // marcador de citação do passo de estruturação ("[S1]"): fica no texto, destacado para o revisor tirar
  for (const m of text.matchAll(/\[S\d+(?:\s*[,;]\s*S?\d+)*\]/g))
    out.push(
      finding(field, m.index, m.index + m[0].length, 'citation_marker', 'marcador de citação no texto'),
    );
  for (const s of sentenceSpans(text)) {
    const numbers = [
      ...new Set(
        checkFacts(stripModelCodes(s.text, ctx.facts.teams), ctx.sheet, locale)
          .filter((v) => v.kind === 'unknown_number')
          .map((v) => v.value),
      ),
    ];
    if (numbers.length)
      out.push(
        finding(field, s.start, s.end, 'unknown_number', `número fora do F1DB (${numbers.join(', ')})`),
      );
    const hits = findForbiddenTerms(withoutRacingAggression(s.text), locale, {
      allowPhrases: ctx.sheet.names,
    });
    if (hits.length)
      out.push(
        finding(
          field,
          s.start,
          s.end,
          'forbidden_term',
          `termo da lista de proibidos (${hits.map((h) => h.match).join(', ')})`,
        ),
      );
  }
  return out;
}

/** Achado da fonte (grave): sem fonte, fora da busca (`groundedUrls` do Gemini) ou de domínio não permitido. */
function sourceFinding(url: string | undefined, field: string, ctx: Ctx): EditorialFinding | null {
  if (!url || !/^https?:\/\//.test(url))
    return finding(field, 0, url?.length ?? 0, 'missing_source', 'sem fonte');
  if (ctx.grounded ? !ctx.grounded.has(url) : !ctx.cited.has(url))
    return finding(field, 0, url.length, 'source_not_grounded', 'fonte que não veio da busca');
  if (!isAllowedUrl(url))
    return finding(field, 0, url.length, 'source_domain', 'domínio da fonte não permitido');
  return null;
}

/** O rival citado pelo nome, entre os pilotos que largaram nas mesmas corridas (nome completo, ou sobrenome único). */
export function resolveRival(name: string, f: ProfileFacts): { f1dbId: string; name: string } | null {
  const n = normalizeText(name);
  const exact = f.contemporaries.find((c) => normalizeText(c.name) === n);
  if (exact) return exact;
  const last = n.split(' ').at(-1)!;
  const bySurname = f.contemporaries.filter((c) => normalizeText(c.name).split(' ').at(-1) === last);
  return bySurname.length === 1 ? bySurname[0]! : null;
}

const raceLabelFinding = (field: string, label: string, key: string, gp: string) =>
  finding(field, 0, 0, 'race_label', `o nome da corrida (${label}) não é o do GP da chave ${key} (${gp})`);

/**
 * Monta o perfil a partir da resposta do modelo **sem mexer nela**: os textos entram como vieram (só sem os espaços
 * das pontas) e cada problema vira um achado com o trecho e a gravidade. Só não há proposta sem bio.
 */
export function buildProfile(
  data: LegendReply,
  facts: ProfileFacts,
  ctx: Ctx,
): { entry: DriverEditorialEntry | null; reasons: string[] } {
  const tier = facts.tier === 'legend' ? 'legend' : 'regular';
  const bioText = (data.bio?.text ?? '').trim();
  if (!bioText) return { entry: null, reasons: ['o modelo não devolveu a bio'] };
  const findings: EditorialFinding[] = [];
  const bioSources = data.bio?.sources ?? [];
  findings.push(
    ...textFindings(bioText, 'bio', 'pt-BR', ctx, tier === 'legend' ? LIMITS.legendBio : LIMITS.regularBio),
  );
  if (!bioSources.length) findings.push(finding('bio.sources', 0, 0, 'missing_source', 'bio sem fonte'));
  bioSources.forEach((u, i) => {
    const f = sourceFinding(u, `bio.sources[${i}]`, ctx);
    if (f) findings.push(f);
  });
  const entry: DriverEditorialEntry = {
    slug: driverSlug(facts.f1dbId),
    name: facts.name,
    f1db: { id: facts.f1dbId },
    tier,
    bio: { text: bioText, sources: bioSources },
    review_status: 'draft',
  };

  if (tier === 'legend') {
    if (data.style) {
      const text = data.style.text.trim();
      const sources = data.style.sources ?? [];
      entry.style = { kind: data.style.kind, text, sources };
      findings.push(...textFindings(text, 'style', 'pt-BR', ctx, LIMITS.style));
      if (!sources.length)
        findings.push(finding('style.sources', 0, 0, 'missing_source', 'estilo sem fonte'));
      sources.forEach((u, i) => {
        const f = sourceFinding(u, `style.sources[${i}]`, ctx);
        if (f) findings.push(f);
      });
    }
    const strengths: NonNullable<DriverEditorialEntry['strengths']> = [];
    for (const s of data.strengths ?? []) {
      const field = `strengths[${strengths.length}]`;
      const text = s.text.trim();
      findings.push(...textFindings(text, field, 'pt-BR', ctx, LIMITS.item));
      const src = sourceFinding(s.source, `${field}.source`, ctx);
      if (src) findings.push(src);
      if (strengths.some((x) => x.key === s.key))
        findings.push(finding(field, 0, text.length, 'duplicate', `ponto forte repetido (${s.key})`));
      strengths.push({ key: s.key, text, ...(s.source ? { source: s.source } : {}) });
    }
    const races = new Map(facts.racesList.map((r) => [r.key, r]));
    const moments: NonNullable<DriverEditorialEntry['moments']> = [];
    for (const m of data.moments ?? []) {
      const field = `moments[${moments.length}]`;
      const text = m.text.trim();
      const race = races.get(m.race_key.trim());
      const label = m.race.trim();
      findings.push(...textFindings(text, field, 'pt-BR', ctx, LIMITS.item));
      if (race && label && !raceLabelMatches(label, race.gp))
        findings.push(raceLabelFinding(field, label, m.race_key, race.gp));
      if (!race)
        findings.push(
          finding(
            field,
            0,
            text.length,
            'race_not_driven',
            `corrida que o piloto não disputou (${m.race_key})`,
          ),
        );
      const src = sourceFinding(m.source, `${field}.source`, ctx);
      if (src) findings.push(src);
      if (race && moments.some((x) => x.year === race.year && x.round === race.round))
        findings.push(finding(field, 0, text.length, 'duplicate', `momento repetido (${m.race_key})`));
      // ano e rodada só da corrida da lista: com a chave de outra corrida, o momento ligaria um GP que não é o dele
      moments.push({
        ...(race ? { year: race.year, round: race.round } : {}),
        race: label || race?.gp || m.race_key,
        ...(m.wet ? { wet: true } : {}),
        text,
        ...(m.source ? { source: m.source } : {}),
      });
    }
    const rivalries: NonNullable<DriverEditorialEntry['rivalries']> = [];
    for (const r of data.rivalries ?? []) {
      const field = `rivalries[${rivalries.length}]`;
      const text = r.text.trim();
      const rival = resolveRival(r.driver, facts);
      findings.push(...textFindings(text, field, 'pt-BR', ctx, LIMITS.item));
      if (!rival)
        findings.push(
          finding(
            field,
            0,
            text.length,
            'rival_not_in_race',
            `rival que não largou junto com o piloto (${r.driver})`,
          ),
        );
      const src = sourceFinding(r.source, `${field}.source`, ctx);
      if (src) findings.push(src);
      if (rival && rivalries.some((x) => x.driver.f1db_id === rival.f1dbId))
        findings.push(finding(field, 0, text.length, 'duplicate', `rival repetido (${rival.name})`));
      rivalries.push({
        driver: { f1db_id: rival?.f1dbId ?? null, name: rival?.name ?? r.driver.trim() },
        text,
        ...(r.source ? { source: r.source } : {}),
      });
    }
    if (!moments.length) findings.push(finding('moments', 0, 0, 'no_moments', 'lenda sem nenhum momento'));
    if (strengths.length) entry.strengths = strengths;
    if (moments.length) entry.moments = moments;
    if (rivalries.length) entry.rivalries = rivalries;
  }
  if (findings.length) entry.findings = findings;
  return { entry, reasons: [] };
}

export async function proposeProfile(llm: LlmClient, facts: ProfileFacts): Promise<ProfileProposal> {
  const tier = facts.tier === 'legend' ? 'legend' : 'regular';
  const out: ProfileProposal = {
    f1dbId: facts.f1dbId,
    name: facts.name,
    tier,
    status: 'rejected',
    reasons: [],
    entries: { 'pt-BR': null, es: null },
  };
  const result = await llm.generateJson<LegendReply>({
    tier: 'research',
    webSearch: true,
    system: `Você é redator e pesquisador de uma base de dados esportiva. ${UNTRUSTED_DATA_RULE}`,
    messages: [{ role: 'user', content: profilePrompt(facts) }],
    schema: (tier === 'legend' ? LEGEND_SCHEMA : REGULAR_SCHEMA) as unknown as Record<string, unknown>,
    schemaName: tier === 'legend' ? 'f1_driver_legend_profile' : 'f1_driver_short_bio',
    purpose: `f1profile:${facts.f1dbId}`,
  });
  out.model = result.model;
  out.usage = result.usage;
  const ctx: Ctx = {
    facts,
    sheet: profileFactSheet(facts),
    grounded: result.groundedUrls ? new Set(result.groundedUrls) : null,
    cited: new Set(result.citations.map((c) => c.url)),
  };
  const built = buildProfile(result.data, facts, ctx);
  out.reasons.push(...built.reasons);
  if (!built.entry) return out;
  out.status = 'accepted';
  out.entries['pt-BR'] = built.entry;
  out.entries.es = await translateProfile(llm, built.entry, ctx, out);
  return out;
}

// ─── tradução (es) ───────────────────────────────────────────────────────────────────────────────

const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bio', 'style', 'strengths', 'moments', 'rivalries'],
  properties: {
    bio: { type: 'string' },
    style: { type: ['string', 'null'] },
    strengths: { type: 'array', items: { type: 'string' } },
    moments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['race', 'text'],
        properties: { race: { type: 'string' }, text: { type: 'string' } },
      },
    },
    rivalries: { type: 'array', items: { type: 'string' } },
  },
} as const;

export type TranslationReply = {
  bio: string;
  style: string | null;
  strengths: string[];
  moments: { race: string; text: string }[];
  rivalries: string[];
};

/** Achados que são do item e não do texto (valem igual na tradução, com o trecho = o item todo). */
const ITEM_RULES = new Set(['race_not_driven', 'rival_not_in_race', 'duplicate', 'no_moments']);
const isSourceField = (field: string) => /\.sources?(\[\d+\])?$/.test(field);

/**
 * O perfil em espanhol neutro, item a item, com as fontes e os vínculos do original. A tradução passa pelo mesmo
 * validador de texto; os achados de fonte e de item do original valem para ela. Nada é descartado: lista traduzida
 * com outro número de itens fica com o texto do original e um alerta.
 */
export function buildTranslation(
  entry: DriverEditorialEntry,
  reply: TranslationReply,
  ctx: Ctx,
): DriverEditorialEntry {
  const findings: EditorialFinding[] = [];
  const textOf = (field: string, translated: string | null | undefined, original: string, max: number) => {
    const text = (translated ?? '').trim();
    if (!text) {
      // sem tradução, fica o texto do original: os achados dele valem aqui também (e o idioma vira alerta)
      findings.push(
        finding(field, 0, original.length, 'translation_mismatch', 'sem tradução: texto do original'),
        ...textFindings(original, field, 'es', ctx, max),
      );
      return original;
    }
    findings.push(...textFindings(text, field, 'es', ctx, max));
    return text;
  };
  const es: DriverEditorialEntry = {
    ...entry,
    bio: {
      ...entry.bio,
      text: textOf(
        'bio',
        reply.bio,
        entry.bio.text,
        entry.tier === 'legend' ? LIMITS.legendBio : LIMITS.regularBio,
      ),
    },
  };
  delete es.findings;
  if (entry.style)
    es.style = { ...entry.style, text: textOf('style', reply.style, entry.style.text, LIMITS.style) };
  const pair = <T extends { text: string }>(
    name: string,
    original: T[] | undefined,
    translated: (string | undefined)[],
  ) => {
    if (!original?.length) return undefined;
    const same = translated.length === original.length;
    if (!same)
      findings.push(
        finding(
          name,
          0,
          0,
          'translation_mismatch',
          `tradução com ${translated.length} itens para ${original.length}`,
        ),
      );
    return original.map((o, i) => ({
      ...o,
      text: textOf(`${name}[${i}]`, same ? translated[i] : undefined, o.text, LIMITS.item),
    }));
  };
  const strengths = pair('strengths', entry.strengths, reply.strengths ?? []);
  if (strengths) es.strengths = strengths;
  const moments = pair(
    'moments',
    entry.moments,
    (reply.moments ?? []).map((m) => m.text),
  );
  if (moments) {
    es.moments = moments.map((m, i) => ({
      ...m,
      race: (reply.moments?.length === entry.moments!.length ? reply.moments[i]!.race.trim() : '') || m.race,
    }));
    // o nome traduzido também precisa ser o do GP da corrida ligada
    es.moments.forEach((m, i) => {
      const race = ctx.facts.racesList.find((r) => r.year === m.year && r.round === m.round);
      if (race && !raceLabelMatches(m.race, race.gp))
        findings.push(raceLabelFinding(`moments[${i}]`, m.race, race.key, race.gp));
    });
  }
  const rivalries = pair('rivalries', entry.rivalries, reply.rivalries ?? []);
  if (rivalries) es.rivalries = rivalries;
  // fonte e item: os achados do original, com o trecho no texto traduzido
  const textLength = (field: string) => {
    if (field === 'bio') return es.bio.text.length;
    if (field === 'style') return es.style?.text.length ?? 0;
    const m = /^(strengths|moments|rivalries)\[(\d+)\]$/.exec(field);
    return m ? ((es[m[1] as 'strengths'] ?? [])[Number(m[2])]?.text.length ?? 0) : 0;
  };
  for (const f of entry.findings ?? []) {
    if (isSourceField(f.field)) findings.push(f);
    else if (ITEM_RULES.has(f.rule))
      findings.push({ ...f, start: 0, end: f.end === 0 ? 0 : textLength(f.field) });
  }
  if (findings.length) es.findings = findings;
  return es;
}

async function translateProfile(
  llm: LlmClient,
  entry: DriverEditorialEntry,
  ctx: Ctx,
  out: ProfileProposal,
): Promise<DriverEditorialEntry | null> {
  const source = {
    bio: entry.bio.text,
    style: entry.style?.text ?? null,
    strengths: (entry.strengths ?? []).map((s) => s.text),
    moments: (entry.moments ?? []).map((m) => ({ race: m.race, text: m.text })),
    rivalries: (entry.rivalries ?? []).map((r) => r.text),
  };
  try {
    const result = await llm.generateJson<TranslationReply>({
      tier: 'standard',
      system:
        'Você traduz textos editoriais de esporte do português do Brasil para o espanhol neutro da América Latina. ' +
        'Mantenha nomes próprios, números e o sentido; não acrescente nem tire fatos. Devolva a mesma estrutura, na mesma ordem.',
      messages: [{ role: 'user', content: JSON.stringify(source) }],
      schema: TRANSLATION_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'f1_driver_profile_es',
      purpose: `f1profile:${entry.f1db.id}:es`,
    });
    if (out.usage)
      out.usage = {
        inputTokens: out.usage.inputTokens + result.usage.inputTokens,
        outputTokens: out.usage.outputTokens + result.usage.outputTokens,
        ...(out.usage.costUsd !== undefined || result.usage.costUsd !== undefined
          ? { costUsd: (out.usage.costUsd ?? 0) + (result.usage.costUsd ?? 0) }
          : {}),
      };
    return buildTranslation(entry, result.data, ctx);
  } catch (err) {
    // falha da chamada (não do validador): sem a versão es nesta rodada; a próxima tenta de novo
    out.reasons.push(`tradução es falhou: ${(err as Error).message}`);
    return null;
  }
}

/** Contagem dos achados de uma entrada (o selo "N alertas / N graves"). */
export function findingCounts(entry: DriverEditorialEntry | null): { alert: number; severe: number } {
  const list = entry?.findings ?? [];
  return {
    alert: list.filter((f) => f.severity === 'alert').length,
    severe: list.filter((f) => f.severity === 'severe').length,
  };
}

/** Junta as propostas novas às de uma execução anterior: a nova substitui a do mesmo piloto. */
export function mergeProfiles(previous: ProfileProposal[], fresh: ProfileProposal[]): ProfileProposal[] {
  const byId = new Map(previous.map((p) => [p.f1dbId, p]));
  for (const p of fresh) byId.set(p.f1dbId, p);
  return [...byId.values()];
}
