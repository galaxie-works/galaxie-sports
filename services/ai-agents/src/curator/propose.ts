import { checkChant, checkProse, type KnowledgeBase, type TeamEntry } from '@galaxie/knowledge';
import {
  detectPromptInjection,
  findForbiddenTerms,
  isAllowedUrl,
  normalizeText,
  UNTRUSTED_DATA_RULE,
} from '../guardrails/index.js';
import type { LlmClient, LlmUsage } from '../llm/types.js';
import type { MissingTeamGap, UnresolvedIdGap, VenueMismatchGap } from './gaps.js';

/**
 * Propostas do Agente Curador Semântico (issue #59, docs/06 §2): o LLM (tier `research`, com busca
 * na web) pesquisa e devolve JSON estruturado com fontes; o código monta a entrada YAML, força
 * `review_status: draft`, preenche os IDs do provedor a partir do banco (nunca do LLM) e reprova
 * qualquer proposta sem fonte, com termo proibido, com padrão de prompt injection ou que tente
 * alterar uma entrada `approved`.
 */

export type ProposalStatus = 'accepted' | 'rejected' | 'needs_review';

interface ProposalBase {
  status: ProposalStatus;
  /** Motivos (pt-BR) da reprovação ou do encaminhamento para revisão. */
  reasons: string[];
  model?: string;
  usage?: LlmUsage;
}

export interface AddTeamProposal extends ProposalBase {
  kind: 'add_team';
  gap: MissingTeamGap;
  /** Arquivo de destino (relativo a data/knowledge). */
  file: string;
  entry: TeamEntry | null;
}

export interface UpdateStadiumProposal extends ProposalBase {
  kind: 'update_stadium';
  gap: VenueMismatchGap;
  file: string;
  currentName: string | null;
  previousNames: string[];
  sources: string[];
}

export interface ResolveIdNote extends ProposalBase {
  kind: 'resolve_id';
  gap: UnresolvedIdGap;
}

export type CuratorProposal = AddTeamProposal | UpdateStadiumProposal | ResolveIdNote;

const HISPANIC = new Set([
  'AR',
  'BO',
  'CL',
  'CO',
  'CR',
  'EC',
  'ES',
  'GT',
  'HN',
  'MX',
  'PA',
  'PE',
  'PY',
  'SV',
  'UY',
  'VE',
]);
const LOCALE_BY_COUNTRY: Record<string, string> = {
  AR: 'es-AR',
  MX: 'es-MX',
  CO: 'es-CO',
  CL: 'es-CL',
  PE: 'es-PE',
  UY: 'es-UY',
  EC: 'es-EC',
};

/** Locale do texto da entrada: espanhol para países hispânicos, português para o resto (padrão da base). */
export function entryLocale(countryCode: string | null): string {
  const cc = (countryCode ?? '').toUpperCase();
  if (LOCALE_BY_COUNTRY[cc]) return LOCALE_BY_COUNTRY[cc]!;
  return HISPANIC.has(cc) ? 'es-AR' : 'pt-BR';
}

export function teamsFileFor(countryCode: string): string {
  return `football/teams/${countryCode.toLowerCase()}.yaml`;
}

/** kebab-case sem acentos, único na base (sufixo com o país se já existir). */
export function makeSlug(name: string, countryCode: string | null, kb: KnowledgeBase): string {
  const base =
    normalizeText(name)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'time';
  const taken = new Set(kb.teams.map((t) => t.entry.slug));
  if (!taken.has(base)) return base;
  const withCountry = `${base}-${(countryCode ?? 'xx').toLowerCase()}`;
  if (!taken.has(withCountry)) return withCountry;
  let i = 2;
  while (taken.has(`${withCountry}-${i}`)) i++;
  return `${withCountry}-${i}`;
}

const str = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
const strList = (v: unknown, maxItems: number, maxLen = 80): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((x) => str(x, maxLen)).filter((x): x is string => !!x))].slice(0, maxItems)
    : [];

/** Fontes: URLs http(s) declaradas + citações do provedor, sem duplicatas (máx. 5). */
export function collectSources(declared: unknown, citations: readonly { url: string }[]): string[] {
  const urls = [...strList(declared, 10, 500), ...citations.map((c) => c.url)].filter((u) => isAllowedUrl(u));
  return [...new Set(urls)].slice(0, 5);
}

/** Reprovações comuns: termos proibidos, injeção e letra de canção nos campos de texto. */
export function textIssues(
  texts: readonly string[],
  locale: string,
  chants: readonly string[] = [],
): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const hit of findForbiddenTerms(t, locale, { allowRivalry: false }))
      out.push(`termo proibido (${hit.category}): "${hit.match}"`);
    for (const s of detectPromptInjection(t)) out.push(`padrão de prompt injection: "${s.excerpt}"`);
    const prose = checkProse(t);
    if (prose?.level === 'error') out.push(`texto parece letra de canção: ${prose.reason}`);
  }
  for (const c of chants) {
    const v = checkChant(c);
    if (v?.level === 'error') out.push(`grito inválido: ${v.reason}`);
  }
  return out;
}

const TEAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'found',
    'names',
    'founded',
    'city',
    'region',
    'colors',
    'nicknames',
    'fans',
    'mascot',
    'stadium',
    'identity',
    'sources',
  ],
  properties: {
    found: { type: 'boolean', description: 'false se não encontrou fontes confiáveis sobre o clube' },
    names: {
      type: 'object',
      additionalProperties: false,
      required: ['official', 'short', 'abbreviation'],
      properties: {
        official: { type: 'string' },
        short: { type: 'string' },
        abbreviation: { type: ['string', 'null'] },
      },
    },
    founded: { type: ['string', 'null'], description: 'AAAA-MM-DD, somente se confirmado' },
    city: { type: ['string', 'null'] },
    region: { type: ['string', 'null'] },
    colors: { type: 'array', items: { type: 'string' } },
    nicknames: { type: 'array', items: { type: 'string' } },
    fans: {
      type: 'object',
      additionalProperties: false,
      required: ['demonym'],
      properties: { demonym: { type: ['string', 'null'] } },
    },
    mascot: { type: ['string', 'null'] },
    stadium: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['name', 'city'],
      properties: { name: { type: 'string' }, city: { type: ['string', 'null'] } },
    },
    identity: { type: 'array', items: { type: 'string' }, maxItems: 2 },
    sources: { type: 'array', items: { type: 'string' } },
  },
} as const;

const STADIUM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['current_name', 'previous_names', 'sources', 'confident'],
  properties: {
    current_name: { type: ['string', 'null'] },
    previous_names: { type: 'array', items: { type: 'string' } },
    sources: { type: 'array', items: { type: 'string' } },
    confident: { type: 'boolean' },
  },
} as const;

function curatorSystem(): string {
  return [
    'Você é curador da base semântica de futebol de uma API esportiva. Pesquise em fontes confiáveis',
    '(site oficial do clube, federação/liga, imprensa esportiva de referência, enciclopédias) e responda',
    'somente com fatos verificáveis, cada um coberto pelas fontes listadas em `sources` (URLs completas).',
    'Na dúvida, use null ou lista vazia. Nunca invente datas, apelidos ou mascotes.',
    'Nada de ofensas, provocações a rivais, discriminação, violência, tragédias ou letras de hinos/cânticos.',
    UNTRUSTED_DATA_RULE,
  ].join(' ');
}

/** Pesquisa e monta a entrada YAML de um clube ausente da base. */
export async function proposeNewTeam(
  gap: MissingTeamGap,
  kb: KnowledgeBase,
  llm: LlmClient,
): Promise<AddTeamProposal> {
  const proposal: AddTeamProposal = {
    kind: 'add_team',
    gap,
    file: gap.countryCode ? teamsFileFor(gap.countryCode) : '',
    entry: null,
    status: 'rejected',
    reasons: [],
  };
  if (!gap.countryCode) {
    proposal.reasons.push('país do clube desconhecido no core');
    return proposal;
  }
  const locale = entryLocale(gap.countryCode);
  const language = locale.startsWith('pt') ? 'português (pt-BR)' : 'espanhol';
  let res;
  try {
    res = await llm.generateJson<Record<string, unknown>>({
      tier: 'research',
      webSearch: true,
      system: curatorSystem(),
      messages: [
        {
          role: 'user',
          content: [
            `Clube: ${gap.name} (país ${gap.countryCode}${gap.countryName ? `, ${gap.countryName}` : ''}).`,
            `Competições atuais: ${gap.competitions.join(', ')}.`,
            `Escreva \`identity\` (no máximo 2 fatos curtos) em ${language}.`,
            'Devolva o perfil semântico no schema pedido.',
          ].join('\n'),
        },
      ],
      schema: TEAM_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'team_profile_proposal',
      purpose: `curator:team:${gap.participantId}`,
      maxOutputTokens: 1500,
    });
  } catch (err) {
    proposal.reasons.push(`LLM falhou: ${err instanceof Error ? err.message : String(err)}`);
    return proposal;
  }
  proposal.model = res.model;
  proposal.usage = res.usage;
  const d = res.data ?? {};
  if (d['found'] === false) {
    proposal.reasons.push('o pesquisador não encontrou fontes confiáveis');
    return proposal;
  }
  const names = (d['names'] ?? {}) as Record<string, unknown>;
  const official = str(names['official']) ?? gap.name;
  const short = str(names['short']) ?? gap.name;
  const sources = collectSources(d['sources'], res.citations);
  if (!sources.length) proposal.reasons.push('proposta sem fonte (URL) válida');

  const entry: TeamEntry = {
    slug: makeSlug(short, gap.countryCode, kb),
    names: { official, short },
    api_sports: {
      team_id: gap.apiSportsTeamId,
      match: { name: gap.name, country: gap.countryName ?? gap.countryCode },
    },
    nicknames: strList(d['nicknames'], 5),
    sources,
    review_status: 'draft',
  };
  const abbreviation = str(names['abbreviation'], 5)?.toUpperCase();
  if (abbreviation && /^[\p{Lu}0-9]{2,5}$/u.test(abbreviation)) entry.names.abbreviation = abbreviation;
  const founded = str(d['founded'], 10);
  entry.founded = founded && /^\d{4}-\d{2}-\d{2}$/.test(founded) ? founded : null;
  const city = str(d['city'], 80);
  if (city) entry.city = city;
  const region = str(d['region'], 40);
  if (region) entry.region = region;
  const colors = strList(d['colors'], 4, 30);
  if (colors.length) entry.colors = colors;
  const demonym = str((d['fans'] as Record<string, unknown> | null)?.['demonym'], 40);
  if (demonym) entry.fans = { demonym };
  const mascot = str(d['mascot'], 60);
  if (mascot) entry.mascot = mascot;
  const stadium = d['stadium'] as Record<string, unknown> | null;
  const stadiumName = str(stadium?.['name'], 100);
  if (stadiumName) {
    entry.stadium = { name: stadiumName };
    const stadiumCity = str(stadium?.['city'], 80);
    if (stadiumCity) entry.stadium.city = stadiumCity;
  }
  const identity = strList(d['identity'], 2, 300);
  if (identity.length) entry.identity = identity;

  const texts = [
    official,
    short,
    ...entry.nicknames,
    ...(entry.identity ?? []),
    ...(entry.mascot ? [entry.mascot] : []),
    ...(entry.fans?.demonym ? [entry.fans.demonym] : []),
    ...(entry.stadium ? [entry.stadium.name] : []),
  ];
  proposal.reasons.push(...textIssues(texts, locale));
  proposal.entry = entry;
  proposal.status = proposal.reasons.length ? 'rejected' : 'accepted';
  return proposal;
}

/** Confere o nome atual do estádio (naming rights) e propõe a troca, se for o caso. */
export async function proposeStadiumUpdate(
  gap: VenueMismatchGap,
  llm: LlmClient,
): Promise<UpdateStadiumProposal> {
  const proposal: UpdateStadiumProposal = {
    kind: 'update_stadium',
    gap,
    file: gap.file,
    currentName: null,
    previousNames: [],
    sources: [],
    status: 'rejected',
    reasons: [],
  };
  let res;
  try {
    res = await llm.generateJson<Record<string, unknown>>({
      tier: 'research',
      webSearch: true,
      system: curatorSystem(),
      messages: [
        {
          role: 'user',
          content: [
            `Estádio do clube "${gap.slug}"${gap.city ? ` (${gap.city})` : ''}.`,
            `Nome na base: "${gap.yamlStadium}" (outros nomes: ${gap.yamlNicknames.join(', ') || 'nenhum'}).`,
            `Nome informado pelo provedor de dados: "${gap.providerVenue}".`,
            'Qual é o nome oficial ATUAL do estádio (considere contratos de naming rights)? Liste nomes anteriores e as fontes.',
          ].join('\n'),
        },
      ],
      schema: STADIUM_SCHEMA as unknown as Record<string, unknown>,
      schemaName: 'stadium_name_check',
      purpose: `curator:stadium:${gap.slug}`,
      maxOutputTokens: 600,
    });
  } catch (err) {
    proposal.reasons.push(`LLM falhou: ${err instanceof Error ? err.message : String(err)}`);
    return proposal;
  }
  proposal.model = res.model;
  proposal.usage = res.usage;
  const current = str(res.data?.['current_name'], 100);
  proposal.currentName = current;
  proposal.previousNames = strList(res.data?.['previous_names'], 5, 100);
  proposal.sources = collectSources(res.data?.['sources'], res.citations);
  if (!current || res.data?.['confident'] !== true) proposal.reasons.push('pesquisa sem conclusão confiável');
  if (!proposal.sources.length) proposal.reasons.push('proposta sem fonte (URL) válida');
  proposal.reasons.push(...textIssues([current ?? '', ...proposal.previousNames].filter(Boolean), 'pt-BR'));
  if (proposal.reasons.length) return proposal;
  if (normalizeText(current!) === normalizeText(gap.yamlStadium)) {
    proposal.reasons.push('a base já tem o nome atual; o provedor está desatualizado');
    return proposal;
  }
  if (gap.reviewStatus === 'approved') {
    // Nunca altera entrada aprovada sem revisão: vira nota no relatório para a revisão editorial.
    proposal.status = 'needs_review';
    proposal.reasons.push('entrada approved: mudança proposta só no relatório, sem alterar o YAML');
    return proposal;
  }
  proposal.status = 'accepted';
  return proposal;
}

/** Clube na base pelo nome, mas sem ID do provedor: resolve com `pnpm resolve:ids`, não com IA. */
export function resolveIdNote(gap: UnresolvedIdGap): ResolveIdNote {
  return {
    kind: 'resolve_id',
    gap,
    status: 'needs_review',
    reasons: ['clube já existe na base sem api_sports.team_id: rode `pnpm resolve:ids --write`'],
  };
}
