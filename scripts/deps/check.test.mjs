// Testes da regra de dependência: node --test scripts/deps (monta repositórios pequenos num diretório temporário).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyExceptions, collect, loadExceptions } from './check.mjs';
import { renderMap, updateBlocks } from './map.mjs';
import { isTestFile, kindOf } from './rules.mjs';

const CHECK = fileURLToPath(new URL('./check.mjs', import.meta.url));
const created = [];
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** Cria um repositório mínimo: cada pacote com package.json, mais os arquivos dados. */
function repo(packages, files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'deps-'));
  created.push(root);
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(
    'pnpm-workspace.yaml',
    'packages:\n  - apps/*\n  - services/*\n  - packages/*\n  - tests/integration\n',
  );
  for (const [dir, deps] of Object.entries(packages)) {
    const name = `@galaxie/${dir.split('/')[1]}`;
    write(`${dir}/package.json`, JSON.stringify({ name, ...deps }));
    write(`${dir}/src/index.ts`, 'export const x = 1;\n');
  }
  for (const [path, text] of Object.entries(files)) write(path, text);
  return root;
}

const PKGS = {
  'apps/demo': {},
  'apps/api': {},
  'services/ingestor': {},
  'services/ai-agents': {},
  'packages/db': {},
  'packages/providers': {},
  'packages/contracts': {},
};

const rules = async (root) =>
  (await collect(root)).violations.map((v) => `${v.rule}: ${v.from} -> ${v.to}`).sort();

describe('imports no código', () => {
  it('app que importa serviço pelo nome do pacote reprova com app-nao-importa-servico', async () => {
    const root = repo(PKGS, {
      'apps/demo/src/page.ts': "import { x } from '@galaxie/ingestor';\nexport { x };\n",
    });
    assert.deepEqual(await rules(root), [
      'app-nao-importa-servico: apps/demo/src/page.ts -> services/ingestor',
    ]);
  });

  it('app que importa serviço por caminho relativo também reprova', async () => {
    const root = repo(PKGS, {
      'apps/demo/src/page.ts':
        "import { x } from '../../../services/ingestor/src/index.js';\nexport { x };\n",
    });
    assert.deepEqual(await rules(root), [
      'app-nao-importa-servico: apps/demo/src/page.ts -> services/ingestor',
    ]);
  });

  it('import type, import() dinâmico e subcaminho do pacote contam', async () => {
    const root = repo(PKGS, {
      'apps/demo/src/a.ts': "import type { x } from '@galaxie/ingestor';\nexport type T = typeof x;\n",
      'apps/demo/src/b.ts': "export const load = () => import('@galaxie/ingestor/scheduler');\n",
    });
    assert.deepEqual(await rules(root), [
      'app-nao-importa-servico: apps/demo/src/a.ts -> services/ingestor',
      'app-nao-importa-servico: apps/demo/src/b.ts -> services/ingestor',
    ]);
  });

  it('pacote já compilado (dist/ e link em node_modules) não esconde o import das regras', async () => {
    const root = repo(
      {
        ...PKGS,
        'services/ingestor': { main: './dist/index.js', exports: { '.': { default: './dist/index.js' } } },
      },
      {
        'services/ingestor/dist/index.js': 'export const x = 1;\n',
        'apps/demo/src/page.ts': "import { x } from '@galaxie/ingestor';\nexport { x };\n",
      },
    );
    mkdirSync(join(root, 'node_modules', '@galaxie'), { recursive: true });
    symlinkSync(
      join(root, 'services', 'ingestor'),
      join(root, 'node_modules', '@galaxie', 'ingestor'),
      'junction',
    );
    assert.deepEqual(await rules(root), [
      'app-nao-importa-servico: apps/demo/src/page.ts -> services/ingestor',
    ]);
  });

  it('app não importa app', async () => {
    const root = repo(PKGS, { 'apps/api/src/a.ts': "import { x } from '@galaxie/demo';\nexport { x };\n" });
    assert.deepEqual(await rules(root), ['app-nao-importa-app: apps/api/src/a.ts -> apps/demo']);
  });

  it('serviço não importa serviço', async () => {
    const root = repo(PKGS, {
      'services/ai-agents/src/a.ts': "import { x } from '@galaxie/ingestor';\nexport { x };\n",
    });
    assert.deepEqual(await rules(root), [
      'servico-nao-importa-servico: services/ai-agents/src/a.ts -> services/ingestor',
    ]);
  });

  it('pacote não importa app nem serviço', async () => {
    const root = repo(PKGS, {
      'packages/db/src/a.ts': "import { x } from '@galaxie/demo';\nexport { x };\n",
      'packages/contracts/src/a.ts': "import { x } from '@galaxie/ingestor';\nexport { x };\n",
    });
    assert.deepEqual(await rules(root), [
      'pacote-nao-importa-app-nem-servico: packages/contracts/src/a.ts -> services/ingestor',
      'pacote-nao-importa-app-nem-servico: packages/db/src/a.ts -> apps/demo',
    ]);
  });

  it('pacote de base não importa pacote de domínio (o inverso é livre)', async () => {
    const root = repo(PKGS, {
      'packages/db/src/a.ts': "import { x } from '@galaxie/providers';\nexport { x };\n",
      'packages/providers/src/a.ts': "import { x } from '@galaxie/db';\nexport { x };\n",
    });
    assert.deepEqual(await rules(root), [
      'base-nao-importa-dominio: packages/db/src/a.ts -> packages/providers',
    ]);
  });

  it('import legítimo, de pacote npm e dentro do mesmo pacote não reprova', async () => {
    const root = repo(PKGS, {
      'apps/api/src/a.ts':
        "import { x } from '@galaxie/db';\nimport z from 'zod';\nimport { y } from './b.js';\nexport { x, y, z };\n",
      'apps/api/src/b.ts': 'export const y = 2;\n',
    });
    assert.deepEqual(await rules(root), []);
  });

  it('pacote @galaxie que não existe no workspace reprova em vez de passar calado', async () => {
    const root = repo(PKGS, {
      'apps/demo/src/a.ts': "import { x } from '@galaxie/fantasma';\nexport { x };\n",
    });
    assert.deepEqual(await rules(root), [
      'import-de-pacote-inexistente: apps/demo/src/a.ts -> @galaxie/fantasma',
    ]);
  });
});

describe('package.json', () => {
  it('dependência declarada que viola a regra reprova, em qualquer campo', async () => {
    const root = repo({
      ...PKGS,
      'apps/api': { devDependencies: { '@galaxie/ingestor': 'workspace:*' } },
      'packages/db': { dependencies: { '@galaxie/providers': 'workspace:*' } },
      'packages/contracts': { peerDependencies: { '@galaxie/demo': 'workspace:*' } },
    });
    assert.deepEqual(await rules(root), [
      'app-nao-importa-servico: apps/api/package.json -> services/ingestor',
      'base-nao-importa-dominio: packages/db/package.json -> packages/providers',
      'pacote-nao-importa-app-nem-servico: packages/contracts/package.json -> apps/demo',
    ]);
  });

  it('o campo e o pacote aparecem no detalhe', async () => {
    const root = repo({ ...PKGS, 'apps/api': { devDependencies: { '@galaxie/ingestor': 'workspace:*' } } });
    const { violations } = await collect(root);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].detail, 'devDependencies: @galaxie/ingestor');
    assert.equal(violations[0].from, 'apps/api/package.json');
  });
});

describe('api-sports', () => {
  it('o host da api-sports fora do apisports-client reprova', async () => {
    const root = repo(
      { ...PKGS, 'packages/apisports-client': {} },
      {
        'services/ingestor/src/a.ts': "export const url = 'https://v3.football.api-sports.io/fixtures';\n",
        'packages/apisports-client/src/hosts.ts':
          "export const base = 'https://v3.football.api-sports.io';\n",
        'scripts/pwsh/x.ps1': "$u = 'https://media.api-sports.io/flags/br.svg'\n",
      },
    );
    assert.deepEqual(await rules(root), [
      'so-o-apisports-client-fala-com-a-api-sports: scripts/pwsh/x.ps1 -> api-sports',
      'so-o-apisports-client-fala-com-a-api-sports: services/ingestor/src/a.ts -> api-sports',
    ]);
  });

  it('comentário, teste e documento não contam', async () => {
    const root = repo(PKGS, {
      'services/ingestor/src/a.ts':
        '// docs em https://v3.football.api-sports.io\n/** media.api-sports.io */\nexport const x = 1;\n',
      'services/ingestor/src/a.test.ts': "export const url = 'https://media.api-sports.io/x.png';\n",
      'services/ingestor/test/b.ts': "export const url = 'https://media.api-sports.io/x.png';\n",
    });
    assert.deepEqual(await rules(root), []);
  });
});

describe('camadas', () => {
  it('o pacote de testes de integração importa API e ingestor, mas ninguém o importa', async () => {
    const root = repo(
      {
        ...PKGS,
        'tests/integration': {
          name: '@galaxie/integration-tests',
          devDependencies: { '@galaxie/api': 'workspace:*', '@galaxie/ingestor': 'workspace:*' },
        },
      },
      {
        'tests/integration/test/a.ts': "import { x } from '@galaxie/ingestor';\nexport { x };\n",
        'apps/demo/src/a.ts': "import { x } from '@galaxie/integration-tests';\nexport { x };\n",
      },
    );
    assert.deepEqual(await rules(root), ['ninguem-importa-teste: apps/demo/src/a.ts -> tests/integration']);
  });

  it('pacote novo sem camada reprova com pacote-sem-camada', async () => {
    const root = repo({ ...PKGS, 'packages/novidade': {} });
    assert.deepEqual(await rules(root), [
      'pacote-sem-camada: packages/novidade/package.json -> packages/novidade',
    ]);
  });

  it('kindOf e isTestFile', () => {
    assert.equal(kindOf('apps/api'), 'app');
    assert.equal(kindOf('services/ingestor'), 'service');
    assert.equal(kindOf('packages/db'), 'base');
    assert.equal(kindOf('packages/rules'), 'domain');
    assert.equal(kindOf('packages/widgets'), 'ui');
    assert.equal(kindOf('tests/integration'), 'test');
    assert.equal(kindOf('packages/nada'), null);
    assert.ok(isTestFile('apps/api/src/x.test.ts'));
    assert.ok(isTestFile('apps/api/test/x.ts'));
    assert.ok(isTestFile('services/ingestor/src/testing/fake.ts'));
    assert.ok(!isTestFile('apps/api/src/x.ts'));
  });

  it('pnpm-workspace.yaml com outra pasta falha pedindo para ensinar a regra', async () => {
    const root = repo(PKGS);
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - services/*\n  - packages/*\n  - tests/integration\n  - tools/*\n',
    );
    await assert.rejects(() => collect(root), /scripts\/deps\/rules\.mjs/);
  });
});

describe('exceções', () => {
  const violation = {
    rule: 'app-nao-importa-servico',
    from: 'apps/api/test/a.ts',
    to: 'services/ingestor',
    detail: 'x',
  };
  const exception = {
    ...violation,
    reason: 'teste de integração semeia o banco com o ingestor; mover para um pacote',
  };

  it('exceção cobre a violação; a que não cobre nada vira "sem uso"', () => {
    const stale = { ...exception, from: 'apps/api/test/b.ts' };
    const result = applyExceptions([violation], [exception, stale]);
    assert.deepEqual(result.failing, []);
    assert.deepEqual(result.excepted, [violation]);
    assert.deepEqual(result.stale, [stale]);
  });

  it('violação sem exceção continua reprovando', () => {
    assert.deepEqual(applyExceptions([violation], []).failing, [violation]);
  });

  it('a lista versionada é válida: regra conhecida, motivo de verdade e sem repetição', () => {
    const list = loadExceptions();
    assert.ok(list.length > 0);
    assert.ok(list.every((e) => e.reason.length >= 20));
  });

  it('exceção sem motivo ou com regra inventada falha ao carregar', () => {
    const root = repo({});
    const file = join(root, 'e.json');
    writeFileSync(file, JSON.stringify([{ ...exception, reason: 'curto' }]));
    assert.throws(() => loadExceptions(file), /motivo/);
    writeFileSync(file, JSON.stringify([{ ...exception, rule: 'inventada' }]));
    assert.throws(() => loadExceptions(file), /regra desconhecida/);
  });
});

describe('mapa', () => {
  it('desenha só o código de produção: import em teste não vira seta', async () => {
    const root = repo(PKGS, {
      'apps/api/src/a.ts': "import { x } from '@galaxie/db';\nexport { x };\n",
      'apps/api/test/a.integration.test.ts': "import { x } from '@galaxie/ingestor';\nexport { x };\n",
    });
    const { units, edges } = await collect(root);
    const map = renderMap(units, edges);
    assert.match(map, /apps_api --> packages_db\n/);
    assert.doesNotMatch(map, /services_ingestor\n.*apps_api -->.*services_ingestor/s);
    assert.ok(!/apps_api --> .*services_ingestor/.test(map));
  });

  it('updateBlocks troca o miolo e falha sem marcador', () => {
    const text = 'a\n<!-- deps-map:start x -->\nvelho\n<!-- deps-map:end -->\nb\n';
    assert.equal(
      updateBlocks(text, { 'deps-map': 'novo' }),
      'a\n<!-- deps-map:start x -->\nnovo\n<!-- deps-map:end -->\nb\n',
    );
    assert.throws(() => updateBlocks('sem marcador', { 'deps-map': 'novo' }), /marcadores/);
  });
});

describe('linha de comando', () => {
  it('sai com 1 e diz o nome da regra quando um app importa um serviço', () => {
    const root = repo(PKGS, {
      'apps/demo/src/page.ts': "import { x } from '@galaxie/ingestor';\nexport { x };\n",
    });
    const result = spawnSync(process.execPath, [CHECK, `--root=${root}`, '--map=off'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /app-nao-importa-servico/);
    assert.match(result.stdout, /apps\/demo\/src\/page\.ts → services\/ingestor/);
  });

  it('sai com 0 quando está tudo em ordem', () => {
    const root = repo(PKGS, { 'apps/api/src/a.ts': "import { x } from '@galaxie/db';\nexport { x };\n" });
    const result = spawnSync(
      process.execPath,
      [CHECK, `--root=${root}`, '--map=off', `--exceptions=${join(root, 'nada.json')}`],
      {
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});
