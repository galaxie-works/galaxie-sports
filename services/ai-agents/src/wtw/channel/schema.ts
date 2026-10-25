/**
 * Saída estruturada do canal do jogo (docs/07 §2.2.4): o modelo só ESCOLHE ids — o código do jogo da
 * lista (J1, J2…), o país, a emissora da biblioteca e o canal dela — e aponta a fonte (URL da busca e
 * trecho). Nada de nome de emissora em texto livre: os enums saem da lista enviada no pedido.
 */

/** Evidências por linha (o validador guarda no máximo 4 por emissora). */
export const CHANNEL_MAX_EVIDENCE = 3;
/** Linhas por jogo × país (Globo + Premiere + streaming é o caso comum). */
export const CHANNEL_MAX_PER_MATCH = 6;

export const WTW_CHANNEL_SCHEMA_NAME = 'where_to_watch_match_channel';

export interface ChannelSchemaInput {
  matches: string[];
  countries: string[];
  broadcasters: string[];
  channels: string[];
}

/** Schema estrito com os enums da chamada (jogos, países, emissoras e canais permitidos). */
export function buildChannelSchema(input: ChannelSchemaInput): Record<string, unknown> {
  const channel = input.channels.length
    ? {
        type: ['string', 'null'],
        enum: [...input.channels, null],
        description: 'Canal da emissora (da lista) ou null.',
      }
    : { type: 'null', description: 'Sem canais específicos: sempre null.' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['assignments', 'notes'],
    properties: {
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['match', 'country', 'broadcaster', 'channel', 'evidence'],
          properties: {
            match: { type: 'string', enum: input.matches, description: 'Código do jogo na lista.' },
            country: { type: 'string', enum: input.countries, description: 'País da lista.' },
            broadcaster: {
              type: 'string',
              enum: input.broadcasters,
              description: 'Id da emissora (um dos detentores listados para o país).',
            },
            channel,
            evidence: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['url', 'excerpt', 'published_at'],
                properties: {
                  url: { type: 'string', description: 'URL exata da fonte (uma das fontes da busca).' },
                  excerpt: {
                    type: 'string',
                    description: 'Trecho curto (até 160 caracteres) com os DOIS times e a emissora/canal.',
                  },
                  published_at: {
                    type: ['string', 'null'],
                    description: 'Data de publicação da fonte (ISO 8601), se informada.',
                  },
                },
              },
            },
          },
        },
      },
      notes: {
        type: ['string', 'null'],
        description: 'Observações curtas (ex.: escala ainda não divulgada).',
      },
    },
  };
}

export interface ChannelAssignmentOutput {
  match: string;
  country: string;
  broadcaster: string;
  channel: string | null;
  evidence: { url: string; excerpt: string; published_at: string | null }[];
}

export interface ChannelOutput {
  assignments: ChannelAssignmentOutput[];
  notes: string | null;
}
