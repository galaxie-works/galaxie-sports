/**
 * Leva as edições aprovadas fora do YAML (semantic.review_override, gravadas pelo agente de revisão de
 * sugestões) para os arquivos de data/knowledge, para virar PR. Depois do merge e do deploy, o seed
 * vê o YAML já com o valor novo e a edição fica "absorvida" (sem efeito; a aprovação continua valendo,
 * porque o conteúdo é o mesmo).
 *   pnpm --filter @galaxie/knowledge review:export            # prévia: mostra o que mudaria
 *   pnpm --filter @galaxie/knowledge review:export --gravar   # grava nos YAML
 * Opções: --dir <pasta> (outra data/knowledge), --item <id> (só um item; repetível).
 * As edições vêm do banco de DATABASE_URL. Para trazer as da produção sem abrir o banco dela:
 *   (na VPS)  docker compose exec -T agents node node_modules/@galaxie/knowledge/dist/cli/export-overrides.js --json > edicoes.json
 *   (no repo) pnpm --filter @galaxie/knowledge review:export --arquivo edicoes.json --gravar
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { DEFAULT_KNOWLEDGE_DIR, loadKnowledge, parseKnowledgeFile, buildKnowledgeBase } from '../load.js';
import { exportOverridesToYaml, type ReviewOverrideRef } from '../overrides.js';
import { readReviewOverrides } from '../seed.js';
import { formatReport, validateKnowledge } from '../validate.js';

const { values } = parseArgs({
  options: {
    gravar: { type: 'boolean', default: false },
    dir: { type: 'string' },
    item: { type: 'string', multiple: true },
    json: { type: 'boolean', default: false },
    arquivo: { type: 'string' },
  },
  strict: true,
});
const dir = values.dir ? resolve(process.env.INIT_CWD ?? '.', values.dir) : DEFAULT_KNOWLEDGE_DIR;

async function fromDb(): Promise<ReviewOverrideRef[]> {
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (.env) ou use --arquivo.');
  const db = createDb(process.env.DATABASE_URL, { max: 1 });
  try {
    return await readReviewOverrides(db);
  } finally {
    await closeDb(db);
  }
}

const all: ReviewOverrideRef[] = values.arquivo
  ? (JSON.parse(
      await readFile(resolve(process.env.INIT_CWD ?? '.', values.arquivo), 'utf8'),
    ) as ReviewOverrideRef[])
  : await fromDb();
if (values.json) {
  process.stdout.write(`${JSON.stringify(all, null, 2)}\n`);
} else {
  const kb = await loadKnowledge(dir);
  const wanted = values.item?.length ? new Set(values.item) : null;
  const overrides = wanted ? all.filter((o) => wanted.has(o.itemId)) : all;
  const result = exportOverridesToYaml(kb, overrides);

  console.log(
    `${overrides.length} edição(ões) no banco: ${result.exported.length} a exportar, ` +
      `${result.skipped.length} sem efeito no YAML atual.`,
  );
  for (const s of result.skipped)
    console.log(
      `  - ${s.itemId}: ${
        s.status === 'absorbed'
          ? 'o YAML já tem o valor novo'
          : s.status === 'conflict'
            ? 'conflito: o YAML mudou o mesmo campo depois (vale o YAML)'
            : 'item fora do YAML'
      }`,
    );
  for (const id of result.exported) console.log(`  + ${id}`);

  // a base com os arquivos novos tem de continuar válida
  const files = kb.files.map((f) =>
    result.files.has(f.rel) ? parseKnowledgeFile(f.path, f.rel, result.files.get(f.rel)!) : f,
  );
  const report = await validateKnowledge(buildKnowledgeBase(dir, files));
  if (report.errors.length) {
    console.error(formatReport({ ...report, warnings: [] }));
    console.error('Exportação cancelada: a base ficaria com erros.');
    process.exitCode = 1;
  } else if (!values.gravar) {
    for (const rel of result.files.keys()) console.log(`  arquivo: data/knowledge/${rel}`);
    console.log('PRÉVIA: nada gravado (use --gravar).');
  } else {
    for (const [rel, text] of result.files) await writeFile(join(dir, rel), text, 'utf8');
    console.log(
      `Gravado em ${result.files.size} arquivo(s). Rode pnpm knowledge:validate e abra o PR; ` +
        'depois do deploy, o seed mostra as edições como "já no YAML".',
    );
  }
}
