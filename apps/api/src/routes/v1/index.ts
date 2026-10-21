import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { catalogRoutes } from './catalog.js';
import { whereToWatchRoutes } from './where-to-watch.js';
import { contextRoutes } from './context.js';
import { eventRoutes } from './events.js';
import { teamRoutes } from './teams.js';
import { copyRoutes } from './copy.js';
import { multisportRoutes } from './multisport.js';
import { semanticRoutes } from './semantic.js';
import { navigationRoutes } from './navigation.js';

/**
 * Rotas /v1. Cada grupo é um módulo próprio:
 * - catálogo e contexto da competição (#30);
 * - eventos `/v1/events` (#31) e times/pessoas `/v1/teams`, `/v1/people` (#32);
 * - SSE/webhooks `/v1/stream` (#35) — próximos.
 */
export async function v1Routes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await catalogRoutes(app, ctx);
  await whereToWatchRoutes(app, ctx);
  await contextRoutes(app, ctx);
  await eventRoutes(app, ctx);
  await teamRoutes(app, ctx);
  // semântica (#45, #43) e multiesporte (#75, #78) — módulos `semantic` e `multisport`
  await semanticRoutes(app, ctx);
  await copyRoutes(app, ctx);
  await multisportRoutes(app, ctx);
  // navegação por país e menu de esportes — módulo core_data
  await navigationRoutes(app, ctx);
}
