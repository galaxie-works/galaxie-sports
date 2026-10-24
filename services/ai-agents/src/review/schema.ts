/**
 * Saída estruturada do modelo na revisão de sugestões. Os valores dos campos vêm como texto JSON
 * (`value_json`): o modo estrito dos provedores não aceita objeto livre, e o conteúdo de um item tem
 * textos, listas e objetos. O validador determinístico faz o parse e confere tudo depois.
 */

export const REVIEW_DECISIONS = ['accept', 'accept_with_changes', 'reject'] as const;
export type ReviewModelDecision = (typeof REVIEW_DECISIONS)[number];

export const REVIEW_SUGGESTION_SCHEMA_NAME = 'review_suggestion_decision';

export const REVIEW_SUGGESTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'fields', 'reason', 'adjustments'],
  properties: {
    decision: {
      type: 'string',
      enum: [...REVIEW_DECISIONS],
      description:
        'accept = a edição proposta está certa como veio; accept_with_changes = certa depois de ajustes pequenos ' +
        '(ou implementando o comentário quando não veio edição); reject = não aplicar.',
    },
    fields: {
      type: 'array',
      description:
        'Valores FINAIS só dos campos que mudam em relação ao conteúdo atual (vazio na recusa e quando a ' +
        'edição proposta vale como veio).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value_json'],
        properties: {
          field: { type: 'string', description: 'Nome de um campo de primeiro nível do conteúdo atual.' },
          value_json: {
            type: 'string',
            description: 'Valor final do campo em JSON (texto entre aspas, lista, objeto, número ou null).',
          },
        },
      },
    },
    reason: {
      type: 'string',
      description: 'Motivo da decisão em português do Brasil, em até 400 caracteres, para o admin ler.',
    },
    adjustments: {
      type: 'array',
      description: 'Ajustes pequenos feitos na edição proposta (ex.: "vírgula depois de Verdão").',
      items: { type: 'string' },
    },
  },
} as const satisfies Record<string, unknown>;

export interface ReviewModelOutput {
  decision: ReviewModelDecision;
  fields: { field: string; value_json: string }[];
  reason: string;
  adjustments: string[];
}
