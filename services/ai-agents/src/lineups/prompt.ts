/**
 * Prompts da pesquisa da grade. Genéricos de propósito: nenhum nome de operadora ou streaming é
 * escrito aqui. As plataformas de cada país vêm da busca (fontes públicas); os nomes que entram no
 * prompt (plataformas e planos já conhecidos, canais da biblioteca) vêm do banco e do dicionário em
 * tempo de execução, só para o modelo reaproveitar a mesma grafia.
 */
import type { PlatformKind } from '@galaxie/db';
import { UNTRUSTED_DATA_RULE } from '../guardrails/index.js';
import { sanitizeText, UNTRUSTED_CONTENT_RULES } from '../llm/hygiene.js';
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
