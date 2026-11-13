/**
 * Seção `webhooks` do OpenAPI gerada do registro de tópicos (#1023): um tópico novo em `webhook-topics.ts` aparece
 * na documentação sem mais nada. Cada entrada é o POST que a Galaxie faz na URL cadastrada pelo cliente.
 */
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { WEBHOOK_TOPICS, type WebhookTopicDef } from './webhook-topics.js';

const HEADERS =
  'Headers: `x-galaxie-event` (o tópico), `x-galaxie-delivery` (id da entrega, igual nas retentativas), ' +
  '`x-galaxie-attempt` e `x-galaxie-signature` (`t=<unix>,v1=<HMAC-SHA256 de "<t>.<corpo>">`, docs/05 §5.2). ' +
  'Responda 2xx em até 10 s; fora disso a entrega é refeita com espera exponencial e vai para a fila de falhas ' +
  'depois de 10 tentativas.';

function describe(def: WebhookTopicDef): string {
  const modules = def.modules.map((m) => `\`${m}\``).join(', ');
  const gate =
    def.modules.length > 1
      ? `Disponível com qualquer um destes módulos ligados: ${modules}.`
      : `Disponível com o módulo ${modules} ligado.`;
  const soon =
    def.status === 'planned' ? ' **Em breve:** documentado, ainda não é emitido nem pode ser assinado.' : '';
  return `${def.description} ${gate}${soon}\n\n${HEADERS}`;
}

export function webhookPaths(): ZodOpenApiPathsObject {
  return Object.fromEntries(
    WEBHOOK_TOPICS.map((def) => [
      def.topic,
      {
        post: {
          operationId: `webhook_${def.topic.replace(/\./g, '_')}`,
          summary: def.label.pt,
          description: describe(def),
          tags: ['Tempo real'],
          security: [],
          requestBody: { required: true, content: { 'application/json': { schema: def.payload } } },
          responses: { '200': { description: 'Recebido (qualquer 2xx serve).' } },
        },
      },
    ]),
  );
}
