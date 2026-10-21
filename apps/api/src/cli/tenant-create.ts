import { parseArgs } from 'node:util';
import { API_PLANS, closeDb, createDb, type ApiModule, type ApiPlan } from '@galaxie/db';
import { createApiKey, isModule, upsertTenant } from '../auth/admin.js';

const USAGE = `Uso: pnpm --filter @galaxie/api tenant:create --slug <slug> [opções]

Cria (ou atualiza) um tenant e gera uma chave de API nova.

  --slug         identificador do tenant (obrigatório)
  --name         nome exibido (padrão: o slug)
  --plan         ${API_PLANS.join(' | ')} (padrão: enterprise)
  --modules      lista separada por vírgula (padrão: módulos do plano)
  --markets      países ISO2 separados por vírgula (padrão: todos)
  --sports       esportes separados por vírgula (padrão: todos)
  --rate-limit   requisições por minuto, por rota (padrão: 120)
  --label        rótulo da chave (ex.: demo-local)
  --scopes       restringe a chave a estes módulos (padrão: todos os do tenant)
  --env          live | test (prefixo da chave; padrão: test)
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

const modules = modulesOrExit(csv(values.modules), '--modules');
const scopes = modulesOrExit(csv(values.scopes), '--scopes');
const markets = csv(values.markets);
const sports = csv(values.sports);
const db = createDb(url, { max: 1 });
try {
  const t = await upsertTenant(db, {
    slug: values.slug,
    name: values.name ?? values.slug,
    plan: values.plan as ApiPlan,
    ...(modules ? { modules } : {}),
    ...(markets ? { markets } : {}),
    ...(sports ? { sports } : {}),
    ...(values['rate-limit'] ? { rateLimitPerMinute: Number(values['rate-limit']) } : {}),
  });
  const key = await createApiKey(db, t.id, {
    env: values.env,
    ...(values.label ? { label: values.label } : {}),
    ...(scopes ? { scopes } : {}),
  });
  console.log(`Tenant ${values.slug} ${t.created ? 'criado' : 'atualizado'} (${t.id}).`);
  console.log(`Chave ${key.prefix} criada. Guarde-a agora — ela não será exibida novamente:\n`);
  console.log(`  ${key.key}\n`);
  console.log(`Teste: curl -H "x-galaxie-key: ${key.key}" http://localhost:8080/v1/sports`);
} finally {
  await closeDb(db);
}
