import { BROADCASTER_KINDS, RIGHTS_DISTRIBUTIONS } from '@galaxie/db';

/** Limites aplicados em código (o modo estrito não garante maxItems/maxLength). */
export const WTW_MAX_OPTIONS = 20;
export const WTW_MAX_EVIDENCE = 5;
/** Jogos por chamada de alocação (rodadas maiores viram mais de uma chamada). */
export const WTW_MAX_MATCHES_PER_CALL = 12;

const EVIDENCE = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['url', 'excerpt', 'published_at', 'stance'],
    properties: {
      url: { type: 'string', description: 'URL exata da página consultada.' },
      excerpt: { type: 'string', description: 'Trecho curto (até 200 caracteres) da página.' },
      published_at: {
        type: ['string', 'null'],
        description: 'Data/hora de publicação da página (ISO 8601), se informada.',
      },
      stance: { type: 'string', enum: ['confirms', 'denies'] },
    },
  },
} as const;

/** Nome do schema da alocação por rodada (nível 2). */
export const WTW_ALLOCATION_SCHEMA_NAME = 'where_to_watch_round_allocation';

/**
 * Alocação por rodada: para cada jogo (J1, J2…) e país, quem transmite — uma linha por
 * jogo × país × emissora. Compatível com o modo estrito (campos obrigatórios, `null` explícito).
 */
export const WTW_ALLOCATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assignments', 'notes'],
  properties: {
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['match', 'country', 'broadcaster', 'channel', 'region', 'watch_url', 'evidence'],
        properties: {
          match: { type: 'string', description: 'Código do jogo na lista (J1, J2…).' },
          country: { type: 'string', description: 'País (ISO 3166-1 alpha-2) da lista.' },
          broadcaster: { type: 'string', description: 'Emissora ou plataforma, como a fonte escreve.' },
          channel: { type: ['string', 'null'], description: 'Canal específico (ex.: "ESPN 2"), se houver.' },
          region: {
            type: ['string', 'null'],
            description: 'UF/praça quando a transmissão é regional; null = nacional.',
          },
          watch_url: { type: ['string', 'null'], description: 'Link oficial para assistir, se houver.' },
          evidence: EVIDENCE,
        },
      },
    },
    notes: { type: ['string', 'null'], description: 'Observações curtas (ex.: grade ainda não divulgada).' },
  },
} as const satisfies Record<string, unknown>;

export interface WtwOutputEvidence {
  url: string;
  excerpt: string;
  published_at: string | null;
  stance: 'confirms' | 'denies';
}

export interface WtwAssignment {
  match: string;
  country: string;
  broadcaster: string;
  channel: string | null;
  region: string | null;
  watch_url: string | null;
  evidence: WtwOutputEvidence[];
}

export interface WtwAllocationOutput {
  assignments: WtwAssignment[];
  notes: string | null;
}

/** Nome do schema da pesquisa de direitos por temporada (nível 1). */
export const WTW_RIGHTS_SCHEMA_NAME = 'where_to_watch_season_rights';

/** Direitos de uma competição × temporada em vários países numa única chamada. */
export const WTW_RIGHTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['markets', 'notes'],
  properties: {
    markets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['country', 'distribution', 'holders', 'notes'],
        properties: {
          country: { type: 'string', description: 'País (ISO 3166-1 alpha-2) da lista.' },
          distribution: {
            type: 'string',
            enum: [...RIGHTS_DISTRIBUTIONS],
            description:
              'exclusive = um detentor com todos os jogos; all_matches = todos os detentores com todos os jogos; ' +
              'split = dividem os jogos por rodada; selected = só jogos escolhidos; to_confirm = não se sabe.',
          },
          holders: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['broadcaster', 'channels', 'kind', 'all_matches', 'evidence'],
              properties: {
                broadcaster: { type: 'string', description: 'Emissora ou plataforma detentora.' },
                channels: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Canais/serviços usados.',
                },
                kind: { type: ['string', 'null'], enum: [...BROADCASTER_KINDS, null] },
                all_matches: {
                  type: 'boolean',
                  description: 'Transmite todos os jogos da competição no país.',
                },
                evidence: EVIDENCE,
              },
            },
          },
          notes: { type: ['string', 'null'] },
        },
      },
    },
    notes: { type: ['string', 'null'] },
  },
} as const satisfies Record<string, unknown>;

export interface WtwRightsHolderOutput {
  broadcaster: string;
  channels: string[];
  kind: (typeof BROADCASTER_KINDS)[number] | null;
  all_matches: boolean;
  evidence: WtwOutputEvidence[];
}

export interface WtwRightsOutput {
  markets: {
    country: string;
    distribution: (typeof RIGHTS_DISTRIBUTIONS)[number];
    holders: WtwRightsHolderOutput[];
    notes: string | null;
  }[];
  notes: string | null;
}
