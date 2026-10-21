import { ACCESS_MODELS, BROADCAST_MEDIA } from '@galaxie/db';

/** Nome do schema de saída (OpenAI `text.format.name` / ferramenta `submit_*` na Anthropic). */
export const WTW_SCHEMA_NAME = 'where_to_watch_options';

/** Limites aplicados em código (o modo estrito não garante maxItems/maxLength). */
export const WTW_MAX_OPTIONS = 20;
export const WTW_MAX_EVIDENCE = 5;

/**
 * Saída do agente Onde Assistir — compatível com o modo estrito das saídas estruturadas
 * (todos os campos obrigatórios, `null` explícito, `additionalProperties: false`).
 * O trecho de evidência é cortado em 200 caracteres pelo validador.
 */
export const WTW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['options', 'notes'],
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['broadcaster', 'channel', 'medium', 'access_model', 'region', 'watch_url', 'evidence'],
        properties: {
          broadcaster: { type: 'string', description: 'Emissora ou plataforma, como a fonte escreve.' },
          channel: { type: ['string', 'null'], description: 'Canal específico (ex.: "ESPN 2"), se houver.' },
          medium: { type: ['string', 'null'], enum: [...BROADCAST_MEDIA, null] },
          access_model: { type: ['string', 'null'], enum: [...ACCESS_MODELS, null] },
          region: {
            type: ['string', 'null'],
            description: 'UF/praça quando a transmissão é regional; null = nacional.',
          },
          watch_url: { type: ['string', 'null'], description: 'Link oficial para assistir, se houver.' },
          evidence: {
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
          },
        },
      },
    },
    notes: {
      type: ['string', 'null'],
      description: 'Observações curtas (ex.: jogo sem transmissão anunciada).',
    },
  },
} as const satisfies Record<string, unknown>;

export interface WtwOutputEvidence {
  url: string;
  excerpt: string;
  published_at: string | null;
  stance: 'confirms' | 'denies';
}

export interface WtwOutputOption {
  broadcaster: string;
  channel: string | null;
  medium: (typeof BROADCAST_MEDIA)[number] | null;
  access_model: (typeof ACCESS_MODELS)[number] | null;
  region: string | null;
  watch_url: string | null;
  evidence: WtwOutputEvidence[];
}

export interface WtwOutput {
  options: WtwOutputOption[];
  notes: string | null;
}
