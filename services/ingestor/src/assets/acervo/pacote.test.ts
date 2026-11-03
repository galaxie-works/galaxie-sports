import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { entriesOf, tgz } from '../../../test/tgz.js';
import {
  extractTgz,
  InMemoryPackageStore,
  openPackage,
  packageRoot,
  parseS3Uri,
  safeEntryPath,
} from './pacote.js';
import { scanAcervo } from './scan.js';

const EXEMPLO = fileURLToPath(new URL('../../../test/fixtures/acervo-exemplo', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'pacote-test-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const write = (name: string, data: Buffer) => {
  const p = join(work, name);
  writeFileSync(p, data);
  return p;
};

describe('parseS3Uri', () => {
  it('lê bucket e chave e recusa o que não é s3:// válido', () => {
    expect(parseS3Uri('s3://galaxie-assets/tasks/abc/pacote.tgz')).toEqual({
      bucket: 'galaxie-assets',
      key: 'tasks/abc/pacote.tgz',
    });
    expect(parseS3Uri('s3://b/')).toBeNull();
    expect(parseS3Uri('s3://bucket/a/../b.tgz')).toBeNull();
    expect(parseS3Uri('https://x/y')).toBeNull();
  });
});

describe('safeEntryPath', () => {
  it('recusa caminho absoluto, .., barra invertida e letra de unidade', () => {
    expect(() => safeEntryPath(work, '../fora.txt')).toThrow(/inseguro/);
    expect(() => safeEntryPath(work, 'a/../../fora.txt')).toThrow(/inseguro/);
    expect(() => safeEntryPath(work, '/etc/passwd')).toThrow(/inseguro/);
    expect(() => safeEntryPath(work, 'C:/x')).toThrow(/inseguro/);
    expect(() => safeEntryPath(work, 'a\\b')).toThrow(/inseguro/);
    expect(safeEntryPath(work, './')).toBeNull();
    expect(safeEntryPath(work, './a/b.png')).toBe(join(work, 'a', 'b.png'));
  });
});

describe('extractTgz', () => {
  it('extrai arquivos e pastas, com nome longo GNU e pax, e pula links', async () => {
    const long = `pacote/${'x'.repeat(120)}/escudo.svg`;
    const file = write(
      'long.tgz',
      tgz([
        { name: 'pacote/', type: '5' },
        { name: 'pacote/a.txt', body: Buffer.from('olá') },
        { name: long, body: Buffer.from('<svg/>'), long: 'gnu' },
        { name: `pacote/${'y'.repeat(130)}.png`, body: Buffer.alloc(700, 1), long: 'pax' },
        { name: 'pacote/link', type: '2' },
      ]),
    );
    const dest = join(work, 'out-long');
    const report = await extractTgz(file, dest);
    expect(report.files).toBe(3);
    expect(report.skipped).toEqual(['pacote/link']);
    expect(readFileSync(join(dest, 'pacote', 'a.txt'), 'utf8')).toBe('olá');
    expect(readFileSync(join(dest, ...long.split('/')), 'utf8')).toBe('<svg/>');
    expect(readFileSync(join(dest, 'pacote', `${'y'.repeat(130)}.png`)).length).toBe(700);
    expect(existsSync(join(dest, 'pacote', 'link'))).toBe(false);
  });

  it('recusa entrada que sai da pasta de destino', async () => {
    const file = write('evil.tgz', tgz([{ name: '../fora.txt', body: Buffer.from('x') }]));
    await expect(extractTgz(file, join(work, 'out-evil'))).rejects.toThrow(/inseguro/);
    expect(existsSync(join(work, 'fora.txt'))).toBe(false);
  });

  it('recusa registro de nome longo ou pax grande demais antes de ler para a memória', async () => {
    const file = write(
      'meta.tgz',
      tgz([{ name: `pacote/${'z'.repeat(70 * 1024)}.svg`, body: Buffer.from('x'), long: 'gnu' }]),
    );
    await expect(extractTgz(file, join(work, 'out-meta'))).rejects.toThrow(/registro de cabeçalho/);
  });

  it('respeita o teto de tamanho e acusa o tar truncado', async () => {
    const big = write('big.tgz', tgz([{ name: 'a.bin', body: Buffer.alloc(4096) }]));
    await expect(extractTgz(big, join(work, 'out-big'), { maxBytes: 1024 })).rejects.toThrow(/MiB/);
    const whole = tgz([{ name: 'a.bin', body: Buffer.alloc(4096, 7) }]);
    const { gunzipSync } = await import('node:zlib');
    const cut = write('cut.tgz', gzipSync(gunzipSync(whole).subarray(0, 512 + 1000)));
    await expect(extractTgz(cut, join(work, 'out-cut'))).rejects.toThrow(/truncado/);
  });
});

describe('openPackage', () => {
  const pacote = tgz(entriesOf(EXEMPLO, 'acervo-exemplo'));

  it('baixa do S3 para um diretório temporário, extrai, e o cleanup apaga', async () => {
    const store = new InMemoryPackageStore();
    store.objects.set('s3://galaxie/tasks/t1/acervo-exemplo.tgz', new Uint8Array(pacote));
    const pkg = await openPackage('s3://galaxie/tasks/t1/acervo-exemplo.tgz', () => store);
    try {
      expect(pkg.source).toBe('s3://galaxie/tasks/t1/acervo-exemplo.tgz');
      expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pkg.dir.endsWith('acervo-exemplo')).toBe(true);
      // o pacote extraído é o mesmo da pasta: mesma varredura
      expect(scanAcervo(pkg.dir).logos).toEqual(scanAcervo(EXEMPLO).logos);
      expect(existsSync(join(pkg.dir, '..', '..', 'pacote.tgz'))).toBe(false);
    } finally {
      pkg.cleanup();
    }
    expect(existsSync(pkg.dir)).toBe(false);
  });

  it('pacote ausente no S3 vira erro claro, sem deixar diretório para trás', async () => {
    await expect(
      openPackage('s3://galaxie/tasks/t2/nada.tgz', () => new InMemoryPackageStore()),
    ).rejects.toThrow(/não encontrado no S3/);
  });

  it('aceita .tgz local e pasta local (sem cópia)', async () => {
    const local = write('local.tgz', pacote);
    const a = await openPackage(local, () => {
      throw new Error('não deveria usar o S3');
    });
    try {
      expect(scanAcervo(a.dir).info.id).toBe(scanAcervo(EXEMPLO).info.id);
    } finally {
      a.cleanup();
    }
    const b = await openPackage(EXEMPLO, () => {
      throw new Error('não deveria usar o S3');
    });
    expect(b.dir).toBe(EXEMPLO);
    b.cleanup();
    expect(existsSync(EXEMPLO)).toBe(true);
  });

  it('packageRoot acha o acervo.yaml na raiz ou na pasta única', () => {
    const d = join(work, 'root-test', 'unica');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'acervo.yaml'), 'acervo: {}\n');
    expect(packageRoot(join(work, 'root-test'))).toBe(d);
    expect(() => packageRoot(work)).toThrow(/acervo.yaml/);
  });
});
