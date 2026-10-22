import 'zod-openapi';
import * as z from 'zod';
import { COMPETITION_CONTEXTS } from './events.js';
import { AssetUrl, LocaleQuery } from './common.js';
import { MOMENTUM_VALUES } from './events.js';

/*
 * Contratos da camada semântica (docs/06 §5, issues #43 e #45): clássicos, cartão de identidade do time,
 * rivais, glossário por mercado e copy contextual.
 */

/** Status editorial da base semântica (data/knowledge/SCHEMA.md). */
export const REVIEW_STATUSES = ['draft', 'reviewed', 'approved'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Filtro de status editorial mínimo (o servidor nunca aceita menos que o seu piso configurado). */
export const ReviewQuery = LocaleQuery.extend({
  min_review_status: z
    .enum(REVIEW_STATUSES)
    .optional()
    .meta({
      description:
        'Status editorial mínimo aceito (draft < reviewed < approved). Só pode endurecer o piso do servidor ' +
        '(`SEMANTIC_MIN_REVIEW_STATUS`, padrão approved); nunca afrouxar.',
      example: 'approved',
    }),
});
export type ReviewQuery = z.input<typeof ReviewQuery>;

const ReviewStatusField = z
  .enum(REVIEW_STATUSES)
  .meta({ description: 'Status editorial do item (draft, reviewed, approved).' });

const TeamKey = z
  .string()
  .min(1)
  .max(120)
  .meta({ description: 'UUID do participante (core) ou slug do perfil semântico.', example: 'palmeiras' });

// ─── referências ─────────────────────────────────────────────────────────────────────────────────

export const SemanticTeamRef = z
  .object({
    slug: z.string().meta({ example: 'palmeiras' }),
    participant_id: z
      .uuid()
      .nullable()
      .meta({ description: 'core.participant.id quando o perfil já foi ligado a um time do provedor.' }),
    name: z.string().meta({ description: 'Nome localizado (ou o curto).', example: 'Palmeiras' }),
    country: z.string().meta({ example: 'BR' }),
    kind: z.enum(['club', 'national_team']),
  })
  .meta({ id: 'SemanticTeamRef' });
export type SemanticTeamRef = z.infer<typeof SemanticTeamRef>;

export const DerbyRef = z
  .object({
    slug: z.string().meta({ example: 'choque-rei' }),
    name: z.string().meta({ example: 'Choque-Rei' }),
    intensity: z.number().int().min(1).max(5),
  })
  .meta({ id: 'DerbyRef' });

// ─── clássicos ───────────────────────────────────────────────────────────────────────────────────

export const DERBY_SCOPES = ['city', 'state', 'national', 'continental', 'international'] as const;

export const DerbySummary = z
  .object({
    slug: z.string().meta({ example: 'choque-rei' }),
    name: z.string().meta({ description: 'Nome localizado.', example: 'Choque-Rei' }),
    aliases: z.array(z.string()).meta({ example: ['San-Pal'] }),
    scope: z.enum(DERBY_SCOPES),
    intensity: z.number().int().min(1).max(5).meta({ description: '1–5 (5 = maior rivalidade do país).' }),
    teams: z.array(SemanticTeamRef).length(2),
    review_status: ReviewStatusField,
  })
  .meta({ id: 'DerbySummary' });
export type DerbySummary = z.infer<typeof DerbySummary>;

export const DerbiesQuery = ReviewQuery.extend({
  country: z
    .string()
    .max(20)
    .transform((v) => v.toUpperCase())
    .optional()
    .meta({ description: 'País de um dos times (ISO2; Inglaterra = GB-ENG).', example: 'BR' }),
  team: TeamKey.optional(),
});
export type DerbiesQuery = z.input<typeof DerbiesQuery>;

export const DerbySideScore = z.object({
  slug: z.string(),
  participant_id: z.uuid(),
  name: z.string(),
  score: z.number().int(),
});

export const DerbyMatch = z
  .object({
    event_id: z.uuid(),
    starts_at: z.string().meta({ description: 'ISO 8601 no fuso pedido (`tz`).' }),
    competition: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }).nullable(),
    home: DerbySideScore,
    away: DerbySideScore,
    winner: z.string().nullable().meta({ description: 'Slug do vencedor; null = empate.' }),
    penalties: z
      .object({ home: z.number().int(), away: z.number().int() })
      .nullable()
      .meta({ description: 'Disputa de pênaltis (não muda o resultado no retrospecto).' }),
  })
  .meta({ id: 'DerbyMatch' });
export type DerbyMatch = z.infer<typeof DerbyMatch>;

export const DerbyRetrospect = z
  .object({
    available: z
      .boolean()
      .meta({ description: 'false quando os dois times ainda não estão ligados a participantes do core.' }),
    source: z.literal('core').meta({ description: 'Calculado dos eventos encerrados em core.event.' }),
    matches: z.number().int(),
    draws: z.number().int(),
    teams: z.array(
      z.object({
        slug: z.string(),
        wins: z.number().int(),
        goals: z.number().int(),
      }),
    ),
    biggest_wins: z
      .array(DerbyMatch)
      .meta({ description: 'Até 3 maiores goleadas (maior saldo; desempate: mais gols, mais recente).' }),
    last_5: z
      .array(DerbyMatch)
      .meta({ description: 'Últimos 5 confrontos, do mais recente ao mais antigo.' }),
    first_match_at: z.string().nullable(),
    last_match_at: z.string().nullable(),
  })
  .meta({ id: 'DerbyRetrospect' });
export type DerbyRetrospect = z.infer<typeof DerbyRetrospect>;

export const DerbyUpcomingEvent = z
  .object({
    event_id: z.uuid(),
    starts_at: z.string(),
    status: z.string(),
    competition: z.object({ id: z.uuid(), slug: z.string(), name: z.string() }).nullable(),
    participants: z.array(
      z.object({ side: z.string(), id: z.uuid(), name: z.string(), slug: z.string().nullable() }),
    ),
  })
  .meta({ id: 'DerbyUpcomingEvent' });

/** Locale dos textos livres servidos (docs/06 §3.3). */
const TextLocaleField = z.string().meta({
  description:
    'Locale de onde vieram os textos livres (identity, mascote, torcida, cores; origin e trivia no clássico): o pedido, o idioma (es-AR → es) ou o original da base quando ainda não há tradução publicada para o mercado.',
  example: 'es',
});

export const Derby = DerbySummary.extend({
  labels: z.record(z.string(), z.string()).meta({ description: 'Nome por mercado.' }),
  first_match: z.iso.date().nullable(),
  origin: z.string().nullable(),
  trivia: z.array(z.string()),
  text_locale: TextLocaleField,
  sources: z.array(z.string()),
  next_event: DerbyUpcomingEvent.nullable(),
  retrospect: DerbyRetrospect,
}).meta({ id: 'Derby' });
export type Derby = z.infer<typeof Derby>;

export const DerbyParams = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug inválido')
    .max(80)
    .meta({ example: 'choque-rei' }),
});

export const UpcomingDerbiesQuery = ReviewQuery.extend({
  days: z.coerce.number().int().min(1).max(30).default(7).meta({ description: 'Janela em dias (1–30).' }),
  country: DerbiesQuery.shape.country,
});
export type UpcomingDerbiesQuery = z.input<typeof UpcomingDerbiesQuery>;

export const UpcomingDerby = DerbyUpcomingEvent.extend({ derby: DerbySummary }).meta({
  id: 'UpcomingDerby',
});
export type UpcomingDerby = z.infer<typeof UpcomingDerby>;

// ─── times ───────────────────────────────────────────────────────────────────────────────────────

/** Times na camada semântica aceitam UUID do participante ou slug do perfil. */
export const SemanticTeamParams = z.object({ id: TeamKey });

export const TeamRival = z
  .object({
    team: SemanticTeamRef,
    derby: DerbyRef.nullable(),
    intensity: z.number().int().min(1).max(5).nullable(),
    mutual: z.boolean().meta({ description: 'Os dois times se listam como rivais.' }),
  })
  .meta({ id: 'TeamRival' });
export type TeamRival = z.infer<typeof TeamRival>;

export const TeamSemantic = z
  .object({
    slug: z.string().meta({ example: 'palmeiras' }),
    participant_id: z.uuid().nullable(),
    kind: z.enum(['club', 'national_team']),
    country: z.string().meta({ example: 'BR' }),
    name: z.string().meta({ description: 'Nome localizado.', example: 'Palmeiras' }),
    official_name: z.string(),
    short_name: z.string(),
    abbreviation: z.string().nullable(),
    logo: AssetUrl,
    city: z.string().nullable(),
    region: z.string().nullable(),
    founded: z.string().nullable(),
    colors: z.array(z.string()),
    nicknames: z
      .array(z.string())
      .meta({ description: 'Apelidos preferidos no mercado primeiro.', example: ['Verdão'] }),
    mascot: z.string().nullable(),
    fans: z.object({ demonym: z.string().nullable(), group_nicknames: z.array(z.string()) }),
    rallying_cries: z.array(z.string()).meta({ example: ['Avanti, Palestra!'] }),
    stadium: z
      .object({
        name: z.string(),
        nicknames: z.array(z.string()),
        former_names: z
          .array(z.object({ name: z.string(), until: z.iso.date() }))
          .meta({ example: [{ name: 'Allianz Parque', until: '2026-05-03' }] }),
        city: z.string().nullable(),
      })
      .nullable(),
    rivals: z.array(TeamRival),
    identity: z.array(z.string()),
    text_locale: TextLocaleField,
    copy_hints: z
      .object({
        locale: z.string().nullable().meta({ description: 'Locale de onde vieram as dicas (com fallback).' }),
        cheer: z.array(z.string()),
        nicknames: z.array(z.string()),
      })
      .meta({ description: 'Sugestões de microcopy para o mercado pedido (tom torcedor, sem ofensa).' }),
    world_cup_titles: z.number().int().nullable(),
    sources: z.array(z.string()),
    review_status: ReviewStatusField,
  })
  .meta({ id: 'TeamSemantic' });
export type TeamSemantic = z.infer<typeof TeamSemantic>;

export const TeamRivals = z
  .object({ team: SemanticTeamRef, data: z.array(TeamRival) })
  .meta({ id: 'TeamRivals' });
export type TeamRivals = z.infer<typeof TeamRivals>;

// ─── glossário ───────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY_CATEGORIES = ['support', 'rivalry', 'fans', 'match', 'competition'] as const;
export const COPY_INTENTS = ['inform', 'anticipate', 'cheer', 'rivalry', 'urgency', 'decisive'] as const;

export const GlossaryQuery = ReviewQuery.extend({
  category: z.enum(GLOSSARY_CATEGORIES).optional(),
});
export type GlossaryQuery = z.input<typeof GlossaryQuery>;

export const GlossaryTerm = z
  .object({
    key: z.string().meta({ example: 'secar' }),
    term: z.string().meta({ example: 'secar' }),
    meaning: z.string(),
    example: z.string().nullable(),
    category: z.enum(GLOSSARY_CATEGORIES),
    copy_intents: z.array(z.enum(COPY_INTENTS)),
    requires: z
      .enum(['declared_rival', 'declared_affinity'])
      .nullable()
      .meta({ description: 'Restrição do copy_permission (docs/06 §4.2).' }),
    note: z.string().nullable(),
    sources: z.array(z.string()),
    review_status: ReviewStatusField,
  })
  .meta({ id: 'GlossaryTerm' });
export type GlossaryTerm = z.infer<typeof GlossaryTerm>;

export const Glossary = z
  .object({
    locale: z.string().meta({ description: 'Locale pedido.', example: 'es-AR' }),
    source_locale: z
      .string()
      .nullable()
      .meta({ description: 'Locale de onde vieram os termos (difere do pedido quando houve fallback).' }),
    data: z.array(GlossaryTerm),
  })
  .meta({ id: 'Glossary' });
export type Glossary = z.infer<typeof Glossary>;

// ─── copy contextual ─────────────────────────────────────────────────────────────────────────────

export const AFFINITY_TYPES = ['heart', 'support', 'sympathy', 'rival', 'interest'] as const;
export const AFFINITY_SOURCES = ['explicit', 'inferred'] as const;

export const CopyQuery = ReviewQuery.extend({
  sport: z.string().max(40).default('football').meta({ example: 'football' }),
  intent: z.enum(COPY_INTENTS).meta({ example: 'cheer' }),
  tone: z.coerce
    .number()
    .int()
    .min(1)
    .max(4)
    .default(2)
    .meta({ description: '1 informativo · 2 próximo · 3 torcedor · 4 alta energia (teto pedido).' }),
  affinity_type: z.enum(AFFINITY_TYPES).optional(),
  affinity_source: z
    .enum(AFFINITY_SOURCES)
    .optional()
    .meta({ description: 'explicit = declarada pelo usuário; inferred = deduzida (só copy informativa).' }),
  momentum: z.enum(MOMENTUM_VALUES).optional(),
  context: z.enum(COMPETITION_CONTEXTS).optional(),
  team: TeamKey.optional().meta({ description: 'Time citado (UUID ou slug): preenche {team} e {nickname}.' }),
  rival: TeamKey.optional().meta({ description: 'Rival citado (UUID ou slug): preenche {rival}.' }),
  minutes: z.coerce.number().int().min(0).max(10_000).optional().meta({ description: 'Preenche {minutes}.' }),
  variant: z
    .string()
    .max(80)
    .optional()
    .meta({ description: 'Semente opaca para variar entre templates equivalentes (nunca dado pessoal).' }),
});
export type CopyQuery = z.input<typeof CopyQuery>;

export const CopyPermission = z
  .object({
    allowed_intents: z.array(z.enum(COPY_INTENTS)),
    max_tone: z.number().int().min(1).max(4),
    rule: z.string().meta({ description: 'Regra aplicada (pt-BR).' }),
  })
  .meta({ id: 'CopyPermission' });

export const CopySuggestion = z
  .object({
    locale: z.string(),
    permission: CopyPermission,
    selection: z
      .object({
        key: z.string().meta({ example: 'pt-BR.cheer-3' }),
        template: z.string().meta({ example: 'Vai, {team}!' }),
        text: z
          .string()
          .nullable()
          .meta({ description: 'Texto pronto quando `team`/`rival`/`minutes` cobrem os placeholders.' }),
        intent: z.enum(COPY_INTENTS).meta({ description: 'Intenção usada (pode cair para inform).' }),
        tone: z.number().int().min(1).max(4).meta({ description: 'Tom do template escolhido.' }),
        max_tone: z.number().int().min(1).max(4),
        downgraded: z.boolean().meta({ description: 'Intenção ou tom rebaixados pelo copy_permission.' }),
        confidence: z.enum(['HIGH', 'MEDIUM', 'EXPERIMENTAL']),
        review_status: ReviewStatusField,
      })
      .nullable()
      .meta({ description: 'null quando nenhum template do mercado atende ao pedido.' }),
  })
  .meta({ id: 'CopySuggestion' });
export type CopySuggestion = z.infer<typeof CopySuggestion>;
