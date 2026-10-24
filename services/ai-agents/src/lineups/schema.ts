import { LINEUP_ACCESS, PLATFORM_KINDS, type LineupAccess, type PlatformKind } from '@galaxie/db';

/** Limites aplicados em código (o modo estrito não garante maxItems). */
export const LINEUP_MAX_PLATFORMS = 15;
export const LINEUP_MAX_PLANS = 12;
export const LINEUP_MAX_CHANNELS = 60;
export const LINEUP_MAX_SERVICES = 10;
export const LINEUP_MAX_SOURCES = 4;

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
        required: ['name', 'kind', 'website', 'sources'],
        properties: {
          name: { type: 'string', description: 'Nome comercial da plataforma, como ela se apresenta.' },
          kind: { type: 'string', enum: [...PLATFORM_KINDS] },
          website: { type: ['string', 'null'], description: 'Site oficial (página inicial), se encontrado.' },
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
  platforms: { name: string; kind: PlatformKind; website: string | null; sources: LineupOutputSource[] }[];
  notes: string | null;
}

export const LINEUP_PLANS_SCHEMA_NAME = 'lineups_platform_plans';

const ITEM = (what: string) =>
  ({
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'access', 'source_url'],
      properties: {
        name: { type: 'string', description: `Nome do ${what}, como a fonte escreve.` },
        access: {
          type: 'string',
          enum: [...LINEUP_ACCESS],
          description: 'included = vem no plano · addon = pacote adicional pago à parte.',
        },
        source_url: {
          type: 'string',
          description: 'URL exata de uma fonte da lista que mostra o item no plano.',
        },
      },
    },
  }) as const;

/** Passo 2: planos de uma plataforma, com os canais esportivos e os streamings inclusos. */
export const LINEUP_PLANS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['plans', 'notes'],
  properties: {
    plans: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'price_text', 'url', 'sources', 'channels', 'services'],
        properties: {
          name: { type: 'string', description: 'Nome do plano/pacote, como a plataforma publica.' },
          price_text: {
            type: ['string', 'null'],
            description: 'Preço como publicado (moeda e período, ex.: "R$ 99,90/mês"); null se não houver.',
          },
          url: { type: ['string', 'null'], description: 'Página oficial do plano, se houver.' },
          sources: SOURCES,
          channels: ITEM('canal esportivo'),
          services: ITEM('streaming incluso'),
        },
      },
    },
    notes: { type: ['string', 'null'] },
  },
} as const satisfies Record<string, unknown>;

export interface LineupOutputItem {
  name: string;
  access: LineupAccess;
  source_url: string;
}

export interface LineupPlansOutput {
  plans: {
    name: string;
    price_text: string | null;
    url: string | null;
    sources: LineupOutputSource[];
    channels: LineupOutputItem[];
    services: LineupOutputItem[];
  }[];
  notes: string | null;
}
