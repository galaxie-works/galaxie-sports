import type { ApiSport, PlanRules, ProviderStatus } from '@galaxie/apisports-client';
import type { CatalogSource } from './catalog-source.js';
import { buildDetailRequests, selectDetailFixtures, splitDone } from './details-job.js';
import { collectFixtures, dateList } from './fixtures.js';
import {
  buildPersonRequests,
  PERSON_ENDPOINTS,
  peopleOfTeams,
  TEAM_ENDPOINTS,
  teamTargets,
} from './people-job.js';
import { cursorId, type CursorStore } from './runtime/cursor-store.js';
import type { RawSource } from './runtime/raw-source.js';
import { plannedRequest, type JobSpec, type PlannedRequest } from './runtime/runner.js';

const DAY_MS = 86_400_000;

/** Agenda diária das outras 11 APIs (cada uma com cota própria): 1 chamada = todas as ligas do dia. */
export const OTHER_SPORTS_SCHEDULE: Record<Exclude<ApiSport, 'football'>, string> = {
  afl: '/games',
  baseball: '/games',
  basketball: '/games',
  'formula-1': '/races',
  handball: '/games',
  hockey: '/games',
  mma: '/fights',
  nba: '/games',
  'american-football': '/games',
  rugby: '/games',
  volleyball: '/games',
};

/** Período do rodízio por endpoint: o cursor mais antigo que isso volta para a fila. */
export const ROTATION_PERIOD_DAYS: Record<string, number> = {
  '/players/squads': 7,
  '/coachs': 30,
  '/transfers': 30,
  '/trophies': 30,
  '/sidelined': 30,
};

export interface DailyOptions {
  /** Máximo de partidas detalhadas por dia (padrão: 35 no free, 400 nos pagos). */
  maxDetails?: number | undefined;
  /** Dias para trás varridos em busca de encerrados sem detalhe (padrão 3: D-1, D-2, D-3). */
  backlogDays?: number | undefined;
  /** Chamadas do rodízio de entidades por dia (padrão: 5 no free, 200 nos pagos). */
  rotation?: number | undefined;
  /** Também busca injuries?date=D+1. */
  injuriesTomorrow?: boolean | undefined;
  /** Agenda das outras 11 APIs (games/races/fights?date=). */
  otherSports?: boolean | undefined;
  maxTier?: number | undefined;
}

export function utcDate(d: Date, offsetDays = 0): string {
  return new Date(d.getTime() + offsetDays * DAY_MS).toISOString().slice(0, 10);
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isPaid(plan: PlanRules): boolean {
  return !plan.current.forbiddenParams.includes('ids');
}

/**
 * Passo fixo do dia: agenda mundial de ontem, hoje e amanhã, desfalques do dia e /leagues (novas temporadas
 * e cobertura). Cada item vale uma vez por dia UTC — reexecutar no mesmo dia não gasta cota de novo.
 */
export function buildScheduleRequests(now: Date, opts: DailyOptions = {}): PlannedRequest[] {
  const staleBefore = startOfUtcDay(now);
  const out: PlannedRequest[] = [-1, 0, 1].map((o) =>
    plannedRequest('fixtures-data', 'football', '/fixtures', { date: utcDate(now, o) }, { staleBefore }),
  );
  for (const o of opts.injuriesTomorrow ? [0, 1] : [0]) {
    out.push(
      plannedRequest('injuries-data', 'football', '/injuries', { date: utcDate(now, o) }, { staleBefore }),
    );
  }
  out.push(plannedRequest('leagues', 'football', '/leagues', {}, { staleBefore }));
  if (opts.otherSports) {
    for (const [sport, endpoint] of Object.entries(OTHER_SPORTS_SCHEDULE)) {
      for (const o of [-1, 0, 1]) {
        out.push(
          plannedRequest(
            'outros-esportes',
            sport as ApiSport,
            endpoint,
            { date: utcDate(now, o) },
            { staleBefore },
          ),
        );
      }
    }
  }
  return out;
}

/**
 * Rodízio de entidades dos times tier 1: escolhe os itens cujo cursor está mais velho que o período
 * (nunca buscados primeiro), até o limite do dia. Usa os mesmos cursores do bootstrap:people.
 * O limite vale por dia UTC: o que já foi renovado hoje desconta (reexecutar não gasta de novo).
 */
export async function buildRotationRequests(
  candidates: PlannedRequest[],
  cursors: CursorStore,
  now: Date,
  limit: number,
): Promise<PlannedRequest[]> {
  const states = await cursors.load(candidates.flatMap((c) => c.cursors));
  const today = startOfUtcDay(now).getTime();
  const aged: { item: PlannedRequest; age: number }[] = [];
  let renewedToday = 0;
  for (const item of candidates) {
    const period = (ROTATION_PERIOD_DAYS[item.endpoint] ?? 30) * DAY_MS;
    const staleBefore = new Date(now.getTime() - period);
    const times = item.cursors.map((c) => states.get(cursorId(c))?.completedAt?.getTime() ?? -Infinity);
    const age = Math.min(...times);
    if (age >= today) renewedToday += 1;
    if (age >= staleBefore.getTime()) continue;
    aged.push({ item: { ...item, staleBefore }, age });
  }
  limit = Math.max(0, limit - renewedToday);
  // estável: em empate, mantém a ordem de prioridade dos candidatos (squads tier 1 primeiro)
  return aged
    .map((a, i) => ({ ...a, i }))
    .sort((a, b) => a.age - b.age || a.i - b.i)
    .slice(0, limit)
    .map((a) => a.item);
}

export type StatusCheck =
  { sport: ApiSport; ok: true; status: ProviderStatus } | { sport: ApiSport; ok: false; error: unknown };

/**
 * /status de cada API antes do sync (não consome cota; reconcilia o Governor com o contador do fornecedor).
 * Uma API que falha (timeout, fora do ar) só fica registrada: o sync segue com o contador local, e o
 * futebol não deixa de rodar por causa de uma API auxiliar.
 */
export async function checkProviderStatus(
  sports: readonly ApiSport[],
  status: (sport: ApiSport) => Promise<ProviderStatus>,
): Promise<StatusCheck[]> {
  const out: StatusCheck[] = [];
  for (const sport of sports) {
    try {
      out.push({ sport, ok: true, status: await status(sport) });
    } catch (error) {
      out.push({ sport, ok: false, error });
    }
  }
  return out;
}

/** Job #19: sync diário incremental (prioridade DAILY). */
export function dailyJob(
  catalog: CatalogSource,
  raw: RawSource,
  cursors: CursorStore,
  plan: PlanRules,
  now: () => Date,
  derbyKeys: () => Promise<Set<string>>,
  opts: DailyOptions = {},
): JobSpec {
  return {
    job: 'sync:daily',
    priority: 'DAILY',
    phases: [
      { name: 'agenda e referência', build: async () => buildScheduleRequests(now(), opts) },
      {
        name: 'detalhe dos encerrados',
        build: async () => {
          const comps = new Map(
            (await catalog.competitions(opts.maxTier ?? 2)).map((c) => [c.leagueId, c] as const),
          );
          const days = opts.backlogDays ?? 3;
          const lists = Array.from({ length: days }, (_, i) => dateList(utcDate(now(), -(i + 1))));
          const ranked = selectDetailFixtures(await collectFixtures(raw, lists), comps, await derbyKeys(), {
            keyOnly: false,
          });
          const { pending } = await splitDone(
            ranked.map((f) => f.id),
            cursors,
          );
          const max = opts.maxDetails ?? (isPaid(plan) ? 400 : 35);
          return buildDetailRequests(pending.slice(0, max), plan.current);
        },
      },
      {
        name: 'rodízio de entidades',
        build: async () => {
          const teams = await teamTargets(catalog, raw, 1);
          const candidates: PlannedRequest[] = [];
          for (const e of TEAM_ENDPOINTS) {
            for (const t of teams)
              candidates.push(plannedRequest(e.step, 'football', e.endpoint, { team: t.teamId }));
          }
          const people = await peopleOfTeams(raw, new Set(teams.map((t) => t.teamId)));
          for (const e of PERSON_ENDPOINTS) {
            candidates.push(
              ...buildPersonRequests(
                e.step,
                e.endpoint,
                e.kind,
                e.kind === 'player' ? people.players : people.coaches,
              ),
            );
          }
          return buildRotationRequests(candidates, cursors, now(), opts.rotation ?? (isPaid(plan) ? 200 : 5));
        },
      },
    ],
  };
}
