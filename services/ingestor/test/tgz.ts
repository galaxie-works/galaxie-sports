/** Tar mínimo em gzip para os testes (o formato do `tar -czf`): ustar, nome longo GNU (`L`) ou pax (`x`). */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

export interface Entry {
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
export function tgz(entries: Entry[]): Buffer {
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
export function entriesOf(dir: string, prefix: string): Entry[] {
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
