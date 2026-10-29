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
  'event.related_content_changed',
] as const;
export type ChangeTopic = (typeof CHANGE_TOPICS)[number];

/** Nomes curtos aceitos em `?topics=` (o nome completo também é aceito). */
export const STREAM_TOPICS = {
  status: 'event.status_changed',
  score: 'event.score_changed',
  incidents: 'event.incident_added',
  where_to_watch: 'where_to_watch.changed',
  context: 'event.context_published',
  related: 'event.related_content_changed',
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
  token: z
    .string()
    .max(1000)
    .optional()
    .meta({
      description:
        'Token curto (5 min) para clientes `EventSource`, que não enviam headers: peça em ' +
        '`POST /v1/stream/token` no seu backend, com a chave no header, e abra o stream com `?token=`. ' +
        'Vale só para abrir este stream do seu tenant (docs/05 §5.1).',
    }),
  key: z
    .string()
    .max(200)
    .optional()
    .meta({
      param: { deprecated: true },
      description:
        '**Obsoleto** (aceito até 27/12/2026, com os headers `Deprecation` e `Sunset`): a chave secreta na URL ' +
        'fica em históricos, logs de proxies e referers. Use `?token=` (`POST /v1/stream/token`) ou o header ' +
        '`x-galaxie-key` (docs/05 §5.1).',
    }),
});
export type StreamQuery = z.infer<typeof StreamQuery>;

/** Resposta de `POST /v1/stream/token`: o token curto do SSE. */
export const StreamToken = z
  .object({
    data: z.object({
      token: z.string().meta({
        description: 'Abre o `/v1/stream` do tenant em `?token=`; não serve para outra rota.',
        example: 'gst_eyJ2IjoxLCJ0Ijoi….Zm9v',
      }),
      expires_at: z.iso
        .datetime()
        .meta({ description: 'Prazo para ABRIR o stream (o stream aberto continua).' }),
      expires_in: z.number().int().meta({ description: 'Segundos até expirar.', example: 300 }),
    }),
  })
  .meta({ id: 'StreamToken' });
export type StreamToken = z.infer<typeof StreamToken>;

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
