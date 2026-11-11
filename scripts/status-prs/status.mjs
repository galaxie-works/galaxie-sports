#!/usr/bin/env node
/**
 * Status dos PRs abertos, montado a partir do GitHub (sem LLM, só o gh): `pnpm status:prs`.
 *
 *   pnpm status:prs                       # todos os PRs abertos
 *   pnpm status:prs --epico 1017          # PRs que citam #1017 no título ou no corpo, e os já mergeados
 *   pnpm status:prs --pr 1061,1062        # só esses PRs
 *   pnpm status:prs --epico 1017 --json   # o mesmo em JSON
 *
 * Para cada PR: rascunho ou não, pilha ou independente (e como entra: merge commit ou squash), conflito, CI (o job
 * rodado de novo conta pela execução mais recente), migrations do diff, rótulos e o comentário padrão de status
 * (CONTRIBUTING, regra 12: linhas "Revisão:", "Próximo passo:", "CI:", "Observação:"). No fim, a numeração das
 * migrations: número repetido entre PRs abertos ou já usado na main (lida do GitHub, não do checkout local).
 *
 * Quem monta o lote de merge roda isto na hora; as sessões das frentes só deixam o comentário de status no PR.
 */
import { execFileSync } from 'node:child_process';
import { lastJournalEntry, migrationIssues, parseStatusComments, prMigrations, render, summarizeCi } from './lib.mjs';

const FIELDS = [
  'number', 'title', 'url', 'isDraft', 'baseRefName', 'headRefName', 'headRefOid', 'mergeable',
  'labels', 'files', 'body', 'statusCheckRollup', 'comments',
].join(',');

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseArgs(argv) {
  const opts = { epico: null, prs: null, json: false, limit: 100 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? '';
    const val = a.includes('=') ? a.slice(a.indexOf('=') + 1) : null;
    if (a.startsWith('--epico')) opts.epico = Number((val ?? next()).replace('#', ''));
    else if (a.startsWith('--pr')) opts.prs = (val ?? next()).split(',').map((s) => Number(s.trim().replace('#', ''))).filter(Boolean);
    else if (a.startsWith('--limit')) opts.limit = Number(val ?? next());
    else if (a === '--json') opts.json = true;
    else if (a === '-h' || a === '--help') {
      console.log('uso: pnpm status:prs [--epico N] [--pr N,M] [--json] [--limit 100]');
      process.exit(0);
    } else {
      console.error(`opção desconhecida: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

const cites = (n) => (p) => new RegExp(`#${n}(?!\\d)`).test(`${p.title}\n${p.body ?? ''}`);

function mainJournal() {
  try {
    const raw = gh(['api', '-H', 'Accept: application/vnd.github.raw+json',
      'repos/{owner}/{repo}/contents/packages/db/drizzle/meta/_journal.json?ref=main']);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const open = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', String(opts.limit), '--json', FIELDS]));
  const all = open.map((p) => ({
    ...p,
    migrations: prMigrations(p.files),
    ci: summarizeCi(p.statusCheckRollup),
    status: parseStatusComments(p.comments),
  }));

  let selected = all;
  let merged = [];
  let title = 'Status dos PRs abertos';
  if (opts.prs) {
    selected = all.filter((p) => opts.prs.includes(p.number));
    const missing = opts.prs.filter((n) => !selected.some((p) => p.number === n));
    title = `Status dos PRs ${opts.prs.map((n) => `#${n}`).join(', ')}`;
    if (missing.length) title += ` (não estão abertos: ${missing.map((n) => `#${n}`).join(', ')})`;
  } else if (opts.epico) {
    selected = all.filter(cites(opts.epico));
    const m = JSON.parse(gh(['pr', 'list', '--state', 'merged', '--limit', '100', '--search', String(opts.epico),
      '--json', 'number,title,body,mergedAt']));
    merged = m.filter(cites(opts.epico)).sort((a, b) => a.number - b.number);
    title = `Status da frente do épico #${opts.epico}`;
  }

  const last = lastJournalEntry(mainJournal());
  const mainLast = last ? Number(last.tag.slice(0, 4)) : null;
  const sel = new Set(selected.map((p) => p.number));
  const issues = migrationIssues(all, mainLast).filter((i) => i.prs.some((n) => sel.has(n)));
  const generatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  if (opts.json) {
    // Sem os campos brutos do gh (diff, corpo, comentários, rollup): o resumo deles já está em migrations, ci e status.
    const slim = selected.map(({ files: _f, body: _b, comments: _c, statusCheckRollup: _r, ...p }) => p);
    console.log(JSON.stringify({ title, generatedAt, mainLast: last?.tag ?? null, merged: merged.map((p) => p.number), prs: slim, issues }, null, 2));
    return;
  }
  console.log(render({ title, prs: selected, merged, mainLast, generatedAt, issues }));
}

try {
  main();
} catch (err) {
  const msg = err.stderr?.toString().trim() || err.message;
  console.error(`status:prs falhou: ${msg}`);
  process.exit(1);
}
