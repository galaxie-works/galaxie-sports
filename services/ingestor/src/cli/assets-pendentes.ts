/**
 * Exporta a fila do Asset Mirror (core.asset sem arquivo, só da CDN de mídia) para baixar fora da VPS: uma linha JSON
 * por asset (`{"id","kind","url"}`), na ordem da fila. Só leitura no banco; nenhuma chamada à API de dados nem à CDN.
 * Pode ser repetido a qualquer momento (ex.: depois de uma carga que criou assets novos): o download local retoma pelo
 * manifest e só baixa o que ainda não tem.
 *
 *   docker compose run --rm --no-deps -T ingestor node dist/cli/assets-pendentes.js > pendentes.jsonl
 *   opções: --saida arquivo (padrão: stdout) · --caminho football · --retentar-ausentes (inclui 404/bloqueados)
 *
 * Depois: `assets:baixar-local` na máquina local, rsync/scp da pasta para a VPS e `assets:mirror --origem-local`.
 * O resumo por tipo sai no stderr, para não misturar com a lista.
 *
 * Variáveis: DATABASE_URL.
 */
import { createWriteStream } from 'node:fs';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { PgAssetStore } from '../assets/asset-store.js';
import type { PendingListItem } from '../assets/local-media.js';

const { values } = parseArgs({
  options: {
    saida: { type: 'string' },
    caminho: { type: 'string' },
    'retentar-ausentes': { type: 'boolean', default: false },
  },
});

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');

const db = createDb(DATABASE_URL);
try {
  const queue = await new PgAssetStore(db).pending({
    includeMissing: values['retentar-ausentes'],
    pathPrefix: values.caminho,
  });
  const out = values.saida ? createWriteStream(values.saida) : process.stdout;
  const byKind = new Map<string, number>();
  for (const a of queue) {
    const item: PendingListItem = { id: a.id, kind: a.kind, url: a.sourceUrl };
    if (!out.write(`${JSON.stringify(item)}\n`))
      await new Promise<void>((ok) => out.once('drain', () => ok()));
    byKind.set(a.kind, (byKind.get(a.kind) ?? 0) + 1);
  }
  if (out !== process.stdout)
    await new Promise<void>((ok) => (out as ReturnType<typeof createWriteStream>).end(ok));
  const kinds = [...byKind].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`);
  console.error(`Pendentes exportados: ${queue.length}${kinds.length ? ` (${kinds.join(' · ')})` : ''}`);
} finally {
  await closeDb(db);
}
