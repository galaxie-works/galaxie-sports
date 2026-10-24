import { PLATFORM_KINDS, type PlatformKind } from '@galaxie/db';

/** Limites aplicados em código (o modo estrito não garante maxItems). */
export const LINEUP_MAX_PLATFORMS = 15;
export const LINEUP_MAX_PLANS = 12;
export const LINEUP_MAX_CHANNELS = 60;
export const LINEUP_MAX_SERVICES = 10;
export const LINEUP_MAX_SOURCES = 4;
export const LINEUP_MAX_OFFICIAL_DOMAINS = 6;

const SOURCES = {
  type: 'array',
  description: 'Fontes (páginas encontradas na busca) que sustentam o item.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'excerpt'],
    properties: {
      url: { type: 'string', description: 'URL exata de uma fonte da lista de fontes.' },
      excerpt: { type: 'string', description: 'Paráfrase curta (até 160 caracteres) do que a fonte diz.' },
    },
  },
} as const;

export const LINEUP_DISCOVERY_SCHEMA_NAME = 'lineups_platform_discovery';

/** Passo 1: as principais plataformas do país (operadoras, vMVPDs, combos e streamings com esporte). */
export const LINEUP_DISCOVERY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['platforms', 'notes'],
  properties: {
    platforms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'kind', 'website', 'dominios_oficiais', 'sources'],
        properties: {
          name: { type: 'string', description: 'Nome comercial da plataforma, como ela se apresenta.' },
          kind: { type: 'string', enum: [...PLATFORM_KINDS] },
          website: { type: ['string', 'null'], description: 'Site oficial (página inicial), se encontrado.' },
          dominios_oficiais: {
            type: 'array',
            description:
              'Outros domínios oficiais da própria plataforma ou do grupo dono dela onde ficam os planos e preços (ex.: o site do grupo de telecom). Só domínios da empresa: nunca comparadores, imprensa, lojas de app ou redes sociais.',
            items: { type: 'string' },
          },
          sources: SOURCES,
        },
      },
    },
    notes: { type: ['string', 'null'] },
  },
} as const satisfies Record<string, unknown>;

export interface LineupOutputSource {
  url: string;
  excerpt: string;
}

export interface LineupDiscoveryOutput {
  platforms: {
    name: string;
    kind: PlatformKind;
    website: string | null;
    dominios_oficiais: string[];
    sources: LineupOutputSource[];
  }[];
  notes: string | null;
}

export const LINEUP_PLANS_SCHEMA_NAME = 'lineups_platform_plans';

const FONTE_URL = {
  type: ['string', 'null'],
  description:
    'URL exata da fonte da busca de hoje que prova o dado (uma da lista de fontes). Sem fonte encontrada na busca, null: o item não entra.',
} as const;

/**
 * Passo 2: planos de uma plataforma, com preço, canais esportivos e streamings inclusos, cada dado com a
 * fonte e o trecho que o prova. Campos no formato validado no AI Studio (24/10): sem fonte, sem conteúdo.
 */
export const LINEUP_PLANS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['planos', 'notas'],
  properties: {
    planos: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'plano_nome',
          'preco_mensal',
          'moeda_iso',
          'plano_url',
          'fonte_url',
          'trecho_da_fonte',
          'streamings_inclusos',
          'canais',
        ],
        properties: {
          plano_nome: { type: 'string', description: 'Nome comercial do plano, como a plataforma publica.' },
          preco_mensal: {
            type: ['number', 'null'],
            description:
              'Preço mensal CHEIO de lista, como número (ex.: 149.9; 34900). Nunca o promocional do 1º mês ou dos primeiros meses. Sem o preço na fonte de hoje, null.',
          },
          moeda_iso: { type: ['string', 'null'], description: 'Moeda ISO 4217 do preço (BRL, ARS, CLP...).' },
          plano_url: { type: ['string', 'null'], description: 'Página oficial deste plano, se houver.' },
          fonte_url: FONTE_URL,
          trecho_da_fonte: {
            type: ['string', 'null'],
            description:
              'Trecho da fonte que cita o NOME do plano e o preço cheio, com os números e nomes escritos como na fonte. Sem trecho, null.',
          },
          streamings_inclusos: {
            type: 'array',
            description:
              'Streamings que a página do PLANO diz que vêm inclusos sem custo extra. Streaming que é complemento pago à parte não entra.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['streaming_id', 'fonte_url', 'trecho'],
              properties: {
                streaming_id: {
                  type: 'string',
                  description: 'Nome do streaming (o da nossa biblioteca, se for um deles).',
                },
                fonte_url: FONTE_URL,
                trecho: {
                  type: ['string', 'null'],
                  description:
                    'Trecho da fonte que cita o plano e o streaming como incluso. Sem trecho, null.',
                },
              },
            },
          },
          canais: {
            type: 'array',
            description:
              'Canais esportivos lineares da grade DESTE plano (nada de filmes, notícias ou variedades).',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['canal_nome', 'fonte_url', 'trecho'],
              properties: {
                canal_nome: {
                  type: 'string',
                  description: 'Nome do canal (o da nossa biblioteca, se for um deles).',
                },
                fonte_url: FONTE_URL,
                trecho: {
                  type: ['string', 'null'],
                  description: 'Trecho da fonte que cita o canal na grade deste plano. Sem trecho, null.',
                },
              },
            },
          },
        },
      },
    },
    notas: { type: ['string', 'null'] },
  },
} as const satisfies Record<string, unknown>;

export interface LineupOutputItem {
  fonte_url: string | null;
  trecho: string | null;
}

export interface LineupPlansOutput {
  planos: {
    plano_nome: string;
    preco_mensal: number | null;
    moeda_iso: string | null;
    plano_url: string | null;
    fonte_url: string | null;
    trecho_da_fonte: string | null;
    streamings_inclusos: (LineupOutputItem & { streaming_id: string })[];
    canais: (LineupOutputItem & { canal_nome: string })[];
  }[];
  notas: string | null;
}
