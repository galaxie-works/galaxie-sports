// Testes da entrada das imagens: node --test infra/ops/image-inputs.test.mjs (lê o repositório; sem git, pnpm nem rede).
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closure, IMAGES, imageInputs, imagesChangedBy, isCovered, readWorkspace } from './image-inputs.mjs';

const SCRIPT = fileURLToPath(new URL('./image-inputs.mjs', import.meta.url));
const REPO = resolve(dirname(SCRIPT), '..', '..');

const DOCKERFILES = {
  api: 'apps/api/Dockerfile',
  demo: 'apps/demo/Dockerfile',
  ingestor: 'services/ingestor/Dockerfile',
};

describe('quais imagens mudam com cada caminho', () => {
  const cases = [
    // os da issue #527
    ['só apps/demo: só a demo', ['apps/demo/src/app/page.tsx'], ['demo']],
    ['só services/ai-agents: só o ingestor', ['services/ai-agents/src/index.ts'], ['ingestor']],
    ['packages/db: as três', ['packages/db/src/index.ts'], ['api', 'demo', 'ingestor']],
    ['config/assets: api e ingestor, não a demo', ['config/assets/denylist.yaml'], ['api', 'ingestor']],
    // o Dockerfile da demo copia só estas duas pastas do config/
    ['config/broadcasters: as três', ['config/broadcasters/br.yaml'], ['api', 'demo', 'ingestor']],
    ['config/broadcast-rights: as três', ['config/broadcast-rights/br.yaml'], ['api', 'demo', 'ingestor']],
    ['data/knowledge: api e ingestor', ['data/knowledge/glossary/pt-BR.yaml'], ['api', 'ingestor']],
    ['só apps/api: só a api', ['apps/api/src/main.ts'], ['api']],
    // issue #563: a api não depende do ingestor (os testes que cruzam os dois ficam em tests/integration)
    ['services/ingestor: só o ingestor', ['services/ingestor/src/x.ts'], ['ingestor']],
    ['tests/integration: nenhuma (nenhuma imagem depende dele)', ['tests/integration/test/x.ts'], []],
    ['packages/widgets: só a demo', ['packages/widgets/src/index.ts'], ['demo']],
    [
      'o selfheal copiado pelos Dockerfiles: as três',
      ['infra/healthcheck/selfheal.mjs'],
      ['api', 'demo', 'ingestor'],
    ],
    ['lockfile: as três', ['pnpm-lock.yaml'], ['api', 'demo', 'ingestor']],
    ['o Dockerfile da demo: só a demo', ['apps/demo/Dockerfile'], ['demo']],
    ['docs: nenhuma', ['docs/runbooks/deploy-pelo-github.md'], []],
    ['outra pasta de infra: nenhuma', ['infra/backup/Dockerfile'], []],
    ['mesmo prefixo sem ser a pasta: nenhuma', ['packages/db-outro/x.ts', 'config-velho/x.yaml'], []],
    ['nada alterado: nenhuma', [], []],
    ['vários caminhos somam', ['apps/demo/x.ts', 'services/ai-agents/x.ts'], ['demo', 'ingestor']],
  ];
  for (const [name, paths, want] of cases) {
    it(name, () => assert.deepEqual(imagesChangedBy(paths), want));
  }
});

describe('entrada no repositório', () => {
  for (const image of Object.keys(IMAGES)) {
    it(`${image}: ordenada, sem repetir e sem pasta dentro de outra`, () => {
      const inputs = imageInputs(image);
      assert.deepEqual(inputs, [...inputs].sort());
      assert.equal(new Set(inputs).size, inputs.length);
      for (const input of inputs) {
        assert.equal(
          isCovered(
            input,
            inputs.filter((other) => other !== input),
          ),
          false,
          input,
        );
      }
    });
  }

  it('o ingestor leva o fechamento dos agentes', () => {
    const inputs = imageInputs('ingestor');
    for (const dir of [
      'services/ingestor',
      'services/ai-agents',
      'packages/ai-ledger',
      'packages/net-guard',
    ]) {
      assert.ok(inputs.includes(dir), dir);
    }
  });

  it('a api não leva o ingestor nem os testes que cruzam os dois', () => {
    const inputs = imageInputs('api');
    assert.ok(!inputs.includes('services/ingestor'));
    assert.ok(!inputs.includes('tests/integration'));
  });

  it('a demo não leva o config/ inteiro nem a base semântica', () => {
    const inputs = imageInputs('demo');
    assert.ok(!inputs.includes('config'));
    assert.ok(!inputs.includes('data/knowledge'));
    assert.ok(!inputs.includes('services/ingestor'));
  });
});

describe('a lista bate com os Dockerfiles', () => {
  /** O que o Dockerfile lê do contexto ou do /repo do estágio de build. Os /out são produto do próprio build. */
  function sources(dockerfile) {
    const found = [];
    for (const [, args] of dockerfile.matchAll(/^COPY +(.+)$/gm)) {
      const words = args.trim().split(/ +/).slice(0, -1);
      const fromBuild = words.some((word) => word.startsWith('--from='));
      for (const word of words.filter((w) => !w.startsWith('--'))) {
        if (fromBuild && word.startsWith('/repo/')) found.push(word.slice('/repo/'.length));
        if (!fromBuild && word !== '.') found.push(word);
      }
    }
    for (const [, args] of dockerfile.matchAll(/cp -r ([^\\\n&]+)/g)) {
      found.push(...args.trim().split(/ +/).slice(0, -1));
    }
    return found;
  }

  for (const [image, file] of Object.entries(DOCKERFILES)) {
    const dockerfile = readFileSync(join(REPO, file), 'utf8');

    it(`${image}: os pacotes construídos são os roots`, () => {
      const built = [...dockerfile.matchAll(/--filter "(@galaxie\/[a-z-]+)\.\.\."/g)].map(
        (match) => match[1],
      );
      assert.deepEqual(built.sort(), [...IMAGES[image].roots].sort());
    });

    it(`${image}: tudo o que o Dockerfile copia está na entrada`, () => {
      const inputs = imageInputs(image);
      const copied = sources(dockerfile);
      assert.ok(copied.length > 0);
      assert.deepEqual(
        copied.filter((path) => !isCovered(path, inputs)),
        [],
      );
    });
  }
});

describe('fechamento de dependências', () => {
  const workspace = new Map([
    ['app', { dir: 'apps/app', deps: ['lib', 'fastify'] }],
    ['lib', { dir: 'packages/lib', deps: ['base'] }],
    ['base', { dir: 'packages/base', deps: ['app'] }], // ciclo não pode travar
    ['solta', { dir: 'packages/solta', deps: [] }],
  ]);

  it('é transitivo, ignora pacote de fora do workspace e aguenta ciclo', () => {
    assert.deepEqual(closure(workspace, ['app']).sort(), ['apps/app', 'packages/base', 'packages/lib']);
  });

  it('nome que não está no workspace falha', () => {
    assert.throws(() => closure(workspace, ['sumiu']), /fora do workspace/);
  });
});

describe('workspace num repositório de exemplo', () => {
  function repo(workspaceYaml, packages = {}) {
    const root = mkdtempSync(join(tmpdir(), 'image-inputs-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), workspaceYaml);
    for (const [dir, pkg] of Object.entries(packages)) {
      mkdirSync(join(root, dir), { recursive: true });
      if (pkg) writeFileSync(join(root, dir, 'package.json'), JSON.stringify(pkg));
    }
    return root;
  }

  it('lê a lista até a próxima chave, segue dev e workspace: e pula pasta sem package.json', () => {
    const root = repo(
      `# comentário\npackages:\n  - apps/*\n  # outro\n  - "libs/*"\n\nallowBuilds:\n  esbuild: true\n  - nao/*\n`,
      {
        'apps/a': { name: 'a', dependencies: { b: 'workspace:*' }, devDependencies: { c: 'workspace:^' } },
        'libs/b': { name: 'b' },
        'libs/c': { name: 'c', peerDependencies: { d: '*' } },
        'libs/d': { name: 'd' },
        'libs/vazia': null,
        'nao/e': { name: 'e' },
      },
    );
    try {
      const workspace = readWorkspace(root);
      assert.deepEqual([...workspace.keys()].sort(), ['a', 'b', 'c', 'd']);
      assert.deepEqual(closure(workspace, ['a']).sort(), ['apps/a', 'libs/b', 'libs/c', 'libs/d']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('forma que o leitor não entende falha em vez de achar menos pacotes', () => {
    for (const [yaml, why] of [
      ['packages: [apps/*]\n', /sem lista/],
      ['outra: 1\n', /sem lista/],
      ['packages:\n  - "apps/**"\n', /não suportado/],
      ['packages:\n  - "!apps/x"\n', /não suportado/],
    ]) {
      const root = repo(yaml);
      try {
        assert.throws(() => readWorkspace(root), why);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});

describe('linha de comando', () => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('a entrada sai numa linha só, a mesma a cada execução', () => {
    const out = execFileSync(process.execPath, [SCRIPT, 'demo'], { encoding: 'utf8' });
    assert.equal(out, `${imageInputs('demo').join(' ')}\n`);
    assert.equal(out, execFileSync(process.execPath, [SCRIPT, 'demo'], { encoding: 'utf8' }));
  });

  it('--changed diz as imagens', () => {
    assert.equal(run('--changed', 'config/assets/x.yaml').stdout, 'api ingestor\n');
    assert.equal(run('--changed', 'docs/x.md').stdout, '\n');
  });

  it('imagem desconhecida ou uso errado saem com erro e sem nada no stdout', () => {
    for (const args of [['caddy'], ['constructor'], [], ['api', 'demo']]) {
      const result = run(...args);
      assert.equal(result.status, 1, args.join(' '));
      assert.equal(result.stdout, '');
      assert.notEqual(result.stderr, '');
    }
  });
});
