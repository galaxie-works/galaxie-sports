import { eq } from 'drizzle-orm';
import { apiKey, tenant, type ApiModule, type ApiPlan, type Database } from '@galaxie/db';

export interface TenantRecord {
  id: string;
  slug: string;
  plan: ApiPlan;
  modules: ApiModule[];
  markets: string[];
  sports: string[];
  rateLimitPerMinute: number;
  status: 'active' | 'suspended';
  /** Cota diária de produção; null/ausente = sem cota. */
  dailyRequestQuota?: number | null;
  /** Fim do trial; depois dele nenhuma chave do tenant autentica. */
  trialEndsAt?: Date | null;
}

export interface KeyRecord {
  keyId: string;
  secretHash: string;
  /** Ambiente gravado: o prefixo da chave enviada precisa bater com ele. */
  env: 'live' | 'test';
  /** 1 = legado (sem checksum), 2 = com checksum (ver keys.ts). */
  keyFormat: number;
  scopes: ApiModule[] | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  tenant: TenantRecord;
}

/** Fonte das chaves e tenants (Postgres em produção; memória nos testes unitários). */
export interface TenantStore {
  findKeyByPrefix(prefix: string): Promise<KeyRecord | undefined>;
  /** Marca uso da chave (best effort). */
  touchKey(keyId: string, at: Date): Promise<void>;
}

export class PgTenantStore implements TenantStore {
  constructor(private readonly db: Database) {}

  async findKeyByPrefix(prefix: string): Promise<KeyRecord | undefined> {
    const [row] = await this.db
      .select({ key: apiKey, tenant })
      .from(apiKey)
      .innerJoin(tenant, eq(tenant.id, apiKey.tenantId))
      .where(eq(apiKey.prefix, prefix))
      .limit(1);
    if (!row) return undefined;
    return {
      keyId: row.key.id,
      secretHash: row.key.secretHash,
      env: row.key.env,
      keyFormat: row.key.keyFormat,
      scopes: row.key.scopes,
      expiresAt: row.key.expiresAt,
      revokedAt: row.key.revokedAt,
      tenant: {
        id: row.tenant.id,
        slug: row.tenant.slug,
        plan: row.tenant.plan,
        modules: row.tenant.modules,
        markets: row.tenant.markets,
        sports: row.tenant.sports,
        rateLimitPerMinute: row.tenant.rateLimitPerMinute,
        status: row.tenant.status,
        dailyRequestQuota: row.tenant.dailyRequestQuota,
        trialEndsAt: row.tenant.trialEndsAt,
      },
    };
  }

  async touchKey(keyId: string, at: Date): Promise<void> {
    await this.db.update(apiKey).set({ lastUsedAt: at }).where(eq(apiKey.id, keyId));
  }
}

export class InMemoryTenantStore implements TenantStore {
  readonly keys = new Map<string, KeyRecord>();
  readonly touched: string[] = [];

  add(prefix: string, record: KeyRecord): void {
    this.keys.set(prefix, record);
  }

  async findKeyByPrefix(prefix: string): Promise<KeyRecord | undefined> {
    return this.keys.get(prefix);
  }

  async touchKey(keyId: string): Promise<void> {
    this.touched.push(keyId);
  }
}
