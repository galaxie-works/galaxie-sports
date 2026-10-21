import 'zod-openapi';
import * as z from 'zod';

// ─── tempo real: SSE e webhooks (docs/05 §5) ─────────────────────────────────────────────────────

/** Tópicos completos, como aparecem no campo `event:` do SSE e no header `x-galaxie-event` do webhook. */
export const CHANGE_TOPICS = [
  'event.status_changed',
  'event.score_changed',
  'event.incident_added',
  'where_to_watch.changed',
  'event.context_published',
] as const;
export type ChangeTopic = (typeof CHANGE_TOPICS)[number];

/** Nomes curtos aceitos em `?topics=` (o nome completo também é aceito). */
export const STREAM_TOPICS = {
  status: 'event.status_changed',
  score: 'event.score_changed',
  incidents: 'event.incident_added',
  where_to_watch: 'where_to_watch.changed',
  context: 'event.context_published',
} as const satisfies Record<string, ChangeTopic>;
export type StreamTopic = keyof typeof STREAM_TOPICS;

/** Resolve um nome curto ou completo de tópico; `undefined` se desconhecido. */
export function resolveTopic(name: string): ChangeTopic | undefined {
  const n = name.trim();
  if ((CHANGE_TOPICS as readonly string[]).includes(n)) return n as ChangeTopic;
  return (STREAM_TOPICS as Record<string, ChangeTopic>)[n];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lista separada por vírgula (também aceita o parâmetro repetido). */
const csv = (max: number, item: z.ZodType<string, string>, description: string) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v.join(',') : (v ?? ''))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(max))
    .meta({ description });

export const StreamQuery = z.object({
  events: csv(200, z.string().regex(UUID, 'id de evento inválido'), 'IDs de evento (até 200).'),
  competitions: csv(50, z.string().regex(UUID, 'id de competição inválido'), 'IDs de competição (até 50).'),
  sports: csv(20, z.string().min(1).max(40), 'Esportes (slug), ex.: `football,basketball`.'),
  topics: csv(
    10,
    z.string().refine((t) => resolveTopic(t) !== undefined, 'tópico desconhecido'),
    'Tópicos: `score,status,incidents,where_to_watch,context` (ou o nome completo). Padrão: todos os do plano.',
  ),
  last_event_id: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .meta({ description: 'Alternativa ao header `Last-Event-ID` para retomar a partir de uma mudança.' }),
  key: z
    .string()
    .max(200)
    .optional()
    .meta({
      description:
        'Chave da API para clientes `EventSource` (que não enviam headers). Prefira o header `x-galaxie-key`: ' +
        'a chave na URL pode ficar em históricos e logs de proxies (docs/05 §5.1).',
    }),
});
export type StreamQuery = z.infer<typeof StreamQuery>;

/**
 * Mudança entregue por SSE (`data:`) e webhooks (corpo). Compacta: o evento, o tópico, os campos que
 * mudaram e os novos valores — para o estado completo, consulte a rota REST correspondente.
 */
export const RealtimeChange = z
  .object({
    id: z
      .string()
      .meta({ description: 'ID da mudança (monotônico; usado no Last-Event-ID).', example: '1042' }),
    topic: z.enum(CHANGE_TOPICS),
    event_id: z.string().meta({ example: '0192c7e2-6c1f-7a33-9a51-5b3e0f7c2d10' }),
    sport: z.string().nullable().meta({ example: 'football' }),
    competition_id: z.string().nullable(),
    changed: z
      .array(z.string())
      .meta({ description: 'Campos alterados (ex.: `score`, `status`, `clock`, `incidents`).' }),
    data: z.record(z.string(), z.unknown()).meta({
      description:
        'Novos valores: `score`; `status`/`status_detail`/`clock`; `incidents` (lances novos); ' +
        '`countries` (onde assistir); `contexts` (locale/kind publicados).',
    }),
    previous: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({ description: 'Valores anteriores relevantes (ex.: `status`).' }),
    occurred_at: z.string().meta({ example: '2026-10-21T22:47:12.345Z' }),
  })
  .meta({ id: 'RealtimeChange' });
export type RealtimeChange = z.infer<typeof RealtimeChange>;
