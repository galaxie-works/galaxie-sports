import type { ZodOpenApiPathsObject } from 'zod-openapi';
import * as z from 'zod';
import { LocaleQuery, Problem } from './common.js';

// ─── conteúdo relacionado por evento (docs/12) ───────────────────────────────────────────────────

/** Tipos de conteúdo (enrich.related_content_type). */
export const RELATED_CONTENT_TYPES = [
  'highlights',
  'goal',
  'penalties',
  'press_conference',
  'interview',
  'behind_the_scenes',
  'fan_reaction',
  'analysis',
  'full_match',
  'other',
] as const;
export type RelatedContentTypeName = (typeof RELATED_CONTENT_TYPES)[number];

export const RELATED_FORMATS = ['short', 'long'] as const;
export const RELATED_SOURCE_TIERS = ['official', 'rights_holder', 'media', 'creator', 'unknown'] as const;
/** Proporção do quadro (enrich.related_content.aspect_ratio). */
export const RELATED_ASPECT_RATIOS = ['16:9', '9:16', '4:3', '1:1'] as const;

const isType = (s: string): s is RelatedContentTypeName =>
  (RELATED_CONTENT_TYPES as readonly string[]).includes(s);
type RelatedAspectRatioName = (typeof RELATED_ASPECT_RATIOS)[number];
const isAspect = (s: string): s is RelatedAspectRatioName =>
  (RELATED_ASPECT_RATIOS as readonly string[]).includes(s);

export const RelatedQuery = LocaleQuery.extend({
  type: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      const list = (Array.isArray(v) ? v : [v])
        .flatMap((s) => s.split(','))
        .map((s) => s.trim())
        .filter(Boolean);
      const bad = list.filter((s) => !isType(s));
      if (bad.length) {
        ctx.addIssue({ code: 'custom', message: `tipo(s) inválido(s): ${bad.join(', ')}` });
        return z.NEVER;
      }
      return [...new Set(list)] as RelatedContentTypeName[];
    })
    .meta({
      description: `Tipos separados por vírgula (${RELATED_CONTENT_TYPES.join(', ')}). Padrão: todos.`,
      example: 'highlights,goal',
    }),
  format: z
    .enum(RELATED_FORMATS)
    .optional()
    .meta({ description: '`short` (vertical curto) ou `long`. Padrão: os dois.' }),
  aspect_ratio: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined) return undefined;
      const list = (Array.isArray(v) ? v : [v])
        .flatMap((s) => s.split(','))
        .map((s) => s.trim())
        .filter(Boolean);
      const bad = list.filter((s) => !isAspect(s));
      if (bad.length) {
        ctx.addIssue({ code: 'custom', message: `proporção(ões) inválida(s): ${bad.join(', ')}` });
        return z.NEVER;
      }
      return [...new Set(list)] as RelatedAspectRatioName[];
    })
    .meta({
      description: `Proporções do quadro separadas por vírgula (${RELATED_ASPECT_RATIOS.join(', ')}): \`9:16\` só os verticais, \`16:9\` só os horizontais, \`16:9,9:16\` os dois. Padrão: todas.`,
      example: '9:16',
    }),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'use o código ISO 3166-1 alpha-2 (ex.: AR)')
    .transform((s) => s.toUpperCase())
    .optional()
    .meta({
      description:
        'País do público (ISO 3166-1 alpha-2): só vídeos no idioma do país, os do próprio país primeiro (AR → es-AR antes de es-MX; nunca vídeo em português). Sem país, o mercado único do plano; sem nenhum, todos.',
      example: 'AR',
    }),
});
export type RelatedQuery = z.input<typeof RelatedQuery>;

export const RelatedChannel = z
  .object({
    id: z.string(),
    title: z.string(),
    handle: z.string().nullable().meta({ example: '@canaloficial' }),
    source_tier: z.enum(RELATED_SOURCE_TIERS).meta({
      description:
        '`official` (clube, competição), `rights_holder` (detentor de direitos no país), `media` (imprensa da ' +
        'allowlist), `creator` (criador com audiência mínima, só reação/análise).',
    }),
  })
  .meta({ id: 'RelatedChannel' });

export const RelatedItem = z
  .object({
    id: z.uuid(),
    provider: z.literal('youtube'),
    external_id: z.string().meta({ description: 'Id do vídeo na plataforma.' }),
    url: z.string().meta({ description: 'Link direto para o vídeo (nunca link de busca).' }),
    embed_url: z.string().nullable().meta({ description: 'Player oficial incorporável.' }),
    title: z.string(),
    content_type: z.enum(RELATED_CONTENT_TYPES),
    content_type_label: z.string().meta({ description: 'Rótulo do tipo no locale da resposta.' }),
    format: z.enum(RELATED_FORMATS),
    aspect_ratio: z.enum(RELATED_ASPECT_RATIOS).meta({
      description:
        'Proporção do vídeo, das dimensões reais do player da plataforma: `16:9` (horizontal), `9:16` (vertical), ' +
        '`4:3` ou `1:1`. Use para montar o quadro (ex.: player 9:16 para vertical).',
      example: '9:16',
    }),
    duration_seconds: z.number().int().nullable(),
    published_at: z.string(),
    thumbnail_url: z
      .string()
      .nullable()
      .meta({ description: 'Miniatura servida pela própria plataforma (nunca rehospedada).' }),
    language: z.string().nullable(),
    channel: RelatedChannel,
    views: z.number().int().nullable(),
    confidence: z.number().min(0).max(1).meta({ description: 'Confiança da classificação do tipo.' }),
    classified_by: z.string().meta({ description: '`llm:<modelo>` ou `rules@v1`.' }),
    last_checked_at: z.string(),
  })
  .meta({ id: 'RelatedItem' });
export type RelatedItem = z.infer<typeof RelatedItem>;

export const RelatedContent = z
  .object({
    event_id: z.uuid(),
    data: z.array(RelatedItem),
    counts: z
      .partialRecord(z.enum(RELATED_CONTENT_TYPES), z.number().int())
      .meta({ description: 'Total publicado por tipo, antes dos filtros (abas da vitrine).' }),
    updated_at: z.string().nullable(),
  })
  .meta({
    id: 'RelatedContent',
    description: 'Vídeos relacionados ao evento, classificados por tipo e formato (docs/12).',
  });
export type RelatedContent = z.infer<typeof RelatedContent>;

// ─── erro de reprodução (o player oficial recusou o vídeo) ──────────────────────────────────────

/** Códigos da IFrame Player API que tiram o vídeo da vitrine: 100 (removido ou privado), 101 e 150 (embed recusado). */
export const RELATED_PLAYBACK_BLOCK_CODES = [100, 101, 150] as const;

export const RelatedPlaybackErrorBody = z
  .object({
    item_id: z.uuid().meta({ description: '`id` do item (RelatedItem) que o player recusou.' }),
    code: z.coerce
      .number()
      .int()
      .refine((c) => (RELATED_PLAYBACK_BLOCK_CODES as readonly number[]).includes(c), {
        message: 'use o código do onError do player: 100, 101 ou 150',
      })
      .meta({
        description:
          'Código do `onError` da IFrame Player API do YouTube: `100` (removido ou privado), `101` ou `150` (o dono ' +
          'do conteúdo não permite a reprodução fora do YouTube). Outros códigos (2, 5) são do player e não tiram o vídeo.',
        example: 150,
      }),
    quorum: z
      .boolean()
      .optional()
      .meta({
        description:
          '`false` quando o aviso vem de usuário não verificado (ex.: visitante anônimo): o vídeo sai só da sua ' +
          'vitrine e o aviso não conta para tirá-lo da vitrine dos outros clientes. Padrão `true`.',
      }),
  })
  .meta({ id: 'RelatedPlaybackErrorBody' });
export type RelatedPlaybackErrorBody = z.infer<typeof RelatedPlaybackErrorBody>;

export const RelatedPlaybackErrorResult = z
  .object({
    item_id: z.uuid(),
    external_id: z.string(),
    removed_from_events: z.number().int().meta({
      description: 'Jogos em que o vídeo saiu da sua vitrine com este aviso (0 se já tinha saído).',
    }),
  })
  .meta({ id: 'RelatedPlaybackErrorResult' });
export type RelatedPlaybackErrorResult = z.infer<typeof RelatedPlaybackErrorResult>;

const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});

export const relatedPaths: ZodOpenApiPathsObject = {
  '/v1/related/playback-errors': {
    post: {
      summary: 'Avisa que o player oficial recusou um vídeo relacionado',
      description:
        'Quando o player do YouTube dispara `onError` com `100`, `101` ou `150`, o vídeo não toca fora do YouTube ' +
        '(removido, privado ou com o embed bloqueado pelo dono do conteúdo, por exemplo por reivindicação de ' +
        'direitos). A Data API não informa esse bloqueio antes do play. Com o aviso, o vídeo sai na hora de ' +
        '`/v1/events/{id}/related` em todos os jogos para o seu tenant (o 101/150 pode depender do domínio do ' +
        'embed); com 3 vídeos recusados, o canal inteiro também sai. Quando outros tenants relatam o mesmo vídeo, ' +
        'ele sai para todos e o tópico `event.related_content_changed` avisa a mudança. ' +
        'O seu player deve pular para o próximo vídeo sem esperar a resposta. Exige o módulo `related_content` e a ' +
        'chave secreta (o backend do cliente repassa o aviso).',
      tags: ['Conteúdo relacionado'],
      requestBody: { content: json(RelatedPlaybackErrorBody) },
      responses: {
        '200': { description: 'Aviso registrado', content: json(RelatedPlaybackErrorResult) },
        '400': problem('Código fora de 100, 101 e 150, ou item inválido (INVALID_PARAMS)'),
        '401': problem('Chave ausente ou inválida (INVALID_KEY)'),
        '403': problem(
          'Módulo related_content fora do plano, ou chave publicável (MODULE_NOT_IN_PLAN / FORBIDDEN)',
        ),
        '404': problem('Item não encontrado (NOT_FOUND)'),
        '429': problem('Limite do tenant atingido (RATE_LIMITED)'),
      },
    },
  },
};
