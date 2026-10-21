import * as z from 'zod';

/** Escopos de uma competição na página de um país (docs/09 §2.1). */
export const COMPETITION_SCOPES = ['domestic', 'continental_clubs', 'national_teams', 'world_clubs'] as const;
export type CompetitionScope = (typeof COMPETITION_SCOPES)[number];

/** Escopos declarados em config/geo/competition-scope.yaml (o doméstico vem do país da competição). */
export const INTERNATIONAL_SCOPES = ['continental_clubs', 'national_teams', 'world_clubs'] as const;
export type InternationalScope = (typeof INTERNATIONAL_SCOPES)[number];

/** Código reservado às competições globais: todos os países participam. */
export const GLOBAL_CONFEDERATION = 'FIFA';

/** Código de país da api-sports: ISO2 ou extensão (GB-ENG). */
const CountryCode = z
  .string()
  .regex(/^[A-Z]{2}(-[A-Z]{3})?$/, 'código de país (ISO2 ou extensão como GB-ENG)');
const ConfederationCode = z.string().regex(/^[A-Z]{3,8}$/, 'código de confederação em maiúsculas');
const Slug = z.string().regex(/^[a-z0-9-]+$/, 'slug em minúsculas');

/** Texto i18n: `en` obrigatório; pt-BR e es são as traduções esperadas. */
export const I18nName = z
  .object({ en: z.string().min(1) })
  .catchall(z.string().min(1))
  .refine((v) => Object.keys(v).every((k) => /^[a-z]{2}(-[A-Z]{2})?$/.test(k)), 'chave de locale inválida');
export type I18nName = z.infer<typeof I18nName>;

export const MemberCountry = z.strictObject({
  code: CountryCode,
  ioc: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  name: I18nName,
});

export const Confederation = z.strictObject({
  code: ConfederationCode,
  name: I18nName,
  members: z.array(MemberCountry).min(1),
});

export const NavigationSport = z.strictObject({ slug: Slug, name: I18nName });

export const GeoFile = z.strictObject({
  schema_version: z.literal(1),
  navigation: z.strictObject({
    countries: z.array(CountryCode).min(1),
    sports: z.array(NavigationSport).min(1),
  }),
  regions: z.record(z.string().regex(/^[A-Z-]+$/), ConfederationCode).default({}),
  confederations: z.array(Confederation).min(1),
});
export type GeoFile = z.output<typeof GeoFile>;

export const ScopeEntry = z
  .strictObject({
    slug: Slug,
    api_sports_id: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
    scope: z.enum(INTERNATIONAL_SCOPES),
    confederations: z.array(ConfederationCode).default([]),
    countries: z.array(CountryCode).default([]),
  })
  .refine((e) => e.confederations.length + e.countries.length > 0, {
    message: 'informe `confederations` e/ou `countries`',
  });
export type ScopeEntryInput = z.output<typeof ScopeEntry>;

export const ScopeFile = z.strictObject({
  schema_version: z.literal(1),
  sports: z.record(
    Slug,
    z.strictObject({
      competitions: z.array(ScopeEntry).default([]),
      excluded: z.array(Slug).default([]),
      /** Domésticas em destaque: vêm primeiro no grupo do país (dentro do mesmo tier), nesta ordem. */
      featured: z.array(Slug).default([]),
    }),
  ),
});
export type ScopeFile = z.output<typeof ScopeFile>;
