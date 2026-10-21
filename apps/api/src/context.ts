import type { ApiModule, Database } from '@galaxie/db';
import type { TenantContext } from './auth/authenticator.js';
import type { ResponseCache } from './cache/store.js';
import { problems } from './errors.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Módulo exigido pela rota; rotas sem módulo são públicas (health, docs). */
    module?: ApiModule;
    /** Exige chave de tenant válida sem exigir módulo (ex.: /v1/account). */
    authenticated?: boolean;
    /** Rota administrativa (/internal/admin), protegida pelo AdminGuard. */
    admin?: boolean;
    /** Rota pública declarada explicitamente (auditoria de autenticação). */
    public?: boolean;
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
}

export function requireDb(ctx: AppContext): Database {
  if (!ctx.db) throw problems.degraded('Banco de dados não configurado.');
  return ctx.db;
}
