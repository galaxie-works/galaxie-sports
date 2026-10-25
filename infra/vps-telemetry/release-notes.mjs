#!/usr/bin/env node
/**
 * Notas de versão do deploy: publica no GitHub uma release com a tag `deploy-AAAA-MM-DD.N` (data em Brasília) no
 * commit publicado, com os PRs que entraram desde a tag anterior, agrupados em novidades e correções e por área. O
 * texto é o título de cada PR (squash merge: o assunto do commit), sem edição à mão. Lógica pura em
 * release-notes-lib.mjs.
 *
 *   node infra/vps-telemetry/release-notes.mjs --to <sha>                        # chamado pelo deploy.sh
 *   node infra/vps-telemetry/release-notes.mjs --to <sha> --from <ref> --title "…"  # retroativa
 *   node infra/vps-telemetry/release-notes.mjs --to <sha> --dry                  # só imprime as notas
 *
 * - Tag e release saem juntas (`gh release create --target`, a tag nasce no GitHub): sem tag local, nem tag
 *   publicada sem release se a criação falhar. Tags e numeração vêm do GitHub (`git ls-remote`), não do clone;
 *   a tag anterior é a mais nova no histórico (first-parent) do commit publicado.
 * - Tags `deploy-*` ainda sem release (publicação que falhou no fluxo antigo) são concluídas antes, cada uma com os
 *   PRs dela e sem virar a "Latest"; senão as notas desses PRs se perderiam.
 * - Sem PR novo desde a última tag (redeploy do mesmo código), não cria tag nem release.
 * Requer o gh autenticado com permissão de escrita no repositório.
 */
import { execFileSync } from 'node:child_process';
import {
  deployDate,
  missingReleases,
  nextTag,
  orderByHistory,
  parseRemoteTags,
  parseSubject,
  renderSections,
  titleOf,
} from './release-notes-lib.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dry = args.includes('--dry');
const run = (cmd, a, input) =>
  execFileSync(cmd, a, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const git = (...a) => run('git', a);

const repo = run('gh', ['repo', 'view', '--json', 'url', '--jq', '.url']);

/** Publica (ou, com --dry, imprime) a release de `tag` com os PRs de from..to. */
const publish = ({ tag, title, from, fromLabel, to, existingTag, note }) => {
  const log = git('log', '--first-parent', '--format=%s', `${from}..${to}`).split('\n').filter(Boolean);
  const prs = log.map(parseSubject).filter(Boolean);
  if (!prs.length) {
    console.log(`release: nenhum PR entre ${fromLabel} e ${to.slice(0, 7)}; sem tag nem release`);
    return;
  }
  const body = [
    `Publicado na produção: \`${to.slice(0, 7)}\` · ${prs.length} PR(s) desde \`${fromLabel}\`.`,
    ...(note ? ['', note] : []),
    '',
    ...renderSections(prs, repo),
  ].join('\n');
  if (dry) {
    console.log(`${tag} — ${title}\n\n${body}\n`);
    return;
  }
  // tag nova: o GitHub cria a tag no commit junto com a release (as duas ou nenhuma). Tag antiga concluída agora
  // não vira a "Latest" do GitHub (seria a de data de criação mais nova)
  const target = existingTag ? ['--verify-tag', '--latest=false'] : ['--target', to];
  run('gh', ['release', 'create', tag, '--title', title, '--notes-file', '-', ...target], body);
  console.log(`release ${tag}: ${prs.length} PR(s) — ${repo}/releases/tag/${tag}`);
};

const to = git('rev-parse', opt('to') ?? 'origin/main');
const remoteTags = parseRemoteTags(git('ls-remote', '--tags', 'origin', 'refs/tags/deploy-*'));
// anterior = a tag mais nova no histórico do commit publicado (o nome não serve: as antigas têm data UTC)
const history = git('log', '--first-parent', '--format=%H', to).split('\n').filter(Boolean);
const tags = orderByHistory(remoteTags, history);

// tags publicadas sem release (no fluxo antigo, o `gh release create` falhava depois do push da tag): todas são
// concluídas, da mais velha à mais nova, antes da nova. Uma lista só de releases, não uma chamada por tag.
const [latest] = tags;
if (!opt('from')) {
  const released = run('gh', [
    'release',
    'list',
    '--limit',
    '1000',
    '--json',
    'tagName',
    '--jq',
    '.[].tagName',
  ])
    .split('\n')
    .filter(Boolean);
  for (const { tag: orphan, previous } of missingReleases(tags, released)) {
    console.log(`release: ${orphan.name} está sem release; concluindo`);
    publish({
      tag: orphan.name,
      title: titleOf(orphan),
      from: previous.sha,
      fromLabel: previous.name,
      to: orphan.sha,
      existingTag: true,
      note: '_Release concluída depois do deploy: a publicação original falhou._',
    });
  }
}

const fromRef = opt('from');
const from = fromRef ? git('rev-parse', fromRef) : latest?.sha;
if (!from) {
  console.error('release: nenhuma tag deploy-* ainda; passe --from <ref> na primeira vez');
  process.exit(1);
}
const fromLabel = fromRef ? (fromRef.startsWith('deploy-') ? fromRef : from.slice(0, 7)) : latest.name;

const today = deployDate();
const localTags = git('tag', '--list', 'deploy-*').split('\n').filter(Boolean);
const { tag: autoTag, n } = nextTag([...remoteTags.map((t) => t.name), ...localTags], today);
const tag = opt('tag') ?? autoTag;
publish({ tag, title: opt('title') ?? `Deploy ${today} nº ${n}`, from, fromLabel, to });
