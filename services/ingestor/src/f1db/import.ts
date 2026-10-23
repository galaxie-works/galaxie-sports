/**
 * Importação do F1DB no core, numa transação: casa com a F1 que já existe (api-sports), grava os vínculos no
 * `provider_map` e faz o upsert do lote normalizado. Com `dryRun`, roda tudo e desfaz no fim (prévia).
 *
 * Precedência: a api-sports continua dona dos eventos que já são dela (estado, participantes, imagens); o
 * F1DB só cria o que falta e nunca sobrescreve uma sessão de outra fonte (`F1DB_PRECEDENCE`). Nome e imagem
 * de piloto, equipe e circuito casados também ficam com a outra fonte (o F1DB só preenche lacunas).
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import {
  F1DB_PROVIDER,
  F1DB_SPORT,
  F1_COMPETITION_ID,
  matchF1db,
  normalizeF1db,
  type F1dbTables,
  type MatchReport,
  type PrecedencePolicy,
} from '@galaxie/providers';
import { linkIds, type Tx } from '../normalize/sql-helpers.js';
import { upsertBatchInTx, type UpsertStats } from '../normalize/upsert-core.js';
import { loadCoreF1Snapshot } from './snapshot.js';

/** O F1DB nunca assume o estado de uma sessão de outra fonte, por mais antiga que seja a observação dela. */
export const F1DB_PRECEDENCE: PrecedencePolicy = {
  order: ['api-sports', F1DB_PROVIDER],
  staleAfterMs: Number.POSITIVE_INFINITY,
};

export interface F1dbImportResult {
  dryRun: boolean;
  match: MatchReport;
  linked: { participants: number; venues: number; events: number; competition: boolean };
  covered: number;
  batch: { events: number; participants: number; venues: number; stages: number; standings: number };
  upsert: UpsertStats;
}

class DryRunRollback extends Error {
  constructor(readonly result: F1dbImportResult) {
    super('prévia: transação desfeita');
  }
}

/** Liga a competição sintética do F1DB à do catálogo (a mesma `world-championship` da api-sports). */
async function linkCompetition(tx: Tx): Promise<boolean> {
  const rows = await tx.execute<{ entity_id: string }>(sql`
    insert into core.provider_map (entity_type, entity_id, provider, sport, provider_id)
    select 'competition', pm.entity_id, ${F1DB_PROVIDER}, ${F1DB_SPORT}, ${F1_COMPETITION_ID}
      from core.provider_map pm
     where pm.entity_type = 'competition' and pm.sport = ${F1DB_SPORT}
       and pm.provider_id = ${F1_COMPETITION_ID} and pm.provider <> ${F1DB_PROVIDER}
     limit 1
    on conflict do nothing
    returning entity_id`);
  return rows.length > 0;
}

export async function importF1db(
  db: Database,
  input: { tables: F1dbTables; release: string; observedAt?: Date; dryRun?: boolean },
): Promise<F1dbImportResult> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`normalize:${F1DB_PROVIDER}:${F1DB_SPORT}`}))`,
      );
      const scope = { provider: F1DB_PROVIDER, sport: F1DB_SPORT };
      const core = await loadCoreF1Snapshot(tx);
      const links = matchF1db(input.tables, core);
      await linkIds(tx, scope, 'participant', links.created.participants);
      await linkIds(tx, scope, 'venue', links.created.venues);
      await linkIds(tx, scope, 'event', links.created.events);
      const competition = await linkCompetition(tx);

      const batch = normalizeF1db(input.tables, {
        observedAt: input.observedAt ?? new Date(),
        release: input.release,
        coveredRaces: links.coveredRaces,
        stageLabels: links.stageLabels,
        // casado = a entidade também é de outra fonte; as que o próprio F1DB criou continuam donas do cadastro
        matchedParticipants: sharedWith(links.participants, core.participants),
        matchedVenues: sharedWith(links.venues, core.venues),
      });
      const upsert = await upsertBatchInTx(tx, batch, { precedence: F1DB_PRECEDENCE, derbyLookup: false });
      const result: F1dbImportResult = {
        dryRun: !!input.dryRun,
        match: links.report,
        linked: {
          participants: links.created.participants.length,
          venues: links.created.venues.length,
          events: links.created.events.length,
          competition,
        },
        covered: links.coveredRaces.size,
        batch: {
          events: batch.events.length,
          participants: batch.participants.length,
          venues: batch.venues.length,
          stages: batch.stages.length,
          standings: batch.standings.length,
        },
        upsert,
      };
      if (input.dryRun) throw new DryRunRollback(result);
      return result;
    });
  } catch (err) {
    if (err instanceof DryRunRollback) return err.result;
    throw err;
  }
}

/** IDs do F1DB cuja entidade também vem de outra fonte. */
function sharedWith(links: Map<string, string>, others: { entityId: string }[]): Set<string> {
  const entities = new Set(others.map((o) => o.entityId));
  return new Set([...links].filter(([, entityId]) => entities.has(entityId)).map(([id]) => id));
}
