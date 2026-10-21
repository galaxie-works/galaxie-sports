import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { catalogRoutes } from './catalog.js';
import { copyRoutes } from './copy.js';
import { multisportRoutes } from './multisport.js';
import { semanticRoutes } from './semantic.js';

/**
 * Rotas /v1. Cada grupo é um módulo próprio:
 * - catálogo (#30) — implementado;
 * - eventos `/v1/events` (#31) e times `/v1/teams` (#32) — próximos;
 * - SSE/webhooks `/v1/stream` (#35) — próximos.
 */
export async function v1Routes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await catalogRoutes(app, ctx);
  // semântica (#45, #43) e multiesporte (#75, #78) — módulos `semantic` e `multisport`
  await semanticRoutes(app, ctx);
  await copyRoutes(app, ctx);
  await multisportRoutes(app, ctx);
}
