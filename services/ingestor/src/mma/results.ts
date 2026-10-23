/**
 * Desfecho das lutas de MMA (método, round e tempo) — `fights/results`. No plano free não há `ids=` nem `date=`
 * fora de ontem → amanhã: o histórico sai luta a luta (`fights/results?id=`), uma chamada cada. A fila prioriza o
 * que a TV mostra primeiro: luta principal da noite, card principal, preliminares e preliminares iniciais; dentro
 * de cada nível, os eventos numerados do UFC e os cards mais recentes antes.
 */
import {
  ApiSportsError,
  normalizeParams,
  PlanViolationError,
  QuotaExceededError,
  type ApiSportsClient,
} from '@galaxie/apisports-client';
import { apiResponse, event, jobRun, season, sportEventDetail, stage, type Database } from '@galaxie/db';
import { mmaCardPlacement, type MmaCardSegment } from '@galaxie/providers';
import { and, eq, sql } from 'drizzle-orm';

export interface MmaFightRow {
  /** ID da luta no fornecedor. */
  fightId: string;
  cardId: string | null;
  cardName: string;
  startsAt: Date;
  status: string;
  summary: Record<string, unknown>;
}

export interface MmaResultCandidate {
  fightId: string;
  cardName: string;
  startsAt: Date;
  segment: MmaCardSegment;
  mainEvent: boolean;
}

const SEGMENT_RANK: Readonly<Record<MmaCardSegment, number>> = { main_card: 1, prelims: 2, early_prelims: 3 };

/** "UFC 300: …" (evento numerado, o PPV) vem antes de "UFC Fight Night: …". */
const numberedEvent = (cardName: string) => /^UFC \d+/i.test(cardName);

/**
 * Lutas encerradas que ainda não têm o desfecho no raw, na ordem de busca. Canceladas e não realizadas ficam de
 * fora (o fornecedor não tem desfecho para elas).
 */
export function prioritizeMmaResults(fights: MmaFightRow[], known: ReadonlySet<string>): MmaResultCandidate[] {
  const byCard = new Map<string, MmaFightRow[]>();
  for (const f of fights) {
    const key = f.cardId ?? `fight:${f.fightId}`;
    byCard.set(key, [...(byCard.get(key) ?? []), f]);
  }
  const out: MmaResultCandidate[] = [];
  for (const card of byCard.values()) {
    const placement = mmaCardPlacement(
      card[0]!.cardName,
      card.map((f) => f.summary),
    );
    for (const f of card) {
      if (f.status !== 'finished' || known.has(f.fightId)) continue;
      const p = placement.get(f.fightId);
      out.push({
        fightId: f.fightId,
        cardName: f.cardName,
        startsAt: f.startsAt,
        segment: p?.segment ?? 'main_card',
        mainEvent: p?.mainEvent ?? false,
      });
    }
  }
  const rank = (c: MmaResultCandidate) => (c.mainEvent ? 0 : SEGMENT_RANK[c.segment]);
  return out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(numberedEvent(b.cardName)) - Number(numberedEvent(a.cardName)) ||
      b.startsAt.getTime() - a.startsAt.getTime() ||
      Number(a.fightId) - Number(b.fightId),
  );
}

/** Lutas da temporada (core) com o card e o item do fornecedor. */
export async function loadMmaFights(db: Database, year: number): Promise<MmaFightRow[]> {
  const rows = await db
    .select({
      fightId: sportEventDetail.providerEventId,
      cardId: stage.id,
      cardName: sql<string | null>`${stage.name}->>'en'`,
      startsAt: event.startsAt,
      status: event.status,
      summary: sportEventDetail.summary,
    })
    .from(event)
    .innerJoin(sportEventDetail, eq(sportEventDetail.eventId, event.id))
    .innerJoin(season, eq(season.id, event.seasonId))
    .leftJoin(stage, eq(stage.id, event.stageId))
    .where(and(eq(event.sport, 'mma'), eq(season.year, year)));
  return rows.map((r) => ({
    ...r,
    cardName: r.cardName ?? String((r.summary as { slug?: unknown }).slug ?? ''),
    summary: r.summary as Record<string, unknown>,
  }));
}

/** IDs de luta que já têm `fights/results` no raw (qualquer idade: o desfecho de luta passada não muda). */
export async function knownMmaResults(db: Database): Promise<Set<string>> {
  const rows = await db
    .select({ id: sql<string>`${apiResponse.params}->>'id'` })
    .from(apiResponse)
    .where(
      and(
        eq(apiResponse.sport, 'mma'),
        eq(apiResponse.endpoint, '/fights/results'),
        eq(apiResponse.statusCode, 200),
        sql`${apiResponse.params} ? 'id'`,
        sql`coalesce(${apiResponse.results}, 0) > 0`,
      ),
    );
  return new Set(rows.map((r) => r.id));
}

export interface MmaResultsJobResult {
  planned: number;
  spent: number;
  cached: number;
  deferred: number;
  errors: { fightId: string; detail: string }[];
}

/**
 * Busca o desfecho das lutas na ordem de `prioritizeMmaResults` até `limit` ou até o Governor negar a cota
 * (prioridade BOOTSTRAP). Só grava no raw: `normalize:sports mma` leva o desfecho ao core.
 */
export async function runMmaResultsJob(
  db: Database,
  client: ApiSportsClient,
  options: { year: number; limit?: number },
): Promise<MmaResultsJobResult> {
  const queue = prioritizeMmaResults(await loadMmaFights(db, options.year), await knownMmaResults(db));
  const todo = queue.slice(0, options.limit ?? queue.length);
  const [run] = await db.insert(jobRun).values({ job: 'bootstrap:mma-results', status: 'running' }).returning();
  const jobId = `job-run:${run!.id}`;
  const out: MmaResultsJobResult = { planned: todo.length, spent: 0, cached: 0, deferred: 0, errors: [] };
  try {
    for (const [i, c] of todo.entries()) {
      try {
        const res = await client.get({
          sport: 'mma',
          endpoint: '/fights/results',
          params: normalizeParams({ id: c.fightId }),
          priority: 'BOOTSTRAP',
          jobId,
        });
        if (res.source === 'network') out.spent += 1;
        else out.cached += 1;
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          out.deferred = todo.length - i;
          break;
        }
        if (err instanceof PlanViolationError || err instanceof ApiSportsError) {
          out.errors.push({ fightId: c.fightId, detail: err.message });
          continue;
        }
        throw err;
      }
    }
    await db
      .update(jobRun)
      .set({
        status: 'ok',
        finishedAt: new Date(),
        callsSpent: out.spent,
        stats: { year: options.year, ...out, pending: queue.length - out.spent - out.cached },
      })
      .where(eq(jobRun.id, run!.id));
    return out;
  } catch (err) {
    await db
      .update(jobRun)
      .set({ status: 'error', finishedAt: new Date(), callsSpent: out.spent, error: String(err) })
      .where(eq(jobRun.id, run!.id));
    throw err;
  }
}
