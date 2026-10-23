import 'zod-openapi';
import * as z from 'zod';
import { TeamColors } from './colors.js';
import { AssetUrl, LocaleQuery } from './common.js';

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

const RaceRef = z.object({
  event_id: z.uuid(),
  name: z.string().meta({ example: 'Brazilian Grand Prix' }),
  date: z.string().meta({ description: 'ISO 8601 (UTC).' }),
  position: z.number().int().nullable(),
});

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
    teams: z
      .array(ParticipantLink)
      .meta({ description: 'Piloto: equipes no ano. Construtor: pilotos no ano.' }),
    car: Photo.nullable().meta({ description: 'Foto do carro da temporada, quando houver no acervo.' }),
  })
  .meta({ id: 'CareerSeason' });
export type CareerSeason = z.infer<typeof CareerSeason>;

export const RaceCareer = z
  .object({
    participant_id: z.uuid(),
    kind: z.enum(['driver', 'constructor']),
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
        'Piloto: carro de destaque (a temporada de título com mais vitórias ou, sem título, a de mais vitórias; curadoria no acervo). Para o topo da página, com o retrato na frente.',
    }),
  })
  .meta({ id: 'RaceCareer' });
export type RaceCareer = z.infer<typeof RaceCareer>;
