import 'zod-openapi';
import * as z from 'zod';
import { CompetitionSummary, FormerName, ParticipantRef, SeasonRef } from './catalog.js';
import { AssetUrl, CountryRef, LocaleQuery, LogoFormats, LogoSource, PaginationQuery } from './common.js';
import { TeamColors } from './colors.js';
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

export { TeamColors, teamGradient } from './colors.js';

export const Team = TeamSummary.extend({
  logo_source: LogoSource,
  logo_formats: LogoFormats,
  country_ref: CountryRef.nullable(),
  founded: z.number().int().nullable(),
  venue: z
    .object({ id: z.uuid(), name: z.string(), city: z.string().nullable(), image: AssetUrl })
    .nullable(),
  colors: TeamColors.nullable().meta({
    description: 'null quando o escudo ainda não foi espelhado ou não é um PNG decodificável.',
  }),
  external_ids: z.record(z.string(), z.string()).meta({ example: { 'api-sports': '121' } }),
  former_names: z.array(FormerName).meta({
    description:
      'Nomes anteriores do time derivados dos jogos do fornecedor (ex.: "Dinamo Moscow" → "Dynamo"; `origin: provider`, `confidence: low`): pistas para busca e casamento de nomes, não fato confirmado. Variações de caixa e acento não contam e os nomes da base semântica vencem.',
  }),
}).meta({ id: 'Team' });
export type Team = z.infer<typeof Team>;

export const TeamStanding = z
  .object({
    competition: CompetitionSummary.pick({ id: true, slug: true, name: true, logo: true }),
    season: SeasonRef,
    group: z.string().nullable(),
    group_display_name: z.string().nullable().optional().meta({
      description:
        'Nome da tabela no idioma pedido, pelo regulamento (ex.: "Clausura · Zona A"). Com várias tabelas na temporada (fase, anual, promedios), a posição é a da fase em andamento.',
    }),
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

/** Situação da campanha do time numa temporada de competição. */
export const CAMPAIGN_STATUSES = [
  'champion',
  'runner_up',
  'third_place',
  'in_progress',
  'eliminated',
  'league',
  'finished_league',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const LocalizedText = z.record(z.string(), z.string());

export const TeamCampaign = z
  .object({
    status: z.enum(CAMPAIGN_STATUSES).meta({
      description:
        '`champion` (venceu a final ou terminou em 1º uma liga encerrada), `runner_up`, `third_place`, ' +
        '`in_progress` (ainda na disputa: `stage_kind` é a fase atual), `eliminated` (`stage_kind` é a fase da ' +
        'eliminação), `league` (liga de pontos corridos em andamento) e `finished_league` (liga encerrada).',
      example: 'in_progress',
    }),
    stage_kind: z.string().nullable().meta({
      description: 'Tipo da fase (core.stage.kind): a atual, ou aquela em que a campanha se decidiu.',
      example: 'final',
    }),
    label: LocalizedText.meta({
      description: 'Rótulo curto no locale da resposta (selo).',
      example: { 'pt-BR': 'Na final' },
    }),
    detail: LocalizedText.nullable().meta({
      description: 'Confronto decisivo (adversário e placar) ou posição e pontos, no locale da resposta.',
      example: { 'pt-BR': 'Eliminou Fluminense nas semifinais (2–2 no agregado, 5–3 nos pênaltis)' },
    }),
    rank: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Posição na tabela da fase (ou 3/4 na disputa de 3º).' }),
    points: z.number().int().nullable(),
    opponent: ParticipantRef.nullable().meta({
      description: 'Adversário do confronto decisivo, do último vencido ou do que está em disputa.',
    }),
    decided_by_event_id: z.uuid().nullable().meta({
      description:
        'Último jogo encerrado do confronto que decidiu (ou classificou) — null se ainda em disputa.',
    }),
    ongoing: z
      .boolean()
      .meta({ description: 'A campanha ainda está em disputa (`in_progress` ou `league`).' }),
  })
  .meta({ id: 'TeamCampaign' });
export type TeamCampaign = z.infer<typeof TeamCampaign>;

export const TeamCompetition = z
  .object({
    competition: CompetitionSummary.pick({ id: true, slug: true, name: true, logo: true }),
    season: SeasonRef,
    group: z.string().nullable().meta({ description: 'Grupo/tabela do time, quando a fase tem tabela.' }),
    campaign: TeamCampaign,
  })
  .meta({ id: 'TeamCompetition' });
export type TeamCompetition = z.infer<typeof TeamCompetition>;

/** Ano de temporada (`core.season.year`): o início da temporada, também nas que cruzam anos (2025/26 → 2025). */
const SeasonYear = z.coerce.number().int().min(1900).max(2100);

export const TeamOverviewQuery = LocaleQuery.extend({
  season: SeasonYear.optional().meta({
    description:
      'Ano da temporada (`season.year`: 2025 também seleciona as temporadas 2025/26). Sem ele, a temporada ' +
      'atual (ou a mais recente) de cada competição. Os anos com dados estão em `seasons`.',
    example: 2025,
  }),
});
export type TeamOverviewQuery = z.input<typeof TeamOverviewQuery>;

export const TeamSeason = z
  .object({
    year: z.number().int().meta({ example: 2025 }),
    labels: z.array(z.string()).meta({
      description:
        'Rótulos das temporadas das competições nesse ano, como o fornecedor os escreve ("2025", "2025/26").',
      example: ['2025'],
    }),
    events: z.number().int().meta({ description: 'Jogos do time nas temporadas desse ano.', example: 76 }),
    has_incidents: z
      .boolean()
      .meta({ description: 'Algum jogo da temporada tem lances (gols, cartões, substituições).' }),
    current: z.boolean().meta({
      description:
        'Temporada corrente do time (a mais recente marcada como atual): a única com `next_event` e `live_event`.',
    }),
  })
  .meta({ id: 'TeamSeason' });
export type TeamSeason = z.infer<typeof TeamSeason>;

export const TeamOverview = z
  .object({
    team: Team,
    season: z.number().int().nullable().meta({
      description: 'Ano pedido em `?season` (null: temporada atual ou mais recente de cada competição).',
    }),
    seasons: z.array(TeamSeason).meta({
      description: 'Anos de temporada com jogos do time, do mais recente ao mais antigo (para o seletor).',
    }),
    standings: z.array(TeamStanding).meta({
      description:
        'Posição nas temporadas atuais (ou mais recentes) das competições do time; com `season`, nas daquele ano.',
    }),
    competitions: z.array(TeamCompetition).meta({
      description:
        'Campanha em cada competição (temporada atual ou mais recente, inclusive copas sem tabela), ' +
        'em disputa primeiro e depois a mais recente. Com `season`, a campanha de cada competição naquele ' +
        'ano (campeão, vice, eliminado ou posição final).',
    }),
    form: z
      .array(
        z.object({
          event_id: z.uuid(),
          result: z.enum(FORM_RESULTS),
          score: z.string().meta({ example: '2-1' }),
        }),
      )
      .meta({
        description:
          'Últimos 5 resultados, do mais recente ao mais antigo (com `season`, os últimos daquele ano).',
      }),
    last_events: z
      .array(Event)
      .meta({ description: 'Últimos jogos encerrados (com `season`, daquele ano).' }),
    live_event: Event.nullable().meta({ description: 'null quando `season` não é a temporada corrente.' }),
    next_event: Event.nullable().meta({ description: 'null quando `season` não é a temporada corrente.' }),
  })
  .meta({ id: 'TeamOverview' });
export type TeamOverview = z.infer<typeof TeamOverview>;

export const TeamEventsQuery = EventsQuery.omit({ team: true });
export type TeamEventsQuery = z.input<typeof TeamEventsQuery>;

export const SquadQuery = LocaleQuery.extend({
  season: SeasonYear.optional().meta({
    description:
      'Ano da temporada: os inscritos daquele ano somados a quem entrou em campo pelo time (escalações), com ' +
      'jogos e gols. Na temporada corrente também entra o elenco atual. Sem ele, só o elenco atual, sem números.',
  }),
});
export type SquadQuery = z.input<typeof SquadQuery>;

const SquadMemberStats = z
  .object({
    appearances: z.number().int().meta({ description: 'Jogos em que entrou em campo (minutos > 0).' }),
    starts: z.number().int().meta({ description: 'Jogos como titular.' }),
    minutes: z.number().int(),
    goals: z.number().int(),
    assists: z.number().int(),
  })
  .meta({
    id: 'SquadMemberStats',
    description:
      'Números da temporada pelo time, somados das estatísticas por partida (`fixtures/players`). Para técnicos, ' +
      '`appearances` são os jogos no banco (escalações) e o resto fica 0.',
  });

const SquadMember = z.object({
  person: z.object({
    id: z.uuid(),
    name: z.string(),
    photo: AssetUrl,
    nationality: z.string().nullable(),
    nationality_ref: CountryRef.nullable().meta({
      description: 'País da nacionalidade no catálogo (código ISO para a bandeira), quando reconhecido.',
    }),
    birth_date: z.iso.date().nullable(),
    age: z.number().int().nullable(),
  }),
  number: z.number().int().nullable(),
  position: z.string().nullable().meta({
    description:
      'Goalkeeper, Defender, Midfielder ou Attacker (sem inscrição, a posição mais usada nas escalações).',
  }),
  stats: SquadMemberStats.nullable().meta({ description: 'null sem `season` ou sem jogo com estatística.' }),
});
export type SquadMember = z.infer<typeof SquadMember>;

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
    birth_place: z.string().nullable().meta({ description: 'Cidade de nascimento.', example: 'São Paulo' }),
    birth_country: z.string().nullable().meta({ description: 'País de nascimento.', example: 'Brazil' }),
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

// ─── perfil da pessoa ────────────────────────────────────────────────────────────────────────────

export const PersonOverviewQuery = LocaleQuery.extend({
  season: SeasonYear.optional().meta({
    description:
      'Ano da temporada das estatísticas e dos jogos. Sem ele, a mais recente com jogos. Os anos com dados ' +
      'estão em `seasons`.',
    example: 2025,
  }),
});
export type PersonOverviewQuery = z.input<typeof PersonOverviewQuery>;

const PersonNumbers = z.object({
  appearances: z.number().int().meta({ description: 'Jogos em que entrou em campo.' }),
  starts: z.number().int().meta({ description: 'Jogos como titular.' }),
  minutes: z.number().int(),
  goals: z.number().int(),
  assists: z.number().int(),
  yellow_cards: z.number().int(),
  red_cards: z.number().int(),
  rating: z
    .number()
    .nullable()
    .meta({ description: 'Nota média do fornecedor nos jogos com nota (0 a 10).', example: 7.12 }),
});

export const PersonSeasonStats = PersonNumbers.extend({
  competition: CompetitionSummary.pick({ id: true, slug: true, name: true, logo: true }),
  season: SeasonRef,
  team: ParticipantRef,
  source: z.enum(['provider', 'matches']).meta({
    description:
      '`provider`: o total da temporada do fornecedor (`players?league&season`, cobre jogos sem detalhe); ' +
      '`matches`: a soma das estatísticas por partida, quando o fornecedor ainda não tem a temporada.',
  }),
}).meta({ id: 'PersonSeasonStats' });
export type PersonSeasonStats = z.infer<typeof PersonSeasonStats>;

const TransferTeam = z.object({
  id: z.uuid().nullable().meta({ description: 'null quando o clube não está no catálogo.' }),
  name: z.string(),
  logo: AssetUrl,
});

export const PersonMatch = z
  .object({
    event: Event,
    team_id: z.uuid().nullable().meta({ description: 'Time pelo qual jogou.' }),
    started: z.boolean(),
    minutes: z.number().int().nullable(),
    rating: z.number().nullable(),
    goals: z.number().int(),
    assists: z.number().int(),
    yellow_cards: z.number().int(),
    red_cards: z.number().int(),
  })
  .meta({ id: 'PersonMatch' });
export type PersonMatch = z.infer<typeof PersonMatch>;

export const PersonOverview = z
  .object({
    person: Person,
    nationality_ref: CountryRef.nullable().meta({
      description: 'País da nacionalidade no catálogo (código ISO para a bandeira), quando reconhecido.',
    }),
    role: z.string().nullable().meta({ description: 'player | coach | staff (o papel mais recente).' }),
    position: z.string().nullable().meta({ description: 'Goalkeeper, Defender, Midfielder ou Attacker.' }),
    number: z.number().int().nullable(),
    current_team: ParticipantRef.extend({
      colors: TeamColors.nullable().meta({ description: 'Cores do escudo do time (para o cabeçalho).' }),
    })
      .nullable()
      .meta({ description: 'Elenco atual ou, sem ele, o time do jogo mais recente.' }),
    season: z.number().int().nullable().meta({
      description: 'Ano das estatísticas e dos jogos (o pedido ou o mais recente com jogos).',
    }),
    seasons: z
      .array(
        z.object({
          year: z.number().int(),
          appearances: z.number().int(),
          goals: z.number().int(),
        }),
      )
      .meta({ description: 'Anos com jogos ou inscrição, do mais recente ao mais antigo (para o seletor).' }),
    totals: PersonNumbers.nullable().meta({
      description: 'Soma da temporada em todas as competições (null sem jogos no ano).',
    }),
    stats: z.array(PersonSeasonStats).meta({
      description:
        'Números da temporada por competição, somados das estatísticas por partida (`fixtures/players`).',
    }),
    career: z
      .array(
        z.object({
          team: ParticipantRef,
          from: z.number().int().meta({ example: 2022 }),
          to: z.number().int().meta({ example: 2026 }),
          seasons: z.array(z.number().int()),
          appearances: z.number().int(),
          goals: z.number().int(),
          current: z.boolean().meta({ description: 'Está no elenco atual do time.' }),
        }),
      )
      .meta({ description: 'Passagens por clube (inscrições e jogos), da mais recente à mais antiga.' }),
    transfers: z
      .array(
        z.object({
          date: z.iso.date().nullable(),
          type: z.string().nullable().meta({ example: 'Loan' }),
          from: TransferTeam,
          to: TransferTeam,
        }),
      )
      .meta({ description: 'Transferências do fornecedor (`transfers`), da mais recente à mais antiga.' }),
    trophies: z
      .array(
        z.object({
          league: z.string().meta({ example: 'Copa Libertadores' }),
          country: z.string().nullable().meta({ example: 'World' }),
          season: z.string().meta({ example: '2021' }),
          place: z.string().nullable().meta({ description: 'Como o fornecedor escreve.', example: 'Winner' }),
        }),
      )
      .meta({
        description: 'Títulos e colocações por temporada (`trophies`), do mais recente ao mais antigo.',
      }),
    sidelined: z
      .array(
        z.object({
          type: z.string().meta({ example: 'Hamstring Injury' }),
          start: z.iso.date().nullable(),
          end: z.iso.date().nullable(),
        }),
      )
      .meta({ description: 'Afastamentos mais recentes (lesões, suspensões), até 10.' }),
    media: z
      .array(
        z.object({
          kind: z.enum(['photo']),
          url: z.url(),
          mirrored: z.boolean().meta({
            description:
              'Servida pelo nosso storage (espelho de mídia); false = URL de origem, ainda não copiada.',
          }),
        }),
      )
      .meta({ description: 'Imagens da pessoa no espelho de mídia (hoje, a foto).' }),
    recent_matches: z.array(PersonMatch).meta({
      description:
        'Últimos jogos da temporada em que entrou em campo (até 10), do mais recente ao mais antigo.',
    }),
  })
  .meta({ id: 'PersonOverview' });
export type PersonOverview = z.infer<typeof PersonOverview>;
