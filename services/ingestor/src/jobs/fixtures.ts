import type { RawQuery, RawSource } from './runtime/raw-source.js';

/** Item de `response` em /fixtures e /fixtures/headtohead (só os campos que os jobs usam). */
export interface ApiFixture {
  fixture: { id: number; date?: string; status?: { short?: string } };
  league: { id: number; season: number; round?: string | null };
  teams: { home: { id: number | null }; away: { id: number | null } };
}

/** Resumo de uma partida conhecida pelo raw. */
export interface FixtureRef {
  id: number;
  status: string;
  /** ISO do início (UTC). */
  date: string;
  leagueId: number;
  season: number;
  round: string | null;
  homeId: number | null;
  awayId: number | null;
  fetchedAt: Date;
}

/** Encerradas com súmula: só essas recebem detalhe (eventos, escalações, estatísticas). */
export const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

/** Listas de temporada inteira (fixtures?league&season). */
export const SEASON_LISTS: RawQuery = {
  sport: 'football',
  endpoint: '/fixtures',
  has: ['league', 'season'],
  lacks: ['id', 'ids', 'live'],
};

/** Confrontos diretos (h2h), que trazem todas as temporadas — inclusive a atual. */
export const H2H_LISTS: RawQuery = { sport: 'football', endpoint: '/fixtures/headtohead', has: ['h2h'] };

/** Agenda mundial de um dia (fixtures?date=). */
export function dateList(date: string): RawQuery {
  return {
    sport: 'football',
    endpoint: '/fixtures',
    where: { date },
    lacks: ['id', 'ids', 'live', 'league'],
  };
}

function isApiFixture(x: unknown): x is ApiFixture {
  const f = x as ApiFixture | null;
  return !!f && typeof f.fixture?.id === 'number' && typeof f.league?.id === 'number' && f.teams != null;
}

export function toFixtureRef(f: ApiFixture, fetchedAt: Date): FixtureRef {
  return {
    id: f.fixture.id,
    status: f.fixture.status?.short ?? 'NS',
    date: f.fixture.date ?? '',
    leagueId: f.league.id,
    season: f.league.season,
    round: f.league.round ?? null,
    homeId: f.teams.home?.id ?? null,
    awayId: f.teams.away?.id ?? null,
    fetchedAt,
  };
}

export function apiFixtures(response: unknown): ApiFixture[] {
  return Array.isArray(response) ? response.filter(isApiFixture) : [];
}

/**
 * Junta as partidas de várias consultas ao raw sem repetir: a mesma partida aparece na lista da temporada,
 * no h2h e na agenda do dia — vale a versão mais recente (status mais atualizado).
 */
export async function collectFixtures(raw: RawSource, queries: RawQuery[]): Promise<FixtureRef[]> {
  const byId = new Map<number, FixtureRef>();
  for (const q of queries) {
    for await (const entry of raw.latest(q)) {
      for (const f of apiFixtures(entry.response)) {
        const prev = byId.get(f.fixture.id);
        if (!prev || prev.fetchedAt <= entry.fetchedAt)
          byId.set(f.fixture.id, toFixtureRef(f, entry.fetchedAt));
      }
    }
  }
  return [...byId.values()];
}

/** Rodadas eliminatórias que justificam detalhe histórico mesmo no free (finais, semis, quartas). */
export function isDecisive(round: string | null): boolean {
  return !!round && /\b(final|semi-finals?|quarter-finals?)\b/i.test(round);
}

/** Par de times em ordem canônica ("menor-maior"): h2h=A-B e h2h=B-A são a mesma consulta. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Reconstrução da temporada a partir dos h2h (docs/03 §1.1): filtra liga e temporada nas respostas de
 * fixtures/headtohead já gravadas e remove duplicatas por fixture.id (cada jogo aparece no h2h do seu par).
 * Devolve os itens originais do fornecedor — prontos para a normalização raw → core.
 */
export async function reconstructSeasonFromH2h(
  raw: RawSource,
  leagueId: number,
  season: number,
): Promise<ApiFixture[]> {
  const byId = new Map<number, { item: ApiFixture; at: Date }>();
  for await (const entry of raw.latest(H2H_LISTS)) {
    for (const f of apiFixtures(entry.response)) {
      if (f.league.id !== leagueId || f.league.season !== season) continue;
      const prev = byId.get(f.fixture.id);
      if (!prev || prev.at <= entry.fetchedAt) byId.set(f.fixture.id, { item: f, at: entry.fetchedAt });
    }
  }
  return [...byId.values()]
    .map((v) => v.item)
    .sort((a, b) => (a.fixture.date ?? '').localeCompare(b.fixture.date ?? ''));
}
