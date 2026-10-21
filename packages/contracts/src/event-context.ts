import 'zod-openapi';
import * as z from 'zod';
import { LocaleQuery } from './common.js';

// ─── cenário pré-jogo e resumo pós-jogo de IA (docs/05 §3.2, docs/07 §2.3) ───────────────────────

export const EVENT_CONTEXT_KINDS = ['scenario', 'recap'] as const;
export type EventContextKindName = (typeof EVENT_CONTEXT_KINDS)[number];

export const EventContextQuery = LocaleQuery.extend({
  kind: z
    .enum(EVENT_CONTEXT_KINDS)
    .optional()
    .meta({ description: '`scenario` (pré-jogo) ou `recap` (pós-jogo). Padrão: os dois.' }),
});
export type EventContextQuery = z.input<typeof EventContextQuery>;

export const EventContextSource = z
  .object({
    kind: z.enum(['core', 'rules', 'knowledge', 'llm']).meta({
      description: 'core (dados normalizados), rules (regulamento), knowledge (base semântica), llm.',
    }),
    ref: z.string().meta({ example: 'core.event' }),
    url: z.string().nullable(),
  })
  .meta({ id: 'EventContextSource' });

export const EventContextText = z
  .object({
    kind: z.enum(EVENT_CONTEXT_KINDS),
    locale: z.string().meta({ example: 'pt-BR' }),
    text: z.string().meta({
      example:
        'O Palmeiras venceu a ida por 2 a 1 e se classifica com qualquer vitória ou empate. O Corinthians precisa vencer por dois gols de diferença para avançar direto.',
    }),
    sentences: z.array(z.string()),
    origin: z.enum(['llm', 'fallback']).meta({
      description:
        '`llm`: redigido pela IA a partir dos fatos e aprovado pelos guardrails (números, nomes, termos, tamanho); ' +
        '`fallback`: texto determinístico montado dos fatos (regulamento/timeline).',
    }),
    model: z.string().meta({ description: 'Modelo do LLM ou `template:*` no texto determinístico.' }),
    confidence: z.number().min(0).max(1).nullable(),
    review_status: z
      .enum(['auto', 'reviewed'])
      .meta({ description: '`auto` (publicado pelos guardrails) ou `reviewed` (conferido por pessoa).' }),
    generated_at: z.string().meta({ description: 'ISO 8601 no fuso pedido (`tz`).' }),
    fits: z
      .object({ tv: z.boolean(), mobile: z.boolean(), web: z.boolean() })
      .meta({ description: 'Superfícies em que o texto cabe (TV 320, mobile 600, web 1200 caracteres).' }),
    sources: z.array(EventContextSource),
  })
  .meta({ id: 'EventContextText' });
export type EventContextText = z.infer<typeof EventContextText>;

export const EventContext = z
  .object({
    event_id: z.uuid(),
    locale: z.string().meta({ example: 'pt-BR' }),
    data: z.array(EventContextText).meta({
      description:
        'Versão vigente de cada tipo no locale pedido (sem fallback entre locales). Vazio enquanto nada foi gerado.',
    }),
  })
  .meta({ id: 'EventContext', description: 'Cenário pré-jogo / resumo pós-jogo gerado por IA, com fontes.' });
export type EventContext = z.infer<typeof EventContext>;

/** Resumo do cenário/resumo no detalhe do evento (`GET /v1/events/{id}`), só com o módulo `live_intelligence`. */
export const EventContextBrief = z
  .object({
    text: z.string(),
    origin: z.enum(['llm', 'fallback']),
    generated_at: z.string(),
  })
  .meta({ id: 'EventContextBrief' });

export const EventContextSummary = z
  .object({
    scenario: EventContextBrief.nullable(),
    recap: EventContextBrief.nullable(),
  })
  .meta({
    id: 'EventContextSummary',
    description:
      'Texto vigente no locale da resposta. Presente só no detalhe e para tenants com `live_intelligence`; ' +
      'fontes e metadados em `GET /v1/events/{id}/context`.',
  });
export type EventContextSummary = z.infer<typeof EventContextSummary>;
