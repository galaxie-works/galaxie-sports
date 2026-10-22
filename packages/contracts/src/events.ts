import 'zod-openapi';
import * as z from 'zod';
import { AssetUrl, LocaleQuery, PaginationQuery } from './common.js';
import { EventContextSummary } from './event-context.js';

/** Estados canônicos do evento (docs/04 §3). */
export const EVENT_STATUSES = [
  'scheduled',
  'starting',
  'live',
  'break',
  'finished',
  'postponed',
  'cancelled',
  'suspended',
  'abandoned',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Momentum temporal (docs/04 §3.2), calculado no fuso do cliente. */
export const MOMENTUM_VALUES = [
  'D-3+',
  'D-2',
  'D-1',
  'today',
  'T-60',
  'T-30',
  'T-10',
  'starting',
  'live',
] as const;

/** Contexto competitivo do card (docs/06 §4.1). */
export const COMPETITION_CONTEXTS = [
  'regular',
  'derby',
  'playoff',
  'knockout',
  'semifinal',
  'final',
  'title',
  'lead',
  'relegation',
] as const;

export const PARTICIPANT_KINDS = [
  'club',
  'national_team',
  'athlete',
  'driver',
  'constructor',
  'fighter',
] as const;

const SidePair = z.object({ home: z.number().int().nullable(), away: z.number().int().nullable() });

// ─── times (resumo) ──────────────────────────────────────────────────────────────────────────────

export const TeamSummary = z
  .object({
    id: z.uuid(),
    sport: z.string().meta({ example: 'football' }),
    kind: z.enum(PARTICIPANT_KINDS),
    name: z.string().meta({ example: 'Palmeiras' }),
    short_name: z.string().nullable(),
    code: z.string().nullable().meta({ example: 'PAL' }),
    country: z.string().nullable().meta({ description: 'Código do país.', example: 'BR' }),
    logo: AssetUrl,
    nicknames: z
      .array(z.string())
      .meta({ description: 'Apelidos da base semântica (vazio se o time não tem perfil).' }),
  })
  .meta({ id: 'TeamSummary' });
export type TeamSummary = z.infer<typeof TeamSummary>;

// ─── evento canônico ─────────────────────────────────────────────────────────────────────────────

export const FanTag = z
  .object({
    code: z.string().meta({
      description: 'Código do stake de origem (o mais relevante, quando vários geram a mesma tag).',
      example: 'in_title_race',
    }),
    priority: z
      .number()
      .int()
      .meta({ description: 'Relevância: menor = mais importante (título < rebaixamento < …).', example: 15 }),
    text: z.record(z.string(), z.string()).meta({
      description: 'Rótulo curto (até ~30 caracteres), do ponto de vista do torcedor, no locale da resposta.',
      example: { 'pt-BR': 'Na briga pelo título' },
    }),
  })
  .meta({
    id: 'FanTag',
    description: 'Tag do torcedor derivada dos stakes por tabela fixa (docs/rules/tags-torcedor.md).',
  });
export type FanTag = z.infer<typeof FanTag>;

export const FanCheer = z
  .object({
    text: z.string().meta({ example: 'Avanti, Palestra!' }),
    source_url: z.url().optional().meta({
      description: 'Primeira fonte consultada do perfil semântico do time (o perfil todo, não só o grito).',
    }),
  })
  .meta({
    id: 'FanCheer',
    description: 'Grito curto da torcida, da base semântica. Nunca letra de hino ou canção.',
  });
export type FanCheer = z.infer<typeof FanCheer>;

export const EventParticipant = z
  .object({
    side: z.string().meta({ example: 'home' }),
    id: z.uuid(),
    name: z.string(),
    short_name: z.string().nullable(),
    logo: AssetUrl,
    nickname: z.string().nullable().meta({ description: 'Primeiro apelido da base semântica.' }),
    winner: z.boolean().nullable().meta({ description: 'Vencedor da partida, quando encerrada.' }),
    fan_tags: z.array(FanTag).meta({
      description:
        'Até 3 tags do torcedor, por relevância, para cards personalizados pelo clube (vazio sem stakes).',
      example: [
        { code: 'in_title_race', priority: 15, text: { 'pt-BR': 'Na briga pelo título' } },
        {
          code: 'can_qualify_for_libertadores_group_stage',
          priority: 43,
          text: { 'pt-BR': 'De olho na Libertadores' },
        },
      ],
    }),
    cheer: FanCheer.nullable()
      .optional()
      .meta({ description: 'Grito curto da torcida no mercado da resposta; null se a base não tem.' }),
  })
  .meta({ id: 'EventParticipant' });
export type EventParticipant = z.infer<typeof EventParticipant>;

export const EventStake = z
  .object({
    team: z.enum(['home', 'away', 'both']),
    team_id: z.uuid().nullable().meta({
      description: 'Participante a que o stake se refere (`participants[].id`); null quando `team` é `both`.',
    }),
    code: z.string().meta({ example: 'needs_win_by_2' }),
    text: z
      .record(z.string(), z.string())
      .meta({ description: 'Rótulo fixo no locale da resposta.', example: { 'pt-BR': 'Avança com empate' } }),
  })
  .meta({ id: 'EventStake', description: 'Código do motor de regras (docs/rules).' });
export type EventStake = z.infer<typeof EventStake>;

export const EventReferee = z
  .object({
    name: z.string().meta({ example: 'Wilton Pereira Sampaio' }),
    country: z.string().nullable().meta({
      description: 'País como o fornecedor escreve (sufixo ", País"); null sem sufixo.',
      example: 'Brazil',
    }),
  })
  .meta({ id: 'EventReferee', description: 'Árbitro da partida (`fixture.referee` do fornecedor).' });
export type EventReferee = z.infer<typeof EventReferee>;

export const EventCompetitionRef = z
  .object({
    id: z.uuid(),
    slug: z.string().meta({ example: 'conmebol-libertadores' }),
    name: z.string().meta({ example: 'Libertadores' }),
    nickname: z.string().nullable().meta({ example: 'Glória Eterna' }),
    logo: AssetUrl,
  })
  .meta({ id: 'EventCompetitionRef' });

export const EventStage = z
  .object({
    kind: z.string().meta({ example: 'semi_final' }),
    leg: z.number().int().nullable().meta({ description: '1 = ida, 2 = volta; null em jogo único.' }),
    name: z.string().nullable().meta({ example: 'Semifinal · Volta' }),
  })
  .meta({ id: 'EventStage' });

/** Sinais de jogo decisivo que entram no score de importância (docs/06 §3). */
export const IMPORTANCE_FLAGS = ['title', 'relegation', 'elimination', 'qualification'] as const;

export const ImportanceBreakdown = z
  .object({
    tier: z.number().int().meta({ description: 'Tier da competição: 40 / 25 / 10 (5 se desconhecido).' }),
    phase: z
      .number()
      .int()
      .meta({ description: 'Fase (final 30 … rodada 4, +até 6 na reta final); jogo de ida × 0,75.' }),
    derby: z.number().int().meta({ description: 'Clássico: 6 × intensidade (1–5).' }),
    decisive: z.number().int().meta({
      description: 'Decisão: título 15, rebaixamento 10, eliminação 8, vaga 6 (teto 20).',
    }),
    prestige: z
      .number()
      .int()
      .meta({ description: 'Prestígio da competição (0–10): copas continentais e seleções.' }),
    flags: z
      .array(z.enum(IMPORTANCE_FLAGS))
      .meta({ description: 'Sinais decisivos considerados (mata-mata e tabela).', example: ['elimination'] }),
  })
  .meta({
    id: 'ImportanceBreakdown',
    description: 'Componentes do `importance` (a soma, limitada a 0–100, é o score global).',
  });
export type ImportanceBreakdown = z.infer<typeof ImportanceBreakdown>;

/** Por que o jogo interessa mais a um mercado (docs/06 §3.2). */
export const RELEVANCE_REASONS = [
  'team_from_market',
  'domestic_competition',
  'continental_competition',
] as const;

export const EventRelevance = z
  .object({
    market: z.string().meta({ description: 'País (ISO 3166-1 alfa-2).', example: 'BR' }),
    score: z.number().int().min(0).max(100).meta({ description: '`importance` + `bonus`, limitado a 100.' }),
    bonus: z.number().int().min(0).max(10).meta({
      description: '+10 participante do país; +5 competição do país ou continental da confederação; teto 10.',
    }),
    reasons: z.array(z.enum(RELEVANCE_REASONS)),
  })
  .meta({
    id: 'EventRelevance',
    description:
      'Relevância por mercado, calculada na requisição a partir de `market` (ou do mercado do plano).',
  });
export type EventRelevance = z.infer<typeof EventRelevance>;

export const Event = z
  .object({
    id: z.uuid(),
    sport: z.string().meta({ example: 'football' }),
    competition: EventCompetitionRef.nullable(),
    stage: EventStage.nullable(),
    starts_at: z.string().meta({ description: 'ISO 8601 no fuso pedido (`tz`).' }),
    status: z.enum(EVENT_STATUSES),
    status_detail: z.string().nullable().meta({ description: 'Código do fornecedor (1H, HT, FT...).' }),
    clock: z
      .object({
        minute: z.number().int().nullable(),
        extra: z.number().int().nullable(),
        period: z.string().nullable(),
      })
      .nullable(),
    momentum: z.enum(MOMENTUM_VALUES).nullable(),
    importance: z.number().int().min(0).max(100),
    importance_breakdown: ImportanceBreakdown.nullable().meta({
      description: 'Componentes do score global; null em eventos ainda não recalculados.',
    }),
    relevance: EventRelevance.nullable().meta({ description: 'null sem mercado (`market`).' }),
    participants: z.array(EventParticipant),
    score: SidePair.extend({
      halftime: SidePair.nullable(),
      extratime: SidePair.nullable(),
      penalty: SidePair.nullable(),
      aggregate: SidePair.nullable().meta({ description: 'Agregado do confronto (jogo de volta).' }),
    }),
    venue: z
      .object({
        id: z.uuid(),
        name: z.string(),
        city: z.string().nullable(),
        timezone: z
          .string()
          .nullable()
          .meta({
            description:
              'Fuso IANA do local, quando conhecido (país e cidade do local ou, sem país, do mandante). ' +
              'Só para exibição: os instantes da API não dependem dele.',
            example: 'America/Sao_Paulo',
          }),
      })
      .nullable()
      .meta({
        description: 'Estádio/local (`core.venue`): nome, cidade e fuso.',
        example: {
          id: '01a15fba-ec17-7000-8000-000000000001',
          name: 'Allianz Parque',
          city: 'São Paulo',
          timezone: 'America/Sao_Paulo',
        },
      }),
    referee: EventReferee.nullable().meta({
      description: 'Árbitro principal, quando o fornecedor informa (futebol). null sem escala.',
    }),
    derby: z
      .object({ slug: z.string(), name: z.string(), intensity: z.number().int().min(1).max(5) })
      .nullable(),
    competition_context: z.array(z.enum(COMPETITION_CONTEXTS)),
    stakes: z.array(EventStake).meta({ description: 'Vazio em eventos encerrados ou sem regulamento.' }),
    data_freshness: z.object({ last_valid_at: z.string().nullable(), is_stale: z.boolean() }),
    context: EventContextSummary.optional(),
  })
  .meta({ id: 'Event', description: 'Evento canônico (docs/05 §3.2).' });
export type Event = z.infer<typeof Event>;

// ─── consultas ───────────────────────────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDateOrInstant = (v: string) =>
  DATE_RE.test(v) || (/^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)));

const statusList = z
  .string()
  .max(200)
  .transform((v, ctx) => {
    const items = [
      ...new Set(
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
    for (const s of items) {
      if (!(EVENT_STATUSES as readonly string[]).includes(s)) {
        ctx.addIssue({ code: 'custom', message: `status desconhecido: ${s}` });
        return z.NEVER;
      }
    }
    return items as EventStatus[];
  })
  .meta({ description: 'Lista separada por vírgulas.', example: 'scheduled,live' });

/** Mercado da relevância (ISO 3166-1 alfa-2, qualquer caixa). Sem ele vale o único mercado do plano. */
const MarketParam = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'use o código ISO de 2 letras do país')
  .transform((v) => v.toUpperCase())
  .meta({ description: 'Mercado (país ISO2) da relevância: `relevance` no evento.', example: 'BR' });

export const EventsQuery = LocaleQuery.extend(PaginationQuery.shape).extend({
  date: z
    .string()
    .regex(DATE_RE, 'use AAAA-MM-DD')
    .optional()
    .meta({ description: 'Dia civil no fuso `tz` (tem precedência sobre from/to).', example: '2026-10-21' }),
  from: z
    .string()
    .refine(isDateOrInstant, 'use AAAA-MM-DD ou ISO 8601')
    .optional()
    .meta({ description: 'Início (dia no fuso `tz` ou instante ISO 8601). Padrão: hoje.' }),
  to: z
    .string()
    .refine(isDateOrInstant, 'use AAAA-MM-DD ou ISO 8601')
    .optional()
    .meta({ description: 'Fim inclusivo (dia no fuso `tz` ou instante ISO 8601).' }),
  sport: z.string().max(40).optional().meta({ example: 'football' }),
  competition: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .meta({ description: 'UUID ou slug da competição.', example: 'brasileirao-serie-a' }),
  team: z.uuid().optional().meta({ description: 'Participante (time/atleta).' }),
  country: z
    .string()
    .max(20)
    .transform((v) => v.toUpperCase())
    .optional()
    .meta({ description: 'País da competição ou de um participante.', example: 'BR' }),
  status: statusList.optional(),
  importance_min: z.coerce.number().int().min(0).max(100).optional(),
  market: MarketParam.optional(),
  relevance_min: z.coerce
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .meta({ description: 'Relevância mínima no mercado (exige `market` ou mercado do plano).' }),
  order: z.enum(['starts_at', 'importance', 'relevance']).default('starts_at').meta({
    description:
      '`starts_at` (crescente), `importance` ou `relevance` (decrescentes, depois horário; `relevance` exige mercado).',
  }),
});
export type EventsQuery = z.input<typeof EventsQuery>;

export const LiveEventsQuery = LocaleQuery.extend({
  sport: z.string().max(40).optional(),
  competition: z.string().min(1).max(120).optional().meta({ description: 'UUID ou slug da competição.' }),
  market: MarketParam.optional(),
});
export type LiveEventsQuery = z.input<typeof LiveEventsQuery>;

/** Detalhe do evento: locale/fuso e o mercado da relevância. */
export const EventQuery = LocaleQuery.extend({ market: MarketParam.optional() });
export type EventQuery = z.input<typeof EventQuery>;

export const EventParams = z.object({
  id: z.uuid().meta({ description: 'ID do evento.' }),
});

export const H2hQuery = LocaleQuery.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

// ─── timeline, escalações, estatísticas, h2h ─────────────────────────────────────────────────────

export const PersonRef = z
  .object({
    id: z.uuid().nullable().meta({ description: 'null quando a pessoa ainda não está no core.' }),
    name: z.string(),
    photo: AssetUrl.optional(),
  })
  .meta({ id: 'PersonRef' });

const TeamSideRef = z.object({
  id: z.uuid().nullable(),
  name: z.string().nullable(),
  side: z.string().nullable(),
  logo: AssetUrl,
});

// ─── minuto a minuto (timeline) ──────────────────────────────────────────────────────────────────

/** Períodos do relógio de jogo (futebol). */
export const MATCH_PERIODS = [
  'first_half',
  'second_half',
  'extra_time_first',
  'extra_time_second',
  'penalty_shootout',
] as const;
export type MatchPeriod = (typeof MATCH_PERIODS)[number];

/** Tipo canônico do lance, mais fino que o `type` do fornecedor. */
export const TIMELINE_KINDS = [
  'goal',
  'own_goal',
  'penalty_goal',
  'penalty_missed',
  'yellow_card',
  'second_yellow',
  'red_card',
  'substitution',
  'var',
  'shootout_scored',
  'shootout_missed',
  'other',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

/** Marcos do jogo (início, intervalo, 2º tempo, prorrogação, pênaltis, fim). */
export const TIMELINE_MARKERS = [
  'kickoff',
  'halftime',
  'second_half',
  'end_of_regulation',
  'extra_time',
  'penalty_shootout',
  'full_time',
] as const;
export type TimelineMarkerKind = (typeof TIMELINE_MARKERS)[number];

export const TIMELINE_FLAGS = ['decisive', 'opener', 'equalizer', 'go_ahead'] as const;
export type TimelineFlag = (typeof TIMELINE_FLAGS)[number];

/** De onde veio o instante UTC de um lance ou marco. */
export const OCCURRED_AT_SOURCES = ['provider', 'clock', 'observed'] as const;
export type OccurredAtSource = (typeof OCCURRED_AT_SOURCES)[number];

export const MatchClock = z
  .object({
    period: z.enum(MATCH_PERIODS).nullable(),
    minute: z.number().int().nullable().meta({ description: 'Minuto do relógio de jogo (1–120).' }),
    extra_minute: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Acréscimo (45+2 → minute 45, extra_minute 2).' }),
    display: z.string().nullable().meta({ example: "45+2'" }),
  })
  .meta({
    id: 'MatchClock',
    description:
      'Relógio de jogo, independente de fuso: período, minuto e acréscimo. A disputa de pênaltis não tem minuto.',
  });
export type MatchClock = z.infer<typeof MatchClock>;

const OccurredAt = {
  occurred_at: z.string().nullable().meta({
    description:
      'Instante em UTC (RFC 3339, sufixo `Z`), com precisão de minuto. null quando não dá para derivar.',
    example: '2026-10-22T01:53:00Z',
  }),
  occurred_at_source: z
    .enum(OCCURRED_AT_SOURCES)
    .nullable()
    .meta({
      description:
        '`provider`: instante informado pelo fornecedor (início do período); `clock`: início do período + relógio ' +
        'de jogo; `observed`: primeira observação da Galaxie (limite superior). null sem instante.',
    }),
};

export const TimelinePerson = PersonRef.extend({
  number: z.number().int().nullable().meta({ description: 'Número da camisa (da escalação).' }),
  position: z.string().nullable().meta({ description: 'G, D, M ou F (da escalação).', example: 'F' }),
}).meta({ id: 'TimelinePerson' });
export type TimelinePerson = z.infer<typeof TimelinePerson>;

const ScorePair = z.object({ home: z.number().int(), away: z.number().int() });

export const TimelineIncident = z
  .object({
    sequence: z.number().int(),
    minute: z.number().int().nullable(),
    extra: z.number().int().nullable(),
    type: z.string().meta({ description: 'goal, own_goal, penalty_missed, card, subst, var, other.' }),
    detail: z.string().nullable().meta({ example: 'Yellow Card' }),
    comments: z.string().nullable(),
    team: TeamSideRef.nullable(),
    player: TimelinePerson.nullable().meta({
      description: 'Autor do lance. Na substituição, quem sai (prefira `player_out`/`player_in`).',
    }),
    assist: TimelinePerson.nullable().meta({ description: 'Assistência. Na substituição, quem entra.' }),
    kind: z.enum(TIMELINE_KINDS),
    clock: MatchClock,
    ...OccurredAt,
    weight: z
      .number()
      .int()
      .min(0)
      .max(100)
      .meta({
        description:
          'Peso do momento: decisivo 100 > pênalti 80 > vermelho 70 > VAR de gol/pênalti/vermelho 65 > gol 60 > ' +
          'cobrança na disputa 45 > outro VAR 40 > amarelo 30 > substituição 10.',
      }),
    key_moment: z.boolean().meta({ description: 'Momento-chave (`weight` ≥ 60).' }),
    flags: z.array(z.enum(TIMELINE_FLAGS)).meta({
      description:
        '`opener` (1º gol), `go_ahead` (põe o time na frente), `equalizer` (empata), `decisive` (gol da vitória ' +
        'ou cobrança que decide os pênaltis; só com o jogo encerrado).',
    }),
    score_after: ScorePair.nullable().meta({
      description: 'Placar depois do gol (na disputa de pênaltis, o placar da disputa).',
    }),
    player_in: TimelinePerson.nullable().meta({ description: 'Substituição: quem entra.' }),
    player_out: TimelinePerson.nullable().meta({ description: 'Substituição: quem sai.' }),
  })
  .meta({ id: 'TimelineIncident' });
export type TimelineIncident = z.infer<typeof TimelineIncident>;

export const TimelineMarker = z
  .object({ kind: z.enum(TIMELINE_MARKERS), clock: MatchClock, ...OccurredAt })
  .meta({ id: 'TimelineMarker', description: 'Marco do jogo, derivado do estado e do log de estados.' });
export type TimelineMarker = z.infer<typeof TimelineMarker>;

export const ShootoutKick = z
  .object({
    order: z.number().int().meta({ description: 'Ordem da cobrança na disputa (1 = primeira).' }),
    round: z.number().int().meta({ description: 'Cobrança do time (1–5 e depois as alternadas).' }),
    sequence: z.number().int().meta({ description: '`sequence` do lance em `incidents`.' }),
    team: TeamSideRef.nullable(),
    player: TimelinePerson.nullable(),
    scored: z.boolean(),
    score_after: ScorePair,
    decisive: z.boolean().meta({ description: 'A cobrança que decidiu a disputa (jogo encerrado).' }),
  })
  .meta({ id: 'ShootoutKick' });
export type ShootoutKick = z.infer<typeof ShootoutKick>;

export const PenaltyShootout = z
  .object({
    first_kicker: TeamSideRef.nullable().meta({ description: 'Time que bateu primeiro.' }),
    score: ScorePair,
    winner_side: z.enum(['home', 'away']).nullable(),
    kicks: z.array(ShootoutKick),
  })
  .meta({ id: 'PenaltyShootout', description: 'Disputa de pênaltis, cobrança a cobrança.' });
export type PenaltyShootout = z.infer<typeof PenaltyShootout>;

export const EventTimeline = z
  .object({
    event_id: z.uuid(),
    status: z.enum(EVENT_STATUSES),
    status_detail: z.string().nullable(),
    live: z.boolean().meta({ description: 'Em andamento (inclui "começando", intervalo e interrompido).' }),
    clock: MatchClock.nullable().meta({ description: 'Relógio atual do jogo (null antes do início).' }),
    score: z.object({ home: z.number().int().nullable(), away: z.number().int().nullable() }),
    incidents: z.array(TimelineIncident).meta({
      description:
        'Na ordem do jogo (`sequence` do fornecedor, crescente). Para "mais novo primeiro", inverta no cliente.',
    }),
    markers: z.array(TimelineMarker),
    shootout: PenaltyShootout.nullable(),
    venue_timezone: z.string().nullable().meta({
      description: 'Fuso IANA do local, quando conhecido. Só para exibição: os instantes vêm sempre em UTC.',
      example: 'America/Sao_Paulo',
    }),
    data_freshness: z.object({
      last_valid_at: z
        .string()
        .nullable()
        .meta({ description: 'Última leitura válida do fornecedor (UTC).' }),
      is_stale: z.boolean(),
    }),
    generated_at: z.string().meta({ description: 'Quando a resposta foi montada (UTC).' }),
  })
  .meta({
    id: 'EventTimeline',
    description:
      'Minuto a minuto: lances com peso de momento-chave, marcos do jogo e disputa de pênaltis. Instantes em ' +
      'UTC; o relógio de jogo vem em campos separados (docs/05 §3.2.1).',
  });
export type EventTimeline = z.infer<typeof EventTimeline>;

const LineupPlayer = z.object({
  person: PersonRef,
  number: z.number().int().nullable(),
  position: z.string().nullable().meta({ example: 'M' }),
  grid: z.string().nullable().meta({ example: '4:2' }),
});

export const EventLineups = z
  .object({
    event_id: z.uuid(),
    available: z.boolean().meta({ description: 'false quando o detalhe ainda não foi sincronizado.' }),
    lineups: z.array(
      z.object({
        team: TeamSideRef,
        formation: z.string().nullable().meta({ example: '4-2-3-1' }),
        coach: PersonRef.nullable(),
        start_xi: z.array(LineupPlayer),
        substitutes: z.array(LineupPlayer),
      }),
    ),
  })
  .meta({ id: 'EventLineups' });
export type EventLineups = z.infer<typeof EventLineups>;

export const EventStats = z
  .object({
    event_id: z.uuid(),
    available: z.boolean(),
    teams: z.array(
      z.object({
        team: TeamSideRef,
        statistics: z.array(
          z.object({ type: z.string(), value: z.union([z.number(), z.string(), z.null()]) }),
        ),
      }),
    ),
    players: z.array(
      z.object({
        team: TeamSideRef,
        players: z.array(
          z.object({
            person: PersonRef,
            statistics: z
              .record(z.string(), z.unknown())
              .meta({ description: 'Estatísticas do fornecedor.' }),
          }),
        ),
      }),
    ),
  })
  .meta({ id: 'EventStats' });
export type EventStats = z.infer<typeof EventStats>;

export const HeadToHead = z
  .object({
    event_id: z.uuid(),
    participants: z.array(z.object({ id: z.uuid(), name: z.string(), logo: AssetUrl })),
    summary: z.object({
      played: z.number().int(),
      draws: z.number().int(),
      teams: z.array(z.object({ id: z.uuid(), wins: z.number().int(), goals: z.number().int() })),
    }),
    events: z.array(Event).meta({ description: 'Confrontos encerrados, do mais recente ao mais antigo.' }),
  })
  .meta({ id: 'HeadToHead' });
export type HeadToHead = z.infer<typeof HeadToHead>;
