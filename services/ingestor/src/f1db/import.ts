/**
 * Importação do F1DB no core, numa transação: casa com a F1 que já existe (api-sports), grava os vínculos no
 * `provider_map` e faz o upsert do lote normalizado, de `SEASONS_PER_BATCH` em `SEASONS_PER_BATCH` temporadas
 * (o release inteiro num lote só passa de 1 GB de heap). Com `dryRun`, roda tudo e desfaz no fim (prévia): o
 * core e o `provider_map` ficam como estavam.
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
  f1dbCountries,
  f1dbSeasonRange,
  matchF1db,
  normalizeF1db,
  rowsOf,
  sliceF1dbSeasons,
  type F1dbTables,
  type MatchReport,
  type PrecedencePolicy,
} from '@galaxie/providers';
import { linkIds, type Tx } from '../normalize/sql-helpers.js';
import { addStats, emptyStats, upsertBatchInTx, type UpsertStats } from '../normalize/upsert-core.js';
import { loadCoreF1Snapshot } from './snapshot.js';

/** O F1DB nunca assume o estado de uma sessão de outra fonte, por mais antiga que seja a observação dela. */
export const F1DB_PRECEDENCE: PrecedencePolicy = {
  order: ['api-sports', F1DB_PROVIDER],
  staleAfterMs: Number.POSITIVE_INFINITY,
};

/** Temporadas por lote de upsert. */
export const SEASONS_PER_BATCH = 10;

/** Entidade do core com mais de um ID do F1DB (a mesma equipe com outro nome): entra como uma só. */
export interface F1dbSharedEntity {
  entityId: string;
  name: string;
  f1dbIds: string[];
}

export interface F1dbImportResult {
  dryRun: boolean;
  match: MatchReport;
  linked: { participants: number; venues: number; events: number; competition: boolean };
  covered: number;
  /** Países que o core não tinha, criados a partir do F1DB (códigos ISO). */
  countries: string[];
  /** Entidades do core que receberam mais de um ID do F1DB (confira). */
  shared: F1dbSharedEntity[];
  batch: { events: number; participants: number; venues: number; stages: number; standings: number };
  upsert: UpsertStats;
}

class DryRunRollback extends Error {
  constructor(readonly result: F1dbImportResult) {
    super('prévia: transação desfeita');
  }
}

/** Cria os países do F1DB que o core ainda não tem (`f1dbCountries`); os existentes ficam como estão. */
async function ensureCountries(tx: Tx, tables: F1dbTables): Promise<string[]> {
  const rows = f1dbCountries(tables);
  if (!rows.length) return [];
  const created = await tx.execute<{ code: string }>(sql`
    insert into core.country (code, name)
    values ${sql.join(
      rows.map((c) => sql`(${c.code}, ${JSON.stringify(c.name)}::jsonb)`),
      sql`, `,
    )}
    on conflict (code) do nothing
    returning code`);
  return created.map((r) => r.code).sort();
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
      // antes do upsert: sem a linha do país, o código do piloto é descartado
      const countries = await ensureCountries(tx, input.tables);

      const ctx = {
        observedAt: input.observedAt ?? new Date(),
        release: input.release,
        coveredRaces: links.coveredRaces,
        stageLabels: links.stageLabels,
        // casado = a entidade também é de outra fonte; as que o próprio F1DB criou continuam donas do cadastro
        matchedParticipants: sharedWith(links.participants, core.participants),
        matchedVenues: sharedWith(links.venues, core.venues),
      };
      let upsert = emptyStats();
      const counts = { events: 0, stages: 0, standings: 0 };
      const seen = { participants: new Set<string>(), venues: new Set<string>() };
      const range = f1dbSeasonRange(input.tables);
      for (let from = range?.from ?? 0; range && from <= range.to; from += SEASONS_PER_BATCH) {
        const batch = normalizeF1db(sliceF1dbSeasons(input.tables, from, from + SEASONS_PER_BATCH - 1), ctx);
        upsert = addStats(
          upsert,
          await upsertBatchInTx(tx, batch, { precedence: F1DB_PRECEDENCE, derbyLookup: false }),
        );
        counts.events += batch.events.length;
        counts.stages += batch.stages.length;
        counts.standings += batch.standings.length;
        for (const p of batch.participants) seen.participants.add(p.id);
        for (const v of batch.venues) seen.venues.add(v.id);
      }
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
        countries,
        shared: sharedEntities(links.participants, core.participants, input.tables),
        batch: {
          events: counts.events,
          participants: seen.participants.size,
          venues: seen.venues.size,
          stages: counts.stages,
          standings: counts.standings,
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

/** Entidades com mais de um ID do F1DB (vínculos antigos e novos), com o nome da outra fonte ou do F1DB. */
function sharedEntities(
  links: Map<string, string>,
  others: { entityId: string; name: string }[],
  tables: F1dbTables,
): F1dbSharedEntity[] {
  const byEntity = new Map<string, string[]>();
  for (const [id, entityId] of links) byEntity.set(entityId, [...(byEntity.get(entityId) ?? []), id]);
  const names = new Map(others.map((o) => [o.entityId, o.name]));
  const f1dbName = new Map(
    [...rowsOf(tables, 'constructor'), ...rowsOf(tables, 'driver')].map((r) => [
      String(r.id),
      String(r.name ?? r.id),
    ]),
  );
  return [...byEntity]
    .filter(([, ids]) => ids.length > 1)
    .map(([entityId, ids]) => ({
      entityId,
      name: names.get(entityId) ?? f1dbName.get(ids[0]!.replace(/^driver-/, '')) ?? ids[0]!,
      f1dbIds: ids.sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
