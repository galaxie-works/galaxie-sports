/**
 * Confere a ordem das migrations no journal (ver journal.ts). Usado no CI:
 *   node packages/db/dist/journal-check-cli.js [--base <journal da base.json>]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { journalProblems, type Journal } from './journal.js';
import { migrationsFolder } from './migrate.js';

const read = (path: string): Journal => JSON.parse(readFileSync(path, 'utf8')) as Journal;

const args = process.argv.slice(2);
const i = args.indexOf('--base');
const basePath = i >= 0 ? args[i + 1] : undefined;
if (i >= 0 && !basePath) {
  console.error('uso: journal-check-cli.js [--base <arquivo>]');
  process.exit(2);
}

const head = read(join(migrationsFolder, 'meta', '_journal.json'));
const problems = journalProblems(head, basePath ? read(basePath) : undefined);
if (problems.length) {
  for (const p of problems) console.error(`journal de migrations: ${p}`);
  process.exit(1);
}
console.log(
  `journal de migrations em ordem: ${head.entries.length} migrations${basePath ? ', base preservada' : ''}.`,
);
