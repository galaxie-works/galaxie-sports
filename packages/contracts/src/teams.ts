import 'zod-openapi';
import * as z from 'zod';
import { CompetitionSummary, ParticipantRef, SeasonRef } from './catalog.js';
import { AssetUrl, CountryRef, LocaleQuery, PaginationQuery } from './common.js';
import { Event, EventsQuery, TeamSummary } from './events.js';

// ─── times ───────────────────────────────────────────────────────────────────────────────────────

export const TeamsQuery = LocaleQuery.extend(PaginationQuery.shape).extend({
  q: z.string().trim().min(2).max(80).optional().meta({ description: 'Busca por nome, código ou apelido.' }),
  sport: z.string().max(40).optional().meta({ example: 'football' }),
  country: z
    .string()
    .max(20)
    .transform((v) => v.toUpperCase())
    .optional()
    .meta({ example: 'BR' }),
  competition: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .meta({ description: 'UUID ou slug: times com jogos na competição.' }),
});
export type TeamsQuery = z.input<typeof TeamsQuery>;

export const TeamParams = z.object({ id: z.uuid().meta({ description: 'ID do participante.' }) });

const HexColor = z.string().regex(/^#[0-9a-f]{6}$/);

/** Gradiente sugerido a partir da cor primária (mesmo ângulo do token de design). */
export function teamGradient(primary: string): string {
  return `linear-gradient(9deg, #000 0%, ${primary} 100%)`;
}

export const TeamColors = z
  .object({
    primary: HexColor.meta({ description: 'Cor predominante do escudo.', example: '#006937' }),
    secondary: HexColor.nullable().meta({
      description: 'Segunda cor do escudo, com matiz distinto da primária; null quando não há.',
      example: null,
    }),
    monochrome: z.boolean().meta({
      description:
        'Escudo preto/branco/cinza: `primary` é um cinza-escuro neutro (#3a3a3a) para o gradiente continuar legível.',
      example: false,
    }),
    gradient: z.string().meta({
      description: 'CSS pronto para fundos: `linear-gradient(9deg, #000 0%, <primary> 100%)`.',
      example: 'linear-gradient(9deg, #000 0%, #006937 100%)',
    }),
  })
  .meta({
    id: 'TeamColors',
    description:
      'Cores do time extraídas do escudo espelhado (sem chamada externa) e o gradiente sugerido para a identidade visual.',
  });
export type TeamColors = z.infer<typeof TeamColors>;

export const Team = TeamSummary.extend({
  country_ref: CountryRef.nullable(),
  founded: z.number().int().nullable(),
  venue: z
    .object({ id: z.uuid(), name: z.string(), city: z.string().nullable(), image: AssetUrl })
    .nullable(),
  colors: TeamColors.nullable().meta({
    description: 'null quando o escudo ainda não foi espelhado ou não é um PNG decodificável.',
  }),
  external_ids: z.record(z.string(), z.string()).meta({ example: { 'api-sports': '121' } }),
}).meta({ id: 'Team' });
export type Team = z.infer<typeof Team>;

export const TeamStanding = z
  .object({
    competition: CompetitionSummary.pick({ id: true, slug: true, name: true, logo: true }),
    season: SeasonRef,
    group: z.string().nullable(),
    rank: z.number().int(),
    points: z.number().int(),
    played: z.number().int(),
    won: z.number().int(),
    drawn: z.number().int(),
    lost: z.number().int(),
    goal_diff: z.number().int(),
    form: z.string().nullable(),
    description: z.string().nullable(),
  })
  .meta({ id: 'TeamStanding' });

export const FORM_RESULTS = ['W', 'D', 'L'] as const;

export const TeamOverview = z
  .object({
    team: Team,
    standings: z
      .array(TeamStanding)
      .meta({ description: 'Posição nas temporadas atuais (ou mais recentes) das competições do time.' }),
    form: z
      .array(
        z.object({
          event_id: z.uuid(),
          result: z.enum(FORM_RESULTS),
          score: z.string().meta({ example: '2-1' }),
        }),
      )
      .meta({ description: 'Últimos 5 resultados, do mais recente ao mais antigo.' }),
    last_events: z.array(Event),
    live_event: Event.nullable(),
    next_event: Event.nullable(),
  })
  .meta({ id: 'TeamOverview' });
export type TeamOverview = z.infer<typeof TeamOverview>;

export const TeamEventsQuery = EventsQuery.omit({ team: true });
export type TeamEventsQuery = z.input<typeof TeamEventsQuery>;

export const SquadQuery = LocaleQuery.extend({
  season: z.coerce
    .number()
    .int()
    .min(1900)
    .max(2100)
    .optional()
    .meta({ description: 'Ano da temporada; sem ele, o elenco atual.' }),
});

const SquadMember = z.object({
  person: z.object({
    id: z.uuid(),
    name: z.string(),
    photo: AssetUrl,
    nationality: z.string().nullable(),
    birth_date: z.iso.date().nullable(),
    age: z.number().int().nullable(),
  }),
  number: z.number().int().nullable(),
  position: z.string().nullable(),
});

export const Squad = z
  .object({
    team_id: z.uuid(),
    season: z.number().int().nullable(),
    players: z.array(SquadMember),
    coaches: z.array(SquadMember),
    staff: z.array(SquadMember),
  })
  .meta({ id: 'Squad' });
export type Squad = z.infer<typeof Squad>;

// ─── pessoas ─────────────────────────────────────────────────────────────────────────────────────

export const Person = z
  .object({
    id: z.uuid(),
    name: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
    birth_date: z.iso.date().nullable(),
    age: z.number().int().nullable(),
    nationality: z.string().nullable(),
    height_cm: z.number().int().nullable(),
    weight_kg: z.number().int().nullable(),
    photo: AssetUrl,
    teams: z.array(
      z.object({
        team: ParticipantRef,
        role: z.string().meta({ example: 'player' }),
        number: z.number().int().nullable(),
        position: z.string().nullable(),
        season: z.number().int().nullable().meta({ description: 'null = elenco atual.' }),
      }),
    ),
    external_ids: z.record(z.string(), z.string()),
  })
  .meta({ id: 'Person' });
export type Person = z.infer<typeof Person>;
