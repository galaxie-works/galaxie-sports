import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { unzipEntry } from './release.js';

/** Zip mínimo com entradas comprimidas (deflate) ou armazenadas. */
function zip(entries: { name: string; data: Buffer; store?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.store ? e.data : deflateRawSync(e.data);
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.store ? 0 : 8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

describe('unzipEntry', () => {
  const db = Buffer.from('SQLite format 3\u0000'.repeat(100));
  const file = zip([
    { name: 'LEIAME.txt', data: Buffer.from('oi'), store: true },
    { name: 'f1db.db', data: db },
  ]);

  it('extrai a entrada pelo nome (deflate)', () => {
    expect(unzipEntry(file, 'f1db.db').equals(db)).toBe(true);
  });

  it('extrai entrada armazenada sem compressão', () => {
    expect(unzipEntry(file, 'LEIAME.txt').toString()).toBe('oi');
  });

  it('falha com nome ausente ou arquivo que não é zip', () => {
    expect(() => unzipEntry(file, 'outro.db')).toThrow(/não está no arquivo/);
    expect(() => unzipEntry(Buffer.from('não é zip'.repeat(5)), 'f1db.db')).toThrow(/diretório central/);
  });
});
