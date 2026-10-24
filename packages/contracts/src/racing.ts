import 'zod-openapi';
import * as z from 'zod';
import { TeamColors } from './colors.js';
import { AssetUrl, CountryRef, LocaleQuery } from './common.js';

// ─── fotos com crédito (acervo de licenças livres) ───────────────────────────────────────────────

export const PHOTO_ROLES = ['portrait', 'action', 'car', 'highlight_car'] as const;

export const PhotoCredit = z
  .object({
    source: z.literal('Wikimedia Commons'),
    title: z.string().meta({ example: 'File:Senna imola89.jpg' }),
    page_url: z.url().meta({ description: 'Página do arquivo na Commons (autor, licença e histórico).' }),
    author: z.string().nullable().meta({ example: 'Gabriele' }),
    author_url: z.url().nullable(),
    license: z.string().meta({ example: 'CC BY 2.0' }),
    license_url: z.url().nullable(),
    credit: z.string().nullable().meta({ description: 'Linha de crédito pedida pelo autor, quando houver.' }),
    share_alike: z.boolean().meta({
      description: 'CC BY-SA: obra derivada (recorte, edição) tem de sair com a mesma licença.',
    }),
    text: z.string().meta({
      description: 'Atribuição pronta para exibir junto da foto (obrigatória nas licenças CC BY e CC BY-SA).',
      example: 'Foto: Gabriele / Wikimedia Commons · CC BY 2.0',
    }),
  })
  .meta({ id: 'PhotoCredit' });
export type PhotoCredit = z.infer<typeof PhotoCredit>;

export const Photo = z
  .object({
    url: AssetUrl,
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    role: z.enum(PHOTO_ROLES).meta({
      description:
        'portrait = retrato; action = em corrida ou no pódio; car = o carro; highlight_car = o carro de destaque do piloto (temporada mais marcante).',
    }),
    season: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Temporada da foto (carro do ano, piloto no ano).' }),
    credit: PhotoCredit,
  })
  .meta({ id: 'Photo' });
export type Photo = z.infer<typeof Photo>;

export const TeamPhotosQuery = LocaleQuery.extend({
  role: z.enum(PHOTO_ROLES).optional(),
  season: z.coerce.number().int().min(1900).max(2100).optional(),
});
export type TeamPhotosQuery = z.input<typeof TeamPhotosQuery>;

export const TeamPhotos = z
  .object({
    photos: z.array(Photo).meta({ description: 'Retrato primeiro; depois ação e carros, por temporada.' }),
  })
  .meta({ id: 'TeamPhotos' });
export type TeamPhotos = z.infer<typeof TeamPhotos>;

// ─── carreira na F1 (piloto ou construtor) ───────────────────────────────────────────────────────

const ParticipantLink = z.object({
  id: z.uuid(),
  name: z.string(),
  logo: AssetUrl,
  colors: TeamColors.nullable().optional().meta({
    description:
      'Cores do escudo da equipe (mesmo `colors` do time); null enquanto o escudo não foi espelhado.',
  }),
});

const HexColor = z.string().regex(/^#[0-9a-f]{6}$/);

export const TeamLivery = z
  .object({
    primary: HexColor.meta({
      description:
        'Cor de identidade da equipe naquela época (a oficial nas transmissões ou a que domina o carro).',
      example: '#e4002b',
    }),
    secondary: HexColor.nullable().meta({ example: '#ffffff' }),
    gradient: z.string().meta({
      description: 'CSS pronto para fundos: `linear-gradient(9deg, #000 0%, <primary> 100%)`.',
      example: 'linear-gradient(9deg, #000 0%, #e4002b 100%)',
    }),
    source: z.url().meta({ description: 'Fonte da curadoria daquela pintura.' }),
  })
  .meta({
    id: 'TeamLivery',
    description:
      'Pintura da equipe na temporada, curada por época na base semântica (a McLaren de 1988 é vermelha e branca; a de 2024, papaia). Null quando a época não está curada: use `colors` (do escudo).',
  });
export type TeamLivery = z.infer<typeof TeamLivery>;

const RaceRef = z.object({
  event_id: z.uuid(),
  name: z.string().meta({ example: 'Brazilian Grand Prix' }),
  date: z.string().meta({ description: 'ISO 8601 (UTC).' }),
  position: z.number().int().nullable(),
});

const SprintStats = z
  .object({
    races: z.number().int().meta({ description: 'Sprints disputadas.' }),
    points: z.number().meta({ description: 'Pontos somados nas sprints.' }),
    wins: z.number().int(),
    podiums: z.number().int(),
    poles: z.number().int().meta({
      description: '1º na classificação da sprint (sprint shootout/sprint qualifying, de 2023 em diante).',
    }),
    top10: z.number().int(),
  })
  .meta({ id: 'SprintStats' });

const BestWithCount = z
  .object({
    position: z.number().int(),
    count: z.number().int().meta({ description: 'Quantas vezes o participante chegou nessa posição.' }),
  })
  .nullable();

const CareerTotals = z.object({
  seasons: z.number().int(),
  races: z.number().int().meta({ description: 'Corridas disputadas (largadas, sem as sprints).' }),
  wins: z.number().int(),
  poles: z
    .number()
    .int()
    .meta({ description: '1º na classificação do GP (a mais rápida na sessão de classificação).' }),
  podiums: z.number().int(),
  fastest_laps: z.number().int(),
  points: z
    .number()
    .int()
    .meta({ description: 'Soma dos pontos do campeonato (válidos, com os descartes da época).' }),
  titles: z.number().int(),
  top10: z.number().int().meta({ description: 'Chegadas entre os dez primeiros nas corridas.' }),
  dnfs: z.number().int().meta({ description: 'Abandonos (DNF) nas corridas; desclassificação não conta.' }),
  best_finish: BestWithCount.meta({ description: 'Melhor chegada numa corrida e quantas vezes ("1 (x8)").' }),
  best_grid: BestWithCount.meta({ description: 'Melhor posição de largada numa corrida e quantas vezes.' }),
  sprint: SprintStats,
});

export const CareerSeason = z
  .object({
    year: z.number().int(),
    position: z
      .number()
      .int()
      .nullable()
      .meta({ description: 'Posição no campeonato (provisória enquanto `final` for false).' }),
    final: z.boolean().meta({
      description: 'Temporada encerrada: a posição é a final. Só temporada encerrada conta título.',
    }),
    points: z.number().int().nullable(),
    races: z.number().int(),
    wins: z.number().int(),
    poles: z.number().int(),
    podiums: z.number().int(),
    fastest_laps: z.number().int(),
    top10: z.number().int(),
    dnfs: z.number().int(),
    sprint: SprintStats,
    number: z.number().int().nullable().meta({
      description:
        'Piloto: número do carro na temporada (o mais usado nas sessões; sem ele, o permanente de 2014 em diante).',
      example: 12,
    }),
    teams: z
      .array(
        ParticipantLink.extend({
          livery: TeamLivery.nullable()
            .optional()
            .meta({ description: 'Piloto: a pintura da equipe naquela temporada (curadoria por época).' }),
        }),
      )
      .meta({ description: 'Piloto: equipes no ano (a principal primeiro). Construtor: pilotos no ano.' }),
    car: Photo.nullable().meta({ description: 'Foto do carro da temporada, quando houver no acervo.' }),
  })
  .meta({ id: 'CareerSeason' });
export type CareerSeason = z.infer<typeof CareerSeason>;

/** Relação no F1DB: o que o parente é do piloto (`PARENT` = pai ou mãe; `SIBLINGS_CHILD` = sobrinho ou sobrinha). */
export const DRIVER_RELATIONS = [
  'PARENT',
  'CHILD',
  'SIBLING',
  'HALF_SIBLING',
  'GRANDPARENT',
  'GRANDCHILD',
  'PARENTS_SIBLING',
  'SIBLINGS_CHILD',
  'PARENTS_SIBLINGS_CHILD',
  'GRANDPARENTS_SIBLING',
  'SIBLINGS_GRANDCHILD',
  'PARENT_IN_LAW',
  'CHILD_IN_LAW',
  'SIBLING_IN_LAW',
  'SIBLINGS_CHILD_IN_LAW',
] as const;

const DriverRelative = z.object({
  relation: z.string().meta({
    description: `O que o parente é do piloto, no F1DB (${DRIVER_RELATIONS.join(', ')}).`,
    example: 'PARENT',
  }),
  gender: z.enum(['male', 'female']).nullable(),
  driver: z.object({
    id: z.uuid().nullable().meta({ description: 'O parente em `/v1/teams/{id}`.' }),
    f1db_id: z.string(),
    name: z.string(),
  }),
});

const DriverDeath = z
  .object({
    date: z.string().meta({ description: 'ISO 8601 (data), do F1DB.', example: '1994-05-01' }),
    age: z.number().int().nullable().meta({ example: 34 }),
    place: z
      .object({ name: z.string(), country: CountryRef.nullable() })
      .nullable()
      .meta({ description: 'Local (Wikidata P20), só quando há um só registrado.' }),
    accident: z.boolean().meta({ description: 'Morte em acidente (F1DB ou Wikidata P1196/P509).' }),
    cause: z
      .string()
      .nullable()
      .meta({ description: 'Causa (Wikidata P509) no idioma pedido, fora de acidente; null sem fonte.' }),
    race: z
      .object({
        event_id: z.uuid(),
        name: z.string().meta({ example: 'San Marino Grand Prix' }),
        date: z.string().meta({ description: 'ISO 8601 (UTC) da corrida.' }),
        session: z.enum(['race', 'qualifying', 'practice', 'support_race']).meta({
          description:
            'Onde foi o acidente: na corrida, na classificação, nos treinos ou numa corrida de apoio.',
        }),
        circuit: z.string().nullable().meta({ example: 'Autodromo Enzo e Dino Ferrari' }),
        city: z.string().nullable().meta({ example: 'Imola' }),
      })
      .nullable()
      .meta({
        description:
          'O GP do acidente fatal, quando o F1DB marca o resultado ("Fatal accident"); a morte pode ter sido dias depois.',
      }),
  })
  .meta({ id: 'DriverDeath' });

export const DriverProfile = z
  .object({
    first_name: z.string().meta({ example: 'Kimi' }),
    last_name: z.string().meta({ example: 'Antonelli' }),
    number: z.number().int().nullable().meta({
      description:
        'Número permanente (F1 desde 2014); antes disso, null — o de cada temporada fica em `seasons[].number`.',
      example: 12,
    }),
    birth_date: z.string().nullable().meta({ description: 'ISO 8601 (data).', example: '2006-08-25' }),
    birth_place: z.string().nullable().meta({ example: 'Bologna' }),
    birth_country: CountryRef.nullable(),
    full_name: z
      .string()
      .nullable()
      .optional()
      .meta({ description: 'Nome completo de registro (F1DB).', example: 'Ayrton Senna da Silva' }),
    nicknames: z
      .array(z.string())
      .optional()
      .meta({
        description: 'Apelidos (Wikidata P1449, QID casado de forma estrita).',
        example: ['Magic Senna'],
      }),
    death: DriverDeath.nullable().optional(),
    family: z
      .array(DriverRelative)
      .optional()
      .meta({ description: 'Família no automobilismo (F1DB): pai, filho, irmão, sobrinho...' }),
    other_wins: z
      .array(
        z.object({
          race: z.enum(['indy500', 'le_mans_24h']),
          year: z.number().int(),
          source: z.url().meta({ description: 'A edição no Wikidata.' }),
        }),
      )
      .optional()
      .meta({
        description:
          'Vitórias fora da F1: 500 Milhas de Indianápolis e 24 Horas de Le Mans (Wikidata P1346).',
      }),
    sources: z.object({ f1db: z.url(), wikidata: z.url().nullable() }).optional().meta({
      description:
        'De onde vêm os fatos: o F1DB e o item do Wikidata (casado pela data de nascimento e pelo id do piloto ou nome).',
    }),
  })
  .meta({ id: 'DriverProfile' });
export type DriverProfile = z.infer<typeof DriverProfile>;

export const RaceCareer = z
  .object({
    participant_id: z.uuid(),
    kind: z.enum(['driver', 'constructor']),
    profile: DriverProfile.nullable().meta({
      description: 'Piloto: nome, número e nascimento. Construtor: null.',
    }),
    current_season: z.number().int().nullable().meta({
      description:
        'Temporada corrente, quando o participante correu nela (o bloco de "temporada atual"); null para quem não está no grid deste ano.',
      example: 2026,
    }),
    competition: z
      .object({ id: z.uuid(), slug: z.string(), name: z.string() })
      .nullable()
      .meta({ description: 'O campeonato (para o link dos resultados de cada temporada).' }),
    totals: CareerTotals,
    titles: z
      .array(z.number().int())
      .meta({ description: 'Anos dos títulos mundiais.', example: [1988, 1990, 1991] }),
    best_finish: z.number().int().nullable(),
    first_race: RaceRef.nullable(),
    first_win: RaceRef.nullable(),
    last_race: RaceRef.nullable(),
    teams: z
      .array(ParticipantLink.extend({ from: z.number().int(), to: z.number().int() }))
      .meta({ description: 'Piloto: equipes da carreira, em ordem. Construtor: vazio.' }),
    teammates: z
      .array(ParticipantLink.extend({ races: z.number().int(), seasons: z.array(z.number().int()) }))
      .meta({ description: 'Companheiros de equipe (piloto), do que mais correu junto ao que menos.' }),
    seasons: z
      .array(CareerSeason)
      .meta({ description: 'Temporada a temporada, da mais recente à primeira.' }),
    portrait: Photo.nullable(),
    highlight: z.object({ season: z.number().int(), car: Photo }).nullable().meta({
      description:
        'Piloto: carro de destaque (a temporada de título com mais vitórias ou, sem título, a de mais vitórias; curadoria no acervo). Para o topo da página, com o retrato na frente. Nunca CC BY-SA: o fundo recorta a foto.',
    }),
  })
  .meta({ id: 'RaceCareer' });
export type RaceCareer = z.infer<typeof RaceCareer>;
