/**
 * Preenche `player_pids`/`coach_pids` de `core.football_fixture` nas partidas gravadas antes da migration 0061 (o
 * trigger cuida das escritas novas). Percorre a tabela pela chave em lotes curtos, com pausa entre eles, e só toca
 * nas linhas ainda nulas: cada lote abre o JSON do detalhe de até `batchSize` partidas e segura a trava dessas
 * linhas por um instante (o upsert do ao vivo espera, não falha). O UPDATE não mexe no detalhe e não dispara o
 * trigger nem o change feed. Rode pelo job `fixture-people` (diário; sem nada nulo, só confere e sai).
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

export interface FixturePeopleOptions {
  /** Partidas por lote. Padrão 1000. */
  batchSize?: number | undefined;
  /** Pausa entre lotes (ms), para o lote não disputar disco com a API. Padrão 250. */
  pauseMs?: number | undefined;
  /** Teto de tempo da execução (ms): o que faltar fica para a próxima. Padrão 45 min. */
  maxMs?: number | undefined;
  /** Só conta as linhas nulas. */
  dryRun?: boolean | undefined;
  sleep?: (ms: number) => Promise<void>;
}

export interface FixturePeopleReport {
  /** Linhas preenchidas (ou nulas, no `dryRun`). */
  filled: number;
  batches: number;
  /** Parou pelo teto de tempo antes do fim da tabela. */
  partial: boolean;
  dryRun: boolean;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fillFixturePeople(
  db: Database,
  options: FixturePeopleOptions = {},
): Promise<FixturePeopleReport> {
  const { batchSize = 1000, pauseMs = 250, maxMs = 45 * 60_000, dryRun = false, sleep = wait } = options;
  if (dryRun) {
    const [row] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from core.football_fixture where player_pids is null or coach_pids is null`);
    return { filled: row?.n ?? 0, batches: 0, partial: false, dryRun };
  }
  // sem nada nulo (o normal depois da primeira passada), uma leitura só e sai
  const [pending] = await db.execute<{ any: boolean }>(sql`
    select exists (select 1 from core.football_fixture where player_pids is null or coach_pids is null) as any`);
  if (!pending?.any) return { filled: 0, batches: 0, partial: false, dryRun };

  const started = Date.now();
  let cursor: string | null = null;
  let filled = 0;
  let batches = 0;
  for (;;) {
    const [range]: { last: string | null }[] = await db.execute<{ last: string | null }>(sql`
      select event_id::text as last from (
        select event_id from core.football_fixture
         where ${cursor === null ? sql`true` : sql`event_id > ${cursor}::uuid`}
         order by event_id limit ${batchSize}) b
       order by event_id desc limit 1`);
    const last: string | null = range?.last ?? null;
    if (last === null) return { filled, batches, partial: false, dryRun };
    const updated = await db.execute<{ event_id: string }>(sql`
      update core.football_fixture
         set player_pids = core.fixture_player_pids(detail), coach_pids = core.fixture_coach_pids(detail)
       where ${cursor === null ? sql`true` : sql`event_id > ${cursor}::uuid`} and event_id <= ${last}::uuid
         and (player_pids is null or coach_pids is null)
      returning event_id`);
    filled += updated.length;
    batches += 1;
    cursor = last;
    if (Date.now() - started >= maxMs) return { filled, batches, partial: true, dryRun };
    if (updated.length) await sleep(pauseMs);
  }
}
