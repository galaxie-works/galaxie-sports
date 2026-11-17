/**
 * Seed mínimo da onda 0 (docs/qa/README.md, "Dados de teste"), gravado no banco descartável antes de a API e a demo
 * subirem:
 *
 * - a organização da própria Galaxie (cliente zero) com uma marca `enterprise` ativa: a chave dela é a
 *   `GALAXIE_DEMO_KEY` da demo, como em produção;
 * - a organização e a marca de referência do cliente (`marca-e2e`), no plano do cadastro (Fan Experience), em `trial`,
 *   com uma chave secreta `gs_test_…`;
 * - o cadastro em autoatendimento ligado em `ops.runtime_setting` (`SIGNUP_ENABLED=on`, `SIGNUP_TERMS_VERSION=e2e`),
 *   para as ondas seguintes; nunca no ambiente de produção.
 *
 * As pessoas (admin e cliente) não entram aqui: o schema `demo_auth` é criado pela demo na subida, que também cria o
 * primeiro admin (`DEMO_ADMIN_EMAIL`); o cliente é criado pelo admin no projeto `setup`, pela rota do produto.
 *
 * Mesmos caminhos do produto, pelos pacotes (o teste não importa `apps/*`): o catálogo e a máquina de estados de
 * `@galaxie/billing` (`recordTenantCreated` + `transitionTenantState`, como o provisionamento da demo faz) e a emissão de
 * chave de `@galaxie/db/api-keys`. O texto das chaves só existe no retorno: vai para o processo do Playwright por
 * variável de ambiente, nunca para arquivo nem para log.
 */
import {
  loadCatalog,
  recordCatalogVersion,
  recordTenantCreated,
  transitionTenantState,
  type Catalog,
} from '@galaxie/billing';
import { closeDb, createDb, organization, tenant, type ApiPlan, type Database } from '@galaxie/db';
import { createApiKey } from '@galaxie/db/api-keys';
import { recordKeyEvent } from '@galaxie/db/key-events';
import { writeRuntimeSetting } from '@galaxie/db/runtime-settings';

import { CLIENT_TENANT_SLUG } from './env.ts';

/** Quem grava (created_by, actor dos eventos). */
const ACTOR = 'cli:e2e-seed';

/** Prazo do trial da marca de referência. */
const TRIAL_DAYS = 14;

export interface SeedResult {
  /** Marca de referência do cliente. */
  clientTenantId: string;
  /** Chave secreta `gs_test_…` da marca de referência. */
  clientApiKey: string;
  /** Chave da marca da Galaxie, que a demo usa para chamar a API. */
  demoApiKey: string;
}

interface BrandInput {
  slug: string;
  name: string;
  isGalaxie: boolean;
  plan: ApiPlan;
  /** `trial` com prazo (como no cadastro) ou `active` (jornada assistida, contrato). */
  state: 'trial' | 'active';
}

/** Organização + marca (draft → estado final, com os eventos da máquina de estados) + uma chave `test`. */
async function createBrand(db: Database, catalog: Catalog, input: BrandInput, now: Date) {
  const plan = catalog.plans[input.plan];
  if (!plan) throw new Error(`Plano ${input.plan} fora do catálogo.`);
  const tenantId = await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organization)
      .values({
        slug: input.slug,
        name: input.name,
        country: 'BR',
        currency: 'brl',
        billingEntity: 'ltda',
        capacityTier: 'C1',
        reviewStatus: 'none',
        locale: 'pt-BR',
        isGalaxie: input.isGalaxie,
        createdBy: ACTOR,
      })
      .returning({ id: organization.id });
    const [row] = await tx
      .insert(tenant)
      .values({
        slug: input.slug,
        name: input.name,
        plan: input.plan,
        modules: [...plan.modules],
        markets: input.state === 'trial' ? ['BR'] : [],
        sports: [],
        rateLimitPerMinute: plan.rateLimitPerMinute,
        dailyRequestQuota: plan.dailyRequestQuota,
        trialEndsAt: input.state === 'trial' ? new Date(now.getTime() + TRIAL_DAYS * 86_400_000) : null,
        catalogVersion: catalog.version,
        organizationId: org!.id,
        // a máquina de estados (F3): nasce em draft e muda logo abaixo, na mesma transação
        state: 'draft',
        stateSince: now,
      })
      .returning({ id: tenant.id });
    const id = row!.id;
    await recordTenantCreated(tx, id, { cause: 'provision', actor: ACTOR, now });
    await transitionTenantState(tx, id, input.state, { cause: 'provision', actor: ACTOR, now });
    return id;
  });
  const key = await createApiKey(db, tenantId, { env: 'test', label: 'e2e' });
  await recordKeyEvent(db, {
    tenantId,
    keyKind: 'secret',
    keyId: key.id,
    prefix: key.prefix,
    action: 'issued',
    actor: ACTOR,
    detail: { env: 'test', label: 'e2e' },
  });
  return { tenantId, key: key.key };
}

export async function seed(url: string, now = new Date()): Promise<SeedResult> {
  const db = createDb(url, { profile: 'job', applicationName: 'galaxie-e2e-seed' });
  try {
    const catalog = loadCatalog();
    await recordCatalogVersion(db, catalog.version);
    const galaxie = await createBrand(
      db,
      catalog,
      { slug: 'galaxie-e2e', name: 'Galaxie (E2E)', isGalaxie: true, plan: 'enterprise', state: 'active' },
      now,
    );
    const client = await createBrand(
      db,
      catalog,
      {
        slug: CLIENT_TENANT_SLUG,
        name: 'Marca E2E',
        isGalaxie: false,
        plan: 'fan_experience',
        state: 'trial',
      },
      now,
    );
    await writeRuntimeSetting(db, { key: 'SIGNUP_ENABLED', value: 'on', valueType: 'enum', by: ACTOR });
    await writeRuntimeSetting(db, {
      key: 'SIGNUP_TERMS_VERSION',
      value: 'e2e',
      valueType: 'text',
      by: ACTOR,
    });
    return { clientTenantId: client.tenantId, clientApiKey: client.key, demoApiKey: galaxie.key };
  } finally {
    await closeDb(db);
  }
}
