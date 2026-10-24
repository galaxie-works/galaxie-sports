// Dados de exemplo para o preview do Builder e para os testes. Os objetos seguem os contratos completos
// da API (@galaxie/contracts): se um contrato mudar, o typecheck daqui acusa.
import type { Event, Standings, WhereToWatch } from '@galaxie/contracts';

import type { GsEvent, GsStandings, GsWhereToWatch } from './core/model.js';

export const PREVIEW_IDS = {
  liveEvent: '0199a5c0-0000-7000-8000-000000000001',
  scheduledEvent: '0199a5c0-0000-7000-8000-000000000002',
  finishedEvent: '0199a5c0-0000-7000-8000-000000000003',
  competition: 'liga-exemplo',
} as const;

const COMPETITION_ID = '0199a5c0-0000-7000-8000-0000000000c1';

/** Escudo genérico (SVG em data URI) na cor do time. */
function shield(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2 4 6v9c0 7.5 5.1 13 12 15 6.9-2 12-7.5 12-15V6z" fill="${color}"/><path d="M16 7 9 9.5V15c0 4.6 3 8 7 9.5 4-1.5 7-4.9 7-9.5V9.5z" fill="#fff" fill-opacity=".85"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const TEAMS = {
  aurora: {
    id: '0199a5c0-0000-7000-8000-0000000000a1',
    name: 'Clube Aurora',
    short: 'Aurora',
    color: '#1d4ed8',
  },
  estrela: {
    id: '0199a5c0-0000-7000-8000-0000000000a2',
    name: 'Estrela do Sul',
    short: 'Estrela',
    color: '#dc2626',
  },
  serra: {
    id: '0199a5c0-0000-7000-8000-0000000000a3',
    name: 'Atlético Serra',
    short: 'Serra',
    color: '#15803d',
  },
  litoral: {
    id: '0199a5c0-0000-7000-8000-0000000000a4',
    name: 'União Litoral',
    short: 'Litoral',
    color: '#0891b2',
  },
  planalto: {
    id: '0199a5c0-0000-7000-8000-0000000000a5',
    name: 'Real Planalto',
    short: 'Planalto',
    color: '#7c3aed',
  },
  vale: {
    id: '0199a5c0-0000-7000-8000-0000000000a6',
    name: 'Sporting Vale',
    short: 'Vale',
    color: '#ca8a04',
  },
} as const;
type TeamKey = keyof typeof TEAMS;

function participant(
  key: TeamKey,
  side: 'home' | 'away',
  winner: boolean | null,
): Event['participants'][number] {
  const t = TEAMS[key];
  return {
    side,
    id: t.id,
    name: t.name,
    short_name: t.short,
    logo: shield(t.color),
    nickname: null,
    winner,
    fan_tags: [],
  };
}

function makeEvent(e: {
  id: string;
  home: TeamKey;
  away: TeamKey;
  startsAt: Date;
  status: Event['status'];
  score: [number | null, number | null];
  minute?: number;
  penalty?: [number, number];
  winner?: 'home' | 'away';
}): Event {
  const pair = (h: number | null, a: number | null) => ({ home: h, away: a });
  return {
    id: e.id,
    sport: 'football',
    competition: {
      id: COMPETITION_ID,
      slug: PREVIEW_IDS.competition,
      name: 'Liga Exemplo',
      nickname: null,
      logo: null,
    },
    stage: { kind: 'regular_season', leg: null, name: 'Rodada 12' },
    starts_at: e.startsAt.toISOString(),
    status: e.status,
    status_detail: null,
    clock: e.minute ? { minute: e.minute, extra: null, period: '2H' } : null,
    momentum: null,
    importance: 55,
    importance_breakdown: null,
    relevance: null,
    relevance_by_market: null,
    participants: [
      participant(e.home, 'home', e.winner ? e.winner === 'home' : null),
      participant(e.away, 'away', e.winner ? e.winner === 'away' : null),
    ],
    score: {
      ...pair(e.score[0], e.score[1]),
      halftime: null,
      extratime: null,
      penalty: e.penalty ? pair(e.penalty[0], e.penalty[1]) : null,
      aggregate: null,
      periods: null,
    },
    venue: {
      id: '0199a5c0-0000-7000-8000-0000000000e1',
      name: 'Arena Exemplo',
      city: 'São Paulo',
      timezone: null,
    },
    referee: null,
    derby: null,
    competition_context: [],
    stakes: [],
    data_freshness: { last_valid_at: null, is_stale: false },
    provisional: null,
  };
}

function standingRow(rank: number, key: TeamKey, s: [number, number, number, number, number]) {
  const t = TEAMS[key];
  const [won, drawn, lost, gf, ga] = s;
  return {
    rank,
    participant: { id: t.id, name: t.name, short_name: t.short, logo: shield(t.color) },
    points: won * 3 + drawn,
    played: won + drawn + lost,
    won,
    drawn,
    lost,
    ot_won: null,
    ot_lost: null,
    goals_for: gf,
    goals_against: ga,
    goal_diff: gf - ga,
    form: 'WDWLW',
    description: rank <= 2 ? 'Classificação para a fase final' : null,
  } satisfies Standings['groups'][number]['rows'][number];
}

export interface PreviewFixtures {
  events: GsEvent[];
  standings: GsStandings;
  whereToWatch: GsWhereToWatch;
}

/** Três jogos (ao vivo, mais tarde e encerrado), a tabela e o onde assistir, relativos a `now`. */
export function createPreviewFixtures(now: Date = new Date()): PreviewFixtures {
  const minutes = (m: number) => new Date(now.getTime() + m * 60_000);
  const events: Event[] = [
    makeEvent({
      id: PREVIEW_IDS.liveEvent,
      home: 'aurora',
      away: 'estrela',
      startsAt: minutes(-72),
      status: 'live',
      score: [2, 1],
      minute: 67,
    }),
    makeEvent({
      id: PREVIEW_IDS.scheduledEvent,
      home: 'serra',
      away: 'litoral',
      startsAt: minutes(150),
      status: 'scheduled',
      score: [null, null],
    }),
    makeEvent({
      id: PREVIEW_IDS.finishedEvent,
      home: 'planalto',
      away: 'vale',
      startsAt: minutes(-240),
      status: 'finished',
      score: [0, 0],
      penalty: [4, 3],
      winner: 'home',
    }),
  ];
  const standings: Standings = {
    competition_id: COMPETITION_ID,
    season: { year: now.getUTCFullYear(), label: String(now.getUTCFullYear()) },
    groups: [
      {
        name: null,
        rows: [
          standingRow(1, 'aurora', [8, 2, 1, 21, 9]),
          standingRow(2, 'planalto', [7, 3, 1, 18, 8]),
          standingRow(3, 'serra', [6, 2, 3, 15, 12]),
          standingRow(4, 'estrela', [5, 2, 4, 14, 13]),
          standingRow(5, 'litoral', [3, 3, 5, 10, 16]),
          standingRow(6, 'vale', [1, 2, 8, 6, 26]),
        ],
      },
    ],
    source: 'computed',
    updated_at: now.toISOString(),
  };
  const verified = now.toISOString();
  const whereToWatch: WhereToWatch = {
    event_id: PREVIEW_IDS.liveEvent,
    country: 'BR',
    status: 'resolved',
    message: null,
    options: [
      {
        id: '0199a5c0-0000-7000-8000-0000000000f1',
        provider: 'TV Exemplo',
        provider_id: null,
        channel: null,
        medium: 'free_tv',
        access_model: 'free',
        region: null,
        watch_url: null,
        confidence: 1,
        status: 'confirmed',
        last_verified_at: verified,
        sources: [],
        logo: null,
        logo_dark: null,
      },
      {
        id: '0199a5c0-0000-7000-8000-0000000000f2',
        provider: 'Canal Esporte Exemplo',
        provider_id: null,
        channel: 'Esporte Exemplo 2',
        medium: 'pay_tv',
        access_model: 'subscription',
        region: null,
        watch_url: null,
        confidence: 1,
        status: 'confirmed',
        last_verified_at: verified,
        sources: [],
        logo: null,
        logo_dark: null,
      },
      {
        id: '0199a5c0-0000-7000-8000-0000000000f3',
        provider: 'Operadora Exemplo Play',
        provider_id: null,
        channel: null,
        medium: 'streaming_svod',
        access_model: 'subscription',
        region: null,
        watch_url: 'https://example.com/assistir',
        confidence: 0.9,
        status: 'confirmed',
        last_verified_at: verified,
        sources: [],
        logo: null,
        logo_dark: null,
      },
    ],
    to_confirm: [],
    availability: { free_tv: [], pay_tv_channels: [], platforms: [], your_operator: null },
    updated_at: verified,
  };
  return { events, standings, whereToWatch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * `fetch` que responde como a API pública com os dados de exemplo — para o preview do Builder sem chave
 * e para os testes. Passe em `<GalaxieWidgetProvider fetch={createPreviewFetch()}>`.
 */
export function createPreviewFetch(options: { now?: Date } = {}): typeof fetch {
  return async (input) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw, 'http://preview.local').pathname.replace(/\/+$/, '');
    const f = createPreviewFixtures(options.now ?? new Date());
    if (path.endsWith('/v1/events/live')) {
      return json({ data: f.events.filter((e) => e.status === 'live' || e.status === 'break') });
    }
    if (path.endsWith('/v1/events')) return json({ data: f.events, next_cursor: null });
    const watch = /\/v1\/events\/([^/]+)\/where-to-watch$/.exec(path);
    if (watch) return json({ ...f.whereToWatch, event_id: decodeURIComponent(watch[1]!) });
    const event = /\/v1\/events\/([^/]+)$/.exec(path);
    if (event) {
      const found = f.events.find((e) => e.id === decodeURIComponent(event[1]!));
      return found
        ? json(found)
        : json({ type: 'about:blank', title: 'Evento não encontrado', status: 404, code: 'NOT_FOUND' }, 404);
    }
    if (/\/v1\/competitions\/[^/]+\/seasons\/[^/]+\/standings$/.test(path)) return json(f.standings);
    return json({ type: 'about:blank', title: 'Rota não encontrada', status: 404, code: 'NOT_FOUND' }, 404);
  };
}
