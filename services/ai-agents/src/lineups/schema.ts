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

const FONTE_URL = {
  type: ['string', 'null'],
  description:
    'URL exata da fonte da busca de hoje que prova o dado (uma da lista de fontes). Sem fonte encontrada na busca, null: o item não entra.',
} as const;

const DATA_DA_FONTE = {
  type: ['string', 'null'],
  description:
    'Data da fonte, se ela diz (AAAA-MM ou AAAA-MM-DD; ex.: tabela de preços de nov/2025 = 2025-11).',
} as const;

export const LINEUP_CATALOG_SCHEMA_NAME = 'lineups_platform_catalog';

/**
 * Etapa 1 (uma chamada por plataforma): a lista dos planos vigentes, só nome e fonte, e o catálogo de
 * complementos com preço (serviço ou canal contratado à parte, por qualquer plano). Sem fonte, sem
 * conteúdo.
 */
export const LINEUP_CATALOG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['planos', 'complementos', 'notas'],
  properties: {
    planos: {
      type: 'array',
      description:
        'TODOS os planos vigentes da plataforma no país que dão acesso a esporte (não pule nenhum).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['plano_nome', 'plano_url', 'fonte_url', 'trecho'],
        properties: {
          plano_nome: { type: 'string', description: 'Nome comercial do plano, como a plataforma publica.' },
          plano_url: { type: ['string', 'null'], description: 'Página oficial do plano, se houver.' },
          fonte_url: FONTE_URL,
          trecho: { type: ['string', 'null'], description: 'Trecho da fonte que cita o plano pelo nome.' },
        },
      },
    },
    complementos: {
      type: 'array',
      description:
        'Catálogo de complementos: serviços (streaming, pacote) ou canais que se contratam à parte, com preço. Uma linha por oferta (mensal e com fidelidade são duas).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'nome',
          'tipo',
          'preco_mensal',
          'moeda_iso',
          'fidelidade_meses',
          'fonte_url',
          'trecho',
          'data_da_fonte',
        ],
        properties: {
          nome: {
            type: 'string',
            description: 'Nome como a plataforma publica (ex.: "Premiere Fidelidade").',
          },
          tipo: { type: 'string', enum: ['streaming', 'canal'] },
          preco_mensal: { type: ['number', 'null'], description: 'Preço mensal da oferta, como número.' },
          moeda_iso: { type: ['string', 'null'] },
          fidelidade_meses: {
            type: ['integer', 'null'],
            description: 'Meses de fidelidade da oferta (null = mensal, sem fidelidade).',
          },
          fonte_url: FONTE_URL,
          trecho: {
            type: ['string', 'null'],
            description: 'Trecho da fonte com o nome e o preço da oferta, como a fonte escreve.',
          },
          data_da_fonte: DATA_DA_FONTE,
        },
      },
    },
    notas: { type: ['string', 'null'] },
  },
} as const satisfies Record<string, unknown>;

export interface LineupCatalogOutput {
  planos: { plano_nome: string; plano_url: string | null; fonte_url: string | null; trecho: string | null }[];
  complementos: {
    nome: string;
    tipo: 'streaming' | 'canal';
    preco_mensal: number | null;
    moeda_iso: string | null;
    fidelidade_meses: number | null;
    fonte_url: string | null;
    trecho: string | null;
    data_da_fonte: string | null;
  }[];
  notas: string | null;
}

export const LINEUP_PLAN_SCHEMA_NAME = 'lineups_plan_detail';

/**
 * Etapa 2 (uma chamada por plano): o detalhe de um plano — os preços vistos (cada um com a fonte e a
 * data), os canais esportivos da grade dele e os streamings inclusos, cada dado com a fonte e o trecho.
 * Campos no formato validado no AI Studio (24/10).
 */
export const LINEUP_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'plano_nome',
    'encontrado',
    'plano_url',
    'fonte_url',
    'trecho_da_fonte',
    'precos',
    'streamings_inclusos',
    'canais',
    'notas',
  ],
  properties: {
    plano_nome: { type: 'string', description: 'Nome do plano, como a plataforma publica.' },
    encontrado: { type: 'boolean', description: 'false se a busca de hoje não achou este plano.' },
    plano_url: { type: ['string', 'null'], description: 'Página oficial deste plano, se houver.' },
    fonte_url: FONTE_URL,
    trecho_da_fonte: {
      type: ['string', 'null'],
      description: 'Trecho da fonte que cita o NOME do plano. Sem trecho, null.',
    },
    precos: {
      type: 'array',
      description:
        'Preços mensais CHEIOS de lista vistos para o plano, um por fonte (se fontes diferentes dão valores diferentes, liste todos). Nunca o promocional do 1º mês.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['preco_mensal', 'moeda_iso', 'fonte_url', 'trecho', 'data_da_fonte'],
        properties: {
          preco_mensal: { type: 'number' },
          moeda_iso: { type: ['string', 'null'] },
          fonte_url: FONTE_URL,
          trecho: {
            type: ['string', 'null'],
            description: 'Trecho com o nome do plano e o preço, com os números como a fonte escreve.',
          },
          data_da_fonte: DATA_DA_FONTE,
        },
      },
    },
    streamings_inclusos: {
      type: 'array',
      description:
        'Streamings que a página do PLANO diz que vêm inclusos sem custo extra. Complemento pago à parte não entra.',
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
            description: 'Trecho da fonte que cita o plano e o streaming como incluso. Sem trecho, null.',
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
    notas: { type: ['string', 'null'] },
  },
} as const satisfies Record<string, unknown>;

export interface LineupOutputItem {
  fonte_url: string | null;
  trecho: string | null;
}

export interface LineupPlanOutput {
  plano_nome: string;
  encontrado: boolean;
  plano_url: string | null;
  fonte_url: string | null;
  trecho_da_fonte: string | null;
  precos: {
    preco_mensal: number;
    moeda_iso: string | null;
    fonte_url: string | null;
    trecho: string | null;
    data_da_fonte: string | null;
  }[];
  streamings_inclusos: (LineupOutputItem & { streaming_id: string })[];
  canais: (LineupOutputItem & { canal_nome: string })[];
  notas: string | null;
}
