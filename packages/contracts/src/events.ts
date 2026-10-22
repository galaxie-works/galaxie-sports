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
    participants: z.array(EventParticipant),
    score: SidePair.extend({
      halftime: SidePair.nullable(),
      extratime: SidePair.nullable(),
      penalty: SidePair.nullable(),
      aggregate: SidePair.nullable().meta({ description: 'Agregado do confronto (jogo de volta).' }),
    }),
    venue: z
      .object({ id: z.uuid(), name: z.string(), city: z.string().nullable() })
      .nullable()
      .meta({
        description: 'Estádio/local (`core.venue`): nome e cidade.',
        example: { id: '01a15fba-ec17-7000-8000-000000000001', name: 'Allianz Parque', city: 'São Paulo' },
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
  order: z
    .enum(['starts_at', 'importance'])
    .default('starts_at')
    .meta({ description: '`starts_at` (crescente) ou `importance` (decrescente, depois horário).' }),
});
export type EventsQuery = z.input<typeof EventsQuery>;

export const LiveEventsQuery = LocaleQuery.extend({
  sport: z.string().max(40).optional(),
  competition: z.string().min(1).max(120).optional().meta({ description: 'UUID ou slug da competição.' }),
});
export type LiveEventsQuery = z.input<typeof LiveEventsQuery>;

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

export const TimelineIncident = z
  .object({
    sequence: z.number().int(),
    minute: z.number().int().nullable(),
    extra: z.number().int().nullable(),
    type: z.string().meta({ description: 'goal, own_goal, penalty_missed, card, subst, var, other.' }),
    detail: z.string().nullable().meta({ example: 'Yellow Card' }),
    comments: z.string().nullable(),
    team: TeamSideRef.nullable(),
    player: PersonRef.nullable(),
    assist: PersonRef.nullable(),
  })
  .meta({ id: 'TimelineIncident' });

export const EventTimeline = z
  .object({ event_id: z.uuid(), incidents: z.array(TimelineIncident) })
  .meta({ id: 'EventTimeline' });
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
