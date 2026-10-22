/**
 * Nomes anteriores de estádios e times derivados das partidas do fornecedor (cada jogo guarda o nome
 * do dia). Grava `provider_former_names` em core.venue/core.participant e atualiza o nome atual do
 * estádio para o do jogo mais recente. Idempotente; não chama o fornecedor.
 *   pnpm --filter @galaxie/ingestor names:derive
 */
import { closeDb, createDb } from '@galaxie/db';
import { deriveProviderNames, type NameDerivationStats } from '../normalize/name-history.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');

const db = createDb(url, { max: 2 });
try {
  const { venues, participants } = await deriveProviderNames(db);
  const row = (s: NameDerivationStats) => ({
    com_jogos: s.entities,
    um_nome: s.single,
    troca_aceita: s.renamed,
    ambiguos_de_fora: s.ambiguous,
    linhas_alteradas: s.changed,
    nome_atual_atualizado: s.currentNameUpdated ?? '-',
  });
  console.table({ estádios: row(venues), times: row(participants) });
  for (const [label, s] of [
    ['Estádios', venues],
    ['Times', participants],
  ] as const) {
    if (!s.ambiguousSamples.length) continue;
    console.log(`\n${label} ambíguos (exemplos, ficaram de fora):`);
    for (const line of s.ambiguousSamples) console.log(`  - ${line}`);
  }
} finally {
  await closeDb(db);
}
