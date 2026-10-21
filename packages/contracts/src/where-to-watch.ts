import 'zod-openapi';
import * as z from 'zod';
import { LocaleQuery } from './common.js';

/** Meios de transmissão (docs/05 §4, enrich.broadcast_medium). */
export const BROADCAST_MEDIA = [
  'free_tv',
  'pay_tv',
  'streaming_svod',
  'streaming_free',
  'youtube',
  'official_app',
  'radio',
] as const;
export const ACCESS_MODELS = ['free', 'subscription', 'ppv', 'unknown'] as const;

export const WhereToWatchParams = z.object({ id: z.uuid().meta({ description: 'Id do evento.' }) });

export const WhereToWatchQuery = LocaleQuery.extend({
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'use o código ISO 3166-1 alpha-2 (ex.: BR)')
    .transform((s) => s.toUpperCase())
    .meta({ description: 'País (ISO 3166-1 alpha-2).', example: 'BR' }),
  region: z.string().trim().min(1).max(40).optional().meta({
    description: 'UF/praça (TV aberta regional). Com região: opções nacionais + as da região.',
    example: 'SP',
  }),
});
export type WhereToWatchQuery = z.infer<typeof WhereToWatchQuery>;

export const WhereToWatchSource = z
  .object({ publisher: z.string(), url: z.string() })
  .meta({ id: 'WhereToWatchSource' });

export const WhereToWatchOption = z
  .object({
    id: z.uuid(),
    provider: z.string().meta({ example: 'Globo' }),
    provider_id: z.string().nullable().meta({ description: 'Id canônico do dicionário de emissoras.' }),
    channel: z.string().nullable(),
    medium: z.enum(BROADCAST_MEDIA),
    access_model: z.enum(ACCESS_MODELS),
    region: z.string().nullable().meta({ description: 'UF/praça; null = nacional.' }),
    watch_url: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    status: z.literal('confirmed'),
    last_verified_at: z.string(),
    sources: z.array(WhereToWatchSource),
  })
  .meta({ id: 'WhereToWatchOption' });
export type WhereToWatchOption = z.infer<typeof WhereToWatchOption>;

export const WhereToWatch = z
  .object({
    event_id: z.uuid(),
    country: z.string(),
    status: z.enum(['resolved', 'unknown']),
    message: z.string().nullable().meta({ description: 'Mensagem localizada quando status = unknown.' }),
    options: z.array(WhereToWatchOption),
    updated_at: z.string().nullable(),
  })
  .meta({ id: 'WhereToWatch', description: 'Onde assistir um evento num país (docs/05 §4).' });
export type WhereToWatch = z.infer<typeof WhereToWatch>;
