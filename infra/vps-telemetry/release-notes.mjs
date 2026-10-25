#!/usr/bin/env node
/**
 * Notas de versão do deploy: marca o commit publicado com a tag `deploy-AAAA-MM-DD.N` e publica uma release no
 * GitHub com os PRs que entraram desde a tag anterior, agrupados em novidades e correções e por área. O texto é
 * o título de cada PR (squash merge: o assunto do commit), sem edição à mão.
 *
 *   node infra/vps-telemetry/release-notes.mjs --to <sha>                        # chamado pelo deploy.sh
 *   node infra/vps-telemetry/release-notes.mjs --to <sha> --from <ref> --title "…"  # retroativa
 *   node infra/vps-telemetry/release-notes.mjs --to <sha> --dry                  # só imprime as notas
 *
 * Sem PR novo desde a última tag (redeploy do mesmo código), não cria tag nem release.
 * Requer git com acesso de push a origin e o gh autenticado.
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dry = args.includes('--dry');
const run = (cmd, a, input) =>
  execFileSync(cmd, a, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const git = (...a) => run('git', a);

const to = git('rev-parse', opt('to') ?? 'origin/main');
const tags = git('tag', '--list', 'deploy-*', '--sort=-creatordate').split('\n').filter(Boolean);
const from = opt('from') ?? tags[0];
if (!from) {
  console.error('release: nenhuma tag deploy-* ainda; passe --from <ref> na primeira vez');
  process.exit(1);
}

// PRs pelo assunto do squash merge: "tipo(área): título (#123)"
const log = git('log', '--first-parent', '--format=%s', `${from}..${to}`).split('\n').filter(Boolean);
const prs = log
  .map((subject) => {
    const m = subject.match(/^(\w+)(?:\(([^)]*)\))?!?:\s*(.+?)\s*\(#(\d+)\)$/);
    return m
      ? { type: m[1], scopes: (m[2] ?? '').split(',').map((s) => s.trim()), title: m[3], number: m[4] }
      : null;
  })
  .filter(Boolean);
if (!prs.length) {
  console.log(`release: nenhum PR entre ${from.slice(0, 12)} e ${to.slice(0, 7)}; sem tag nem release`);
  process.exit(0);
}

/** Área pela primeira área do PR que bate, nesta ordem (do mais específico ao mais geral). */
const AREAS = [
  ['Fórmula 1', ['f1', 'race', 'formula-1', 'pilotos']],
  ['Onde assistir e grades', ['wtw', 'onde-assistir', 'grade', 'lineups', 'canais', 'channel-list']],
  ['Vídeos relacionados', ['related', 'videos', 'vídeos']],
  ['IA e custos', ['ai', 'ia', 'agents', 'llm', 'stakes', 'context', 'titulos']],
  ['Painel e revisão', ['ajustes', 'revisao', 'review', 'painel', 'ops', 'operacao']],
  [
    'Dados e ingestão',
    [
      'ingestion',
      'ingestor',
      'scheduler',
      'assets',
      'nomes',
      'pessoas',
      'perfis',
      'sync',
      'geo',
      'quality',
      'qualidade',
    ],
  ],
  ['API', ['api', 'contracts', 'webhooks', 'widgets']],
  ['App e navegação', ['demo', 'explorar', 'nav', 'live']],
  ['Infra e qualidade', ['infra', 'ci', 'smoke', 'deps', 'docker', 'db', 'test', 'tests']],
];
const areaOf = (pr) => AREAS.find(([, keys]) => pr.scopes.some((s) => keys.includes(s)))?.[0] ?? 'Geral';
const KINDS = [
  ['Novidades', ['feat']],
  ['Correções', ['fix']],
  ['Bastidores', ['chore', 'docs', 'refactor', 'perf', 'test', 'ci', 'style', 'build']],
];

const repo = run('gh', ['repo', 'view', '--json', 'url', '--jq', '.url']);
const line = (pr) =>
  `- ${pr.title.charAt(0).toUpperCase()}${pr.title.slice(1)} ([#${pr.number}](${repo}/pull/${pr.number}))`;
const sections = [];
for (const [kind, types] of KINDS) {
  const list = prs.filter((p) => types.includes(p.type));
  if (!list.length) continue;
  sections.push(`## ${kind}`);
  const byArea = new Map();
  for (const p of list) byArea.set(areaOf(p), [...(byArea.get(areaOf(p)) ?? []), p]);
  const order = [...AREAS.map(([a]) => a), 'Geral'];
  for (const area of order.filter((a) => byArea.has(a))) {
    sections.push(`### ${area}`, ...byArea.get(area).map(line), '');
  }
}
const others = prs.filter((p) => !KINDS.some(([, types]) => types.includes(p.type)));
if (others.length) sections.push('## Outros', ...others.map(line), '');

const today = new Date().toISOString().slice(0, 10);
const n = tags.filter((t) => t.startsWith(`deploy-${today}.`)).length + 1;
const tag = opt('tag') ?? `deploy-${today}.${n}`;
const title = opt('title') ?? `Deploy ${today} nº ${n}`;
const body = [
  `Publicado na produção: \`${to.slice(0, 7)}\` · ${prs.length} PR(s) desde \`${from.startsWith('deploy-') ? from : from.slice(0, 7)}\`.`,
  '',
  ...sections,
].join('\n');

if (dry) {
  console.log(`${tag} — ${title}\n\n${body}`);
  process.exit(0);
}
git('tag', '-a', tag, to, '-m', title);
git('push', '-q', 'origin', tag);
run('gh', ['release', 'create', tag, '--title', title, '--notes-file', '-', '--verify-tag'], body);
console.log(`release ${tag}: ${prs.length} PR(s) — ${repo}/releases/tag/${tag}`);
