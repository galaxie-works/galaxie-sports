import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { catalogRoutes } from './catalog.js';
import { whereToWatchRoutes } from './where-to-watch.js';
import { contextRoutes } from './context.js';
import { eventContextRoutes } from './event-context.js';
import { eventRoutes } from './events.js';
import { teamRoutes } from './teams.js';
import { copyRoutes } from './copy.js';
import { multisportRoutes } from './multisport.js';
import { semanticRoutes } from './semantic.js';

/**
 * Rotas /v1. Cada grupo é um módulo próprio:
 * - catálogo e contexto da competição (#30);
 * - eventos `/v1/events` (#31), cenário/resumo de IA `/v1/events/{id}/context` (#57) e
 *   times/pessoas `/v1/teams`, `/v1/people` (#32);
 * - onde assistir, semântica e multiesporte (abaixo).
 * O tempo real (`GET /v1/stream`, SSE, #35) é registrado à parte por `registerRealtime` (src/realtime).
 */
export async function v1Routes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await catalogRoutes(app, ctx);
  await whereToWatchRoutes(app, ctx);
  await contextRoutes(app, ctx);
  await eventRoutes(app, ctx);
  await eventContextRoutes(app, ctx);
  await teamRoutes(app, ctx);
  // semântica (#45, #43) e multiesporte (#75, #78) — módulos `semantic` e `multisport`
  await semanticRoutes(app, ctx);
  await copyRoutes(app, ctx);
  await multisportRoutes(app, ctx);
}
