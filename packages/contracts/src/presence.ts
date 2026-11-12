import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';

/**
 * Presença ao vivo verificada (#906, docs/05 §9): o widget ou o app do cliente manda um sinal a cada `heartbeat_s`
 * enquanto o jogo está visível. O servidor grava pelo relógio dele; o do aparelho nunca vale.
 */

export const FanPresenceBody = z
  .strictObject({
    eventId: z.uuid().meta({ description: 'Jogo (id do evento da API).' }),
    visible: z.boolean().meta({
      description: 'A aba ou a tela do jogo está visível (`document.visibilityState === "visible"`).',
    }),
    interacted: z.boolean().optional().meta({
      description: 'O torcedor tocou ou clicou desde o último sinal (responde ao `interaction_due`).',
    }),
  })
  .meta({ id: 'FanPresenceBody' });
export type FanPresenceBody = z.infer<typeof FanPresenceBody>;

export const FanPresenceResponse = z
  .object({
    data: z.object({
      counted: z.boolean().meta({ description: 'O sinal contou como presença.' }),
      reason: z
        .enum(['hidden', 'interaction_needed', 'too_many_games'])
        .nullable()
        .meta({
          description:
            '`hidden`: aba oculta; `interaction_needed`: peça um toque do torcedor; `too_many_games`: o Perfil já ' +
            'está no limite de jogos ao mesmo tempo.',
        }),
      interaction_due: z
        .boolean()
        .meta({ description: 'Peça um toque ao torcedor e mande `interacted: true`.' }),
      heartbeat_s: z.number().int().meta({ description: 'Intervalo até o próximo sinal.' }),
      present: z.number().int().meta({ description: 'Torcedores do cliente no jogo agora.' }),
      server_time: z.string().meta({ description: 'Relógio do servidor (ISO 8601), o único que vale.' }),
    }),
  })
  .meta({ id: 'FanPresenceResponse' });
export type FanPresenceResponse = z.infer<typeof FanPresenceResponse>;

export const PresenceEventParams = z.object({ eventId: z.uuid() });

export const EventPresence = z
  .object({ data: z.object({ event_id: z.uuid(), present: z.number().int() }) })
  .meta({ id: 'EventPresence' });
export type EventPresence = z.infer<typeof EventPresence>;

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const TAG = 'Torcedor';
const fanAuth = [{ galaxieFanToken: [] }];

export const presencePaths: ZodOpenApiPathsObject = {
  '/v1/fans/me/presence': {
    post: {
      summary: 'Sinal de presença ao vivo',
      description:
        'Mande a cada `heartbeat_s` (30 s) enquanto o jogo está na tela. Só conta com a aba visível; de tempos em ' +
        'tempos peça um toque (`interaction_due`). Há limite de jogos ao mesmo tempo por Perfil. Quem abre depois de ' +
        'um lance não ganha o lance: a presença vale do primeiro sinal em diante, pelo relógio do servidor.',
      tags: [TAG],
      security: fanAuth,
      requestBody: { content: json(FanPresenceBody) },
      responses: {
        '200': { description: 'Sinal recebido (veja `counted`)', content: json(FanPresenceResponse) },
        '400': problem('Campo inválido (INVALID_PARAMS)'),
        '401': problem('Token ausente, inválido, vencido ou de Perfil excluído (INVALID_KEY)'),
        '403': problem('Faixa etária sem permissão (FAN_AGE_RESTRICTED)'),
        '404': problem('Jogo não encontrado (NOT_FOUND)'),
        '409': problem('Jogo fora do ao vivo (CONFLICT)'),
        '429': problem('Limite atingido (RATE_LIMITED)'),
      },
    },
  },
  '/v1/events/{eventId}/presence': {
    get: {
      summary: 'Torcedores no jogo agora',
      description:
        'Quantos torcedores do cliente mandaram sinal de presença no jogo nos últimos 90 segundos.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: PresenceEventParams },
      responses: {
        '200': { description: 'OK', content: json(EventPresence) },
        '401': problem('Token ausente, inválido, vencido ou de Perfil excluído (INVALID_KEY)'),
        '403': problem('Faixa etária sem permissão (FAN_AGE_RESTRICTED)'),
        '429': problem('Limite atingido (RATE_LIMITED)'),
      },
    },
  },
};
