import 'zod-openapi';
import * as z from 'zod';
import { ClientChannelRef } from './channel-list.js';
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

const clientChannels = z
  .array(ClientChannelRef)
  .optional()
  .meta({
    description:
      'Canais da lista do tenant que levam esta emissora (todas as praças entram). Só vem quando o tenant tem ' +
      'uma lista de canais confirmada (`/v1/channel-list`); [] = nenhum canal da lista.',
  });

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
    logo: z.string().nullable().meta({
      description:
        'Logo da emissora (biblioteca `/v1/broadcasters`) — o do canal quando o acervo oficial tem um; null = sem logo com origem.',
    }),
    logo_dark: z
      .string()
      .nullable()
      .meta({ description: 'Versão do logo para fundo escuro (acervo oficial); null = usar `logo`.' }),
    client_channels: clientChannels,
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
    logo_dark: z.string().nullable(),
    sources: z.array(WhereToWatchSource),
    client_channels: clientChannels,
  })
  .meta({ id: 'WhereToWatchToConfirm' });
export type WhereToWatchToConfirm = z.infer<typeof WhereToWatchToConfirm>;

// ─── grade das operadoras e streamings (onde o canal está) ────────────────────────────────────────

/** Tipos de plataforma da grade (enrich.platform.kind). */
export const PLATFORM_KINDS = ['pay_tv_operator', 'vmvpd', 'telco_bundle', 'streaming'] as const;
export type PlatformKind = (typeof PLATFORM_KINDS)[number];
/** Como o canal ou o streaming entra no plano: já incluso ou como adicional pago. */
export const PLAN_ACCESS = ['included', 'addon'] as const;
export type PlanAccess = (typeof PLAN_ACCESS)[number];

/** Canal ou streaming da biblioteca de emissoras, com o logo (claro e escuro). */
export const AvailabilityLogo = z
  .object({
    id: z.string().meta({ description: 'Id da biblioteca de emissoras (`/v1/broadcasters`).' }),
    name: z.string(),
    logo: z.string().nullable(),
    logo_dark: z.string().nullable().meta({ description: 'Versão para fundo escuro; null = usar `logo`.' }),
  })
  .meta({ id: 'AvailabilityLogo' });
export type AvailabilityLogo = z.infer<typeof AvailabilityLogo>;

/** Canal ou streaming dentro de um plano, com o tipo de acesso. */
export const LineupItem = AvailabilityLogo.extend({ access: z.enum(PLAN_ACCESS) }).meta({ id: 'LineupItem' });
export type LineupItem = z.infer<typeof LineupItem>;

/** Crédito do logo de uma plataforma (arquivo de licença livre da Wikimedia Commons). */
export const LogoCredit = z
  .object({
    source: z.literal('Wikimedia Commons'),
    title: z.string().meta({ example: 'File:Logo de exemplo.svg' }),
    page_url: z.url().meta({ description: 'Página do arquivo na Commons (autor, licença e histórico).' }),
    author: z.string().nullable(),
    license: z.string().meta({ example: 'Public domain' }),
    license_url: z.url().nullable(),
    attribution_required: z.boolean().meta({
      description: 'A licença exige o crédito junto do logo (CC BY, CC BY-SA); domínio público não exige.',
    }),
    text: z.string().meta({
      description: 'Atribuição pronta para exibir (ou para o `title` do logo, quando não é exigida).',
      example: 'Logo: Wikimedia Commons · Public domain',
    }),
  })
  .meta({ id: 'LogoCredit' });
export type LogoCredit = z.infer<typeof LogoCredit>;

export const Platform = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    kind: z.enum(PLATFORM_KINDS).meta({
      description:
        'pay_tv_operator = operadora de TV paga · vmvpd = TV paga pela internet · telco_bundle = pacote de ' +
        'telefonia/internet com TV · streaming.',
    }),
    country: z.string(),
    broadcaster_id: z.string().nullable().meta({
      description: 'Entrada da própria plataforma na biblioteca de emissoras (ex.: o streaming das opções).',
    }),
    logo: z
      .string()
      .nullable()
      .meta({
        description:
          'Logo da plataforma: o da biblioteca de emissoras com o mesmo site oficial, ou o da Wikimedia Commons ' +
          'ligado pelo Wikidata e conferido pelo site oficial; null = sem logo com origem verificável.',
      }),
    logo_dark: z.string().nullable(),
    logo_credit: LogoCredit.nullable().meta({
      description: 'Crédito do logo quando ele vem da Wikimedia Commons; null para o acervo oficial.',
    }),
  })
  .meta({ id: 'Platform', description: 'Operadora de TV paga ou streaming (grade de canais e ofertas).' });
export type Platform = z.infer<typeof Platform>;

export const AvailabilityPlan = z
  .object({
    id: z.string(),
    name: z.string(),
    access: z.enum(PLAN_ACCESS).meta({
      description: '`included` = o jogo está no plano sem custo extra; `addon` = só com um adicional.',
    }),
    via_channels: z.array(LineupItem).meta({ description: 'Canais do plano por onde o jogo passa.' }),
    included_services: z.array(AvailabilityLogo).meta({ description: 'Streamings inclusos no plano.' }),
  })
  .meta({ id: 'AvailabilityPlan' });
export type AvailabilityPlan = z.infer<typeof AvailabilityPlan>;

/** Oferta de um complemento: o mensal e o com fidelidade são duas. */
export const PlatformAddonOffer = z
  .object({
    name: z.string().meta({ description: 'Nome como a plataforma vende (ex.: "Premiere Fidelidade").' }),
    price: z.number().nullable().meta({ description: 'Preço mensal; null = sem preço provado.' }),
    currency: z.string().nullable().meta({ description: 'ISO 4217.' }),
    commitment_months: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Fidelidade em meses; null = mensal.' }),
  })
  .meta({ id: 'PlatformAddonOffer' });
export type PlatformAddonOffer = z.infer<typeof PlatformAddonOffer>;

/**
 * Complemento da plataforma: serviço ou canal que qualquer plano contrata à parte. Para quem tem um plano
 * sem o serviço: "disponível como complemento: Premiere a partir de R$ 49,90".
 */
export const PlatformAddon = AvailabilityLogo.extend({
  kind: z
    .enum(['service', 'channel'])
    .meta({ description: 'service = streaming ou pacote · channel = canal avulso.' }),
  channel: z
    .string()
    .nullable()
    .meta({ description: 'Canal numerado da emissora (ex.: "ESPN 6"), quando é um canal.' }),
  price_from: z
    .number()
    .nullable()
    .meta({ description: 'Menor preço mensal entre as ofertas ("a partir de").' }),
  currency: z.string().nullable(),
  offers: z.array(PlatformAddonOffer),
}).meta({ id: 'PlatformAddon' });
export type PlatformAddon = z.infer<typeof PlatformAddon>;

export const PlatformAvailability = z
  .object({
    platform: Platform,
    plans: z.array(AvailabilityPlan),
    addons: z.array(PlatformAddon).optional().meta({
      description:
        'Complementos da plataforma com o canal ou o streaming do jogo, contratados à parte por qualquer plano.',
    }),
  })
  .meta({ id: 'PlatformAvailability' });
export type PlatformAvailability = z.infer<typeof PlatformAvailability>;

export const WhereToWatchAvailability = z
  .object({
    free_tv: z.array(AvailabilityLogo).meta({ description: 'Canais abertos com o jogo.' }),
    pay_tv_channels: z.array(AvailabilityLogo).meta({ description: 'Canais pagos com o direito.' }),
    platforms: z.array(PlatformAvailability).meta({
      description:
        'Operadoras e streamings que levam o jogo ("disponível também em"), com o plano ou planos. Tenant com ' +
        'operadora própria e `show_other_operators = false`: só a própria operadora e os streamings.',
    }),
    your_operator: PlatformAvailability.nullable().meta({
      description:
        'A operadora do próprio tenant, com os planos em que o jogo está (`plans: []` = não está na grade ' +
        'dela); null quando o tenant não tem operadora.',
    }),
    channel_status: z.enum(['confirmed', 'to_confirm']).meta({
      description:
        '`to_confirm` = o canal do jogo ainda não foi confirmado ("canal a confirmar"): TV aberta, canais ' +
        'pagos e plataformas são os dos detentores dos direitos no país (os mesmos de `to_confirm`), não ' +
        'o canal do jogo. `confirmed` nos demais casos.',
    }),
  })
  .meta({
    id: 'WhereToWatchAvailability',
    description: 'Onde assistir agrupado por TV aberta, canais pagos e plataformas.',
  });
export type WhereToWatchAvailability = z.infer<typeof WhereToWatchAvailability>;

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
    availability: WhereToWatchAvailability,
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
    dark_url: z
      .string()
      .nullable()
      .meta({ description: 'Versão para fundo escuro (acervo oficial); null = usar `url`.' }),
    source_url: z.string().meta({
      description: 'Origem do arquivo (URL, ou `acervo-oficial://<nó>` para o acervo oficial de logos).',
    }),
    source_page: z.string().nullable(),
    license: z.string().nullable().meta({ description: 'Licença/observação de uso informada pela origem.' }),
  })
  .meta({ id: 'BroadcasterLogo' });

export const BroadcasterChannelLogo = z
  .object({
    channel: z.string().meta({ example: 'ESPN 2' }),
    url: z.string(),
    dark_url: z.string().nullable(),
  })
  .meta({ id: 'BroadcasterChannelLogo', description: 'Logo de um canal da emissora (acervo oficial).' });

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
    channel_logos: z.array(BroadcasterChannelLogo),
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

// ─── grade: rotas /v1/platforms ─────────────────────────────────────────────────────────────────

export const PlatformsQuery = BroadcastersQuery;
export type PlatformsQuery = z.infer<typeof PlatformsQuery>;

export const PlatformParams = z.object({
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .meta({ description: 'Id da plataforma.' }),
});

export const LineupPlan = z
  .object({
    id: z.string(),
    name: z.string(),
    channels: z.array(LineupItem),
    services: z.array(LineupItem).meta({ description: 'Streamings do plano (inclusos ou adicionais).' }),
  })
  .meta({ id: 'LineupPlan' });

export const PlatformLineup = z
  .object({
    platform: Platform,
    plans: z.array(LineupPlan),
    addons: z
      .array(PlatformAddon)
      .optional()
      .meta({ description: 'Catálogo de complementos (contratados à parte).' }),
  })
  .meta({ id: 'PlatformLineup', description: 'Grade de canais e streamings de cada plano da plataforma.' });
export type PlatformLineup = z.infer<typeof PlatformLineup>;
