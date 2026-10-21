import Fastify, { type FastifyInstance } from 'fastify';
import { pingDb, type Database } from '@galaxie/db';

export interface ServerOptions {
  db?: Database;
  logger?: boolean;
}

/** Monta a API sem iniciar o listener — usado pelo main.ts e pelos testes (inject). */
export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get('/health', async () => ({ status: 'ok', service: 'galaxie-sports-api' }));

  app.get('/health/db', async (_req, reply) => {
    if (!options.db)
      return reply.code(503).send({ status: 'unavailable', reason: 'database not configured' });
    await pingDb(options.db);
    return { status: 'ok' };
  });

  return app;
}
