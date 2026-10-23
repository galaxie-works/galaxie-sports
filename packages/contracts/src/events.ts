import 'zod-openapi';
import * as z from 'zod';
import { TeamColors } from './colors.js';
import { AssetUrl, CountryRef, LocaleQuery, PaginationQuery } from './common.js';
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

const GoalsBehinds = z.object({
  goals: z.number().int().nullable().meta({ description: 'Gols (6 pontos cada).' }),
  behinds: z.number().int().nullable().meta({ description: 'Behinds (1 ponto cada).' }),
});

/** Placar da AFL por lado: gols e behinds (pontos = 6 × gols + behinds; escrito "12.14 (86)"). */
export const SideGoalsBehinds = z.object({ home: GoalsBehinds, away: GoalsBehinds }).meta({
  id: 'SideGoalsBehinds',
  example: { home: { goals: 12, behinds: 14 }, away: { goals: 9, behinds: 10 } },
});
export type SideGoalsBehinds = z.infer<typeof SideGoalsBehinds>;

/** Parcial de um período do jogo (set, quarto, tempo, período, entrada). */
export const ScorePeriod = SidePair.extend({
  code: z.string().meta({
    description:
      'Período: sets do vôlei `s1`–`s5`; quartos `q1`–`q4`; tempos `h1`/`h2`; períodos do hóquei `p1`–`p3`; ' +
      'entradas do beisebol `i1`–`i9` e `extra`; prorrogações `ot`/`ot2`; shootout `so`.',
    example: 's1',
  }),
  goals_behinds: SideGoalsBehinds.optional().meta({
    description:
      'Futebol australiano (AFL): gols e behinds de cada time no quarto. Ausente nos outros esportes.',
  }),
}).meta({ id: 'ScorePeriod' });
export type ScorePeriod = z.infer<typeof ScorePeriod>;

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

/** Resultado de um participante em evento de vários participantes (F1: sessão de treino, classificação ou corrida). */
export const ParticipantResult = z
  .object({
    time: z
      .string()
      .nullable()
      .meta({ description: 'Tempo total (vencedor) ou volta de referência.', example: '1:31:44.742' }),
    gap: z
      .string()
      .nullable()
      .meta({ description: 'Diferença para o líder, como o fornecedor manda.', example: '+22.457' }),
    laps: z.number().int().nullable().meta({ example: 57 }),
    grid: z.number().int().nullable().meta({ description: 'Posição de largada.', example: 1 }),
    pits: z.number().int().nullable().meta({ description: 'Paradas nos boxes.', example: 2 }),
    team: z
      .object({ id: z.uuid().nullable(), name: z.string(), logo: AssetUrl })
      .nullable()
      .meta({ description: 'Equipe do piloto na sessão (construtor); `id` é o participante da equipe.' }),
  })
  .meta({ id: 'ParticipantResult' });
export type ParticipantResult = z.infer<typeof ParticipantResult>;

export const EVENT_SESSION_TYPES = ['practice', 'qualifying', 'sprint_qualifying', 'sprint', 'race'] as const;

/** Sessão de um fim de semana de corrida (F1): o Grande Prêmio é a fase (`stage`), a sessão é o evento. */
export const EventSession = z
  .object({
    type: z.enum(EVENT_SESSION_TYPES),
    number: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Treino 1/2/3 ou Q1/Q2/Q3; null em sessão única.' }),
    name: z.string().meta({ description: 'Nome da sessão no locale da resposta.', example: 'Corrida' }),
    laps: z.number().int().nullable().meta({ example: 57 }),
    distance: z.string().nullable().meta({ example: '308.5 Kms' }),
    fastest_lap: z
      .object({ participant_id: z.uuid().nullable(), time: z.string().nullable() })
      .nullable()
      .meta({ description: 'Volta mais rápida da sessão (piloto e tempo).' }),
  })
  .meta({ id: 'EventSession' });
export type EventSession = z.infer<typeof EventSession>;

export const EventParticipant = z
  .object({
    side: z.string().meta({ example: 'home' }),
    id: z.uuid(),
    name: z.string(),
    short_name: z.string().nullable(),
    logo: AssetUrl,
    nickname: z.string().nullable().meta({ description: 'Primeiro apelido da base semântica.' }),
    colors: TeamColors.nullable().optional().meta({
      description: 'Cores do escudo (mesmo `colors` do time); null enquanto o escudo não foi espelhado.',
    }),
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
    position: z.number().int().nullable().optional().meta({
      description:
        'Posição final em eventos de vários participantes (lado `grid`, ex.: F1); ausente em mandante × visitante.',
      example: 1,
    }),
    result: ParticipantResult.nullable().optional(),
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
    country: CountryRef.extend({ flag: AssetUrl })
      .nullable()
      .optional()
      .meta({
        description:
          'País da competição, com a bandeira (para "Liga Leumit" e "First NL" dizerem de onde são). `WORLD` nas ' +
          'internacionais (sem bandeira); null sem país no catálogo. Ausente nos blocos que não trazem o país.',
        example: { code: 'BR', name: 'Brasil', flag: 'https://assets.galaxie.sports/flags/br.svg' },
      }),
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
  'decides_final_opponent',
  'decides_third_place_opponent',
  'market_audience',
] as const;
export type RelevanceReasonCode = (typeof RELEVANCE_REASONS)[number];

export const RelevanceReason = z
  .object({
    code: z.enum(RELEVANCE_REASONS),
    points: z.number().int().min(0).max(40).meta({
      description:
        'Pontos do motivo isolado. A soma dos motivos do país pode passar do teto de 10; a audiência soma por fora.',
      example: 5,
    }),
    text: z.string().meta({
      description: 'Motivo no idioma pedido (pt-BR, en, es).',
      example: 'Define o adversário de Estudiantes L.P. na final',
    }),
    participant: z.object({ id: z.uuid(), name: z.string() }).nullable().meta({
      description: 'Time citado no motivo (`decides_*_opponent`): o da outra semifinal. null nos demais.',
    }),
  })
  .meta({
    id: 'RelevanceReason',
    description:
      '`team_from_market` +10; `domestic_competition` / `continental_competition` +5; ' +
      '`decides_final_opponent` / `decides_third_place_opponent` +5 (semifinal: a outra semifinal tem um time do país); ' +
      '`market_audience` 0–40, audiência da competição no país (liga nacional, grandes europeias).',
  });
export type RelevanceReason = z.infer<typeof RelevanceReason>;

export const EventRelevance = z
  .object({
    market: z.string().meta({ description: 'País (ISO 3166-1 alfa-2).', example: 'BR' }),
    score: z.number().int().min(0).max(100).meta({ description: '`importance` + `bonus`, limitado a 100.' }),
    bonus: z
      .number()
      .int()
      .min(0)
      .max(50)
      .meta({
        description:
          '+10 participante do país; +5 competição do país ou continental da confederação; +5 semifinal que ' +
          'define o adversário de um time do país (teto 10); mais a audiência da competição no país (0–40).',
      }),
    reasons: z.array(z.enum(RELEVANCE_REASONS)).meta({ description: 'Códigos dos motivos (ver `details`).' }),
    details: z.array(RelevanceReason).meta({
      description: 'Os mesmos motivos, com pontos e texto localizado, na ordem de `reasons`.',
    }),
  })
  .meta({
    id: 'EventRelevance',
    description:
      'Relevância por mercado, calculada na requisição a partir de `market` (ou do mercado do plano).',
  });
export type EventRelevance = z.infer<typeof EventRelevance>;

export const EventProvisional = z
  .object({
    announced_by: z.string().nullable().meta({
      description: 'Quem anunciou data e local (organizador, federação).',
      example: 'Conmebol',
    }),
    time_confirmed: z.boolean().meta({
      description:
        'false: só a data é oficial. `starts_at` traz o meio-dia no fuso do local (mesmo dia nas Américas) ' +
        'e `status_detail` é `TBD`; mostre "horário a confirmar".',
    }),
    sources: z
      .array(z.object({ name: z.string(), url: z.string(), checked_at: z.string().nullable() }))
      .meta({ description: 'Fontes conferidas pela curadoria (a oficial primeiro).' }),
    note: z.string().nullable().meta({
      description: 'Observação editorial no idioma pedido (ex.: regulamento do jogo único).',
      example: 'Jogo único; empate leva à prorrogação de 30 minutos e, depois, aos pênaltis.',
    }),
  })
  .meta({
    id: 'EventProvisional',
    description:
      'Jogo anunciado oficialmente que o fornecedor de dados ainda não publicou. Quando ele publicar, o mesmo ' +
      'evento (mesmo `id`) vira oficial e este campo passa a null.',
  });
export type EventProvisional = z.infer<typeof EventProvisional>;

/** Segmento da luta no card de MMA: card principal, preliminares e preliminares iniciais. */
export const FIGHT_CARD_SEGMENTS = ['main_card', 'prelims', 'early_prelims'] as const;
/** Método da vitória no MMA (`other` = valor novo do fornecedor, ver `method_name`). */
export const FIGHT_METHODS = [
  'ko',
  'submission',
  'decision_unanimous',
  'decision_split',
  'decision_majority',
  'disqualification',
  'draw',
  'no_contest',
  'other',
] as const;

export const EventFight = z
  .object({
    card: z
      .object({
        id: z
          .uuid()
          .meta({ description: 'Fase (`core.stage`, tipo `fight_card`) que agrupa a noite de lutas.' }),
        name: z.string().meta({ example: 'UFC 300: Pereira vs. Hill' }),
      })
      .nullable(),
    segment: z.enum(FIGHT_CARD_SEGMENTS).meta({
      description:
        '`main_card` (card principal), `prelims` (preliminares) ou `early_prelims` (preliminares iniciais).',
    }),
    main_event: z.boolean().meta({ description: 'Luta principal da noite (a que dá nome ao card).' }),
    weight_class: z
      .object({
        code: z.string().meta({ example: "Women's Strawweight" }),
        name: z.string().meta({ example: 'Peso-palha feminino' }),
      })
      .nullable(),
    result: z
      .object({
        method: z.enum(FIGHT_METHODS),
        method_name: z.string().meta({ example: 'Nocaute' }),
        detail: z.string().nullable().meta({ description: 'Golpe ou finalização.', example: 'Punches' }),
        round: z.number().int().nullable(),
        time: z.string().nullable().meta({ description: 'Tempo no round em que acabou.', example: '3:29' }),
        scorecards: z
          .array(z.string())
          .meta({ description: 'Cartões dos juízes (decisões).', example: ['29-28'] }),
      })
      .nullable()
      .meta({ description: 'Desfecho; null antes da luta ou enquanto o desfecho não chegou do fornecedor.' }),
  })
  .meta({ id: 'EventFight', description: 'Luta de MMA: card, segmento, categoria de peso e desfecho.' });
export type EventFight = z.infer<typeof EventFight>;

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
    relevance_by_market: z
      .array(EventRelevance)
      .nullable()
      .meta({
        description:
          'Relevância em todos os mercados ativos (config/geo `markets` + mercados do plano), da maior nota ' +
          'para a menor. Só no detalhe (`GET /v1/events/{id}`); null nas listas.',
      }),
    participants: z.array(EventParticipant),
    session: EventSession.nullable()
      .optional()
      .meta({ description: 'Sessão do fim de semana de corrida (F1); ausente nos outros esportes.' }),
    score: SidePair.extend({
      halftime: SidePair.nullable(),
      extratime: SidePair.nullable(),
      penalty: SidePair.nullable(),
      aggregate: SidePair.nullable().meta({ description: 'Agregado do confronto (jogo de volta).' }),
      periods: z
        .array(ScorePeriod)
        .nullable()
        .meta({
          description:
            'Parciais na ordem do jogo, nos esportes além do futebol. No vôlei, `home`/`away` do placar são os ' +
            'sets vencidos e cada item de `periods` traz os pontos de um set. null sem parciais (e no futebol).',
          example: [
            { code: 's1', home: 25, away: 21 },
            { code: 's2', home: 23, away: 25 },
          ],
        }),
      goals_behinds: SideGoalsBehinds.optional().meta({
        description:
          'Futebol australiano (AFL): gols e behinds do placar final (`home`/`away` são os pontos). Na AFL, ' +
          '`periods` traz os pontos de cada quarto (`q1`–`q4`), não o placar acumulado. Ausente nos outros esportes.',
      }),
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
    provisional: EventProvisional.nullable().meta({
      description: 'Preenchido só em jogo provisório (anunciado e ainda não publicado pelo fornecedor).',
    }),
    context: EventContextSummary.optional(),
    fight: EventFight.nullable().optional().meta({
      description: 'Só no MMA (`sport: mma`): card, segmento, categoria de peso e desfecho da luta.',
    }),
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

/** Códigos estáveis das estatísticas de time (docs/05 §3.2; iguais a `TEAM_STATISTIC_CODES` de @galaxie/providers). */
export const TEAM_STATISTIC_CODES = [
  'possession_pct',
  'shots_total',
  'shots_on_goal',
  'shots_off_goal',
  'shots_blocked',
  'shots_inside_box',
  'shots_outside_box',
  'xg',
  'goals_prevented',
  'passes_total',
  'passes_accurate',
  'pass_accuracy_pct',
  'corners',
  'free_kicks',
  'fouls',
  'offsides',
  'yellow_cards',
  'red_cards',
  'saves',
] as const;
export type TeamStatisticCode = (typeof TEAM_STATISTIC_CODES)[number];

export const TeamStatistic = z
  .object({
    type: z.string().meta({
      description:
        '`type` cru do fornecedor ("Ball Possession", "Shots insidebox"…). Nos derivados, repete o `code`.',
      example: 'Ball Possession',
    }),
    value: z
      .union([z.number(), z.string(), z.null()])
      .meta({ description: 'Valor como o fornecedor mandou.', example: '54%' }),
    code: z.enum(TEAM_STATISTIC_CODES).nullable().meta({
      description: 'Código estável (null para tipos do fornecedor ainda não mapeados).',
      example: 'possession_pct',
    }),
    label: z.string().meta({
      description: 'Rótulo no locale da resposta; sem código, o próprio `type`.',
      example: 'Posse de bola',
    }),
    numeric: z.number().nullable().meta({
      description: 'Valor numérico ("54%" → 54, "0.64" → 0.64); null quando não há número.',
      example: 54,
    }),
    source: z.enum(['provider', 'derived']).meta({
      description:
        '`provider`: veio do fornecedor; `derived`: calculada pela Galaxie (ex.: `pass_accuracy_pct` = certos ÷ totais, quando o fornecedor não manda "Passes %").',
    }),
  })
  .meta({ id: 'TeamStatistic' });
export type TeamStatistic = z.infer<typeof TeamStatistic>;

export const EventStats = z
  .object({
    event_id: z.uuid(),
    available: z.boolean(),
    teams: z.array(
      z.object({
        team: TeamSideRef,
        statistics: z.array(TeamStatistic),
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

export const EventFightCard = z
  .object({
    card: z.object({
      id: z.uuid(),
      name: z.string().meta({ example: 'UFC 300: Pereira vs. Hill' }),
      starts_at: z.string().meta({ description: 'Primeira luta da noite (ISO 8601 no fuso `tz`).' }),
      ends_at: z.string().meta({ description: 'Última luta da noite (ISO 8601 no fuso `tz`).' }),
    }),
    fights: z.array(Event).meta({
      description:
        'Todas as lutas do card: luta principal primeiro, depois o card principal, as preliminares e as ' +
        'preliminares iniciais (cada uma com `fight.segment`). Inclui as canceladas.',
    }),
  })
  .meta({ id: 'EventFightCard', description: 'Card de MMA (a noite de lutas) de uma luta.' });
export type EventFightCard = z.infer<typeof EventFightCard>;

export const HeadToHead = z
  .object({
    event_id: z.uuid(),
    participants: z.array(
      z.object({ id: z.uuid(), name: z.string(), logo: AssetUrl, colors: TeamColors.nullable().optional() }),
    ),
    summary: z.object({
      scope: z.literal('database').meta({
        description:
          'Recorte: só os confrontos que estão na base Galaxie (em geral os últimos anos). Não é o histórico ' +
          'geral; esse vem em `all_time` quando o par é um clássico com número curado.',
      }),
      since: z.number().int().nullable().meta({
        description: 'Ano do confronto mais antigo do recorte; null sem confrontos.',
        example: 2013,
      }),
      played: z.number().int(),
      draws: z.number().int(),
      teams: z.array(z.object({ id: z.uuid(), wins: z.number().int(), goals: z.number().int() })),
    }),
    all_time: z
      .object({
        derby: z
          .object({ slug: z.string(), name: z.string() })
          .nullable()
          .meta({ description: 'Clássico de onde vem o número; null quando o par não é clássico.' }),
        matches: z.number().int(),
        draws: z.number().int(),
        teams: z.array(
          z.object({
            id: z.uuid(),
            wins: z.number().int(),
            goals: z
              .number()
              .int()
              .nullable()
              .meta({ description: 'null quando a fonte não publica os gols.' }),
          }),
        ),
        basis: z.enum(['all', 'official']).meta({
          description: '`all` = todos os jogos (inclui amistosos); `official` = só jogos oficiais.',
        }),
        as_of: z.iso.date().meta({ description: 'Data de referência dos números.' }),
        sources: z.array(z.string()),
        review_status: z.enum(['draft', 'reviewed', 'approved']),
      })
      .nullable()
      .meta({
        description:
          'Retrospecto histórico geral curado (base semântica) do par: o `all_time` do clássico ' +
          '(`/v1/derbies/{slug}`) ou de um confronto relevante que não é clássico. Times por participante; ' +
          'null sem número confiável.',
      }),
    events: z.array(Event).meta({
      description:
        'Confrontos encerrados, do mais recente ao mais antigo. Inclui o próprio evento quando ele já terminou.',
    }),
  })
  .meta({ id: 'HeadToHead' });
export type HeadToHead = z.infer<typeof HeadToHead>;
