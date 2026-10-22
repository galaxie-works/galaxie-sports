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
    logo: z
      .string()
      .nullable()
      .meta({ description: 'Logo da emissora (biblioteca `/v1/broadcasters`); null = sem logo com origem.' }),
  })
  .meta({ id: 'WhereToWatchOption' });
export type WhereToWatchOption = z.infer<typeof WhereToWatchOption>;

/** Detentor de direitos ainda sem o jogo confirmado ("canal a confirmar"). */
export const WhereToWatchToConfirm = z
  .object({
    provider: z.string(),
    provider_id: z.string().nullable(),
    medium: z.enum(BROADCAST_MEDIA),
    access_model: z.enum(ACCESS_MODELS),
    logo: z.string().nullable(),
    sources: z.array(WhereToWatchSource),
  })
  .meta({ id: 'WhereToWatchToConfirm' });
export type WhereToWatchToConfirm = z.infer<typeof WhereToWatchToConfirm>;

export const WhereToWatch = z
  .object({
    event_id: z.uuid(),
    country: z.string(),
    status: z.enum(['resolved', 'unknown']),
    message: z.string().nullable().meta({ description: 'Mensagem localizada quando status = unknown.' }),
    options: z.array(WhereToWatchOption),
    to_confirm: z.array(WhereToWatchToConfirm).meta({
      description:
        'Detentores de direitos sem o jogo confirmado ("canal a confirmar"). Só vem preenchido quando `options` está vazio.',
    }),
    updated_at: z.string().nullable(),
  })
  .meta({ id: 'WhereToWatch', description: 'Onde assistir um evento num país (docs/05 §4).' });
export type WhereToWatch = z.infer<typeof WhereToWatch>;

// ─── biblioteca de emissoras ─────────────────────────────────────────────────────────────────────

export const BROADCASTER_KINDS = ['free_tv', 'pay_tv', 'streaming', 'radio'] as const;

export const BroadcasterLogo = z
  .object({
    url: z
      .string()
      .meta({ description: 'Logo servido pelo nosso storage (ou a origem, se ainda não espelhado).' }),
    source_url: z.string(),
    source_page: z.string().nullable(),
    license: z.string().nullable().meta({ description: 'Licença/observação de uso informada pela origem.' }),
  })
  .meta({ id: 'BroadcasterLogo' });

export const BroadcasterMarket = z
  .object({
    country: z.string(),
    name: z.string(),
    medium: z.enum(BROADCAST_MEDIA),
    access_model: z.enum(ACCESS_MODELS),
    channels: z.array(z.string()),
  })
  .meta({ id: 'BroadcasterMarket' });

export const Broadcaster = z
  .object({
    id: z.string().meta({ example: 'espn' }),
    name: z.string(),
    aliases: z.array(z.string()),
    kind: z.enum(BROADCASTER_KINDS).meta({
      description: 'free_tv = TV aberta · pay_tv = TV paga (cabo/satélite/IPTV) · streaming · radio.',
    }),
    countries: z.array(z.string()),
    channels: z.array(z.string()),
    website: z.string().nullable(),
    logo: BroadcasterLogo.nullable(),
    markets: z.array(BroadcasterMarket),
  })
  .meta({ id: 'Broadcaster', description: 'Emissora ou plataforma da biblioteca do onde assistir.' });
export type Broadcaster = z.infer<typeof Broadcaster>;

export const BroadcastersQuery = LocaleQuery.extend({
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'use o código ISO 3166-1 alpha-2 (ex.: BR)')
    .transform((s) => s.toUpperCase())
    .optional()
    .meta({ description: 'Só emissoras presentes no país.', example: 'BR' }),
});
export type BroadcastersQuery = z.infer<typeof BroadcastersQuery>;

export const BroadcasterParams = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .meta({ description: 'Id da emissora.', example: 'espn' }),
});
