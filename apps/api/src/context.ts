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
  /** Camada semântica: piso editorial e pasta da base (glossário). */
  semantic?: SemanticConfig;
}

/** Status editoriais da base semântica, do menos ao mais revisado. */
export type ReviewStatus = 'draft' | 'reviewed' | 'approved';

export interface SemanticConfig {
  /**
   * Status editorial mínimo servido pela API (SEMANTIC_MIN_REVIEW_STATUS). Padrão `approved` (produção);
   * em desenvolvimento local use `draft` para ver a base inteira. O cliente pode endurecer, nunca afrouxar.
   */
  minReviewStatus?: ReviewStatus;
  /** Pasta data/knowledge (KNOWLEDGE_DIR); padrão: a do repositório. */
  knowledgeDir?: string;
}

export function requireDb(ctx: AppContext): Database {
  if (!ctx.db) throw problems.degraded('Banco de dados não configurado.');
  return ctx.db;
}
