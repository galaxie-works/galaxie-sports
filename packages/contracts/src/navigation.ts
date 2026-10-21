import 'zod-openapi';
import * as z from 'zod';
import { CompetitionSummary } from './catalog.js';
import { AssetUrl, LocaleQuery } from './common.js';

// ─── navegação por país (docs/05 §3.1.1, docs/09 §2.1) ───────────────────────────────────────────

/** Escopo de uma competição na página do país. */
export const COMPETITION_SCOPES = ['domestic', 'continental_clubs', 'national_teams', 'world_clubs'] as const;
export type CompetitionScope = (typeof COMPETITION_SCOPES)[number];

export const CountryParams = z.object({
  code: z
    .string()
    .regex(/^[A-Za-z]{2}(-[A-Za-z]{3})?$/, 'código de país (ISO2 ou extensão como GB-ENG)')
    .transform((v) => v.toUpperCase())
    .meta({ description: 'Código do país (ISO2 ou extensão da api-sports, ex.: GB-ENG).', example: 'BR' }),
});

export const ConfederationRef = z
  .object({
    code: z.string().meta({ example: 'CONMEBOL' }),
    name: z.string().meta({ example: 'CONMEBOL (América do Sul)' }),
  })
  .meta({ id: 'ConfederationRef' });
export type ConfederationRef = z.infer<typeof ConfederationRef>;

export const CountryDetail = z
  .object({
    code: z.string().meta({ example: 'BR' }),
    name: z.string().meta({ example: 'Brasil' }),
    ioc_code: z.string().nullable().meta({ example: 'BRA' }),
    flag: AssetUrl,
    confederation: ConfederationRef.nullable(),
    in_navigation: z.boolean().meta({ description: 'O país está no menu de navegação da demo.' }),
  })
  .meta({ id: 'CountryDetail' });
export type CountryDetail = z.infer<typeof CountryDetail>;

export const CountryCompetitionsQuery = LocaleQuery.extend({
  sport: z
    .string()
    .max(40)
    .optional()
    .meta({ description: 'Só um esporte (padrão: todos).', example: 'football' }),
  max_tier: z.coerce
    .number()
    .int()
    .min(1)
    .max(3)
    .default(2)
    .meta({
      description:
        'Tier máximo das competições domésticas (padrão 2 = catalogadas; 3 inclui todo o espelho). ' +
        'As internacionais do escopo são sempre listadas.',
    }),
});
export type CountryCompetitionsQuery = z.input<typeof CountryCompetitionsQuery>;

export const CountryCompetition = CompetitionSummary.extend({
  scope: z.enum(COMPETITION_SCOPES),
  confederations: z.array(z.string()).meta({
    description: 'Confederações participantes (FIFA = global); vazio nas domésticas.',
    example: ['CONMEBOL'],
  }),
}).meta({ id: 'CountryCompetition' });
export type CountryCompetition = z.infer<typeof CountryCompetition>;

export const CountryCompetitions = z
  .object({
    country: CountryDetail,
    sports: z.array(
      z.object({
        sport: z.object({
          slug: z.string().meta({ example: 'football' }),
          name: z.string().meta({ example: 'Futebol' }),
        }),
        groups: z.array(
          z.object({
            scope: z.enum(COMPETITION_SCOPES),
            label: z.string().meta({ example: 'Copas continentais de clubes' }),
            competitions: z.array(CountryCompetition),
          }),
        ),
      }),
    ),
  })
  .meta({ id: 'CountryCompetitions' });
export type CountryCompetitions = z.infer<typeof CountryCompetitions>;

export const NavigationSport = z
  .object({
    slug: z.string().meta({ example: 'football' }),
    name: z.string().meta({ example: 'Futebol' }),
    competitions: z.number().int().meta({ description: 'Competições no catálogo (todos os tiers).' }),
    events: z.number().int().meta({ description: 'Eventos sincronizados.' }),
    has_data: z.boolean().meta({ description: 'Há competições ou eventos no banco.' }),
    mirror: z.string().nullable().meta({ example: '/mirror/football' }),
  })
  .meta({ id: 'NavigationSport' });
export type NavigationSport = z.infer<typeof NavigationSport>;

export const NavigationCountry = z
  .object({
    code: z.string().meta({ example: 'BR' }),
    name: z.string().meta({ example: 'Brasil' }),
    flag: AssetUrl,
    confederation: ConfederationRef,
  })
  .meta({ id: 'NavigationCountry' });
export type NavigationCountry = z.infer<typeof NavigationCountry>;

export const Navigation = z
  .object({
    sports: z.array(NavigationSport),
    countries: z.array(NavigationCountry),
    confederations: z
      .array(ConfederationRef.extend({ countries: z.array(z.string()).meta({ example: ['BR', 'AR'] }) }))
      .meta({ description: 'Seções do menu: países da navegação agrupados por confederação.' }),
  })
  .meta({ id: 'Navigation' });
export type Navigation = z.infer<typeof Navigation>;
