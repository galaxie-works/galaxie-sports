import 'zod-openapi';
import * as z from 'zod';
import { AssetUrl } from './common.js';

/*
 * Placeholders dos contratos de eventos e times (issues #31 e #32). Já entram nos componentes
 * do OpenAPI para o demo tipar as telas; as rotas chegam com as respectivas issues.
 */

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

const SideScore = z.object({ home: z.number().int().nullable(), away: z.number().int().nullable() });

export const TeamSummary = z
  .object({
    id: z.uuid(),
    sport: z.string(),
    kind: z.enum(['club', 'national_team', 'athlete', 'driver', 'constructor', 'fighter']),
    name: z.string(),
    short_name: z.string().nullable(),
    country: z.string().nullable().meta({ description: 'Código do país.' }),
    logo: AssetUrl,
  })
  .meta({ id: 'TeamSummary', description: 'Placeholder (#32).' });
export type TeamSummary = z.infer<typeof TeamSummary>;

export const EventParticipant = z
  .object({
    side: z.string().meta({ example: 'home' }),
    id: z.uuid(),
    name: z.string(),
    logo: AssetUrl,
  })
  .meta({ id: 'EventParticipant' });

export const Event = z
  .object({
    id: z.uuid(),
    sport: z.string(),
    competition: z
      .object({ id: z.uuid(), slug: z.string(), name: z.string(), nickname: z.string().nullable() })
      .nullable(),
    stage: z
      .object({ kind: z.string(), leg: z.number().int().nullable(), name: z.string().nullable() })
      .nullable(),
    starts_at: z.string().meta({ description: 'ISO 8601 no fuso pedido.' }),
    status: z.enum(EVENT_STATUSES),
    momentum: z.enum(MOMENTUM_VALUES).nullable(),
    participants: z.array(EventParticipant),
    score: SideScore.extend({ aggregate: SideScore.nullable().optional() }),
    venue: z.object({ name: z.string(), city: z.string().nullable() }).nullable(),
    derby: z.object({ slug: z.string(), name: z.string() }).nullable(),
    competition_context: z.array(z.string()),
    data_freshness: z.object({ last_valid_at: z.string().nullable(), is_stale: z.boolean() }),
  })
  .meta({ id: 'Event', description: 'Placeholder (#31): evento canônico de docs/05 §3.2.' });
export type Event = z.infer<typeof Event>;
