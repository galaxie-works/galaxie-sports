import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { applyKeyMigration, planKeyMigration } from '../admin/key-migration.js';

const USAGE = `Uso: pnpm --filter @galaxie/api keys:migrate [--plan | --apply] [--test-prefixes <p1,p2>]

Troca as chaves secretas legadas (formato sem checksum) por chaves novas, com o mesmo tenant, rótulo,
escopos e validade. Passo a passo: docs/runbooks/migracao-de-chaves.md.

  --plan            (padrão) só lista o que seria feito; não muda nada
  --apply           revoga cada chave legada válida e emite a substituta (exibida uma única vez)
  --test-prefixes   prefixos (12 hex) das chaves legadas que eram de teste: a nova sai gs_test_
                    (o banco marcou todas as antigas como live — item C18)
`;

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    'test-prefixes': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
  args: process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--')),
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (values.plan && values.apply) {
  console.error('Use --plan ou --apply, não os dois.');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL não definida (veja .env.example).');
  process.exit(1);
}
const testPrefixes = (values['test-prefixes'] ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const badPrefix = testPrefixes.find((p) => !/^[0-9a-f]{12}$/.test(p));
if (badPrefix) {
  console.error(`Prefixo inválido em --test-prefixes: ${badPrefix} (12 caracteres hex).`);
  process.exit(1);
}

const db = createDb(url, { max: 1 });
try {
  const plan = await planKeyMigration(db, { testPrefixes });
  const unknownTest = testPrefixes.filter((p) => !plan.some((k) => k.prefix === p));
  if (unknownTest.length)
    console.warn(`Aviso: sem chave legada válida para os prefixos ${unknownTest.join(', ')}.`);
  if (!plan.length) {
    console.log('Nenhuma chave legada válida: nada a migrar.');
  } else if (!values.apply) {
    console.log(`${plan.length} chave(s) legada(s) válida(s) seriam revogadas e reemitidas:\n`);
    for (const k of plan)
      console.log(
        `  ${k.tenant}  ${k.prefix}  rótulo=${k.label ?? '-'}  gravada=${k.storedEnv}  nova=${k.newEnv}  ` +
          `último uso=${k.lastUsedAt?.toISOString() ?? 'nunca'}`,
      );
    console.log('\nNada foi alterado (--plan). Rode com --apply para migrar.');
  } else {
    const done = await applyKeyMigration(db, { testPrefixes });
    console.log(`${done.length} chave(s) migrada(s). Guarde as novas agora — não serão exibidas de novo:\n`);
    for (const k of done)
      console.log(
        `  ${k.tenant}  ${k.prefix} → ${k.newPrefix}  (${k.newEnv}, rótulo=${k.label ?? '-'})\n    ${k.newKey}`,
      );
    console.log(
      '\nAs antigas valem até 60 s (cache do autenticador). Troque GALAXIE_DEMO_KEY se a demo estiver na lista.',
    );
  }
} finally {
  await closeDb(db);
}
