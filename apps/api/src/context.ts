import type { MediaDenylist } from '@galaxie/apisports-client';
import type { ApiModule, Database } from '@galaxie/db';
import type { TenantContext } from './auth/authenticator.js';
import type { ResponseCache } from './cache/store.js';
import type { RulesRegistry } from './events/rules-registry.js';
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
  /** Regulamentos (config/rules) para stakes e contexto competitivo. */
  rules: RulesRegistry;
  /** Lista de bloqueio de mídia (config/assets/denylist.yaml) aplicada na reescrita do espelho. */
  mediaDenylist: MediaDenylist | undefined;
  /** Relógio (testes). */
  now: () => Date;
}

export function requireDb(ctx: AppContext): Database {
  if (!ctx.db) throw problems.degraded('Banco de dados não configurado.');
  return ctx.db;
}
