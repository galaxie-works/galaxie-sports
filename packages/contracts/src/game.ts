import * as z from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { Problem } from './common.js';

/**
 * Gamificação (#904): Palpite individual e Ranking único por cliente e país (#942). O relógio é o do servidor: o
 * Palpite fecha no `lock_at` (o horário do jogo) e o que chega depois é recusado. Durante o jogo a pontuação é
 * provisória (o widget calcula com o placar ao vivo); no fim vira definitiva e entra nos Pontos e no Ranking.
 */

const WinnerPick = z.enum(['home', 'draw', 'away']);

export const PredictionInput = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('exact_score'),
      home: z.number().int().min(0).max(999),
      away: z.number().int().min(0).max(999),
    }),
    z.strictObject({ kind: z.literal('winner'), pick: WinnerPick }),
    z.strictObject({
      kind: z.literal('quantity'),
      subject: z.string().min(1).max(40).meta({
        description: 'Assunto do Palpite de quantidade (`total_score`: total de pontos do jogo).',
      }),
      atLeast: z.number().int().min(1).max(999).meta({
        description:
          '"Pelo menos N". Precisa ser maior ou igual ao Piso do esporte (`floors` do Palpite aberto).',
      }),
    }),
  ])
  .meta({ id: 'PredictionInput' });
export type PredictionInput = z.infer<typeof PredictionInput>;

export const PredictionsBody = z
  .strictObject({
    predictions: z.array(PredictionInput).min(1).max(10).meta({
      description:
        'Um Palpite por tipo (e por assunto, no de quantidade). Mandar de novo antes do prazo troca.',
    }),
  })
  .meta({ id: 'PredictionsBody' });
export type PredictionsBody = z.infer<typeof PredictionsBody>;

export const PredictionEventParams = z.object({ eventId: z.uuid() });
export const PredictionOpenQuery = z.object({ event_id: z.uuid() });

export const PredictionView = z
  .object({
    kind: z.enum(['exact_score', 'winner', 'quantity']),
    value: PredictionInput,
    state: z.enum(['open', 'locked', 'final', 'void']).meta({
      description:
        '`open` aceita troca; `locked` o jogo começou; `final` Pontos definitivos; `void` jogo cancelado.',
    }),
    points: z.number().int().meta({ description: 'Provisório durante o jogo; definitivo em `final`.' }),
    full_hit: z.boolean().meta({ description: 'Acerto em cheio (placar exato ou o total exato).' }),
  })
  .meta({ id: 'PredictionView' });
export type PredictionView = z.infer<typeof PredictionView>;

export const OpenPredictions = z
  .object({
    data: z.object({
      event_id: z.uuid(),
      sport: z.string(),
      lock_at: z.string().meta({ description: 'Prazo do Palpite (ISO 8601), pelo relógio do servidor.' }),
      open: z.boolean(),
      kinds: z.array(z.enum(['exact_score', 'winner', 'quantity'])),
      floors: z
        .record(z.string(), z.number().int())
        .meta({ description: 'Piso por assunto do Palpite de quantidade.' }),
      predictions: z.array(PredictionView),
      server_time: z.string(),
    }),
  })
  .meta({ id: 'OpenPredictions' });
export type OpenPredictions = z.infer<typeof OpenPredictions>;

export const SavedPredictions = z
  .object({ data: z.object({ event_id: z.uuid(), predictions: z.array(PredictionView) }) })
  .meta({ id: 'SavedPredictions' });
export type SavedPredictions = z.infer<typeof SavedPredictions>;

export const RankingParams = z.object({
  period: z
    .string()
    .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/)
    .meta({ description: 'Mês (`2026-11`) ou ano (`2026`), no fuso do país do programa.' }),
});
export const RankingQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const RankingEntryView = z
  .object({
    position: z.number().int().positive(),
    profile_id: z.uuid(),
    nickname: z.string().nullable(),
    points: z.number().int(),
    full_hits: z.number().int(),
  })
  .meta({ id: 'RankingEntry' });

export const Ranking = z
  .object({
    data: z.object({
      period: z.string(),
      program_country: z.string(),
      entries: z.array(RankingEntryView),
    }),
  })
  .meta({ id: 'Ranking' });
export type Ranking = z.infer<typeof Ranking>;

export const MyRanking = z
  .object({
    data: z.object({
      period: z.string(),
      program_country: z.string(),
      position: z
        .number()
        .int()
        .positive()
        .nullable()
        .meta({ description: 'null = ainda sem Pontos no período.' }),
      points: z.number().int(),
      full_hits: z.number().int(),
    }),
  })
  .meta({ id: 'MyRanking' });
export type MyRanking = z.infer<typeof MyRanking>;

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: Problem } },
});
const json = (schema: z.ZodType) => ({ 'application/json': { schema } });
const TAG = 'Gamificação';
const fanAuth = [{ galaxieFanToken: [] }];
const common = {
  '401': problem('Token ausente, inválido, vencido ou de Perfil excluído (INVALID_KEY)'),
  '403': problem('Módulo Gamificação desligado ou faixa etária sem permissão (FAN_AGE_RESTRICTED)'),
  '429': problem('Limite atingido (RATE_LIMITED)'),
};

export const gamePaths: ZodOpenApiPathsObject = {
  '/v1/predictions/open': {
    get: {
      summary: 'Palpite de um jogo',
      description:
        'Prazo, tipos aceitos, Piso do Palpite de quantidade e os Palpites do torcedor no jogo, com a pontuação ' +
        'provisória ou definitiva.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { query: PredictionOpenQuery },
      responses: {
        '200': { description: 'OK', content: json(OpenPredictions) },
        '404': problem('Jogo não encontrado ou esporte sem Palpite (NOT_FOUND)'),
        ...common,
      },
    },
  },
  '/v1/predictions/{eventId}': {
    put: {
      summary: 'Palpitar',
      description:
        'Grava ou troca os Palpites do torcedor no jogo até o prazo. Palpitar é sempre grátis e nunca depende de ' +
        'compra. Depois do prazo, recusa com 409.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: PredictionEventParams },
      requestBody: { content: json(PredictionsBody) },
      responses: {
        '200': { description: 'Palpites gravados', content: json(SavedPredictions) },
        '400': problem('Palpite inválido, abaixo do Piso ou assunto sem Piso (INVALID_PARAMS)'),
        '404': problem('Jogo não encontrado ou esporte sem Palpite (NOT_FOUND)'),
        '409': problem('Prazo encerrado (CONFLICT)'),
        ...common,
      },
    },
  },
  '/v1/rankings/{period}': {
    get: {
      summary: 'Ranking do período',
      description:
        'Ranking único do cliente no país do torcedor, pelos Pontos definitivos do período. Desempate: mais ' +
        'Acertos em cheio, depois quem chegou primeiro ao total. Nunca por sorte.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: RankingParams, query: RankingQuery },
      responses: { '200': { description: 'OK', content: json(Ranking) }, ...common },
    },
  },
  '/v1/rankings/{period}/me': {
    get: {
      summary: 'Minha posição no Ranking',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: RankingParams },
      responses: { '200': { description: 'OK', content: json(MyRanking) }, ...common },
    },
  },
};
