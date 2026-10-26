import 'zod-openapi';
import * as z from 'zod';
import { COMPETITION_TYPES } from './catalog.js';
import { TeamColors } from './colors.js';
import { AssetUrl, LocaleQuery, ProviderName, TeamDisplayName } from './common.js';
import { Event, isCalendarDate, MarketParam } from './events.js';
import { ConfederationRef } from './navigation.js';

// ─── resumo da home "Explorar" (docs/05 §3.1.2) ──────────────────────────────────────────────────

/** Janela de "próximos jogos" do resumo, em dias a partir de agora. */
export const EXPLORE_WINDOW_DAYS = 7;

export const ExploreSummaryQuery = LocaleQuery;
export type ExploreSummaryQuery = z.input<typeof ExploreSummaryQuery>;

export const ExploreCompetition = z
  .object({
    id: z.uuid(),
    slug: z.string().meta({ example: 'brasileirao-serie-a' }),
    sport: z.string().meta({ example: 'football' }),
    name: z.string().meta({ description: 'Nome localizado (ou o oficial).', example: 'Brasileirão Série A' }),
    type: z.enum(COMPETITION_TYPES),
    tier: z.number().int().min(1).max(3),
    logo: AssetUrl,
  })
  .meta({ id: 'ExploreCompetition' });
export type ExploreCompetition = z.infer<typeof ExploreCompetition>;

export const ExploreTeam = z
  .object({
    id: z.uuid(),
    name: TeamDisplayName,
    provider_name: ProviderName,
    short_name: z.string().nullable(),
    logo: AssetUrl,
    colors: TeamColors.nullable().meta({ description: 'Cores do escudo; null enquanto não espelhado.' }),
  })
  .meta({ id: 'ExploreTeam' });
export type ExploreTeam = z.infer<typeof ExploreTeam>;

const Upcoming = z
  .number()
  .int()
  .meta({
    description: `Jogos que começam nos próximos ${EXPLORE_WINDOW_DAYS} dias (sem adiados e cancelados).`,
    example: 42,
  });
const Live = z
  .number()
  .int()
  .meta({ description: 'Jogos em andamento agora (mesma regra de /v1/events/live).' });

export const ExploreSport = z
  .object({
    slug: z.string().meta({ example: 'football' }),
    name: z.string().meta({ example: 'Futebol' }),
    competitions: z.number().int().meta({ description: 'Competições catalogadas (tier 1–2).', example: 76 }),
    participants: z.number().int().meta({
      description: 'Participantes no banco: times, seleções, pilotos, equipes ou lutadores.',
      example: 9094,
    }),
    upcoming: Upcoming,
    live: Live,
    top_competitions: z.array(ExploreCompetition).meta({
      description:
        'Até 4 competições do catálogo em destaque: com jogos nos últimos 12 meses, menor tier, maior prestígio.',
    }),
  })
  .meta({ id: 'ExploreSport' });
export type ExploreSport = z.infer<typeof ExploreSport>;

export const ExploreCountry = z
  .object({
    code: z.string().meta({ example: 'BR' }),
    name: z.string().meta({ example: 'Brasil' }),
    flag: AssetUrl,
    confederation: ConfederationRef,
    competitions: z.number().int().meta({
      description: 'Competições domésticas catalogadas (tier 1–2), de todos os esportes.',
      example: 14,
    }),
    main_competition: ExploreCompetition.nullable().meta({
      description: 'Liga principal do futebol (a primeira em `featured` de config/geo, senão a liga tier 1).',
    }),
    top_teams: z.array(ExploreTeam).meta({
      description:
        'Até 5 clubes do país no futebol, por importância: os da base semântica primeiro, depois a soma da ' +
        'importância dos jogos dos últimos 12 meses.',
    }),
    upcoming: Upcoming,
    live: Live,
    highlight: Event.nullable().meta({
      description:
        `Próximo jogo de maior relevância no mercado do país (\`relevance.market\` = código do país), nos ` +
        `próximos ${EXPLORE_WINDOW_DAYS} dias; empate vai para o mais cedo.`,
    }),
    announced: z.array(Event).meta({
      description:
        'Até 2 jogos anunciados oficialmente e ainda não publicados pelo fornecedor (`provisional` preenchido) ' +
        'que envolvem o país, nos próximos 90 dias, do mais cedo ao mais tarde; sem o `highlight`.',
    }),
  })
  .meta({ id: 'ExploreCountry' });
export type ExploreCountry = z.infer<typeof ExploreCountry>;

export const ExploreSummary = z
  .object({
    generated_at: z.string().meta({ description: 'Quando o resumo foi montado (UTC).' }),
    window: z
      .object({
        from: z.string().meta({ description: 'Início (ISO 8601, UTC).' }),
        to: z.string().meta({ description: 'Fim exclusivo (ISO 8601, UTC).' }),
      })
      .meta({ description: `Janela de \`upcoming\` (${EXPLORE_WINDOW_DAYS} dias).` }),
    sports: z.array(ExploreSport).meta({ description: 'Os esportes da navegação, na ordem do menu.' }),
    countries: z.array(ExploreCountry).meta({ description: 'Os países da navegação, na ordem do menu.' }),
    confederations: z
      .array(ConfederationRef.extend({ countries: z.array(z.string()).meta({ example: ['BR', 'AR'] }) }))
      .meta({ description: 'Países da navegação agrupados por confederação (como em /v1/navigation).' }),
  })
  .meta({ id: 'ExploreSummary' });
export type ExploreSummary = z.infer<typeof ExploreSummary>;

// ─── agenda dos próximos dias (os jogos que o resumo conta) ─────────────────────────────────────

export const ExploreAgendaQuery = LocaleQuery.extend({
  sport: z.string().max(40).optional().meta({ example: 'football' }),
  country: z
    .string()
    .max(20)
    .transform((v) => v.toUpperCase())
    .optional()
    .meta({
      description: 'País da competição ou de um participante (como `/v1/events?country=`).',
      example: 'BR',
    }),
  competition: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .meta({ description: 'Slug ou UUID da competição.', example: 'brasileirao-serie-a' }),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')
    .refine(isCalendarDate, 'data inexistente')
    .optional()
    .meta({
      description:
        'Dia civil no fuso `tz` cujos jogos vêm em `data`. Padrão: o primeiro dia da janela com jogos.',
      example: '2026-10-25',
    }),
  market: MarketParam.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .default(60)
    .meta({ description: 'Jogos por página (1–200).' }),
  cursor: z.string().max(64).optional().meta({ description: 'Cursor opaco devolvido em `next_cursor`.' }),
});
export type ExploreAgendaQuery = z.input<typeof ExploreAgendaQuery>;

const FacetCount = z
  .number()
  .int()
  .meta({ description: 'Jogos da janela com este valor e os demais filtros.' });

export const ExploreAgenda = z
  .object({
    generated_at: z.string().meta({ description: 'Quando a agenda foi montada (UTC).' }),
    window: z
      .object({
        from: z.string().meta({ description: 'Início (ISO 8601, UTC): agora.' }),
        to: z.string().meta({ description: 'Fim exclusivo (ISO 8601, UTC).' }),
      })
      .meta({
        description: `A mesma janela do resumo (\`/v1/explore/summary\`): ${EXPLORE_WINDOW_DAYS} dias.`,
      }),
    total: z.number().int().meta({
      description:
        'Jogos da janela com os filtros. Sem filtro, é a soma de `upcoming` dos esportes do resumo (mesma consulta).',
      example: 2413,
    }),
    days: z
      .array(z.object({ date: z.string().meta({ example: '2026-10-25' }), count: z.number().int() }))
      .meta({ description: 'Todos os dias da janela no fuso `tz`, com a contagem (zero incluído).' }),
    day: z.string().nullable().meta({ description: 'O dia dos jogos em `data`; null sem jogo na janela.' }),
    facets: z
      .object({
        sports: z.array(z.object({ slug: z.string(), count: FacetCount })),
        countries: z.array(z.object({ code: z.string(), count: FacetCount })).meta({
          description: 'Os países da navegação (os mesmos do resumo).',
        }),
        competitions: z.array(
          z.object({
            id: z.uuid(),
            slug: z.string(),
            sport: z.string(),
            name: z.string(),
            count: FacetCount,
          }),
        ),
      })
      .meta({ description: 'Contagens para os filtros: cada uma com os outros filtros aplicados.' }),
    highlights: z.array(Event).meta({
      description:
        'Até 6 jogos da janela (com os filtros) de maior relevância no mercado (`market`), com a nota.',
    }),
    data: z.array(Event).meta({ description: 'Os jogos do dia `day`, por horário.' }),
    next_cursor: z.string().nullable(),
  })
  .meta({ id: 'ExploreAgenda' });
export type ExploreAgenda = z.infer<typeof ExploreAgenda>;
