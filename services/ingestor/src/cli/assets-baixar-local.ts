/**
 * Baixa na máquina local a lista exportada por `assets-pendentes` (CDN de mídia da api-sports: não consome cota da
 * API de dados), para uma pasta organizada por tipo e caminho da URL, com `manifest.jsonl`. Não usa banco nem S3.
 * Retoma de onde parou: o que já está no manifest (baixado ou 404) é pulado; 429/5xx ficam para a próxima execução.
 * O 429 pausa todos os downloads (Retry-After) e, seguido em 5 itens, interrompe.
 *
 *   pnpm --filter @galaxie/ingestor assets:baixar-local --lista pendentes.jsonl --destino G:\galaxie-assets
 *   opções: --concorrencia N (padrão 3) · --pausa-ms N (padrão 250) · --limite N
 *           --retentar-404   tenta de novo o que está no manifest como 404 (para listas com --retentar-ausentes)
 *
 * Depois: rsync/scp da pasta para a VPS e `assets:mirror --origem-local <pasta>` (ver mirror-assets.ts).
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { downloadToLocal, parsePendingList } from '../assets/local-media.js';
import { MediaFetcher } from '../assets/media-fetcher.js';

const { values } = parseArgs({
  options: {
    lista: { type: 'string' },
    destino: { type: 'string' },
    concorrencia: { type: 'string', default: '3' },
    'pausa-ms': { type: 'string', default: '250' },
    limite: { type: 'string' },
    'retentar-404': { type: 'boolean', default: false },
  },
});
if (!values.lista || !values.destino) throw new Error('Use --lista pendentes.jsonl --destino <pasta>.');

const items = parsePendingList(await readFile(values.lista, 'utf8'));
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());

let done = 0;
const started = Date.now();
const report = await downloadToLocal({
  items,
  dir: values.destino,
  fetcher: new MediaFetcher(),
  concurrency: Number(values.concorrencia),
  delayMs: Number(values['pausa-ms']),
  limit: values.limite ? Number(values.limite) : undefined,
  retryNotFound: values['retentar-404'],
  signal: stop.signal,
  onProgress: (e) => {
    if (e.type === 'aborted') console.warn(e.reason);
    else if (++done % 500 === 0) {
      const perSecond = done / ((Date.now() - started) / 1000);
      console.log(`  ${done} processados (${perSecond.toFixed(1)}/s)...`);
    }
    if (e.type === 'failed') console.warn(`  falha ${e.item.url}: ${e.reason}`);
  },
});

console.log(
  `Lista: ${report.listed} · já no manifest: ${report.skipped} · baixados: ${report.ok} (${(report.bytes / 1024 / 1024).toFixed(1)} MiB)` +
    ` · 404: ${report.notFound} · falhas: ${report.failed}${stop.signal.aborted ? ' · interrompido (rode de novo para continuar)' : ''}`,
);
if (report.aborted) process.exitCode = 1;
