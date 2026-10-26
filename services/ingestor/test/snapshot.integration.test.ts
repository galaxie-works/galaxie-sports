/**
 * Snapshot do raw: snapshot da versão 1 continua importando, asset marcado como ausente não é religado,
 * snapshot truncado não deixa nada gravado e export interrompido não deixa arquivo final.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { apiResponse, asset, closeDb, createDb, type Database } from '@galaxie/db';
import { exportRawSnapshot, importRawSnapshot } from '../src/snapshot/raw-snapshot.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;
let dir: string;

beforeAll(async () => {
  db = await disposable.setup();
  dir = await mkdtemp(join(tmpdir(), 'snapshot-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await disposable.teardown();
});
beforeEach(async () => {
  await db.delete(apiResponse);
  await db.delete(asset);
});

/** Linha `raw` no formato da versão 1 (o que os snapshots já gravados têm). */
const rawLine = (i: number) => ({
  t: 'raw',
  provider: 'api-sports',
  sport: 'football',
  apiVersion: 'v3',
  endpoint: '/teams',
  params: { id: String(i) },
  requestHash: `hash-${i}`,
  page: 1,
  statusCode: 200,
  results: 0,
  errors: [],
  body: { get: 'teams', parameters: { id: String(i) }, errors: [], results: 0, response: [] },
  bodyHash: `body-${i}`,
  quotaRemaining: null,
  fetchedAt: '2026-10-01T12:00:00.000Z',
  jobId: null,
});

const assetLine = (url: string, storageKey: string | null) => ({
  t: 'asset',
  kind: 'team_logo',
  sourceUrl: url,
  storageKey,
  sha256: storageKey ? 'abc' : null,
  width: storageKey ? 100 : null,
  height: storageKey ? 100 : null,
  bytes: storageKey ? 1234 : null,
  fetchedAt: '2026-10-01T12:00:00.000Z',
});

async function writeSnapshot(name: string, lines: unknown[]): Promise<string> {
  const file = join(dir, name);
  await writeFile(file, gzipSync(lines.map((l) => `${JSON.stringify(l)}\n`).join('')));
  return file;
}

const header = {
  t: 'header',
  format: 'galaxie-raw-snapshot',
  version: 1,
  createdAt: '2026-10-01T12:00:00.000Z',
  filters: {},
};

describe('importRawSnapshot', () => {
  it('importa snapshot da versão 1; asset já marcado como ausente aqui continua ausente', async () => {
    const missingUrl = 'https://media.api-sports.io/football/teams/1.png';
    const okUrl = 'https://media.api-sports.io/football/teams/2.png';
    // o Asset Mirror deste banco tentou e não achou arquivo (404 ou imagem genérica)
    await db
      .insert(asset)
      .values({ kind: 'team_logo', sourceUrl: missingUrl, fetchedAt: new Date('2026-10-20T00:00:00Z') });
    const file = await writeSnapshot('v1.ndjson.gz', [
      header,
      rawLine(1),
      rawLine(2),
      assetLine(missingUrl, 'football/teams/1.png'),
      assetLine(okUrl, 'football/teams/2.png'),
      { t: 'end', raw: 2, assets: 2 },
    ]);
    const r = await importRawSnapshot(db, file);
    expect(r).toEqual({ raw: 2, imported: 2, duplicates: 0, assets: 2 });

    const [missing] = await db.select().from(asset).where(eq(asset.sourceUrl, missingUrl));
    expect(missing).toMatchObject({ storageKey: null, sha256: null });
    const [ok] = await db.select().from(asset).where(eq(asset.sourceUrl, okUrl));
    expect(ok).toMatchObject({ storageKey: 'football/teams/2.png', sha256: 'abc' });

    // idempotente
    expect(await importRawSnapshot(db, file)).toMatchObject({ imported: 0, duplicates: 2 });
  });

  it('asset nunca tentado aqui é completado pelo snapshot', async () => {
    const url = 'https://media.api-sports.io/football/teams/3.png';
    await db.insert(asset).values({ kind: 'team_logo', sourceUrl: url });
    const file = await writeSnapshot('pending.ndjson.gz', [
      header,
      assetLine(url, 'football/teams/3.png'),
      { t: 'end', raw: 0, assets: 1 },
    ]);
    await importRawSnapshot(db, file);
    const [row] = await db.select().from(asset).where(eq(asset.sourceUrl, url));
    expect(row!.storageKey).toBe('football/teams/3.png');
  });

  it('snapshot truncado (sem a linha end) não deixa nenhum lote gravado', async () => {
    // mais de um lote (200 por vez): antes, os primeiros já ficavam no banco quando o erro aparecia
    const lines = [header, ...Array.from({ length: 450 }, (_, i) => rawLine(i))];
    const file = await writeSnapshot('truncado.ndjson.gz', lines);
    await expect(importRawSnapshot(db, file)).rejects.toThrow(/Snapshot incompleto/);
    const [n] = await db.select({ n: count() }).from(apiResponse);
    expect(n!.n).toBe(0);
  });

  it('contagem do end diferente do lido também desfaz tudo', async () => {
    const file = await writeSnapshot('contagem.ndjson.gz', [
      header,
      rawLine(1),
      { t: 'end', raw: 2, assets: 0 },
    ]);
    await expect(importRawSnapshot(db, file)).rejects.toThrow(/Snapshot incompleto/);
    const [n] = await db.select({ n: count() }).from(apiResponse);
    expect(n!.n).toBe(0);
  });
});

describe('exportRawSnapshot', () => {
  it('grava pelo .part e renomeia; o arquivo exportado volta a importar', async () => {
    const source = await writeSnapshot('origem.ndjson.gz', [
      header,
      rawLine(7),
      { t: 'end', raw: 1, assets: 0 },
    ]);
    await importRawSnapshot(db, source);
    const out = join(dir, 'export', 'raw-20261025T120000Z.ndjson.gz');
    expect(await exportRawSnapshot(db, out, { includeAssets: false })).toMatchObject({ raw: 1, assets: 0 });
    expect(await readdir(join(dir, 'export'))).toEqual(['raw-20261025T120000Z.ndjson.gz']);
    await db.delete(apiResponse);
    expect(await importRawSnapshot(db, out)).toMatchObject({ raw: 1, imported: 1 });
  });

  it('export interrompido não deixa arquivo final nem o .part', async () => {
    // banco inexistente: a consulta do raw falha depois do cabeçalho já escrito
    const u = new URL(process.env.DATABASE_URL!);
    u.pathname = '/galaxie_snapshot_inexistente';
    const broken = createDb(u.toString(), { max: 1 });
    const out = join(dir, 'falha', 'raw-20261025T130000Z.ndjson.gz');
    try {
      await expect(exportRawSnapshot(broken, out)).rejects.toThrow();
    } finally {
      await closeDb(broken);
    }
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.part`)).toBe(false);
  });
});
