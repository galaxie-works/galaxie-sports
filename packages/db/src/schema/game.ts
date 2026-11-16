/**
 * Gamificação (épico #904, #905; arquitetura 03), schema `game`. Tudo o que é do programa tem a chave
 * `(tenant_id, program_country)`: a economia é separada por cliente **e** por país-alvo (decisão de 07/11), e o banco
 * recusa vínculo entre programas diferentes por chave composta, mesmo com bug no código.
 *
 * O Perfil vem da base (`fan.profile`, #937) e os Pontos da carteira da base (`fan.wallet` e `fan.points_ledger`,
 * #938): aqui não há outro perfil nem outro extrato. Ficam o programa, as regras versionadas, o Palpite, a soma por
 * período do Ranking, o Catálogo de Conquistas da Galaxie, o que o cliente ligou, o progresso, os Degraus e Cartas
 * concedidos, o sinal real de participação, o registro de auditoria e os alertas antifraude.
 *
 * - **Regras versionadas** (`rule_version`): toda mudança cria versão nova; Palpite, Degrau, Carta e auditoria
 *   guardam a versão da época, e mudança nunca reescreve o que já foi ganho.
 * - **Auditoria** (`audit_log`): só acréscimo. A API tem só INSERT nela (roles.ts); quem ganhou o quê, por qual
 *   evento e com qual versão, para responder a órgão de defesa do consumidor. Na exclusão do torcedor, o registro
 *   fica com o id interno do Perfil, que já não liga a ninguém (o Perfil perde o id do cliente e o Apelido).
 * - **Nenhuma compra entra**: não há tipo de entrada, coluna nem gatilho de compra ou de clique do Shopping.
 *
 * O jogo (`core.event`) e o time ficam sem chave estrangeira: o espelho reorganiza o que é dele.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './_shared.js';
import { tenant } from './api.js';
import { fanProfile } from './fan.js';

export const game = pgSchema('game');

export const GAME_PROGRAM_STATUS = ['active', 'paused'] as const;
export type GameProgramStatus = (typeof GAME_PROGRAM_STATUS)[number];

/** Tipos de Palpite (`@galaxie/game-rules`, prediction.ts). */
export const GAME_PREDICTION_KINDS = ['exact_score', 'winner', 'quantity'] as const;
export type GamePredictionKind = (typeof GAME_PREDICTION_KINDS)[number];

/**
 * Estado do Palpite: `open` (aceita mudança até o `lock_at`), `locked` (o jogo começou, pontuação provisória),
 * `final` (Pontos definitivos no extrato), `void` (jogo cancelado ou adiado sem nova data, pela regra do programa).
 */
export const GAME_PREDICTION_STATES = ['open', 'locked', 'final', 'void'] as const;
export type GamePredictionState = (typeof GAME_PREDICTION_STATES)[number];

/** Categoria da Conquista no Catálogo (revisão de produto de 08/11). */
export const GAME_ACHIEVEMENT_CATEGORIES = ['participation', 'hit', 'moment', 'consumption'] as const;
export type GameAchievementCategory = (typeof GAME_ACHIEVEMENT_CATEGORIES)[number];

/** Sinal real de participação. Compra e clique do Shopping não existem aqui, de propósito. */
export const GAME_PARTICIPATION_ACTIONS = ['poll', 'trivia', 'watched', 'consumption'] as const;
export type GameParticipationAction = (typeof GAME_PARTICIPATION_ACTIONS)[number];

/** O que o registro de auditoria registra. */
export const GAME_AUDIT_KINDS = [
  'prediction.placed',
  'prediction.scored',
  'prediction.reverted',
  'prediction.voided',
  'participation.counted',
  'achievement.step_reached',
  'achievement.completed',
  'card.granted',
  'level.reached',
  'program.rules_changed',
  'program.achievement_changed',
  'fraud.flagged',
] as const;
export type GameAuditKind = (typeof GAME_AUDIT_KINDS)[number];

/** Textos nos três idiomas. */
export type GameI18n = Partial<Record<'pt' | 'es' | 'en', string>>;

const inList = (col: string, list: readonly string[]) =>
  sql.raw(`${col} in (${list.map((v) => `'${v}'`).join(', ')})`);

const gameId = () =>
  uuid('id')
    .notNull()
    .default(sql`public.uuid_generate_v7()`);

const tenantRef = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' });

const programCountry = () => text('program_country').notNull();

/** Programa: cliente + país, com a versão de regra vigente. */
export const gameProgram = game.table(
  'program',
  {
    tenantId: tenantRef(),
    programCountry: programCountry(),
    status: text('status').$type<GameProgramStatus>().notNull().default('active'),
    /** Versão vigente em `rule_version`. */
    ruleVersion: integer('rule_version').notNull().default(1),
    /** Fuso do país para o mês do Ranking (o jogo conta no mês em que começou). */
    timeZone: text('time_zone').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'program_pkey', columns: [t.tenantId, t.programCountry] }),
    check('program_country', sql`${t.programCountry} ~ '^[A-Z]{2}$'`),
    check('program_status', inList('status', GAME_PROGRAM_STATUS)),
    check('program_rule_version', sql`${t.ruleVersion} >= 1`),
  ],
);

/**
 * Regras do programa, uma linha por versão (escala de Pontos da Galaxie da época + o que o programa acrescentou).
 * Linha nova a cada mudança; a antiga nunca muda.
 */
export const gameRuleVersion = game.table(
  'rule_version',
  {
    tenantId: tenantRef(),
    programCountry: programCountry(),
    version: integer('version').notNull(),
    /** Escala de Pontos (`PointsScale` do `@galaxie/game-rules`) e regras do programa. */
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    /** Quem mudou: `galaxie:<id>`, `tenant:<prefixo>` ou `system`. */
    changedBy: text('changed_by').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'rule_version_pkey', columns: [t.tenantId, t.programCountry, t.version] }),
    foreignKey({
      name: 'rule_version_program_fk',
      columns: [t.tenantId, t.programCountry],
      foreignColumns: [gameProgram.tenantId, gameProgram.programCountry],
    }).onDelete('cascade'),
    check('rule_version_positive', sql`${t.version} >= 1`),
    check('rule_version_note_len', sql`${t.note} is null or length(${t.note}) <= 500`),
  ],
);

/**
 * Palpite individual (#942). Um por Perfil, jogo, tipo e assunto (o assunto só existe no Palpite de quantidade).
 * `lock_at` sai do horário do jogo pelo relógio do servidor. Durante o jogo a pontuação fica em
 * `provisional_points`; o extrato só recebe o definitivo, e o gol anulado pelo VAR muda só o provisório.
 */
export const gamePrediction = game.table(
  'prediction',
  {
    tenantId: tenantRef(),
    id: gameId(),
    programCountry: programCountry(),
    profileId: uuid('profile_id').notNull(),
    /** `core.event.id`, sem chave estrangeira. */
    eventId: uuid('event_id').notNull(),
    kind: text('kind').$type<GamePredictionKind>().notNull(),
    /** Assunto do Palpite de quantidade (`goals`, `corners`...); vazio nos outros tipos. */
    subject: text('subject').notNull().default(''),
    /** O Palpite (`PredictionValue` do `@galaxie/game-rules`). */
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    lockAt: timestamp('lock_at', { withTimezone: true }).notNull(),
    state: text('state').$type<GamePredictionState>().notNull().default('open'),
    provisionalPoints: integer('provisional_points').notNull().default(0),
    finalPoints: integer('final_points'),
    fullHit: boolean('full_hit').notNull().default(false),
    /** Versão da regra quando o Palpite foi feito: é ela que pontua. */
    ruleVersion: integer('rule_version').notNull(),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'prediction_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'prediction_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'prediction_program_fk',
      columns: [t.tenantId, t.programCountry],
      foreignColumns: [gameProgram.tenantId, gameProgram.programCountry],
    }).onDelete('cascade'),
    // a regra da época existe: o que foi feito ou ganho pontua pela versão que guarda
    foreignKey({
      name: 'prediction_rule_version_fk',
      columns: [t.tenantId, t.programCountry, t.ruleVersion],
      foreignColumns: [gameRuleVersion.tenantId, gameRuleVersion.programCountry, gameRuleVersion.version],
    }).onDelete('cascade'),
    uniqueIndex('prediction_profile_event_uq').on(
      t.tenantId,
      t.programCountry,
      t.profileId,
      t.eventId,
      t.kind,
      t.subject,
    ),
    // pontuação em lote por evento: UPDATE ... FROM por cliente, país e jogo
    index('prediction_event_idx').on(t.tenantId, t.programCountry, t.eventId, t.state),
    // fechar os Palpites do jogo que começou, em todos os clientes
    index('prediction_lock_idx').on(t.eventId, t.state, t.lockAt),
    check('prediction_kind', inList('kind', GAME_PREDICTION_KINDS)),
    check('prediction_state', inList('state', GAME_PREDICTION_STATES)),
    check(
      'prediction_subject',
      sql`(${t.kind} = 'quantity' and length(${t.subject}) between 1 and 40) or (${t.kind} <> 'quantity' and ${t.subject} = '')`,
    ),
    check(
      'prediction_points_nonneg',
      sql`${t.provisionalPoints} >= 0 and (${t.finalPoints} is null or ${t.finalPoints} >= 0)`,
    ),
    check('prediction_final_shape', sql`(${t.state} = 'final') = (${t.finalPoints} is not null)`),
  ],
);

/**
 * Pontos do Perfil por período (mês `AAAA-MM` e ano `AAAA`), base do Ranking. O Valkey guarda o sorted set, que é
 * reconstruível daqui. `reached_at` = quando chegou ao total atual (desempate).
 */
export const gamePeriodPoints = game.table(
  'period_points',
  {
    tenantId: tenantRef(),
    programCountry: programCountry(),
    period: text('period').notNull(),
    profileId: uuid('profile_id').notNull(),
    points: bigint('points', { mode: 'number' }).notNull().default(0),
    fullHits: integer('full_hits').notNull().default(0),
    reachedAt: timestamp('reached_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      name: 'period_points_pkey',
      columns: [t.tenantId, t.programCountry, t.period, t.profileId],
    }),
    foreignKey({
      name: 'period_points_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'period_points_program_fk',
      columns: [t.tenantId, t.programCountry],
      foreignColumns: [gameProgram.tenantId, gameProgram.programCountry],
    }).onDelete('cascade'),
    index('period_points_rank_idx').on(
      t.tenantId,
      t.programCountry,
      t.period,
      sql`${t.points} desc`,
      sql`${t.fullHits} desc`,
      t.reachedAt,
    ),
    check('period_points_period', sql`${t.period} ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$'`),
    check('period_points_nonneg', sql`${t.points} >= 0 and ${t.fullHits} >= 0`),
  ],
);

/** Nível do torcedor por Pontos acumulados. Da Galaxie, igual para todos; o cliente pode prender um Prêmio a ele. */
export const gameLevelDef = game.table(
  'level_def',
  {
    level: smallint('level').primaryKey(),
    minPoints: bigint('min_points', { mode: 'number' }).notNull(),
    name: jsonb('name').$type<GameI18n>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('level_def_min_points_uq').on(t.minPoints),
    check('level_def_level', sql`${t.level} >= 1`),
    check('level_def_min_points', sql`${t.minPoints} >= 0`),
  ],
);

/**
 * Catálogo de Conquistas publicado pela Galaxie (global). `sport` null = comum a todos os esportes. `rule` é a regra
 * declarativa que o motor (#908) lê. `active` desliga a Conquista quando o dado do esporte não permite, com o motivo.
 */
export const gameCatalogAchievement = game.table(
  'catalog_achievement',
  {
    /** Slug estável (`loyalty.watched`, `football.stoppage_time_goal`). */
    id: text('id').primaryKey(),
    sport: text('sport'),
    category: text('category').$type<GameAchievementCategory>().notNull(),
    /** Família (Fidelidade, Palpites, Explorador...), para agrupar na estante. */
    family: text('family').notNull(),
    rule: jsonb('rule').$type<Record<string, unknown>>().notNull(),
    /** Conquista de momento não tem Degrau: é única. */
    stepped: boolean('stepped').notNull().default(true),
    /** Versão sazonal além da vitalícia. */
    seasonal: boolean('seasonal').notNull().default(false),
    active: boolean('active').notNull().default(true),
    inactiveReason: text('inactive_reason'),
    name: jsonb('name').$type<GameI18n>().notNull(),
    description: jsonb('description').$type<GameI18n>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('catalog_achievement_sport_idx').on(t.sport, t.active),
    check('catalog_achievement_id', sql`${t.id} ~ '^[a-z0-9_]+(\\.[a-z0-9_]+)+$' and length(${t.id}) <= 80`),
    check('catalog_achievement_category', inList('category', GAME_ACHIEVEMENT_CATEGORIES)),
    check('catalog_achievement_inactive', sql`${t.active} or ${t.inactiveReason} is not null`),
  ],
);

/** Degraus de cada Conquista do Catálogo (1 a 5; a de momento tem só o 1), com o bônus e a Carta de cada um. */
export const gameCatalogStep = game.table(
  'catalog_step',
  {
    achievementId: text('achievement_id')
      .notNull()
      .references(() => gameCatalogAchievement.id, { onDelete: 'cascade' }),
    step: smallint('step').notNull(),
    threshold: integer('threshold').notNull(),
    /** Bônus de Pontos do Degrau (Conquista de acerto dá bônus; a de participação não, já pontuou nas ações). */
    bonusPoints: integer('bonus_points').notNull().default(0),
    /** Carta que o Degrau dá (chave da arte), se der. */
    cardKey: text('card_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'catalog_step_pkey', columns: [t.achievementId, t.step] }),
    check('catalog_step_step', sql`${t.step} between 1 and 5`),
    check('catalog_step_threshold', sql`${t.threshold} >= 1`),
    check('catalog_step_bonus', sql`${t.bonusPoints} >= 0`),
  ],
);

/**
 * O que o programa ligou do Catálogo, com limites ajustados, e as Conquistas próprias do cliente (`custom`, com a
 * definição em `definition` e arte de um conjunto pronto).
 */
export const gameProgramAchievement = game.table(
  'program_achievement',
  {
    tenantId: tenantRef(),
    programCountry: programCountry(),
    achievementId: text('achievement_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Limites dos Degraus ajustados pelo cliente; null = os do Catálogo. */
    thresholds: integer('thresholds').array(),
    custom: boolean('custom').notNull().default(false),
    /** Definição da Conquista própria do cliente (mesmo formato do Catálogo). */
    definition: jsonb('definition').$type<Record<string, unknown>>(),
    ruleVersion: integer('rule_version').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      name: 'program_achievement_pkey',
      columns: [t.tenantId, t.programCountry, t.achievementId],
    }),
    foreignKey({
      name: 'program_achievement_program_fk',
      columns: [t.tenantId, t.programCountry],
      foreignColumns: [gameProgram.tenantId, gameProgram.programCountry],
    }).onDelete('cascade'),
    // a regra da época existe: o que foi feito ou ganho pontua pela versão que guarda
    foreignKey({
      name: 'program_achievement_rule_version_fk',
      columns: [t.tenantId, t.programCountry, t.ruleVersion],
      foreignColumns: [gameRuleVersion.tenantId, gameRuleVersion.programCountry, gameRuleVersion.version],
    }).onDelete('cascade'),
    check('program_achievement_custom', sql`${t.custom} = (${t.definition} is not null)`),
    check(
      'program_achievement_thresholds',
      sql`${t.thresholds} is null or (cardinality(${t.thresholds}) between 1 and 5)`,
    ),
  ],
);

/** Contagem por Perfil, Conquista e temporada (`all` = vitalícia; `2026` = a da temporada). */
export const gameAchievementProgress = game.table(
  'achievement_progress',
  {
    tenantId: tenantRef(),
    programCountry: programCountry(),
    profileId: uuid('profile_id').notNull(),
    achievementId: text('achievement_id').notNull(),
    season: text('season').notNull().default('all'),
    count: integer('count').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      name: 'achievement_progress_pkey',
      columns: [t.tenantId, t.programCountry, t.profileId, t.achievementId, t.season],
    }),
    foreignKey({
      name: 'achievement_progress_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'achievement_progress_program_fk',
      columns: [t.tenantId, t.programCountry],
      foreignColumns: [gameProgram.tenantId, gameProgram.programCountry],
    }).onDelete('cascade'),
    // raridade automática ("3% dos torcedores têm")
    index('achievement_progress_rarity_idx').on(t.tenantId, t.programCountry, t.achievementId, t.season),
    check(
      'achievement_progress_season',
      sql`${t.season} = 'all' or ${t.season} ~ '^[0-9]{4}(-[0-9]{2,4})?$'`,
    ),
    check('achievement_progress_count', sql`${t.count} >= 0`),
  ],
);

/** Degrau concluído: um por Perfil, Conquista, temporada e Degrau. Guarda a versão da regra da época. */
export const gameStepGrant = game.table(
  'step_grant',
  {
    tenantId: tenantRef(),
    programCountry: programCountry(),
    profileId: uuid('profile_id').notNull(),
    achievementId: text('achievement_id').notNull(),
    season: text('season').notNull().default('all'),
    step: smallint('step').notNull(),
    /** Limite vigente quando o Degrau saiu. */
    threshold: integer('threshold').notNull(),
    bonusPoints: integer('bonus_points').notNull().default(0),
    ruleVersion: integer('rule_version').notNull(),
    /** Evento que fechou o Degrau (Palpite, janela de presença, voto...). */
    sourceEvent: text('source_event').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'step_grant_pkey',
      columns: [t.tenantId, t.programCountry, t.profileId, t.achievementId, t.season, t.step],
    }),
    foreignKey({
      name: 'step_grant_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'step_grant_program_fk',
      columns: [t.tenantId, t.programCountry],
      foreignColumns: [gameProgram.tenantId, gameProgram.programCountry],
    }).onDelete('cascade'),
    // a regra da época existe: o que foi feito ou ganho pontua pela versão que guarda
    foreignKey({
      name: 'step_grant_rule_version_fk',
      columns: [t.tenantId, t.programCountry, t.ruleVersion],
      foreignColumns: [gameRuleVersion.tenantId, gameRuleVersion.programCountry, gameRuleVersion.version],
    }).onDelete('cascade'),
    index('step_grant_recent_idx').on(t.tenantId, t.programCountry, t.profileId, t.grantedAt),
    check('step_grant_step', sql`${t.step} between 1 and 5`),
    check('step_grant_source_len', sql`length(${t.sourceEvent}) between 1 and 200`),
  ],
);

/** Carta: uma certa por Degrau, sem sorteio e sem troca. Única por Perfil e Carta. */
export const gameCardGrant = game.table(
  'card_grant',
  {
    tenantId: tenantRef(),
    id: gameId(),
    programCountry: programCountry(),
    profileId: uuid('profile_id').notNull(),
    cardKey: text('card_key').notNull(),
    achievementId: text('achievement_id').notNull(),
    season: text('season').notNull().default('all'),
    step: smallint('step').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'card_grant_pkey', columns: [t.tenantId, t.id] }),
    foreignKey({
      name: 'card_grant_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'card_grant_program_fk',
      columns: [t.tenantId, t.programCountry],
      foreignColumns: [gameProgram.tenantId, gameProgram.programCountry],
    }).onDelete('cascade'),
    // a regra da época existe: o que foi feito ou ganho pontua pela versão que guarda
    foreignKey({
      name: 'card_grant_rule_version_fk',
      columns: [t.tenantId, t.programCountry, t.ruleVersion],
      foreignColumns: [gameRuleVersion.tenantId, gameRuleVersion.programCountry, gameRuleVersion.version],
    }).onDelete('cascade'),
    uniqueIndex('card_grant_profile_card_uq').on(
      t.tenantId,
      t.programCountry,
      t.profileId,
      t.cardKey,
      t.season,
    ),
    // tiragem conhecida ("1.204 existem")
    index('card_grant_card_idx').on(t.tenantId, t.programCountry, t.cardKey),
    check('card_grant_step', sql`${t.step} between 1 and 5`),
  ],
);

/**
 * Sinal real de participação: conta uma vez por partida (`ref` = o jogo, a enquete, a trivia) e por dia, no fuso do
 * país. `points` já vem cortado pelo teto diário: passou do teto, conta para a Conquista mas não dá Pontos.
 */
export const gameParticipationDaily = game.table(
  'participation_daily',
  {
    tenantId: tenantRef(),
    programCountry: programCountry(),
    profileId: uuid('profile_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    action: text('action').$type<GameParticipationAction>().notNull(),
    ref: text('ref').notNull(),
    points: integer('points').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: 'participation_daily_pkey',
      columns: [t.tenantId, t.programCountry, t.profileId, t.action, t.ref],
    }),
    foreignKey({
      name: 'participation_daily_profile_fk',
      columns: [t.tenantId, t.profileId],
      foreignColumns: [fanProfile.tenantId, fanProfile.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'participation_daily_program_fk',
      columns: [t.tenantId, t.programCountry],
      foreignColumns: [gameProgram.tenantId, gameProgram.programCountry],
    }).onDelete('cascade'),
    // soma do dia para o teto
    index('participation_daily_day_idx').on(t.tenantId, t.programCountry, t.profileId, t.day),
    check('participation_daily_action', inList('action', GAME_PARTICIPATION_ACTIONS)),
    check('participation_daily_points', sql`${t.points} >= 0`),
    check('participation_daily_ref_len', sql`length(${t.ref}) between 1 and 200`),
  ],
);

/**
 * Registro de auditoria, só acréscimo. Sem chave estrangeira para o Perfil: o registro sobrevive à exclusão do
 * torcedor com o id interno, que não liga a ninguém depois dela.
 */
export const gameAuditLog = game.table(
  'audit_log',
  {
    tenantId: tenantRef(),
    id: gameId(),
    programCountry: programCountry(),
    profileId: uuid('profile_id'),
    kind: text('kind').$type<GameAuditKind>().notNull(),
    /** O que foi concedido ou mudou (id do Palpite, Conquista e Degrau, Carta...). */
    subject: text('subject').notNull(),
    /** Evento de origem (jogo, Palpite, janela de presença). */
    sourceEvent: text('source_event'),
    ruleVersion: integer('rule_version'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'audit_log_pkey', columns: [t.tenantId, t.id] }),
    index('audit_log_program_idx').on(t.tenantId, t.programCountry, t.createdAt),
    index('audit_log_profile_idx').on(t.tenantId, t.profileId, t.createdAt),
    check('audit_log_kind', inList('kind', GAME_AUDIT_KINDS)),
    check('audit_log_subject_len', sql`length(${t.subject}) between 1 and 200`),
  ],
);

/** Alerta antifraude (Palpites em bloco, sinais por Conta). Só alerta: nada é barrado sem revisão humana. */
export const gameFraudSignal = game.table(
  'fraud_signal',
  {
    tenantId: tenantRef(),
    id: gameId(),
    programCountry: programCountry(),
    /** Conta (`fan.account.id`) ou Perfil sob alerta. */
    accountId: uuid('account_id'),
    profileId: uuid('profile_id'),
    kind: text('kind').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    /** `open` até a equipe revisar. */
    status: text('status').notNull().default('open'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'fraud_signal_pkey', columns: [t.tenantId, t.id] }),
    index('fraud_signal_open_idx').on(t.tenantId, t.programCountry, t.status, t.createdAt),
    check('fraud_signal_status', sql`${t.status} in ('open', 'dismissed', 'confirmed')`),
    check('fraud_signal_target', sql`${t.accountId} is not null or ${t.profileId} is not null`),
  ],
);
