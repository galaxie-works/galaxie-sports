import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
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

interface Entry {
  name: string;
  body?: Buffer;
  type?: string;
  /** Formato do cabeçalho do nome longo: GNU (`L`) ou pax (`x`). */
  long?: 'gnu' | 'pax';
}

function header(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.fill(' ', 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);

/** Tar mínimo (ustar, com nome longo GNU ou pax) em gzip, como o `tar -czf` gera. */
function tgz(entries: Entry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = e.body ?? Buffer.alloc(0);
    if (e.long === 'gnu') {
      const n = Buffer.from(`${e.name}\0`);
      blocks.push(header('././@LongLink', n.length, 'L'), pad(n));
    } else if (e.long === 'pax') {
      const rec = (k: string, v: string) => {
        const base = ` ${k}=${v}
`;
        let len = base.length + 1;
        while (String(len).length + base.length !== len) len = String(len).length + base.length;
        return `${len}${base}`;
      };
      const p = Buffer.from(rec('path', e.name));
      blocks.push(header('PaxHeaders/x', p.length, 'x'), pad(p));
    }
    blocks.push(header(e.long ? 'truncado' : e.name, body.length, e.type ?? '0'), pad(body));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

/** Os arquivos de uma pasta como entradas do tar, sob `prefix`. */
function entriesOf(dir: string, prefix: string): Entry[] {
  const out: Entry[] = [{ name: `${prefix}/`, type: '5' }];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      const rel = `${prefix}/${relative(dir, p).split('\\').join('/')}`;
      if (statSync(p).isDirectory()) {
        out.push({ name: `${rel}/`, type: '5' });
        walk(p);
      } else out.push({ name: rel, body: readFileSync(p) });
    }
  };
  walk(dir);
  return out;
}

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
