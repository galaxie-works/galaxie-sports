import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { catalogRoutes } from './catalog.js';
import { whereToWatchRoutes } from './where-to-watch.js';

/**
 * Rotas /v1. Cada grupo é um módulo próprio:
 * - catálogo (#30) — implementado;
 * - eventos `/v1/events` (#31) e times `/v1/teams` (#32) — próximos;
 * - SSE/webhooks `/v1/stream` (#35) — próximos.
 */
export async function v1Routes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await catalogRoutes(app, ctx);
  await whereToWatchRoutes(app, ctx);
}
