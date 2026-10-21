import 'zod-openapi';
import * as z from 'zod';

/** Esportes do espelho compatível (mesmos prefixos do fornecedor; docs/05 §2). */
export const MIRROR_SPORTS = [
  'football',
  'afl',
  'baseball',
  'basketball',
  'formula-1',
  'handball',
  'hockey',
  'mma',
  'nba',
  'american-football',
  'rugby',
  'volleyball',
] as const;
export type MirrorSport = (typeof MIRROR_SPORTS)[number];

/** Origem da resposta do espelho (header `x-galaxie-source`). */
export const MIRROR_SOURCES = ['raw-hit', 'rebuilt', 'stale', 'miss'] as const;
export type MirrorSource = (typeof MIRROR_SOURCES)[number];

/** Envelope idêntico ao da api-sports. */
export const MirrorEnvelope = z
  .object({
    get: z.string().meta({ example: 'fixtures' }),
    parameters: z.union([z.record(z.string(), z.string()), z.array(z.unknown())]),
    errors: z.union([z.array(z.unknown()), z.record(z.string(), z.string())]),
    results: z.number().int(),
    paging: z.object({ current: z.number().int(), total: z.number().int() }).optional(),
    response: z.unknown(),
  })
  .meta({ id: 'MirrorEnvelope', description: 'Mesmo envelope da api-sports.' });
export type MirrorEnvelope = z.infer<typeof MirrorEnvelope>;

export const MirrorParams = z.object({
  sport: z.enum(MIRROR_SPORTS),
  endpoint: z
    .string()
    .meta({ description: 'Endpoint do fornecedor sem a barra inicial.', example: 'fixtures' }),
});
