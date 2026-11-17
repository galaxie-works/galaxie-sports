/**
 * Teste por módulo pela loja (plataforma comercial F3, decisão 9 do brief; doc 01 §A loja de features; PL3). Uma
 * organização testa cada módulo uma vez: `billing.module_trial` é o registro (índice único por organização e módulo) e
 * os direitos do teste são `tenant_override` com `valid_until = ends_at` e `reason = 'module_trial'`: o `module_grant`
 * do módulo e um `tier` por faixa do módulo com o **mínimo** do catálogo. Tudo numa transação, com um advisory lock
 * por organização e módulo: duas ativações ao mesmo tempo não passam juntas (a segunda recebe `already_used`) e o
 * override nunca duplica. No fim, o override vence sozinho e o módulo sai dos direitos (o TTL do cache respeita
 * `valid_until`); nada a desfazer.
 *
 * Quem chama confere antes que a loja oferece o módulo (`storeView` → `available`, `canStartModuleTrial`) e que a conta
 * tem acesso (`stateHasAccess`): aqui só o que o banco garante (teste no catálogo, uma vez por organização).
 */
import { sql } from 'drizzle-orm';
import { publishChange } from '@galaxie/db/change-feed';
import { eq } from 'drizzle-orm';
import { moduleTrial, tenant, tenantOverride, type ApiModule } from '@galaxie/db/schema';
import type { Catalog } from '../catalog/catalog.js';
import { invalidateEntitlements } from '../entitlements/load.js';
import {
  assertInvalidationAllowed,
  type EntitlementsInvalidation,
  type TenantStateExecutor,
} from '../tenant-state/transition.js';

/** Tópico publicado no `ops.change_feed` quando um teste de módulo começa. */
export const MODULE_TRIAL_STARTED_TOPIC = 'tenant.module_trial_started';

/** `reason` dos `tenant_override` do teste: é como se distinguem dos acordos da equipe. */
export const MODULE_TRIAL_REASON = 'module_trial';

export type ModuleTrialErrorCode = 'unknown_module' | 'no_trial' | 'already_used' | 'wrong_organization';

export class ModuleTrialError extends Error {
  constructor(
    readonly code: ModuleTrialErrorCode,
    readonly module: string,
  ) {
    super(
      code === 'unknown_module'
        ? `Módulo desconhecido no catálogo: ${module}.`
        : code === 'no_trial'
          ? `O módulo ${module} não tem teste no catálogo.`
          : code === 'wrong_organization'
            ? `A marca não é da organização informada: o teste de ${module} não foi ligado.`
            : `O módulo ${module} já foi testado nesta organização.`,
    );
    this.name = 'ModuleTrialError';
  }
}

export interface StartModuleTrialInput {
  tenantId: string;
  /** Organização da marca: o "uma vez" vale para todas as marcas dela. */
  organizationId: string;
  module: ApiModule | string;
  /** `panel:<id do usuário>` ou `galaxie:<id do usuário>`. */
  actor: string;
  now?: Date;
  /**
   * Cache de direitos a invalidar depois do commit (a API tem o Valkey; a demo não: o TTL de 60 s cobre). Só com o
   * executor `Database`: com uma transação aberta a função lança (a invalidação rodaria antes do commit).
   */
  entitlements?: EntitlementsInvalidation | null;
}

export interface StartedModuleTrial {
  id: string;
  tenantId: string;
  organizationId: string;
  module: ApiModule;
  trialDays: number;
  startedAt: Date;
  endsAt: Date;
  /** Ids dos `tenant_override` gravados: o `module_grant` e um `tier` por faixa do módulo. */
  overrideIds: string[];
}

const DAY_MS = 86_400_000;

/**
 * Violação do índice único por organização e módulo (direto do driver ou embrulhada pelo Drizzle em `cause`). Quando o
 * driver traz `constraint_name` (o postgres-js traz), ela tem de ser a do índice. Premissa para quando não traz: dentro
 * da transação do teste, o único 23505 possível é o deste índice (a chave primária é UUID v7 gerada pelo banco e
 * `tenant_override` não tem índice único), por isso o código sozinho basta.
 */
function isUniqueModuleTrial(err: unknown): boolean {
  const own = err as {
    code?: string;
    constraint_name?: string;
    cause?: { code?: string; constraint_name?: string };
  };
  const e = own.code ? own : own.cause;
  if (e?.code !== '23505') return false;
  return e.constraint_name === undefined || e.constraint_name === 'module_trial_organization_module_uq';
}

/**
 * Liga o teste do módulo para a marca. Lança `ModuleTrialError` (`unknown_module`, `no_trial`, `wrong_organization`,
 * `already_used`) sem gravar nada.
 */
export async function startModuleTrial(
  db: TenantStateExecutor,
  catalog: Catalog,
  input: StartModuleTrialInput,
): Promise<StartedModuleTrial> {
  const def = catalog.modules[input.module as ApiModule];
  if (!def) throw new ModuleTrialError('unknown_module', input.module);
  if (def.trialDays === null) throw new ModuleTrialError('no_trial', input.module);
  assertInvalidationAllowed(db, input);
  const module = input.module as ApiModule;
  const trialDays = def.trialDays;
  const now = input.now ?? new Date();
  const endsAt = new Date(now.getTime() + trialDays * DAY_MS);

  let result: StartedModuleTrial;
  try {
    result = await db.transaction(async (tx) => {
      // uma ativação por vez para a mesma organização e módulo: a segunda espera o commit e cai no índice único
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`module-trial:${input.organizationId}:${module}`}))`,
      );
      // a marca tem de ser da organização informada: o "uma vez por organização" não pode ser contornado nem a prova
      // ficar na organização errada
      const [brand] = await tx
        .select({ organizationId: tenant.organizationId })
        .from(tenant)
        .where(eq(tenant.id, input.tenantId));
      if (!brand || brand.organizationId !== input.organizationId)
        throw new ModuleTrialError('wrong_organization', module);
      const [row] = await tx
        .insert(moduleTrial)
        .values({
          organizationId: input.organizationId,
          tenantId: input.tenantId,
          module,
          startedAt: now,
          endsAt,
          startedBy: input.actor,
          createdAt: now,
        })
        .returning({ id: moduleTrial.id });
      const overrides = await tx
        .insert(tenantOverride)
        .values([
          {
            tenantId: input.tenantId,
            kind: 'module_grant' as const,
            key: module,
            value: null,
            reason: MODULE_TRIAL_REASON,
            grantedBy: input.actor,
            validUntil: endsAt,
            createdAt: now,
          },
          // a faixa mínima de cada faixa do módulo (PL3): o teste é do módulo, não do tamanho
          ...Object.entries(def.tiers).map(([key, tier]) => ({
            tenantId: input.tenantId,
            kind: 'tier' as const,
            key,
            value: tier.min,
            reason: MODULE_TRIAL_REASON,
            grantedBy: input.actor,
            validUntil: endsAt,
            createdAt: now,
          })),
        ])
        .returning({ id: tenantOverride.id });
      await publishChange(tx, {
        topic: MODULE_TRIAL_STARTED_TOPIC,
        entityType: 'tenant',
        entityId: input.tenantId,
        payload: {
          tenant_id: input.tenantId,
          organization_id: input.organizationId,
          module,
          trial_days: trialDays,
          started_at: now.toISOString(),
          ends_at: endsAt.toISOString(),
          started_by: input.actor,
        },
      });
      return {
        id: row!.id,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        module,
        trialDays,
        startedAt: now,
        endsAt,
        overrideIds: overrides.map((o) => o.id),
      };
    });
  } catch (err) {
    if (isUniqueModuleTrial(err)) throw new ModuleTrialError('already_used', module);
    throw err;
  }
  if (input.entitlements)
    await invalidateEntitlements(input.entitlements.cache, input.entitlements.catalog, input.tenantId);
  return result;
}
