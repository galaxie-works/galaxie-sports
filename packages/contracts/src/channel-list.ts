import 'zod-openapi';
import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';

/**
 * Lista de canais do cliente casada com os direitos de transmissão (docs/05 §4.2, docs/07 §2.2.3). Só
 * nomes de canais: nunca EPG (o guia de programação é licenciado ao cliente pelo fornecedor dele).
 */

export const CHANNEL_MATCH_KINDS = [
  'exato',
  'feed_generico',
  'nome_divergente',
  'sem_canal_na_lista',
] as const;
export const CHANNEL_LINK_KINDS = ['exato', 'feed_generico', 'nome_divergente'] as const;

const MATCH_DESCRIPTION =
  'exato = o canal é a emissora no país (qualquer praça: a geolocalização é da operadora) · ' +
  'feed_generico = sinal pan-regional ou de outro país, sem o feed do país na lista · ' +
  'nome_divergente = mesma marca com sufixo diferente (confira) · sem_canal_na_lista.';

/** Canal da lista do cliente que leva a emissora (no onde assistir, em `client_channels`). */
export const ClientChannelRef = z
  .object({
    index: z
      .number()
      .int()
      .min(0)
      .meta({ description: 'Posição do canal na lista enviada (a partir de 0).' }),
    name: z
      .string()
      .meta({ example: 'BR: |SP| GLOBO HD', description: 'Nome como está na lista do cliente.' }),
    match: z.enum(CHANNEL_LINK_KINDS).meta({ description: MATCH_DESCRIPTION }),
  })
  .meta({ id: 'ClientChannelRef' });
export type ClientChannelRef = z.infer<typeof ClientChannelRef>;

export const ChannelListBody = z
  .object({
    content: z
      .string()
      .min(1)
      .max(2 * 1024 * 1024)
      .meta({
        description:
          'Arquivo M3U ou nomes de canais, um por linha. Só o nome é lido: URLs e EPG são descartados.',
      }),
    format: z
      .enum(['m3u', 'text'])
      .optional()
      .meta({ description: 'Padrão: detectado pelo conteúdo (`#EXTM3U`/`#EXTINF` = m3u).' }),
    default_country: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((s) => s.toUpperCase())
      .nullable()
      .optional()
      .meta({ description: 'País dos canais sem país no nome nem no grupo (ISO2). Opcional.' }),
  })
  .meta({ id: 'ChannelListBody' });
export type ChannelListBody = z.infer<typeof ChannelListBody>;

export const ChannelListChannel = z
  .object({ index: z.number().int(), name: z.string(), group: z.string().nullable() })
  .meta({ id: 'ChannelListChannel' });

export const ChannelListMatch = z
  .object({
    country: z.string(),
    provider_id: z.string().meta({ description: 'Id da biblioteca de emissoras (`/v1/broadcasters`).' }),
    provider: z.string(),
    access: z.enum(['linear', 'streaming']),
    match: z.enum(CHANNEL_MATCH_KINDS).meta({ description: MATCH_DESCRIPTION }),
    channels: z.array(z.object({ index: z.number().int(), name: z.string() })),
    origin: z.enum(['codigo', 'ia', 'cliente']).meta({
      description:
        'codigo = dicionário de emissoras · ia = sobras, conferidas pelo validador · cliente = correção no portal.',
    }),
    note: z
      .string()
      .nullable()
      .meta({ description: 'Nota de auditoria (divergência, validador, correção).' }),
  })
  .meta({ id: 'ChannelListMatch', description: 'Uma emissora num país (direito) e os canais da lista.' });
export type ChannelListMatch = z.infer<typeof ChannelListMatch>;

export const ChannelList = z
  .object({
    status: z.enum(['review', 'confirmed']).meta({
      description: 'review = casamento proposto esperando a confirmação · confirmed = o que a API serve.',
    }),
    ai_status: z.enum(['not_needed', 'pending', 'done', 'failed']).meta({
      description: 'A IA só confere as sobras do casamento por código; pending = ainda não conferiu.',
    }),
    source: z.enum(['m3u', 'text']),
    default_country: z.string().nullable(),
    markets: z.array(z.string()).meta({ description: 'Países dos direitos considerados.' }),
    processed_at: z.string(),
    confirmed_at: z.string().nullable(),
    channels: z.array(ChannelListChannel),
    matches: z.array(ChannelListMatch).meta({ description: 'Casamento atual (proposto).' }),
    confirmed_matches: z
      .array(ChannelListMatch)
      .nullable()
      .meta({ description: 'O casamento servido em `client_channels` (o da última confirmação).' }),
  })
  .meta({ id: 'ChannelList' });
export type ChannelList = z.infer<typeof ChannelList>;

export const ChannelListUpload = ChannelList.extend({
  duplicates: z.number().int().min(0).meta({ description: 'Nomes repetidos descartados no envio.' }),
  truncated: z.number().int().min(0).meta({
    description:
      'Canais além do limite de 5.000 (sem contar os repetidos) que ficaram de fora; 0 = lista inteira.',
  }),
}).meta({ id: 'ChannelListUpload' });
export type ChannelListUpload = z.infer<typeof ChannelListUpload>;

const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});
const common = {
  '401': problem('Chave ausente ou inválida (INVALID_KEY)'),
  '403': problem('Módulo where_to_watch fora do plano, ou chave publicável (MODULE_NOT_IN_PLAN / FORBIDDEN)'),
  '429': problem('Limite do tenant atingido (RATE_LIMITED)'),
};

export const channelListPaths: ZodOpenApiPathsObject = {
  '/v1/channel-list': {
    get: {
      summary: 'Lista de canais do tenant e o casamento com os direitos',
      description:
        'A lista enviada (só nomes), o casamento proposto (`matches`) e o confirmado (`confirmed_matches`, o ' +
        'que entra em `client_channels` no onde assistir). Exige o módulo `where_to_watch`.',
      tags: ['Onde assistir'],
      responses: {
        '200': { description: 'OK', content: json(ChannelList) },
        '404': problem('Tenant sem lista de canais (NOT_FOUND)'),
        ...common,
      },
    },
    put: {
      summary: 'Envia (ou substitui) a lista de canais',
      description:
        'M3U ou nomes colados. Nunca envie EPG: só o nome de cada canal é lido. O casamento por código sai na ' +
        'hora (`status: review`); as sobras vão para a IA (`ai_status: pending`). Correções feitas no portal ' +
        'continuam valendo para os canais de mesmo nome. Até 5.000 canais: os repetidos e os além do limite ' +
        'ficam de fora, contados em `duplicates` e `truncated`. Só com a chave secreta.',
      tags: ['Onde assistir'],
      requestBody: { content: json(ChannelListBody) },
      responses: {
        '200': { description: 'Lista gravada', content: json(ChannelListUpload) },
        '400': problem('Lista vazia, sem nomes ou acima do limite (INVALID_PARAMS)'),
        ...common,
      },
    },
  },
  '/v1/channel-list/reprocess': {
    post: {
      summary: 'Reprocessa a lista com o dicionário de emissoras atual',
      description:
        'Refaz o casamento por código (o dicionário e os mercados podem ter mudado) e põe as sobras de novo na ' +
        'fila da IA. As correções do cliente são mantidas; a versão confirmada segue servida até a próxima ' +
        'confirmação. Só com a chave secreta.',
      tags: ['Onde assistir'],
      responses: {
        '200': { description: 'Reprocessada', content: json(ChannelList) },
        '404': problem('Tenant sem lista de canais (NOT_FOUND)'),
        ...common,
      },
    },
  },
  '/v1/channel-list/confirm': {
    post: {
      summary: 'Confirma o casamento proposto',
      description:
        'O casamento atual passa a ser servido em `client_channels` no onde assistir. Só com a chave secreta.',
      tags: ['Onde assistir'],
      responses: {
        '200': { description: 'Confirmada', content: json(ChannelList) },
        '404': problem('Tenant sem lista de canais (NOT_FOUND)'),
        ...common,
      },
    },
  },
};
