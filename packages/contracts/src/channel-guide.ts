import 'zod-openapi';
import * as z from 'zod';
import { LocaleQuery } from './common.js';
import { Event, isCalendarDate } from './events.js';

/**
 * Grade de esportes nos canais do cliente (widget `channel_guide`, issue #834): o que passa no dia, hora a
 * hora, nos canais da lista confirmada do tenant (`/v1/channel-list`), cruzada com o onde assistir de cada
 * jogo. A rota fica presa a um widget salvo no Builder: o filtro de canais escolhido lá é aplicado no
 * servidor e a resposta só traz os canais que têm jogo no dia, nunca a lista inteira.
 */

export const ChannelGuideParams = z.object({
  id: z.uuid().meta({ description: 'Id do widget "Grade nos canais" salvo no Builder.' }),
});

export const ChannelGuideQuery = LocaleQuery.extend({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')
    .refine(isCalendarDate, 'data inexistente')
    .optional()
    .meta({ description: 'Dia civil no fuso `tz`. Padrão: hoje.', example: '2026-11-08' }),
  sport: z
    .string()
    .max(400)
    .regex(/^[a-z0-9-]+(,[a-z0-9-]+)*$/, 'esportes separados por vírgula')
    .optional()
    .meta({
      description: 'Só estes esportes (separados por vírgula). Padrão: o esporte salvo no widget, ou todos.',
      example: 'football,basketball',
    }),
});
export type ChannelGuideQuery = z.infer<typeof ChannelGuideQuery>;

export const ChannelGuideEntry = z
  .object({
    event: Event,
    channels: z
      .array(z.string())
      .meta({ description: 'Canais da lista do cliente que passam o jogo (nomes como na lista).' }),
  })
  .meta({ id: 'ChannelGuideEntry' });

export const ChannelGuide = z
  .object({
    widget_id: z.uuid(),
    date: z.string().meta({ description: 'Dia civil da grade (AAAA-MM-DD) no fuso `tz`.' }),
    country: z.string().meta({ description: 'País do widget (ISO 3166-1 alpha-2).', example: 'BR' }),
    status: z.enum(['ok', 'no_channel_list']).meta({
      description: '`no_channel_list` = o tenant ainda não confirmou a lista de canais (grade vazia).',
    }),
    channels: z.array(z.string()).meta({
      description: 'Canais com algum jogo no dia, em ordem alfabética (só estes; nunca a lista toda).',
    }),
    entries: z.array(ChannelGuideEntry).meta({ description: 'Jogos do dia, pelo horário de início.' }),
  })
  .meta({ id: 'ChannelGuide' });
export type ChannelGuide = z.infer<typeof ChannelGuide>;
export type ChannelGuideEntry = z.infer<typeof ChannelGuideEntry>;
