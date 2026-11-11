import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  lastJournalEntry,
  mergeOrder,
  migrationIssues,
  parseStatusComments,
  prMigrations,
  render,
  stackInfo,
  summarizeCi,
} from './lib.mjs';

const run = (name, conclusion, startedAt, status = 'COMPLETED') => ({
  __typename: 'CheckRun', name, status, conclusion, startedAt, detailsUrl: `https://ci/${name}`,
});

test('CI: o job rodado de novo vale pela execução mais recente', () => {
  const ci = summarizeCi([
    run('checks', 'FAILURE', '2026-11-11T10:00:00Z'),
    run('checks', null, '2026-11-11T12:00:00Z', 'IN_PROGRESS'),
    run('build', 'SUCCESS', '2026-11-11T10:00:00Z'),
  ]);
  assert.equal(ci.state, 'pendente');
  assert.deepEqual(ci.pending, ['checks']);
  assert.equal(ci.fail.length, 0);
});

test('CI: falha, pulado e status antigo', () => {
  const ci = summarizeCi([
    run('a', 'FAILURE', '1'),
    run('b', 'SKIPPED', '1'),
    { __typename: 'StatusContext', context: 'ext', state: 'SUCCESS' },
  ]);
  assert.equal(ci.state, 'falhou');
  assert.deepEqual(ci.fail, [{ name: 'a', url: 'https://ci/a' }]);
  assert.equal(ci.pass, 1);
  assert.equal(summarizeCi([]).state, 'sem CI');
  assert.equal(summarizeCi([run('a', 'SUCCESS', '1')]).state, 'verde');
});

test('migrations do diff e última da main', () => {
  const files = [
    { path: 'packages/db/drizzle/0083_ficha_por_pais.sql' },
    { path: 'packages/db/drizzle/meta/0083_snapshot.json' },
    { path: 'packages/db/src/schema/fan.ts' },
  ];
  assert.deepEqual(prMigrations(files), [{ num: 83, tag: '0083_ficha_por_pais' }]);
  const j = { entries: [{ idx: 79, tag: '0081_x' }, { idx: 78, tag: '0080_y' }] };
  assert.equal(lastJournalEntry(j).tag, '0081_x');
  assert.equal(lastJournalEntry(null), null);
});

test('numeração: repetida entre PRs e já usada na main', () => {
  const issues = migrationIssues(
    [
      { number: 1092, migrations: [{ num: 84 }] },
      { number: 1090, migrations: [{ num: 84 }] },
      { number: 1070, migrations: [{ num: 81 }] },
      { number: 1061, migrations: [{ num: 82 }] },
    ],
    81,
  );
  assert.deepEqual(issues.map((i) => i.text), [
    '0081 (#1070) já existe na main (última: 0081); renumerar',
    '0084 reservada em mais de um PR: #1090, #1092',
  ]);
  assert.deepEqual(issues[1].prs, [1090, 1092]);
});

test('comentário de status: o mais recente com as chaves, em vários formatos', () => {
  const s = parseStatusComments([
    { body: 'Revisão: antiga', createdAt: '2026-11-10T00:00:00Z' },
    { body: 'You have reached your Codex usage limits for code reviews.', createdAt: '2026-11-11T00:00:00Z' },
    { body: '**Revisão:** subagente, sem apontamentos\n- **Próximo passo**: trazer a main\nCI: teste fora do diff', createdAt: '2026-11-11T01:00:00Z' },
  ]);
  assert.equal(s.codexNoQuota, true);
  assert.deepEqual(s.fields, { 'Revisão': 'subagente, sem apontamentos', 'Próximo passo': 'trazer a main', CI: 'teste fora do diff' });
  assert.deepEqual(parseStatusComments([]).fields, {});
});

const pr = (number, base, head, mig = []) => ({
  number, baseRefName: base, headRefName: head, migrations: mig.map((num) => ({ num, tag: `${num}` })),
});

test('pilhas e ordem de merge', () => {
  const prs = [pr(3, 'b', 'c'), pr(2, 'a', 'b', [90]), pr(1, 'main', 'a', [89]), pr(5, 'main', 'x', [82]), pr(4, 'main', 'y')];
  const st = stackInfo(prs);
  assert.deepEqual(st.get(1), { parent: null, parentBranch: null, children: [2], stacked: true });
  assert.deepEqual(st.get(3), { parent: 2, parentBranch: null, children: [], stacked: true });
  assert.equal(st.get(5).stacked, false);
  assert.deepEqual(mergeOrder(prs, st).map((p) => p.number), [5, 1, 2, 3, 4]);
});

test('pilha cuja raiz não tem migration ordena pela menor migration da pilha', () => {
  const prs = [pr(1, 'main', 'a'), pr(2, 'a', 'b', [82]), pr(3, 'main', 'c', [83])];
  assert.deepEqual(mergeOrder(prs, stackInfo(prs)).map((p) => p.number), [1, 2, 3]);
});

test('pilha com pai ou filho fora do filtro continua pilha', () => {
  const all = [pr(1, 'main', 'a'), pr(2, 'a', 'b')];
  const st = stackInfo(all);
  assert.equal(st.get(1).stacked, true);
  assert.deepEqual(mergeOrder([all[1]], st).map((p) => p.number), [2]);
  const orphan = stackInfo([pr(9, 'feat-x', 'y')]).get(9);
  assert.deepEqual(orphan, { parent: null, parentBranch: 'feat-x', children: [], stacked: true });
  const base = { title: 't', isDraft: false, mergeable: 'MERGEABLE', ci: summarizeCi([]), status: { fields: {} } };
  const txt = render({ title: 'x', prs: [{ ...all[0], ...base }], stacks: st, generatedAt: 'g', issues: [] });
  assert.match(txt, /pilha, base de #2; entra com merge commit/);
});

test('migration repetida dentro do mesmo PR', () => {
  const issues = migrationIssues([{ number: 5, migrations: [{ num: 82 }, { num: 82 }] }], 81);
  assert.deepEqual(issues.map((i) => i.text), ['0082 aparece mais de uma vez no #5']);
});

test('comentário comum com "CI:" não apaga o status', () => {
  const s = parseStatusComments([
    { body: 'Revisão: ok', createdAt: '1' },
    { body: 'ci: o gate foi corrigido', createdAt: '2' },
    { body: 'CI: rodando de novo', createdAt: '3' },
  ]);
  assert.deepEqual(s.fields, { 'Revisão': 'ok' });
});

test('texto final', () => {
  const p = {
    ...pr(1061, 'main', 'eng/b3', [82]),
    title: 'identidade do torcedor', isDraft: true, mergeable: 'CONFLICTING', headRefOid: 'ed93fa1a55',
    labels: [{ name: 'quebra-de-contrato' }],
    ci: summarizeCi([run('checks', null, '2', 'IN_PROGRESS'), run('build', 'SUCCESS', '1')]),
    status: { fields: { 'Revisão': 'subagente' }, codexNoQuota: true },
  };
  p.migrations = [{ num: 82, tag: '0082_identidade_torcedor' }];
  const txt = render({ title: 'Frente', prs: [p], merged: [{ number: 1057 }], mainLast: 81, generatedAt: 'agora', issues: [] });
  assert.match(txt, /Já na main: #1057\./);
  assert.match(txt, /1\. #1061, identidade do torcedor/);
  assert.match(txt, /rascunho; base main, independente; entra com squash; em conflito com a base\./);
  assert.match(txt, /CI: pendente: "checks" em ed93fa1a \(1 verdes\)\./);
  assert.match(txt, /Migrations: 0082_identidade_torcedor\./);
  assert.match(txt, /Revisão: subagente/);
  assert.match(txt, /sem número repetido/);
});
