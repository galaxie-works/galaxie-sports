import { parseArgs } from 'node:util';
import { API_PLANS, closeDb, createDb, type ApiModule, type ApiPlan } from '@galaxie/db';
import { loadPlans } from '../admin/plans.js';
import { KeyPolicyError, resolveTenantValues, trialEndsFor, upsertTenantWithKey } from '../admin/tenants.js';
import { isModule } from '../auth/admin.js';
import type { KeyEnv } from '../auth/keys.js';

const USAGE = `Uso: pnpm --filter @galaxie/api tenant:create --slug <slug> [opções]

Cria (ou atualiza) um tenant a partir do modelo do plano (config/plans.yaml; PLANS_CONFIG_PATH
sobrescreve) e gera uma chave de API nova. As opções abaixo ajustam o modelo.

  --slug          identificador do tenant (obrigatório)
  --name          nome exibido (padrão: o slug)
  --plan          ${API_PLANS.join(' | ')} (padrão: enterprise)
  --modules       lista separada por vírgula (padrão: módulos do plano)
  --markets       países ISO2 separados por vírgula (padrão: os do plano; vazio = todos)
  --sports        esportes separados por vírgula (padrão: os do plano; vazio = todos)
  --rate-limit    requisições por minuto, por rota (padrão: rateLimitPerMinute do plano)
  --daily-quota   cota diária de requisições (padrão: dailyRequestQuota do plano; "none" = sem cota)
  --label         rótulo da chave (ex.: demo-local)
  --scopes        restringe a chave a estes módulos (padrão: todos os do tenant)
  --env           live | test (prefixo da chave; padrão: test — chave de desenvolvimento)
`;

const csv = (v: string | undefined) =>
  v
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function modulesOrExit(list: string[] | undefined, flag: string): ApiModule[] | undefined {
  if (!list) return undefined;
  const bad = list.filter((m) => !isModule(m));
  if (bad.length) {
    console.error(`${flag}: módulo(s) desconhecido(s): ${bad.join(', ')}`);
    process.exit(1);
  }
  return list as ApiModule[];
}

const { values } = parseArgs({
  options: {
    slug: { type: 'string' },
    name: { type: 'string' },
    plan: { type: 'string', default: 'enterprise' },
    modules: { type: 'string' },
    markets: { type: 'string' },
    sports: { type: 'string' },
    'rate-limit': { type: 'string' },
    'daily-quota': { type: 'string' },
    label: { type: 'string' },
    scopes: { type: 'string' },
    env: { type: 'string', default: 'test' },
    help: { type: 'boolean', short: 'h' },
  },
  // `pnpm tenant:create -- --slug x` repassa o "--"; descartamos para não encerrar as opções
  args: process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--')),
  allowPositionals: true,
});

if (values.help || !values.slug) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 1);
}
if (!(API_PLANS as readonly string[]).includes(values.plan!)) {
  console.error(`--plan inválido: ${values.plan}. Use ${API_PLANS.join(', ')}.`);
  process.exit(1);
}
if (values.env !== 'live' && values.env !== 'test') {
  console.error('--env deve ser live ou test.');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida (veja .env.example).');
  process.exit(1);
}

function positiveIntOrExit(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`${flag} precisa ser um inteiro positivo.`);
    process.exit(1);
  }
  return n;
}

const modules = modulesOrExit(csv(values.modules), '--modules');
const scopes = modulesOrExit(csv(values.scopes), '--scopes');
const markets = csv(values.markets);
const sports = csv(values.sports);
const rateLimit = positiveIntOrExit(values['rate-limit'], '--rate-limit');
const dailyQuota =
  values['daily-quota'] === 'none' ? null : positiveIntOrExit(values['daily-quota'], '--daily-quota');
// modelo do plano (config/plans.yaml) + ajustes das flags — o mesmo cálculo do onboarding administrativo
const plans = loadPlans();
const resolved = resolveTenantValues(plans, {
  plan: values.plan as ApiPlan,
  ...(modules ? { modules } : {}),
  ...(markets ? { markets } : {}),
  ...(sports ? { sports } : {}),
  ...(rateLimit !== undefined ? { rateLimitPerMinute: rateLimit } : {}),
  ...(dailyQuota !== undefined ? { dailyRequestQuota: dailyQuota } : {}),
});
const db = createDb(url, { max: 1 });
try {
  // tenant e chave numa transação só, com o teto da emissão administrativa (5 válidas por ambiente):
  // no teto, o comando falha sem reescrever o tenant
  const { tenant: t, key } = await upsertTenantWithKey(
    db,
    {
      slug: values.slug,
      name: values.name ?? values.slug,
      ...resolved,
      // plano trial: prazo a partir de agora (rodar de novo reinicia o prazo, como reaplica o modelo)
      trialEndsAt: trialEndsFor(plans, resolved.plan),
    },
    {
      env: values.env as KeyEnv,
      ...(values.label ? { label: values.label } : {}),
      ...(scopes ? { scopes } : {}),
    },
    new Date(),
    'cli:tenant-create',
  ).catch((err: unknown) => {
    if (!(err instanceof KeyPolicyError)) throw err;
    console.error(`${err.message} Nada foi alterado no tenant.`);
    process.exit(1);
  });
  console.log(
    `Tenant ${values.slug} ${t.created ? 'criado' : 'atualizado'} (${t.id}) — plano ${resolved.plan}: ` +
      `${resolved.modules.join(', ')} · ${resolved.rateLimitPerMinute} req/min · ` +
      `cota diária ${resolved.dailyRequestQuota ?? 'sem limite'}.`,
  );
  console.log(`Chave ${key.prefix} criada. Guarde-a agora — ela não será exibida novamente:\n`);
  console.log(`  ${key.key}\n`);
  console.log(`Teste: curl -H "x-galaxie-key: ${key.key}" http://localhost:8080/v1/sports`);
} finally {
  await closeDb(db);
}
