/**
 * Curadoria interna da grade de uma plataforma (arquivo JSON fora do repositório, com os nomes reais).
 *   pnpm --filter @galaxie/ai-agents lineups:curate --arquivo /curadoria/grade.json            # prévia
 *   pnpm --filter @galaxie/ai-agents lineups:curate --arquivo /curadoria/grade.json --aplicar
 * Grava a grade completa da plataforma como aprovada, com a fonte "operadora (curadoria interna)".
 * `replaces` no arquivo: plataformas antigas que viraram esta (os tenants delas passam para a nova e a
 * antiga é rejeitada). Formato: `CuratedLineup` em src/lineups/curate.ts. Sem LLM.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { closeDb } from '@galaxie/db';
import { loadWtwConfig, syncBroadcasterLibrary } from '@galaxie/where-to-watch';
import { curateLineup, parseCuration } from '../lineups/curate.js';
import { dbFromEnv } from './common.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { arquivo: { type: 'string' }, aplicar: { type: 'boolean', default: false } },
    strict: true,
  });
  if (!values.arquivo) throw new Error('--arquivo <json> obrigatório.');
  const input = parseCuration(JSON.parse(readFileSync(values.arquivo, 'utf8')));
  const config = loadWtwConfig();
  const db = dbFromEnv();
  try {
    if (values.aplicar) await syncBroadcasterLibrary(db, config);
    const r = await curateLineup(db, config, input, { apply: values.aplicar });
    console.log(
      `${r.platform.name} (${r.platform.slug}) · ${r.platform.exists ? 'já existe' : 'nova'} · país ${input.country}`,
    );
    console.table(
      r.plans.map((p) => ({
        plano: p.name,
        preco: p.price ?? '—',
        canais: p.channels.join(', '),
        streamings: p.services.join(', '),
        'fora da biblioteca': p.unknown.join(', '),
      })),
    );
    if (r.addons.length)
      console.table(
        r.addons.map((a) => ({
          complemento: a.name,
          id: a.refId ?? '(fora da biblioteca)',
          preco: a.price ?? '—',
        })),
      );
    for (const o of r.replaces)
      console.log(
        `substitui ${o.slug}: ${o.found ? `encontrada; ${o.tenants.length} tenant(s) passam para a nova; a antiga é rejeitada` : 'não encontrada'}`,
      );
    if (r.unknown.length)
      console.log(`Fora da biblioteca (não entram até a curadoria do dicionário): ${r.unknown.join(', ')}`);
    console.log(
      r.applied
        ? `APLICADO: ${r.approved} item(ns) aprovados, fonte "${input.note ?? 'operadora (curadoria interna)'}".`
        : 'PRÉVIA: nada gravado. Rode de novo com --aplicar.',
    );
  } finally {
    await closeDb(db);
  }
}

main().catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
