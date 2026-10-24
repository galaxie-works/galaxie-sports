/** Eventos de todos os esportes: placar dos encerrados e jogos que ficaram "ao vivo" depois do fim. */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import type { QualityFailureItem, QualityRule, RuleOutcome } from '../types.js';

/** Falhas guardadas por regra e esporte (a contagem é sempre a completa). */
export const MAX_FAILURES_PER_SPORT = 200;

/** Jogo encerrado (ou terminado há mais que isto) que ainda está em andamento = travado. */
const STALE_LIVE_HOURS = 3;

type CountRow = { sport: string; checked: number; failed: number };
type EventRow = {
  id: string;
  sport: string;
  starts_at: string;
  home: string | null;
  away: string | null;
  status: string;
  score: unknown;
};

export function outcomeBySport(
  counts: CountRow[],
  rows: EventRow[],
  describe: (r: EventRow) => Pick<QualityFailureItem, 'current' | 'expected'>,
): RuleOutcome {
  return {
    checked: Object.fromEntries(counts.map((c) => [c.sport, Number(c.checked)])),
    failed: Object.fromEntries(counts.map((c) => [c.sport, Number(c.failed)])),
    failures: rows.map((r) => ({
      key: r.id,
      sport: r.sport,
      label: `${r.home ?? '?'} × ${r.away ?? '?'} · ${String(r.starts_at).slice(0, 10)}`,
      ...describe(r),
      link: { type: 'event', id: r.id },
    })),
  };
}

/** Jogos (com mandante) que entram na regra, as contagens por esporte e os errados (no máximo N por esporte). */
async function eventsBySport(db: Database, scope: ReturnType<typeof sql>, wrong: ReturnType<typeof sql>) {
  const counts = await db.execute<CountRow>(sql`
    select e.sport, count(*)::int as checked, count(*) filter (where ${wrong})::int as failed
      from core.event e
     where ${scope} and exists (select 1 from core.event_participant ep where ep.event_id = e.id and ep.side = 'home')
     group by e.sport`);
  const rows = await db.execute<EventRow>(sql`
    select id::text, sport, starts_at, status, score, home, away from (
      select e.id, e.sport, e.starts_at, e.status::text, e.score,
             (select p.name from core.event_participant ep join core.participant p on p.id = ep.participant_id
               where ep.event_id = e.id and ep.side = 'home' limit 1) as home,
             (select p.name from core.event_participant ep join core.participant p on p.id = ep.participant_id
               where ep.event_id = e.id and ep.side = 'away' limit 1) as away,
             row_number() over (partition by e.sport order by e.starts_at desc) as n
        from core.event e
       where ${scope} and ${wrong}
         and exists (select 1 from core.event_participant ep where ep.event_id = e.id and ep.side = 'home')
    ) x where n <= ${MAX_FAILURES_PER_SPORT}`);
  return { counts, rows };
}

export const EVENT_RULES: QualityRule[] = [
  {
    id: 'events.finished-has-score',
    sport: 'all',
    area: 'events',
    severity: 'critical',
    description: {
      'pt-BR': 'Jogo encerrado tem placar dos dois lados',
      en: 'A finished game has a score for both sides',
      es: 'Un partido finalizado tiene marcador de ambos lados',
    },
    check: async (ctx) => {
      const { counts, rows } = await eventsBySport(
        ctx.db,
        sql`e.status = 'finished'`,
        sql`(e.score is null or e.score->>'home' is null or e.score->>'away' is null)`,
      );
      return outcomeBySport(counts, rows, () => ({ current: 'sem placar', expected: 'placar final' }));
    },
  },
  {
    id: 'events.no-stale-live',
    sport: 'all',
    area: 'events',
    severity: 'critical',
    description: {
      'pt-BR': `Jogo que já deveria ter acabado (fim previsto há mais de ${STALE_LIVE_HOURS} h) não fica "ao vivo"`,
      en: `A game that should be over (expected end more than ${STALE_LIVE_HOURS} h ago) is not left "live"`,
      es: `Un partido que ya debería haber terminado (fin previsto hace más de ${STALE_LIVE_HOURS} h) no queda "en vivo"`,
    },
    check: async (ctx) => {
      const ended = sql`e.ends_at_expected < ${ctx.now.toISOString()}::timestamptz - make_interval(hours => ${STALE_LIVE_HOURS})`;
      const { counts, rows } = await eventsBySport(
        ctx.db,
        // os do último mês (e qualquer um travado, por mais antigo)
        sql`${ended} and (e.starts_at > ${ctx.now.toISOString()}::timestamptz - interval '30 days' or e.status in ('starting', 'live', 'break'))`,
        sql`e.status in ('starting', 'live', 'break')`,
      );
      return outcomeBySport(counts, rows, (r) => ({
        current: r.status,
        expected: 'finished (ou adiado/cancelado)',
      }));
    },
  },
];
