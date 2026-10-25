/**
 * Carrega data/knowledge no Postgres (issue #39): semantic.team_profile, derby, derby_team,
 * competition_profile, copy_template e load_run (com o SHA do Git). Idempotente.
 * Também liga perfis a participantes/competições existentes e recalcula core.event.derby_id.
 *   pnpm db:seed:semantic
 *   pnpm db:seed:semantic --dir <pasta>
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { closeDb, createDb } from '@galaxie/db';
import { DEFAULT_KNOWLEDGE_DIR, loadKnowledge } from '../load.js';
import { seedSemantic } from '../seed.js';
import { formatReport, validateKnowledge } from '../validate.js';

function gitSha(): string | null {
  const fromEnv = process.env.GIT_SHA ?? process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

const args = process.argv.slice(2);
const dirArg = args.indexOf('--dir');
const dir =
  dirArg >= 0 && args[dirArg + 1]
    ? resolve(process.env.INIT_CWD ?? '.', args[dirArg + 1]!)
    : DEFAULT_KNOWLEDGE_DIR;
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');

const kb = await loadKnowledge(dir);
const report = await validateKnowledge(kb);
if (report.errors.length) {
  console.error(formatReport({ ...report, warnings: [] }));
  console.error('Seed cancelado: a base semântica tem erros (rode pnpm knowledge:validate).');
  process.exit(1);
}

const db = createDb(process.env.DATABASE_URL, { max: 2 });
try {
  const result = await seedSemantic(db, kb, { gitSha: gitSha() });
  const { teams, derbies, competitions, copyTemplates } = result;
  console.table({ teams, derbies, competitions, copyTemplates });
  console.log(
    `Ligados: ${result.linked.teams} perfil(is) a participantes, ${result.linked.competitions} competição(ões). ` +
      `Eventos com derby_id alterado: ${result.events.updated}. load_run ${result.loadRunId}.`,
  );
  console.log(
    `Estádios curados: ${result.venues.curated} linha(s) de core.venue (${result.venues.changed} alterada(s)).`,
  );
  for (const c of result.venues.conflicts) console.warn(`Estádio em conflito (ignorado): ${c}`);
  console.log(
    `Revisão: ${result.review.items} item(ns) no catálogo, ${result.review.decided} decisão(ões) do painel ` +
      `aplicada(s), ${result.review.stale} desatualizada(s) (o YAML mudou depois da decisão).`,
  );
  const o = result.review.overrides;
  if (o.applied + o.absorbed + o.conflicts + o.missing)
    console.log(
      `Edições do banco (review_override): ${o.applied} aplicada(s) por cima do YAML, ${o.absorbed} já no YAML, ` +
        `${o.conflicts} em conflito (vale o YAML), ${o.missing} de item(ns) fora do YAML` +
        (o.partial ? `; ${o.partial} aplicada(s) só em parte (campos em conflito ficaram com o YAML).` : '.'),
    );
} finally {
  await closeDb(db);
}
