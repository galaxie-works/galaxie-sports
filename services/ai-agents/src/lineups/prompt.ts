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
    'Você pesquisa ofertas de TV paga e streaming na América Latina para uma base de dados esportiva B2B.',
    'Fontes preferidas: o site oficial da própria plataforma (páginas de planos, grade de canais, regulamento da oferta); imprensa especializada só como apoio. Nunca use agregadores de programação nem sites de terceiros que revendem planos.',
    'Só informe o que estiver numa fonte encontrada na busca. O que não tiver fonte fica de fora: não complete de memória.',
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
    'Para cada plataforma: nome comercial, tipo, site oficial e as fontes que mostram que ela opera no país.',
  ].join('\n\n');
}

export function plansPrompt(input: {
  country: string;
  platform: { name: string; kind: PlatformKind; website: string | null };
  knownPlans: readonly string[];
  channels: readonly string[];
  services: readonly string[];
}): string {
  const c = countryOf(input.country);
  const p = input.platform;
  return [
    `País: ${c.name} (${input.country}). Pesquise em ${c.language}.`,
    `Plataforma: ${sanitizeText(p.name, 120)} — ${KIND_LABEL[p.kind]}${p.website ? ` · site: ${sanitizeText(p.website, 200)}` : ''}.`,
    'Levante os planos/pacotes vigentes dessa plataforma no país que dão acesso a esporte: nome do plano, preço como publicado (com moeda e período), página oficial do plano e fontes.',
    'Para cada plano: os canais esportivos da grade (included = vem no plano; addon = pacote pago à parte) e os serviços de streaming inclusos no plano. Só canais de esporte; ignore canais de filmes, notícias e variedades.',
    `Planos já conhecidos (se for o mesmo, use exatamente este nome):\n${list(input.knownPlans, 30)}`,
    `Canais esportivos da nossa biblioteca (se o canal for um deles, use exatamente este nome):\n${list(input.channels, 120)}`,
    `Streamings da nossa biblioteca (se for um deles, use exatamente este nome):\n${list(input.services, 60)}`,
    'Cada canal e cada streaming precisa da URL da fonte que mostra que ele está naquele plano.',
  ].join('\n\n');
}
