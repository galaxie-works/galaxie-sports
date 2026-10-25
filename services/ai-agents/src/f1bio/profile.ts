/**
 * Perfil editorial de piloto de F1 (`formula-1/editorial/<locale>.yaml`, perfis `draft` revisados no painel):
 * lenda = bio, estilo, pontos fortes, momentos marcantes e rivalidades; regular = bio curta.
 *
 * O LLM (tier `research`, com busca na web) recebe os fatos do F1DB e a lista de corridas do piloto e devolve uma
 * estrutura fixa em pt-BR, cada item com a URL da fonte. Regras, no código e não no prompt:
 * - item sem fonte, com fonte que não veio da busca (`groundedUrls` do Gemini) ou de domínio não permitido **não
 *   entra**;
 * - número que não está nos fatos do F1DB (FactSheet: totais, temporadas, corridas, pistas) reprova o item;
 * - momento precisa citar uma corrida da lista do piloto (`<ano>-<rodada>`); rival precisa ser um piloto que largou
 *   nas mesmas corridas (vínculo pelo F1DB, nunca pelo LLM);
 * - termo proibido, padrão de prompt injection ou texto com cara de letra de música reprovam o item;
 * - sem a bio, ou lenda sem nenhum momento, não há proposta.
 * Depois, um segundo pedido (tier `standard`, sem busca) traduz o perfil aceito para o espanhol neutro (`es`), item a
 * item e com as mesmas fontes; a tradução passa pelas mesmas regras de texto.
 */
import {
  checkParagraphs,
  checkProse,
  DRIVER_STRENGTHS,
  DRIVING_STYLES,
  driverSlug,
  type DriverEditorialEntry,
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
  entries: Record<ProfileLocale, DriverEditorialEntry | null>;
  /** Itens descartados e o motivo (para o relatório). */
  dropped: { locale: ProfileLocale; field: string; text: string; reason: string }[];
  model?: string;
  usage?: LlmUsage;
}

/** Tamanhos de cada parte (o schema da base aceita um pouco mais, para a edição no painel). */
const LIMITS = { legendBio: 1500, regularBio: 450, item: 280 } as const;
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

type LegendReply = {
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

interface Ctx {
  facts: ProfileFacts;
  sheet: FactSheet;
  grounded: Set<string> | null;
  cited: Set<string>;
}

/** Motivo para recusar um texto (ou null): injection, termos, letra de música, idioma e números fora do F1DB. */
function textProblem(text: string, locale: ProfileLocale, ctx: Ctx, max: number): string | null {
  if (!text) return 'texto vazio';
  if (text.length > max) return 'texto longo demais';
  if (detectPromptInjection(text).length) return 'padrão de prompt injection';
  const hits = findForbiddenTerms(text, locale, { allowPhrases: ctx.sheet.names });
  if (hits.length) return `termo proibido (${hits.map((h) => h.match).join(', ')})`;
  // a bio vem em parágrafos (prosa); os itens são frases curtas
  const prose = /\n\s*\n/.test(text) ? checkParagraphs(text) : checkProse(text);
  if (prose?.level === 'error') return `texto reprovado pelo validador da base (${prose.reason})`;
  const lang = detectLanguage(text);
  if (lang && lang !== (locale === 'pt-BR' ? 'pt' : 'es')) return 'texto em outro idioma';
  const numbers = checkFacts(text, ctx.sheet, locale).filter((v) => v.kind === 'unknown_number');
  if (numbers.length) return `número fora do F1DB (${[...new Set(numbers.map((v) => v.value))].join(', ')})`;
  return null;
}

/** Motivo para recusar uma fonte (ou null): tem de ser URL da busca e de domínio permitido. */
function sourceProblem(url: string, ctx: Ctx): string | null {
  if (!url || !/^https?:\/\//.test(url)) return 'sem fonte';
  if (ctx.grounded ? !ctx.grounded.has(url) : !ctx.cited.has(url)) return 'fonte não veio da busca';
  if (!isAllowedUrl(url)) return 'domínio da fonte não permitido';
  return null;
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const cleanBio = (s: string) =>
  s
    .split(/\n\s*\n/)
    .map(clean)
    .filter(Boolean)
    .join('\n\n');

/** O rival citado pelo nome, entre os pilotos que largaram nas mesmas corridas (nome completo, ou sobrenome único). */
export function resolveRival(name: string, f: ProfileFacts): { f1dbId: string; name: string } | null {
  const n = normalizeText(name);
  const exact = f.contemporaries.find((c) => normalizeText(c.name) === n);
  if (exact) return exact;
  const last = n.split(' ').at(-1)!;
  const bySurname = f.contemporaries.filter((c) => normalizeText(c.name).split(' ').at(-1) === last);
  return bySurname.length === 1 ? bySurname[0]! : null;
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
    dropped: [],
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
  const data = result.data;
  const drop = (field: string, text: string, reason: string) =>
    out.dropped.push({ locale: 'pt-BR', field, text, reason });
  /** Fontes que passam (sem repetir); as recusadas vão para o relatório. */
  const goodSources = (field: string, list: string[]) =>
    [...new Set(list.map(clean))].filter((u) => {
      const why = sourceProblem(u, ctx);
      if (why) drop(field, u, why);
      return !why;
    });

  // bio: obrigatória
  const bioText = cleanBio(data.bio?.text ?? '');
  const bioSources = goodSources('bio', data.bio?.sources ?? []);
  const bioProblem =
    textProblem(bioText, 'pt-BR', ctx, tier === 'legend' ? LIMITS.legendBio : LIMITS.regularBio) ??
    (bioSources.length ? null : 'bio sem fonte da busca');
  if (bioProblem) {
    drop('bio', bioText, bioProblem);
    out.reasons.push(`bio recusada: ${bioProblem}`);
    return out;
  }
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
      const text = clean(data.style.text);
      const sources = goodSources('style', data.style.sources);
      const why =
        textProblem(text, 'pt-BR', ctx, LIMITS.item) ?? (sources.length ? null : 'sem fonte da busca');
      if (why) drop('style', text, why);
      else entry.style = { kind: data.style.kind, text, sources };
    }
    const strengths: NonNullable<DriverEditorialEntry['strengths']> = [];
    for (const s of data.strengths ?? []) {
      const text = clean(s.text);
      const why =
        sourceProblem(s.source, ctx) ??
        textProblem(text, 'pt-BR', ctx, LIMITS.item) ??
        (strengths.some((x) => x.key === s.key) ? 'ponto forte repetido' : null);
      if (why) drop('strengths', text, why);
      else if (strengths.length < MAX.strengths) strengths.push({ key: s.key, text, source: s.source });
    }
    const races = new Map(facts.racesList.map((r) => [r.key, r]));
    const moments: NonNullable<DriverEditorialEntry['moments']> = [];
    for (const m of data.moments ?? []) {
      const text = clean(m.text);
      const race = races.get(m.race_key.trim());
      const why =
        (race ? null : `corrida fora da lista do piloto (${m.race_key})`) ??
        sourceProblem(m.source, ctx) ??
        textProblem(text, 'pt-BR', ctx, LIMITS.item) ??
        (moments.some((x) => x.year === race!.year && x.round === race!.round) ? 'momento repetido' : null);
      if (why) drop('moments', text, why);
      else if (moments.length < MAX.moments)
        moments.push({
          year: race!.year,
          round: race!.round,
          race: clean(m.race) || race!.gp,
          ...(m.wet ? { wet: true } : {}),
          text,
          source: m.source,
        });
    }
    const rivalries: NonNullable<DriverEditorialEntry['rivalries']> = [];
    for (const r of data.rivalries ?? []) {
      const text = clean(r.text);
      const rival = resolveRival(r.driver, facts);
      const why =
        (rival ? null : `rival fora do F1DB (${r.driver})`) ??
        sourceProblem(r.source, ctx) ??
        textProblem(text, 'pt-BR', ctx, LIMITS.item) ??
        (rivalries.some((x) => x.driver.f1db_id === rival!.f1dbId) ? 'rival repetido' : null);
      if (why) drop('rivalries', text, why);
      else if (rivalries.length < MAX.rivalries)
        rivalries.push({ driver: { f1db_id: rival!.f1dbId, name: rival!.name }, text, source: r.source });
    }
    if (!moments.length) {
      out.reasons.push('lenda sem nenhum momento com fonte verificável');
      return out;
    }
    if (strengths.length) entry.strengths = strengths;
    entry.moments = moments.sort((a, b) => a.year - b.year || a.round - b.round);
    if (rivalries.length) entry.rivalries = rivalries;
  }
  out.status = 'accepted';
  out.entries['pt-BR'] = entry;
  out.entries.es = await translateProfile(llm, entry, ctx, out);
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

type TranslationReply = {
  bio: string;
  style: string | null;
  strengths: string[];
  moments: { race: string; text: string }[];
  rivalries: string[];
};

/** O perfil aceito em espanhol neutro, item a item (as fontes são as do original); item recusado fica de fora. */
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
  let reply: TranslationReply;
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
    reply = result.data;
    if (out.usage)
      out.usage = {
        inputTokens: out.usage.inputTokens + result.usage.inputTokens,
        outputTokens: out.usage.outputTokens + result.usage.outputTokens,
        ...(out.usage.costUsd !== undefined || result.usage.costUsd !== undefined
          ? { costUsd: (out.usage.costUsd ?? 0) + (result.usage.costUsd ?? 0) }
          : {}),
      };
  } catch (err) {
    out.reasons.push(`tradução es falhou: ${(err as Error).message}`);
    return null;
  }
  const drop = (field: string, text: string, reason: string) =>
    out.dropped.push({ locale: 'es', field, text, reason });
  const ok = (field: string, text: string | null | undefined, max: number): string | null => {
    const t = field === 'bio' ? cleanBio(text ?? '') : clean(text ?? '');
    const why = textProblem(t, 'es', ctx, max);
    if (why) drop(field, t, why);
    return why ? null : t;
  };
  const bio = ok('bio', reply.bio, entry.tier === 'legend' ? LIMITS.legendBio : LIMITS.regularBio);
  if (!bio) {
    out.reasons.push('tradução es da bio recusada');
    return null;
  }
  const es: DriverEditorialEntry = { ...entry, bio: { ...entry.bio, text: bio } };
  delete es.style;
  delete es.strengths;
  delete es.moments;
  delete es.rivalries;
  if (entry.style) {
    const text = ok('style', reply.style, LIMITS.item);
    if (text) es.style = { ...entry.style, text };
  }
  // lista traduzida com tamanho diferente do original: não dá para casar item a item
  const pair = <T>(field: string, original: T[] | undefined, translated: unknown[]): T[] | null => {
    if (!original?.length) return null;
    if (translated.length !== original.length) {
      drop(field, '', 'tradução com outro número de itens');
      return null;
    }
    return original;
  };
  const strengths = pair('strengths', entry.strengths, reply.strengths ?? []);
  if (strengths) {
    const list = strengths.flatMap((s, i) => {
      const text = ok('strengths', reply.strengths[i], LIMITS.item);
      return text ? [{ ...s, text }] : [];
    });
    if (list.length) es.strengths = list;
  }
  const moments = pair('moments', entry.moments, reply.moments ?? []);
  if (moments) {
    const list = moments.flatMap((m, i) => {
      const text = ok('moments', reply.moments[i]!.text, LIMITS.item);
      return text ? [{ ...m, race: clean(reply.moments[i]!.race) || m.race, text }] : [];
    });
    if (list.length) es.moments = list;
  }
  const rivalries = pair('rivalries', entry.rivalries, reply.rivalries ?? []);
  if (rivalries) {
    const list = rivalries.flatMap((r, i) => {
      const text = ok('rivalries', reply.rivalries[i], LIMITS.item);
      return text ? [{ ...r, text }] : [];
    });
    if (list.length) es.rivalries = list;
  }
  return es;
}

/** Junta as propostas novas às de uma execução anterior: a nova substitui a do mesmo piloto. */
export function mergeProfiles(previous: ProfileProposal[], fresh: ProfileProposal[]): ProfileProposal[] {
  const byId = new Map(previous.map((p) => [p.f1dbId, p]));
  for (const p of fresh) byId.set(p.f1dbId, p);
  return [...byId.values()];
}
