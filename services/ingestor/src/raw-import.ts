import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import {
  API_HOSTS,
  normalizeParams,
  requestHash,
  type ApiSport,
  type Envelope,
} from '@galaxie/apisports-client';
import { apiResponse, type Database } from '@galaxie/db';

export interface ImportResult {
  files: number;
  imported: number;
  duplicates: number;
  skipped: { file: string; reason: string }[];
}

/** "leagues__20261021T141332Z.json" → 2026-10-21T14:13:32Z (data da coleta original). */
function fetchedAtFromName(file: string): Date | undefined {
  const m = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(file);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) : undefined;
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && entry.name.endsWith('.json')) yield full;
  }
}

/**
 * Importa para raw.api_response envelopes salvos em disco (<dir>/<esporte>/*.json), sem gastar cota.
 * O endpoint e os parâmetros vêm do próprio envelope (`get`, `parameters`); o esporte, da pasta.
 * Idempotente: um mesmo corpo para a mesma requisição não é importado duas vezes.
 */
export async function importRawDirectory(db: Database, dir: string): Promise<ImportResult> {
  const result: ImportResult = { files: 0, imported: 0, duplicates: 0, skipped: [] };
  for await (const file of walk(dir)) {
    result.files += 1;
    const sport = basename(dirname(file)) as ApiSport;
    if (!(sport in API_HOSTS)) {
      result.skipped.push({ file, reason: `pasta "${sport}" não é um esporte conhecido` });
      continue;
    }
    const text = await readFile(file, 'utf8');
    let envelope: Envelope;
    try {
      envelope = JSON.parse(text) as Envelope;
    } catch {
      result.skipped.push({ file, reason: 'JSON inválido' });
      continue;
    }
    if (typeof envelope.get !== 'string' || !('response' in envelope)) {
      result.skipped.push({ file, reason: 'não é um envelope da api-sports' });
      continue;
    }
    const endpoint = `/${envelope.get.replace(/^\//, '')}`;
    const rawParams = Array.isArray(envelope.parameters) ? {} : envelope.parameters;
    const params = normalizeParams(rawParams);
    const hash = requestHash('api-sports', sport, endpoint, params);
    const bodyHash = createHash('sha256').update(text).digest('hex');

    const [existing] = await db
      .select({ id: apiResponse.id })
      .from(apiResponse)
      .where(and(eq(apiResponse.requestHash, hash), eq(apiResponse.bodyHash, bodyHash)))
      .limit(1);
    if (existing) {
      result.duplicates += 1;
      continue;
    }

    await db.insert(apiResponse).values({
      provider: 'api-sports',
      sport,
      apiVersion: API_HOSTS[sport].version,
      endpoint,
      params,
      requestHash: hash,
      page: Number(params.page ?? 1),
      statusCode: 200,
      results: envelope.results ?? null,
      errors: envelope.errors ?? null,
      body: envelope,
      bodyHash,
      quotaRemaining: null,
      jobId: 'raw-import',
      fetchedAt: fetchedAtFromName(basename(file)) ?? new Date(),
    });
    result.imported += 1;
  }
  return result;
}
