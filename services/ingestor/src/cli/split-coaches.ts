/**
 * Separa técnicos e jogadores que dividiam a mesma pessoa (ids da api-sports colididos), sem chamar o fornecedor.
 *   pnpm --filter @galaxie/ingestor pessoas:separar-tecnicos --plan   # prévia: conta e desfaz
 *   pnpm --filter @galaxie/ingestor pessoas:separar-tecnicos
 * Depois, reprocessar o perfil dos técnicos:
 *   pnpm --filter @galaxie/ingestor normalize:football --tudo --endpoints /coachs,/trophies,/sidelined,/players,/players/squads
 */
import { closeDb, createDb } from '@galaxie/db';
import { splitCoachIds } from '../normalize/split-coaches.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');

const plan = process.argv.includes('--plan');
const db = createDb(url);
try {
  const r = await splitCoachIds(db, { dryRun: plan });
  if (plan) console.log('Prévia (nada gravado):');
  console.log(
    `Ids de técnico vistos: ${r.coachIds} · só técnico (mapeamento renomeado): ${r.renamed} · ` +
      `técnico separado do jogador: ${r.split} · elencos de técnico movidos: ${r.rostersMoved}`,
  );
} finally {
  await closeDb(db);
}
