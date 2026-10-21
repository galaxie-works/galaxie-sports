import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Database } from '@galaxie/db';
import type { KnowledgeBase } from '@galaxie/knowledge';
import type { LlmClient } from '../llm/types.js';
import { applyProposals, type AppliedChanges } from './apply.js';
import { findKnowledgeGaps, type GapOptions, type KnowledgeGap } from './gaps.js';
import { proposeNewTeam, proposeStadiumUpdate, resolveIdNote, type CuratorProposal } from './propose.js';

/**
 * Agente Curador Semântico (issue #59): lacunas do core → pesquisa (LLM) → propostas YAML `draft`
 * com fontes → validação do CI em memória → saída. Padrão **dry-run**: grava proposals.json,
 * report.md (corpo do PR) e changes.diff num diretório de saída; `openPr` aplica num branch novo,
 * faz commit, push e abre o PR com `gh` (revisão humana obrigatória antes do merge).
 */

export interface CuratorRunOptions extends GapOptions {
  llm: LlmClient | null;
  /** Máximo de lacunas pesquisadas por execução (custo; padrão 10). */
  limit?: number;
}

export interface CuratorRunResult {
  gaps: KnowledgeGap[];
  proposals: CuratorProposal[];
  changes: AppliedChanges;
  report: string;
}

export async function runCurator(
  db: Database,
  kb: KnowledgeBase,
  opts: CuratorRunOptions,
): Promise<CuratorRunResult> {
  const gaps = await findKnowledgeGaps(db, kb, opts);
  const proposals: CuratorProposal[] = [];
  let researched = 0;
  const limit = opts.limit ?? 10;
  for (const gap of gaps) {
    if (gap.kind === 'unresolved_id') {
      proposals.push(resolveIdNote(gap));
      continue;
    }
    if (!opts.llm || researched >= limit) continue;
    researched++;
    proposals.push(
      gap.kind === 'missing_team'
        ? await proposeNewTeam(gap, kb, opts.llm)
        : await proposeStadiumUpdate(gap, opts.llm),
    );
  }
  const changes = await applyProposals(kb, proposals);
  const skipped = gaps.filter((g) => g.kind !== 'unresolved_id').length - researched;
  return {
    gaps,
    proposals,
    changes,
    report: curatorReport(gaps, proposals, changes, { skipped, llm: !!opts.llm }),
  };
}

function describeGap(g: KnowledgeGap): string {
  switch (g.kind) {
    case 'missing_team':
      return `clube ausente: ${g.name} (${g.countryCode ?? '?'}) — ${g.competitions.join(', ')}`;
    case 'unresolved_id':
      return `sem ID do provedor: ${g.slug} (${g.file})`;
    case 'venue_mismatch':
      return `estádio divergente: ${g.slug} — base "${g.yamlStadium}", provedor "${g.providerVenue}"`;
  }
}

function describeProposal(p: CuratorProposal): string {
  const head =
    p.kind === 'add_team'
      ? `novo clube \`${p.entry?.slug ?? p.gap.name}\` em \`${p.file}\``
      : p.kind === 'update_stadium'
        ? `estádio de \`${p.gap.slug}\`: "${p.gap.yamlStadium}" → "${p.currentName ?? '?'}"`
        : `\`${p.gap.slug}\` sem team_id`;
  const sources =
    p.kind === 'add_team' ? (p.entry?.sources ?? []) : p.kind === 'update_stadium' ? p.sources : [];
  const lines = [`- **${p.status}** — ${head}`];
  for (const r of p.reasons) lines.push(`  - ${r}`);
  for (const s of sources) lines.push(`  - fonte: ${s}`);
  return lines.join('\n');
}

/** Relatório em Markdown (também é o corpo do PR). */
export function curatorReport(
  gaps: readonly KnowledgeGap[],
  proposals: readonly CuratorProposal[],
  changes: AppliedChanges,
  info: { skipped: number; llm: boolean },
): string {
  const count = (s: string) => proposals.filter((p) => p.status === s).length;
  return [
    '## Propostas do Agente Curador Semântico',
    '',
    'Entradas novas ou alteradas entram com `review_status: draft` e fontes. **Revisão editorial obrigatória**',
    'antes do merge (docs/06 §2). Entradas `approved` nunca são alteradas pelo agente: viram nota abaixo.',
    '',
    `Lacunas detectadas: ${gaps.length} · aceitas: ${count('accepted')} · reprovadas: ${count('rejected')} · para revisão: ${count('needs_review')}` +
      (info.skipped > 0 ? ` · não pesquisadas nesta execução: ${info.skipped}` : '') +
      (info.llm ? '' : ' · (sem LLM: só detecção de lacunas)'),
    '',
    '### Lacunas',
    ...(gaps.length ? gaps.map((g) => `- ${describeGap(g)}`) : ['- nenhuma']),
    '',
    '### Propostas',
    ...(proposals.length ? proposals.map(describeProposal) : ['- nenhuma']),
    '',
    `### Arquivos alterados (${changes.files.size})`,
    ...[...changes.files.keys()].map((f) => `- \`data/knowledge/${f}\``),
    '',
    '_Gerado pelo Agente Curador Semântico (`pnpm --filter @galaxie/ai-agents curator:run`)._',
    '',
  ].join('\n');
}

/** Saída dry-run: proposals.json, report.md, changes.diff e os YAML propostos em files/. */
export async function writeDryRun(outDir: string, result: CuratorRunResult): Promise<string[]> {
  const written: string[] = [];
  const put = async (rel: string, content: string) => {
    const path = join(outDir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    written.push(path);
  };
  await put(
    'proposals.json',
    `${JSON.stringify({ gaps: result.gaps, proposals: result.proposals, validation: result.changes.validation }, null, 2)}\n`,
  );
  await put('report.md', result.report);
  await put('changes.diff', result.changes.diff);
  for (const [rel, content] of result.changes.files) await put(join('files', rel), content);
  return written;
}

export interface OpenPrOptions {
  /** Raiz do repositório (padrão: três níveis acima de data/knowledge). */
  repoRoot: string;
  knowledgeDir: string;
  base?: string;
  date?: Date;
}

const run = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * Abre o PR com as mudanças (opcional; exige árvore Git limpa, `git` e `gh` autenticado).
 * Cria `curator/<data>`, grava os YAML, commita, faz push e roda `gh pr create`.
 */
export async function openCuratorPr(result: CuratorRunResult, opts: OpenPrOptions): Promise<string> {
  if (!result.changes.files.size) throw new Error('Nenhuma mudança aceita: nada para abrir PR.');
  const root = resolve(opts.repoRoot);
  if (run('git', ['status', '--porcelain'], root))
    throw new Error('Árvore Git com mudanças pendentes; abortei.');
  const stamp = (opts.date ?? new Date()).toISOString().slice(0, 10);
  const branch = `curator/${stamp}-${Date.now().toString(36)}`;
  run('git', ['switch', '-c', branch], root);
  const paths: string[] = [];
  for (const [rel, content] of result.changes.files) {
    const path = join(opts.knowledgeDir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    paths.push(path);
  }
  run('git', ['add', ...paths], root);
  run('git', ['commit', '-m', `chore(knowledge): propostas do curador semântico (${stamp}, draft)`], root);
  run('git', ['push', '-u', 'origin', branch], root);
  const tmp = await mkdtemp(join(tmpdir(), 'galaxie-curator-'));
  const bodyFile = join(tmp, 'pr-body.md');
  await writeFile(bodyFile, result.report, 'utf8');
  try {
    return run(
      'gh',
      [
        'pr',
        'create',
        '--base',
        opts.base ?? 'main',
        '--head',
        branch,
        '--title',
        `Curador semântico: propostas ${stamp} (draft)`,
        '--body-file',
        bodyFile,
      ],
      root,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
