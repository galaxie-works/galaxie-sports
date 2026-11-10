/**
 * Webhook do Stripe da Cosmos AI (#993, arquitetura 06):
 *
 *   POST /internal/cosmos/stripe/webhook
 *
 * Autenticado pela assinatura do Stripe (`Stripe-Signature`, segredo STRIPE_WEBHOOK_SECRET), não por chave
 * da Galaxie: é o Stripe que chama. O corpo chega cru (a assinatura é do texto exato), e o crédito só entra
 * com o pagamento confirmado, uma vez por evento (`cosmos.stripe_event`). Sem o segredo, responde 503 e o
 * Stripe tenta de novo depois.
 *
 * TODO(#1018): quando o módulo da Cosmos existir no plano, conferir aqui se o tenant da intenção o tem.
 */
import type { FastifyInstance } from 'fastify';
import { applyStripeEvent, parseStripeEvent, verifyStripeSignature } from '@galaxie/cosmos';
import type { Database } from '@galaxie/db';

export const COSMOS_STRIPE_WEBHOOK_PATH = '/internal/cosmos/stripe/webhook';

/** Eventos de checkout são pequenos; folga para metadados. */
const BODY_LIMIT = 256 * 1024;

export interface CosmosStripeOptions {
  db?: Database | undefined;
  /** Segredo do endpoint no Stripe (`whsec_…`); ausente = rota responde 503. */
  webhookSecret?: string | undefined;
  now?: (() => Date) | undefined;
}

export async function cosmosStripeRoutes(app: FastifyInstance, options: CosmosStripeOptions): Promise<void> {
  // só neste escopo: o JSON chega como texto, para a assinatura conferir o corpo exato
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: BODY_LIMIT },
    (_req, body, done) => done(null, body),
  );

  app.post(
    COSMOS_STRIPE_WEBHOOK_PATH,
    // assinatura do Stripe no lugar da chave (auditoria de rotas em security.test.ts)
    { config: { public: true, signed: 'stripe' }, bodyLimit: BODY_LIMIT },
    async (request, reply) => {
      const secret = options.webhookSecret?.trim();
      if (!secret || !options.db) return reply.code(503).send({ error: 'cosmos_stripe_unavailable' });
      const raw = typeof request.body === 'string' ? request.body : '';
      const header = request.headers['stripe-signature'];
      const now = options.now?.() ?? new Date();
      if (!verifyStripeSignature(raw, typeof header === 'string' ? header : undefined, secret, now))
        return reply.code(401).send({ error: 'invalid_signature' });
      const event = parseStripeEvent(raw);
      if (!event) return reply.code(400).send({ error: 'invalid_event' });
      const result = await applyStripeEvent(options.db, event, { now });
      request.log.info(
        {
          stripeEvent: event.id,
          type: event.type,
          outcome: result.outcome,
          purchaseIntent: result.purchaseIntentId,
        },
        'cosmos: evento do Stripe',
      );
      // 200 também para duplicado e ignorado: o Stripe só precisa saber que recebemos
      return reply.code(200).send({ received: true, outcome: result.outcome });
    },
  );
}
