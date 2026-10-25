/**
 * Prompts da pesquisa da grade. Genéricos de propósito: nenhum nome de operadora ou streaming é
 * escrito aqui. As plataformas de cada país vêm da busca (fontes públicas); os nomes que entram no
 * prompt (plataformas e planos já conhecidos, canais da biblioteca) vêm do banco e do dicionário em
 * tempo de execução, só para o modelo reaproveitar a mesma grafia.
 */
import type { PlatformKind } from '@galaxie/db';
import { UNTRUSTED_DATA_RULE } from '../guardrails/index.js';
import { sanitizeText, UNTRUSTED_CONTENT_RULES, wrapUntrusted } from '../llm/hygiene.js';
import { COUNTRY_NAMES } from '../wtw/prompt.js';

/** Nome do país e idioma da busca. */
function countryOf(code: string): { name: string; language: string } {
  return {
    name: COUNTRY_NAMES[code]?.pt ?? code,
    language: code === 'BR' ? 'português' : 'espanhol',
  };
}

export const KIND_LABEL: Record<PlatformKind, string> = {
  pay_tv_operator: 'operadora de TV paga (cabo, satélite ou IPTV)',
  vmvpd: 'TV paga pela internet com grade linear de canais (vMVPD)',
  telco_bundle: 'combo de telecom (internet, celular ou fixo com TV ou streaming)',
  streaming: 'serviço de streaming com esporte ao vivo',
};

const list = (items: readonly string[], max = 80) =>
  items.length
    ? items
        .slice(0, max)
        .map((n) => `- ${sanitizeText(n, 120)}`)
        .join('\n')
    : '(nenhum)';

export function lineupSystemPrompt(): string {
  return [
    'Você pesquisa ofertas de TV paga e streaming na América Latina para uma base de dados esportiva B2B. Use só o que a busca na web de hoje encontrar.',
    'Fontes: o site oficial da própria plataforma (ou do grupo dono dela) — página do plano, grade de canais, regulamento da oferta. Comparadores de planos, imprensa, documentos de terceiros, lojas de app e redes sociais não provam a oferta.',
    'Sem fonte, sem conteúdo: cada plano, canal e streaming leva a URL da fonte da busca e o trecho que o prova. O que vier só da memória fica com fonte e trecho null (e não entra). Não invente canais: se a página não lista o canal pelo nome, ele não entra.',
    UNTRUSTED_CONTENT_RULES,
    UNTRUSTED_DATA_RULE,
  ].join('\n\n');
}

export function discoveryPrompt(input: { country: string; known: readonly string[] }): string {
  const c = countryOf(input.country);
  return [
    `País: ${c.name} (${input.country}). Pesquise em ${c.language}.`,
    'Liste as principais plataformas pelas quais o público do país assiste a esporte ao vivo pago, de quatro tipos:',
    ...Object.entries(KIND_LABEL).map(([k, v]) => `- ${k}: ${v};`),
    'Inclua as de maior base de assinantes e as que têm direitos de campeonatos relevantes no país. Até 15 plataformas.',
    `Plataformas já conhecidas (se for a mesma, use exatamente este nome):\n${list(input.known)}`,
    'Para cada plataforma: nome comercial, tipo, site oficial, outros domínios oficiais da empresa ou do grupo onde ficam os planos (se houver) e as fontes que mostram que ela opera no país.',
  ].join('\n\n');
}

export interface PlatformPromptInput {
  name: string;
  kind: PlatformKind;
  website: string | null;
  officialDomains?: readonly string[];
}

function platformLines(country: string, p: PlatformPromptInput): string[] {
  const c = countryOf(country);
  const domains = (p.officialDomains ?? []).map((d) => sanitizeText(d, 120));
  return [
    // um país por vez: com vários, o modelo só cita fonte de metade (teste de 24/10)
    `País: ${c.name} (${country}). Pesquise em ${c.language}, só este país.`,
    `Plataforma: ${sanitizeText(p.name, 120)} — ${KIND_LABEL[p.kind]}${p.website ? ` · site oficial: ${sanitizeText(p.website, 200)}` : ''}${domains.length ? ` · outros domínios oficiais: ${domains.join(', ')}` : ''}.`,
  ];
}

const EXCERPT_RULE =
  'Trechos: pode resumir, mas mantenha o nome do plano, os números do preço e os nomes de canais e streamings exatamente como a fonte escreve.';

/** Etapa 1: a lista dos planos (só nome e fonte) e o catálogo de complementos com preço. */
export function catalogPrompt(input: {
  country: string;
  platform: PlatformPromptInput;
  knownPlans: readonly string[];
  services: readonly string[];
}): string {
  return [
    ...platformLines(input.country, input.platform),
    'Liste TODOS os planos vigentes dessa plataforma no país que dão acesso a esporte: só o nome, a página oficial do plano, a fonte e o trecho que cita o plano. Não pule nenhum plano que aparecer na busca; o detalhe de cada um vem depois, numa pesquisa só dele.',
    'Liste também o catálogo de complementos: o que qualquer plano contrata à parte (streaming, pacote ou canal avulso), com o preço mensal e a fidelidade em meses. Uma linha por oferta: o mesmo serviço com preço mensal e com fidelidade de 12 meses são duas linhas. Só com fonte oficial da plataforma e o trecho com o nome e o preço.',
    EXCERPT_RULE,
    `Planos já conhecidos (se for o mesmo, use exatamente este nome):\n${list(input.knownPlans, 30)}`,
    `Streamings e canais da nossa biblioteca (se for um deles, use exatamente este nome):\n${list(input.services, 80)}`,
  ].join('\n\n');
}

/** Etapa 2: o detalhe de um plano (preços, grade de canais esportivos e streamings inclusos). */
export function planPrompt(input: {
  country: string;
  platform: PlatformPromptInput;
  plan: string;
  /** Os outros planos da plataforma (para não confundir um com o outro). */
  siblings: readonly string[];
  channels: readonly string[];
  services: readonly string[];
}): string {
  return [
    ...platformLines(input.country, input.platform),
    `Plano: ${sanitizeText(input.plan, 160)}. Pesquise só este plano.`,
    `Outros planos da mesma plataforma (não são este; não misture a grade deles):\n${list(input.siblings, 30)}`,
    'Levante: os preços mensais deste plano (um por fonte, com a data da fonte quando ela diz; se fontes diferentes dão valores diferentes, liste todos), os canais esportivos lineares da grade DESTE plano e os streamings que a página do plano diz que vêm inclusos sem custo extra.',
    'Preço: o CHEIO de lista ("preço de lista", "depois", "a partir do 2º mês"). Ignore o promocional do 1º mês ou dos primeiros meses e o desconto de entrada.',
    'Prova do plano: cada trecho cita o nome deste plano (ou a fonte é a página deste plano). Lista de canais de uma página geral, de marketing ("SporTV, ESPN, Globo e muito mais") ou de outro plano não vale para este plano: se a fonte não diz que o canal está neste plano, ele não entra. Complemento pago à parte não é incluso.',
    EXCERPT_RULE,
    'Se a busca de hoje não achar este plano, responda encontrado = false.',
    `Canais esportivos da nossa biblioteca (se o canal for um deles, use exatamente este nome):\n${list(input.channels, 120)}`,
    `Streamings da nossa biblioteca (se for um deles, use exatamente este nome):\n${list(input.services, 60)}`,
  ].join('\n\n');
}

// ─── pesquisa pela página oficial ────────────────────────────────────────────────────────────────

/**
 * Descoberta das páginas de planos (só quando a plataforma não tem nenhuma guardada): busca curta, no
 * site oficial. O resto da pesquisa lê essas páginas do nosso lado, sem busca.
 */
export function planPagesPrompt(input: { country: string; platform: PlatformPromptInput }): string {
  return [
    ...platformLines(input.country, input.platform),
    'Ache só as URLs das páginas do site oficial onde a plataforma publica os planos vigentes no país, com os preços: a página da lista de planos e, se o site tiver, a página de cada plano e a da grade de canais.',
    'Faça no máximo 3 buscas, de preferência com "site:" no domínio oficial. Não levante planos, preços nem canais: só as URLs.',
    'Só URLs do site oficial ou dos domínios oficiais da plataforma que apareceram na busca de hoje. Até 6, a da lista de planos primeiro.',
  ].join('\n\n');
}

/** Página oficial lida do nosso lado, como entra no prompt da extração. */
export interface PromptPage {
  url: string;
  text: string;
  /** Listas abertas pelo botão de cada plano (rótulo = o cartão do plano). */
  sections: { label: string | null; text: string }[];
}

/**
 * Tetos de caracteres das páginas no prompt da extração (configuráveis no painel de Operação):
 * - `LINEUP_PROMPT_MAX_CHARS`: o texto de todas as páginas de planos de uma plataforma numa chamada,
 *   dividido igualmente entre elas (cada página fica com ao menos 5 mil);
 * - `LINEUP_PAGE_MAX_CHARS`: o teto de uma página sozinha. O padrão é o do total, como era o efeito
 *   antes (a constante de 60 mil por página não era aplicada na extração).
 * O que passa do teto é cortado do fim da página (primeiro as listas abertas dos planos, depois os
 * últimos cartões): o modelo não vê esses planos, preços e canais, e a revisita não marca nada como
 * removido. Cada corte vai para o log e para o resultado da tarefa (`promptCuts`).
 */
export const LINEUP_PROMPT_LIMITS = {
  page: { key: 'LINEUP_PAGE_MAX_CHARS', default: 150_000, min: 5_000, max: 600_000 },
  total: { key: 'LINEUP_PROMPT_MAX_CHARS', default: 150_000, min: 10_000, max: 600_000 },
} as const;
/** Menor fatia por página quando o total é dividido entre muitas páginas. */
const MIN_PAGE_SHARE = 5_000;

export interface LineupPromptLimits {
  /** Teto de uma página (`LINEUP_PAGE_MAX_CHARS`). */
  pageChars: number;
  /** Teto de todas as páginas da plataforma (`LINEUP_PROMPT_MAX_CHARS`). */
  totalChars: number;
}

export const DEFAULT_LINEUP_PROMPT_LIMITS: LineupPromptLimits = {
  pageChars: LINEUP_PROMPT_LIMITS.page.default,
  totalChars: LINEUP_PROMPT_LIMITS.total.default,
};

/**
 * Os tetos do env (o painel sobrescreve pelo env de cada execução). Vazio usa o padrão; valor que não é
 * inteiro ou fora da faixa também, com aviso em `warn`.
 */
export function lineupPromptLimitsFromEnv(
  env: Record<string, string | undefined>,
  warn: (message: string) => void = () => {},
): LineupPromptLimits {
  const read = (def: (typeof LINEUP_PROMPT_LIMITS)['page' | 'total']): number => {
    const raw = env[def.key]?.trim();
    if (!raw) return def.default;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= def.min && n <= def.max) return n;
    warn(
      `${def.key} inválido (${raw}): use um inteiro de ${def.min} a ${def.max}; vale o padrão ${def.default}.`,
    );
    return def.default;
  };
  return { pageChars: read(LINEUP_PROMPT_LIMITS.page), totalChars: read(LINEUP_PROMPT_LIMITS.total) };
}

/** O texto e, depois, cada lista aberta com o rótulo do plano. */
const pageBody = (page: PromptPage) =>
  [
    page.text,
    ...page.sections.map(
      (s) => `### Lista aberta no cartão: ${sanitizeText(s.label ?? '(sem rótulo)', 160)}\n${s.text}`,
    ),
  ].join('\n\n');

/** Texto de uma página para o prompt: o texto e, depois, cada lista aberta com o rótulo do plano. */
export function pageBlock(
  page: PromptPage,
  index: number,
  maxChars: number = LINEUP_PROMPT_LIMITS.page.default,
): string {
  return wrapUntrusted(`página P${index + 1}: ${page.url}`, pageBody(page), maxChars);
}

/** Teto de cada página na extração: o total dividido entre as páginas (ao menos 5 mil), até o da página. */
export const pageCharLimit = (pages: number, limits: LineupPromptLimits = DEFAULT_LINEUP_PROMPT_LIMITS) =>
  Math.min(limits.pageChars, Math.max(MIN_PAGE_SHARE, Math.floor(limits.totalChars / Math.max(1, pages))));

/** Página cortada no prompt da extração: o tamanho original e o teto que valeu. */
export interface PromptCut {
  url: string;
  chars: number;
  limit: number;
}

/** As páginas que passam do teto e são cortadas no prompt da extração. */
export function pageExtractCuts(
  pages: readonly PromptPage[],
  limits: LineupPromptLimits = DEFAULT_LINEUP_PROMPT_LIMITS,
): PromptCut[] {
  const limit = pageCharLimit(pages.length, limits);
  return pages
    .map((p) => ({ url: p.url, chars: sanitizeText(pageBody(p), Infinity).length, limit }))
    .filter((c) => c.chars > limit);
}

/**
 * Alguma página passou do teto e foi cortada no prompt da extração? Então o modelo não viu a página
 * inteira e a resposta não é a grade completa (não pode marcar o que sumiu).
 */
export function pageExtractTruncated(
  pages: readonly PromptPage[],
  limits: LineupPromptLimits = DEFAULT_LINEUP_PROMPT_LIMITS,
): boolean {
  return pageExtractCuts(pages, limits).length > 0;
}

export function pageExtractSystemPrompt(): string {
  return [
    'Você extrai ofertas de TV paga e streaming do texto de páginas oficiais de uma plataforma, lidas por nós, para uma base de dados esportiva B2B. Não há busca: use só o texto das páginas entre <dados_externos>.',
    'Sem trecho, sem prova: cada plano, preço, canal, streaming e complemento leva um trecho copiado LITERALMENTE da página (pode cortar com "..."). O código confere cada trecho na página; trecho que não está lá deixa o item sem prova. Nunca escreva um trecho que não está na página e não invente canais, streamings ou preços.',
    UNTRUSTED_CONTENT_RULES,
    UNTRUSTED_DATA_RULE,
  ].join('\n\n');
}

/** Extração (nível leve, sem busca) dos planos, preços, grade, inclusos e complementos das páginas. */
export function pageExtractPrompt(input: {
  country: string;
  platform: PlatformPromptInput;
  pages: readonly PromptPage[];
  knownPlans: readonly string[];
  channels: readonly string[];
  services: readonly string[];
  limits?: LineupPromptLimits;
}): string {
  const c = countryOf(input.country);
  const per = pageCharLimit(input.pages.length, input.limits);
  return [
    `País: ${c.name} (${input.country}).`,
    `Plataforma: ${sanitizeText(input.platform.name, 120)} — ${KIND_LABEL[input.platform.kind]}.`,
    'Das páginas abaixo, levante TODOS os planos vigentes da plataforma que dão acesso a esporte e, de cada um:',
    '- o preço mensal CHEIO de lista ("de", "depois", "a partir do 2º mês"); ignore o promocional do 1º mês e o desconto de entrada. Trecho: do nome do plano até o preço, como está no cartão;',
    '- os canais lineares esportivos e de TV aberta da grade DESTE plano: a lista aberta no cartão dele ("### Lista aberta no cartão: <plano>") ou a página que é só dele. Trecho: a linha do canal. Lista de outro plano ou texto de marketing ("X, Y e muito mais") não é a grade deste plano;',
    '- os streamings que o cartão ou a página DESTE plano diz que vêm inclusos. Trecho: a frase que diz incluso. Complemento pago à parte não é incluso.',
    'Levante também o catálogo de complementos (o que qualquer plano contrata à parte, com preço): uma linha por oferta; mensal e com fidelidade de 12 meses são duas. Trecho: o nome e o preço.',
    `Planos já conhecidos (se for o mesmo, use exatamente este nome):\n${list(input.knownPlans, 30)}`,
    `Canais da nossa biblioteca (se o canal for um deles, use exatamente este nome):\n${list(input.channels, 120)}`,
    `Streamings da nossa biblioteca (se for um deles, use exatamente este nome):\n${list(input.services, 60)}`,
    ...input.pages.map((p, i) => pageBlock(p, i, per)),
  ].join('\n\n');
}
