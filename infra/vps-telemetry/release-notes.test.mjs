// Testes da lógica das notas de versão: node --test infra/vps-telemetry/release-notes.test.mjs (sem git, gh nem rede).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
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

const REPO = 'https://github.com/exemplo/repo';

describe('parseSubject', () => {
  it('lê tipo, áreas, título e número do squash merge convencional', () => {
    assert.deepEqual(parseSubject('feat(api, demo): busca global (#120)'), {
      type: 'feat',
      scopes: ['api', 'demo'],
      title: 'busca global',
      number: '120',
    });
    assert.deepEqual(parseSubject('fix!: quebra o contrato (#7)'), {
      type: 'fix',
      scopes: [''],
      title: 'quebra o contrato',
      number: '7',
    });
  });

  it('assunto sem prefixo convencional, com o número do PR, vai para "outros"', () => {
    assert.deepEqual(parseSubject('Sobre o jogo: contexto e retrospecto (#274)'), {
      type: 'outros',
      scopes: [],
      title: 'Sobre o jogo: contexto e retrospecto',
      number: '274',
    });
  });

  it('commit sem número de PR no fim fica de fora', () => {
    assert.equal(parseSubject('feat(api): direto na main'), null);
    assert.equal(parseSubject('Merge pull request #12 from fork/branch'), null);
  });
});

describe('renderSections', () => {
  it('agrupa por tipo e área e manda o assunto não convencional para "Outros"', () => {
    const prs = [
      'feat(f1): grid de largada (#10)',
      'fix(api): cache por tenant (#11)',
      'chore(deps): atualiza o turbo (#12)',
      'Sobre o jogo: contexto (#13)',
    ].map(parseSubject);
    assert.deepEqual(renderSections(prs, REPO), [
      '## Novidades',
      '### Fórmula 1',
      `- Grid de largada ([#10](${REPO}/pull/10))`,
      '',
      '## Correções',
      '### API',
      `- Cache por tenant ([#11](${REPO}/pull/11))`,
      '',
      '## Bastidores',
      '### Infra e qualidade',
      `- Atualiza o turbo ([#12](${REPO}/pull/12))`,
      '',
      '## Outros',
      `- Sobre o jogo: contexto ([#13](${REPO}/pull/13))`,
      '',
    ]);
  });

  it('intervalo só com assuntos não convencionais ainda gera notas', () => {
    const sections = renderSections([parseSubject('Ajuste do placar ao vivo (#300)')], REPO);
    assert.deepEqual(sections, ['## Outros', `- Ajuste do placar ao vivo ([#300](${REPO}/pull/300))`, '']);
  });
});

describe('deployDate', () => {
  it('usa o dia de Brasília: 21:30 BRT continua no mesmo dia (já é o seguinte em UTC)', () => {
    assert.equal(deployDate(new Date('2026-10-26T00:30:00Z')), '2026-10-25');
    assert.equal(deployDate(new Date('2026-10-26T03:00:00Z')), '2026-10-26');
  });
});

describe('parseRemoteTags', () => {
  it('pega o commit de tag anotada (^{}) e de tag leve, e ordena pela data e pelo número', () => {
    const out = [
      'aaa1\trefs/tags/deploy-2026-10-24.1',
      'c0mm1t1\trefs/tags/deploy-2026-10-24.1^{}',
      'c0mm1t9\trefs/tags/deploy-2026-10-25.9',
      'c0mm1t10\trefs/tags/deploy-2026-10-25.10',
      'xxx\trefs/tags/deploy-manual',
      'yyy\trefs/tags/v1.0.0',
    ].join('\n');
    assert.deepEqual(parseRemoteTags(out), [
      { name: 'deploy-2026-10-25.10', date: '2026-10-25', n: 10, sha: 'c0mm1t10' },
      { name: 'deploy-2026-10-25.9', date: '2026-10-25', n: 9, sha: 'c0mm1t9' },
      { name: 'deploy-2026-10-24.1', date: '2026-10-24', n: 1, sha: 'c0mm1t1' },
    ]);
  });

  it('sem tags → lista vazia', () => {
    assert.deepEqual(parseRemoteTags(''), []);
  });
});

describe('orderByHistory', () => {
  it('ordena pela posição do commit no histórico e deixa de fora o que não é ancestral', () => {
    const tags = [
      { name: 'deploy-2026-10-26.1', date: '2026-10-26', n: 1, sha: 'c2' }, // fluxo antigo: dia em UTC
      { name: 'deploy-2026-10-25.2', date: '2026-10-25', n: 2, sha: 'c3' },
      { name: 'deploy-2026-10-24.1', date: '2026-10-24', n: 1, sha: 'c1' },
      { name: 'deploy-2026-10-27.1', date: '2026-10-27', n: 1, sha: 'fora' },
    ];
    assert.deepEqual(
      orderByHistory(tags, ['c4', 'c3', 'c2', 'c1']).map((t) => t.name),
      ['deploy-2026-10-25.2', 'deploy-2026-10-26.1', 'deploy-2026-10-24.1'],
    );
  });
});

describe('missingReleases', () => {
  it('todas as tags sem release, da mais velha à mais nova, cada uma com a anterior no histórico', () => {
    const t = (name, sha) => parseRemoteTags(`${sha}\trefs/tags/${name}`)[0];
    const tags = [
      t('deploy-2026-10-25.1', 'c4'),
      t('deploy-2026-10-24.1', 'c3'),
      t('deploy-2026-10-23.1', 'c2'),
      t('deploy-2026-10-22.1', 'c1'),
    ];
    const got = missingReleases(tags, ['deploy-2026-10-25.1', 'deploy-2026-10-23.1']);
    assert.deepEqual(
      got.map(({ tag, previous }) => [tag.name, previous.name]),
      [['deploy-2026-10-24.1', 'deploy-2026-10-23.1']],
    );
    // a primeira do histórico não tem de onde partir
    assert.deepEqual(missingReleases(tags.slice(3), []), []);
    assert.deepEqual(
      missingReleases(tags, []).map(({ tag }) => tag.name),
      ['deploy-2026-10-23.1', 'deploy-2026-10-24.1', 'deploy-2026-10-25.1'],
    );
  });
});

describe('nextTag', () => {
  it('primeira do dia é .1; outros dias não contam', () => {
    assert.deepEqual(nextTag(['deploy-2026-10-24.3'], '2026-10-25'), { tag: 'deploy-2026-10-25.1', n: 1 });
  });

  it('segue o maior número do dia, mesmo com buraco na sequência ou tag só local', () => {
    const names = ['deploy-2026-10-25.1', 'deploy-2026-10-25.3', 'deploy-2026-10-25.3', 'deploy-x'];
    assert.deepEqual(nextTag(names, '2026-10-25'), { tag: 'deploy-2026-10-25.4', n: 4 });
  });
});

describe('titleOf', () => {
  it('monta o título padrão pelo nome da tag', () => {
    assert.equal(titleOf({ date: '2026-10-25', n: 2 }), 'Deploy 2026-10-25 nº 2');
  });
});

// CLI ponta a ponta: repositório descartável com origin local e um gh falso que só registra as chamadas
describe('release-notes.mjs', () => {
  const script = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
  const GH_FAKE = `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
if (a[0] === 'repo') { console.log('https://github.com/exemplo/repo'); process.exit(0); }
if (a[0] === 'release' && a[1] === 'list') {
  console.log((process.env.GH_RELEASED || 'deploy-2026-10-20.1').split(',').join('\\n'));
  process.exit(0);
}
if (a[0] === 'release' && a[1] === 'create') {
  fs.appendFileSync(process.env.GH_FAKE_LOG, JSON.stringify({ args: a.slice(2), body: fs.readFileSync(0, 'utf8') }) + '\\n');
  process.exit(0);
}
process.exit(2);
`;

  const GIT_ID = [
    ...['-c', 'user.name=t', '-c', 'user.email=t@example.test'],
    ...['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'],
  ];

  /** origin com deploy-2026-10-20.1 (com release) e deploy-2026-10-21.1 (sem release) e um PR depois dela. */
  const withRepo = (fn) => {
    const tmp = mkdtempSync(join(tmpdir(), 'release-notes-'));
    const work = join(tmp, 'work');
    const git = (...a) =>
      execFileSync('git', [...GIT_ID, ...a], {
        cwd: work,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    try {
      execFileSync('git', ['init', '-q', '--bare', join(tmp, 'origin.git')]);
      execFileSync('git', ['clone', '-q', join(tmp, 'origin.git'), work], { stdio: 'ignore' });
      const commit = (subject) => git('commit', '-q', '--allow-empty', '-m', subject);
      commit('chore: início (#1)');
      git('tag', '-a', 'deploy-2026-10-20.1', '-m', 'Deploy 2026-10-20 nº 1');
      commit('fix(f1): pontos do sprint (#2)');
      git('tag', 'deploy-2026-10-21.1'); // publicada no fluxo antigo: a tag subiu, a release não
      commit('Sobre o jogo: contexto (#3)');
      git('push', '-q', 'origin', 'HEAD:main', 'deploy-2026-10-20.1', 'deploy-2026-10-21.1');
      git('tag', '-d', 'deploy-2026-10-20.1', 'deploy-2026-10-21.1'); // o clone do operador pode não ter as tags

      const bin = join(tmp, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'gh'), GH_FAKE);
      chmodSync(join(bin, 'gh'), 0o755);
      const log = join(tmp, 'gh.log');
      let released;
      const cli = (...args) =>
        execFileSync(process.execPath, [script, ...args], {
          cwd: work,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}${delimiter}${process.env.PATH}`,
            GH_FAKE_LOG: log,
            ...(released ? { GH_RELEASED: released } : {}),
          },
        });
      const setReleased = (names) => (released = names.join(','));
      const calls = () =>
        readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l));
      fn({ git, cli, calls, setReleased });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };

  it('conclui a tag sem release e cria a nova com a tag nascendo no GitHub (nada local)', () =>
    withRepo(({ git, cli, calls }) => {
      const head = git('rev-parse', 'HEAD');
      assert.match(cli('--to', head), /deploy-2026-10-21\.1 está sem release/);
      const [recovered, created, ...rest] = calls();
      assert.equal(rest.length, 0);

      assert.equal(recovered.args[0], 'deploy-2026-10-21.1');
      assert.ok(recovered.args.includes('--verify-tag'));
      assert.ok(recovered.args.includes('--latest=false'));
      assert.ok(!created.args.includes('--latest=false'));
      assert.match(recovered.body, /desde `deploy-2026-10-20\.1`/);
      assert.match(recovered.body, /Pontos do sprint/);
      assert.doesNotMatch(recovered.body, /#3/);

      const today = deployDate();
      assert.equal(created.args[0], `deploy-${today}.1`);
      assert.equal(created.args[created.args.indexOf('--target') + 1], head);
      assert.match(created.body, /1 PR\(s\) desde `deploy-2026-10-21\.1`/);
      assert.match(created.body, /## Outros\n- Sobre o jogo: contexto/);
      assert.equal(git('tag', '--list', 'deploy-*'), '');
    }));

  it('a tag anterior é a mais nova no histórico, não no nome (tag antiga com data UTC do dia seguinte)', () =>
    withRepo(({ git, cli, calls, setReleased }) => {
      // HEAD (#3) publicado depois da 21.1, mas com nome de data anterior; depois entra o #4
      git('tag', 'deploy-2026-10-20.2');
      git('commit', '-q', '--allow-empty', '-m', 'feat(api): busca (#4)');
      git('push', '-q', 'origin', 'HEAD:main', 'deploy-2026-10-20.2');
      setReleased(['deploy-2026-10-20.1', 'deploy-2026-10-21.1', 'deploy-2026-10-20.2']);
      cli('--to', git('rev-parse', 'HEAD'));
      const [created, ...rest] = calls();
      assert.equal(rest.length, 0);
      assert.match(created.body, /1 PR\(s\) desde `deploy-2026-10-20\.2`/);
      assert.match(created.body, /Busca/);
      assert.doesNotMatch(created.body, /#3/);
    }));

  it('conclui também a tag sem release que ficou atrás de uma com release', () =>
    withRepo(({ git, cli, calls, setReleased }) => {
      // 21.1 sem release; o deploy seguinte (20.2, no #3) já tem; depois entra o #4
      git('tag', 'deploy-2026-10-20.2');
      git('commit', '-q', '--allow-empty', '-m', 'feat(api): busca (#4)');
      git('push', '-q', 'origin', 'HEAD:main', 'deploy-2026-10-20.2');
      setReleased(['deploy-2026-10-20.1', 'deploy-2026-10-20.2']);
      cli('--to', git('rev-parse', 'HEAD'));
      const [recovered, created, ...rest] = calls();
      assert.equal(rest.length, 0);
      assert.equal(recovered.args[0], 'deploy-2026-10-21.1');
      assert.ok(recovered.args.includes('--latest=false'));
      assert.match(recovered.body, /Pontos do sprint/);
      assert.match(created.body, /1 PR\(s\) desde `deploy-2026-10-20\.2`/);
    }));

  it('com --dry só imprime; redeploy do mesmo commit não gera release nova', () =>
    withRepo(({ git, cli }) => {
      const out = cli('--to', git('rev-parse', 'HEAD~1'), '--dry');
      assert.match(out, /deploy-2026-10-21\.1 — Deploy 2026-10-21 nº 1/);
      assert.match(out, /nenhum PR entre deploy-2026-10-21\.1/);
    }));
});
