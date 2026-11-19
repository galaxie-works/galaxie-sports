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
    .regex(/^(\d{4}(-(0[1-9]|1[0-2]))?|current-month|current-year)$/)
    .meta({
      description:
        'Mês (`2026-11`) ou ano (`2026`), no fuso do país do programa; `current-month` e `current-year` usam o ' +
        'período corrente nesse fuso.',
    }),
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
    is_me: z
      .boolean()
      .optional()
      .meta({ description: 'A linha é do torcedor do token (só nas rotas do torcedor).' }),
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

const FanAchievementView = z.object({
  achievement_id: z.string(),
  season: z.string().meta({ description: '`all` (vitalícia) ou o ano da temporada.' }),
  count: z.number().int(),
  steps: z.number().int().meta({ description: 'Degraus alcançados (0 a 5).' }),
  next_threshold: z.number().int().nullable().meta({ description: 'Quanto falta contar para o próximo.' }),
  rarity: z
    .number()
    .nullable()
    .meta({ description: 'Fração dos torcedores do programa com o primeiro Degrau (0 a 1).' }),
});

export const FanAchievements = z
  .object({
    data: z.object({
      program_country: z.string(),
      achievements: z.array(FanAchievementView),
    }),
  })
  .meta({ id: 'FanAchievements' });
export type FanAchievements = z.infer<typeof FanAchievements>;

const FanCardView = z.object({
  card_key: z.string(),
  achievement_id: z.string(),
  season: z.string(),
  step: z.number().int(),
  granted_at: z.string(),
});

export const FanCards = z
  .object({
    data: z.object({
      program_country: z.string(),
      cards: z.array(FanCardView),
    }),
  })
  .meta({ id: 'FanCards' });
export type FanCards = z.infer<typeof FanCards>;

/** Nível do torcedor pelos Pontos (`game.level_def`, igual para todos os clientes). */
export const FanLevelView = z
  .object({
    level: z.number().int().positive(),
    min_points: z.number().int().nonnegative().meta({ description: 'Mínimo de Pontos do Nível atual.' }),
    next_min_points: z
      .number()
      .int()
      .positive()
      .nullable()
      .meta({ description: 'Mínimo do próximo Nível; null no último.' }),
  })
  .meta({ id: 'FanLevel' });

// ─── leitura pelo servidor do cliente (chave secreta, #913) ──────────────────────────────────────

const ExternalId = z.string().trim().min(1).max(200);
export const GameFanParams = z.object({ externalAccountId: ExternalId, externalProfileId: ExternalId });

const ProgramCountry = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .meta({ description: 'País do programa (ISO 3166-1 alfa-2, maiúsculo).' });

export const GameRankingServerQuery = RankingQuery.extend({ country: ProgramCountry });

export const FanGameSummary = z
  .object({
    data: z.object({
      profile_id: z.uuid().meta({ description: 'Id opaco do Perfil na Galaxie (o mesmo dos webhooks).' }),
      program_country: z.string(),
      points: z.number().int().meta({ description: 'Pontos: só sobem; definem Nível e Ranking.' }),
      balance: z.number().int().meta({ description: 'Saldo que se pode gastar no resgate (só 18+).' }),
      level: FanLevelView,
      achievements: z.array(FanAchievementView),
      cards: z.array(FanCardView),
    }),
  })
  .meta({ id: 'FanGameSummary' });
export type FanGameSummary = z.infer<typeof FanGameSummary>;

export const AchievementEarnersParams = z.object({
  achievementId: z
    .string()
    .regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/)
    .max(80),
});
export const AchievementEarnersQuery = z.object({
  season: z
    .string()
    .regex(/^(all|\d{4}(-\d{2,4})?)$/)
    .default('all'),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

export const AchievementEarners = z
  .object({
    data: z.object({
      achievement_id: z.string(),
      season: z.string(),
      total: z.number().int().meta({ description: 'Torcedores do programa com o primeiro Degrau.' }),
      earners: z
        .array(
          z.object({
            profile_id: z.uuid(),
            nickname: z.string().nullable(),
            avatar_url: z.string().nullable(),
            step: z.number().int().min(1).max(5),
            is_me: z.boolean().optional().meta({ description: 'É o torcedor do token.' }),
          }),
        )
        .meta({
          description:
            'Alguns que já ganharam, do Degrau mais alto. Só aparece quem é adulto e deixou as Conquistas visíveis no Perfil.',
        }),
    }),
  })
  .meta({ id: 'AchievementEarners' });
export type AchievementEarners = z.infer<typeof AchievementEarners>;

export const AchievementCatalogQuery = z.object({
  /** Só as do esporte e as comuns a todos. Sem ele, o Catálogo inteiro do programa. */
  sport: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(40)
    .optional(),
});

const GameI18nView = z
  .object({ pt: z.string().optional(), es: z.string().optional(), en: z.string().optional() })
  .meta({ description: 'Texto por idioma (`pt`, `es`, `en`); o widget escolhe o do leitor.' });

export const AchievementCatalog = z
  .object({
    data: z.object({
      program_country: z.string(),
      achievements: z.array(
        z.object({
          id: z.string(),
          sport: z.string().nullable().meta({ description: 'null = comum a todos os esportes.' }),
          category: z.enum(['participation', 'hit', 'moment', 'consumption']),
          family: z
            .string()
            .meta({ description: 'Grupo da estante (`loyalty`, `predictions`, `moments`...).' }),
          stepped: z.boolean().meta({ description: 'false = Conquista de momento, única (um Degrau só).' }),
          seasonal: z.boolean(),
          name: GameI18nView,
          description: GameI18nView,
          steps: z.array(
            z.object({
              step: z.number().int().min(1).max(5),
              threshold: z.number().int().positive(),
              card_key: z.string().nullable(),
            }),
          ),
        }),
      ),
    }),
  })
  .meta({ id: 'AchievementCatalog' });
export type AchievementCatalog = z.infer<typeof AchievementCatalog>;

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

const serverAuth = [{ galaxieKey: [] }];
const serverCommon = {
  '401': problem('Chave ausente, inválida ou que não é a secreta (INVALID_KEY)'),
  '403': problem('Módulo Gamificação desligado (MODULE_NOT_IN_PLAN)'),
  '429': problem('Limite atingido (RATE_LIMITED)'),
};

export const gamePaths: ZodOpenApiPathsObject = {
  '/v1/fans/{externalAccountId}/profiles/{externalProfileId}/game': {
    get: {
      summary: 'Gamificação de um torcedor (servidor)',
      description:
        'Para o servidor do cliente, com a chave secreta: Pontos, Saldo, Nível, Conquistas e Cartas de um Perfil ' +
        'pelos ids do seu sistema, no país do programa do Perfil. Use para apps próprios, sem os widgets. Perfil ' +
        'que não existe (ou foi excluído) dá 404.',
      tags: [TAG],
      security: serverAuth,
      requestParams: { path: GameFanParams },
      responses: {
        '200': { description: 'OK', content: json(FanGameSummary) },
        '404': problem('Perfil não encontrado (NOT_FOUND)'),
        ...serverCommon,
      },
    },
  },
  '/v1/game/rankings/{period}': {
    get: {
      summary: 'Ranking do período (servidor)',
      description:
        'O mesmo Ranking que o torcedor vê, para o servidor do cliente, com a chave secreta e o país do programa.',
      tags: [TAG],
      security: serverAuth,
      requestParams: { path: RankingParams, query: GameRankingServerQuery },
      responses: { '200': { description: 'OK', content: json(Ranking) }, ...serverCommon },
    },
  },
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
  '/v1/fans/me/achievements': {
    get: {
      summary: 'Minhas Conquistas',
      description:
        'Progresso do torcedor em cada Conquista (vitalícia e da temporada), Degraus alcançados e a raridade. ' +
        'Nenhuma Conquista vem de compra.',
      tags: [TAG],
      security: fanAuth,
      responses: { '200': { description: 'OK', content: json(FanAchievements) }, ...common },
    },
  },
  '/v1/achievements': {
    get: {
      summary: 'Catálogo de Conquistas do programa',
      description:
        'As Conquistas que valem no programa do torcedor (cliente e país): nome e descrição por idioma, a família ' +
        'da estante e os Degraus com o limite e a Carta de cada um. As que o cliente desligou não aparecem.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { query: AchievementCatalogQuery },
      responses: { '200': { description: 'OK', content: json(AchievementCatalog) }, ...common },
    },
  },
  '/v1/achievements/{achievementId}/earners': {
    get: {
      summary: 'Quem já ganhou',
      description:
        'Torcedores do mesmo cliente e país que já ganharam a Conquista. Mostra só quem é adulto e deixou as ' +
        'Conquistas visíveis; o total conta todos.',
      tags: [TAG],
      security: fanAuth,
      requestParams: { path: AchievementEarnersParams, query: AchievementEarnersQuery },
      responses: { '200': { description: 'OK', content: json(AchievementEarners) }, ...common },
    },
  },
  '/v1/fans/me/cards': {
    get: {
      summary: 'Minhas Cartas',
      description: 'Cartas ganhas, uma certa por Degrau de Conquista. Sem sorteio, sem compra e sem troca.',
      tags: [TAG],
      security: fanAuth,
      responses: { '200': { description: 'OK', content: json(FanCards) }, ...common },
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
