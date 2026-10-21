import type { ApiModule, Database } from '@galaxie/db';
import type { WtwConfig } from '@galaxie/where-to-watch';
import type { TenantContext } from './auth/authenticator.js';
import type { ResponseCache } from './cache/store.js';
import { problems } from './errors.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Módulo exigido pela rota; rotas sem módulo são públicas (health, docs). */
    module?: ApiModule;
  }
  interface FastifyRequest {
    tenant: TenantContext | null;
  }
}

/** Dependências compartilhadas pelas rotas. */
export interface AppContext {
  db: Database | undefined;
  cache: ResponseCache;
  /** ASSETS_PUBLIC_BASE_URL — base pública do nosso storage de assets. */
  assetsBaseUrl: string | undefined;
  /** ADMIN_API_KEY — habilita as rotas internas (/internal/...); sem ela, respondem 503. */
  adminKey?: string | undefined;
  /** Dicionários/política do onde assistir (carregados sob demanda de config/). */
  wtwConfig?: () => WtwConfig;
}

export function requireDb(ctx: AppContext): Database {
  if (!ctx.db) throw problems.degraded('Banco de dados não configurado.');
  return ctx.db;
}
