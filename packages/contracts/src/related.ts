import 'zod-openapi';
import * as z from 'zod';
import { LocaleQuery } from './common.js';

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

const isType = (s: string): s is RelatedContentTypeName =>
  (RELATED_CONTENT_TYPES as readonly string[]).includes(s);

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
  limit: z.coerce.number().int().min(1).max(50).default(20),
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
