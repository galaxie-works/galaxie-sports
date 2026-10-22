import 'zod-openapi';
import * as z from 'zod';
import { COMPETITION_TYPES } from './catalog.js';
import { TeamColors } from './colors.js';
import { AssetUrl, LocaleQuery } from './common.js';
import { Event } from './events.js';
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
    name: z.string().meta({ example: 'Palmeiras' }),
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
