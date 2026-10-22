/**
 * Simulação ao vivo para desenvolvimento (demo "Ao vivo" e "Minuto a minuto" sem jogo de verdade).
 *
 *   SIM_DATABASE_URL=postgres://…/galaxie_sim pnpm --filter @galaxie/ingestor live:simulate [--velocidade 3]
 *
 * Usa o mundo falso dos testes (`testing/live-world.ts`): partidas com roteiro relativo a agora (uma no 1º
 * tempo, um clássico no 2º, uma semifinal que vai à prorrogação e aos pênaltis e uma que começa em
 * minutos), servidas por um `fixtures?live=` falso. O Live Poller real lê esse fornecedor a cada
 * `--intervalo` segundos e grava pelo caminho de produção (normalização, máquina de estados, change
 * feed, SSE). Nenhuma chamada sai para a rede.
 *
 * Segurança: só roda num banco cujo nome começa com `galaxie_sim` (criado e migrado se não existir) e
 * nunca com NODE_ENV=production — os IDs falsos do fornecedor colidiriam com os reais.
 * Depois: suba a API apontando para esse banco, crie um tenant (`pnpm --filter @galaxie/api
 * tenant:create --slug demo-sim`) e rode a demo com GALAXIE_API_URL/GALAXIE_DEMO_KEY dessa API.
 */
import { parseArgs } from 'node:util';
import { sql } from 'drizzle-orm';
import { closeDb, competition, createDb, runMigrations, sport } from '@galaxie/db';
import {
  ApiSportsProvider,
  normalizeFixtures,
  type ApiFixture,
  type ApiFixtureEvent,
} from '@galaxie/providers';
import { LivePoller } from '../live/poller.js';
import { PgLiveStore } from '../live/store.js';
import { upsertBatch } from '../normalize/upsert-core.js';
import { apiFixture, liveWorld, matchState, realOffset, type WorldMatch } from '../testing/live-world.js';

const MIN = 60_000;

const { values } = parseArgs({
  options: {
    velocidade: { type: 'string', default: '1' },
    intervalo: { type: 'string', default: '15' },
    help: { type: 'boolean', short: 'h' },
  },
});
if (values.help) {
  console.log(
    'Uso: SIM_DATABASE_URL=postgres://…/galaxie_sim… live:simulate [--velocidade 1] [--intervalo 15]',
  );
  process.exit(0);
}
if (process.env.NODE_ENV === 'production') throw new Error('live:simulate é só para desenvolvimento.');
const simUrl = process.env.SIM_DATABASE_URL;
if (!simUrl) throw new Error('Defina SIM_DATABASE_URL (banco galaxie_sim*, nunca o banco de trabalho).');
const dbName = new URL(simUrl).pathname.slice(1);
if (!/^galaxie_sim\w*$/.test(dbName))
  throw new Error(`Banco "${dbName}" recusado: o nome precisa começar com galaxie_sim.`);
const speed = Math.max(0.1, Number(values.velocidade) || 1);
const intervalMs = Math.max(2, Number(values.intervalo) || 15) * 1000;

// ─── roteiro (relativo a agora) ──────────────────────────────────────────────────────────────────

const realStart = Date.now();
const simNow = () => new Date(realStart + (Date.now() - realStart) * speed);
const T0 = new Date(realStart);
const ago = (min: number) => new Date(T0.getTime() - min * MIN);
const goals = (...g: [number, 'home' | 'away'][]) => g.map(([minute, side]) => ({ minute, side }));

const bra = {
  leagueId: 71,
  leagueName: 'Serie A',
  round: 'Regular Season - 31',
  tier: 1,
  livePriority: 'high' as const,
  stageKind: 'regular',
};
const matches: WorldMatch[] = [
  {
    ...bra,
    fixtureId: 9_100_001,
    home: 'Palmeiras',
    away: 'Corinthians',
    kickoff: ago(70),
    derby: true,
    importance: 70,
    goals: goals([9, 'home'], [38, 'away'], [71, 'home'], [88, 'home']),
  },
  {
    leagueId: 13,
    leagueName: 'CONMEBOL Libertadores',
    round: 'Semi-finals',
    tier: 1,
    livePriority: 'high',
    stageKind: 'semi_final',
    fixtureId: 9_100_002,
    home: 'Racing Club',
    away: 'Botafogo',
    kickoff: ago(100),
    importance: 90,
    extraTime: true,
    penalties: { home: 4, away: 5 },
    goals: goals([30, 'away'], [66, 'home']),
  },
  {
    leagueId: 128,
    leagueName: 'Liga Profesional Argentina',
    round: '2nd Phase - 15',
    tier: 1,
    livePriority: 'high',
    stageKind: 'regular',
    fixtureId: 9_100_003,
    home: 'Boca Juniors',
    away: 'Estudiantes',
    kickoff: ago(12),
    importance: 55,
    goals: goals([20, 'home'], [50, 'away']),
  },
  {
    ...bra,
    fixtureId: 9_100_004,
    home: 'Flamengo',
    away: 'Vasco DA Gama',
    kickoff: new Date(T0.getTime() + 8 * MIN),
    derby: true,
    importance: 65,
    goals: goals([14, 'home']),
  },
];

/** Lances além dos gols (cartões, substituições, VAR, pênalti perdido e disputa de pênaltis). */
type Extra = { minute: number; extra?: number; side: 'home' | 'away' } & Pick<
  ApiFixtureEvent,
  'type' | 'detail' | 'comments'
> & { player: string; assist?: string };
const EXTRAS: Record<number, Extra[]> = {
  9_100_001: [
    { minute: 23, side: 'away', type: 'Card', detail: 'Yellow Card', comments: 'Foul', player: 'Raniele' },
    {
      minute: 45,
      extra: 2,
      side: 'home',
      type: 'Card',
      detail: 'Yellow Card',
      comments: 'Argument',
      player: 'Aníbal Moreno',
    },
    {
      minute: 46,
      side: 'away',
      type: 'subst',
      detail: 'Substitution 1',
      comments: null,
      player: 'Romero',
      assist: 'Talles Magno',
    },
    {
      minute: 60,
      side: 'home',
      type: 'subst',
      detail: 'Substitution 1',
      comments: null,
      player: 'Facundo Torres',
      assist: 'Felipe Anderson',
    },
    {
      minute: 64,
      side: 'away',
      type: 'Var',
      detail: 'Goal cancelled',
      comments: null,
      player: 'Yuri Alberto',
    },
    {
      minute: 77,
      side: 'away',
      type: 'Card',
      detail: 'Red Card',
      comments: 'Violent conduct',
      player: 'Raniele',
    },
  ],
  9_100_002: [
    {
      minute: 18,
      side: 'home',
      type: 'Card',
      detail: 'Yellow Card',
      comments: 'Foul',
      player: 'Santiago Sosa',
    },
    {
      minute: 55,
      side: 'home',
      type: 'Goal',
      detail: 'Missed Penalty',
      comments: null,
      player: 'Adrián Martínez',
    },
    {
      minute: 72,
      side: 'away',
      type: 'subst',
      detail: 'Substitution 1',
      comments: null,
      player: 'Igor Jesus',
      assist: 'Arthur Cabral',
    },
    {
      minute: 101,
      side: 'away',
      type: 'Card',
      detail: 'Yellow Card',
      comments: 'Time wasting',
      player: 'John',
    },
  ],
  9_100_003: [
    {
      minute: 8,
      side: 'away',
      type: 'Card',
      detail: 'Yellow Card',
      comments: 'Foul',
      player: 'Santiago Ascacíbar',
    },
  ],
};
/** Disputa de pênaltis da semifinal (4 x 5, igual a `penalties`): [lado, cobrador, converteu]; o visitante bate primeiro. */
const SHOOTOUT: [number, ['home' | 'away', string, boolean][]] = [
  9_100_002,
  [
    ['away', 'Alex Telles', true],
    ['home', 'Juan Fernando Quintero', true],
    ['away', 'Marlon Freitas', true],
    ['home', 'Gastón Martirena', false],
    ['away', 'Savarino', true],
    ['home', 'Maximiliano Salas', true],
    ['away', 'Igor Jesus', false],
    ['home', 'Agustín Almendra', true],
    ['away', 'Arthur Cabral', true],
    ['home', 'Santiago Sosa', true],
    // alternadas: Botafogo converte, Racing perde (4 x 5)
    ['away', 'Cuiabano', true],
    ['home', 'Gabriel Rojas', false],
  ],
];

const teamIds = new Map<string, number>();
const teamId = (name: string) => {
  if (!teamIds.has(name)) teamIds.set(name, 1000 + teamIds.size);
  return teamIds.get(name)!;
};
const ev = (m: WorldMatch, e: Extra): ApiFixtureEvent => {
  const team = e.side === 'home' ? m.home : m.away;
  return {
    time: { elapsed: e.minute, extra: e.extra ?? null },
    team: { id: teamId(team), name: team, logo: null },
    player: { id: null, name: e.player },
    assist: { id: null, name: e.assist ?? null },
    type: e.type,
    detail: e.detail,
    comments: e.comments,
  } as ApiFixtureEvent;
};

/** Acrescenta ao jogo os lances já acontecidos (pelo minuto de jogo, na ordem do jogo). */
function enrich(f: ApiFixture, at: Date): ApiFixture {
  const m = matches.find((x) => x.fixtureId === f.fixture.id);
  if (!m) return f;
  const t = (at.getTime() - m.kickoff.getTime()) / MIN - (m.delayMin ?? 0);
  const happened = (EXTRAS[m.fixtureId] ?? []).filter((e) => realOffset(e.minute) + (e.extra ?? 0) <= t);
  const events = [...(f.events ?? []), ...happened.map((e) => ev(m, e))].sort(
    (a, b) => (a.time.elapsed ?? 0) - (b.time.elapsed ?? 0) || (a.time.extra ?? 0) - (b.time.extra ?? 0),
  );
  const state = matchState(m, at);
  let penalty = f.score.penalty;
  if (m.fixtureId === SHOOTOUT[0] && (state.short === 'P' || state.short === 'PEN')) {
    // pênaltis: uma cobrança por minuto de jogo simulado a partir do início da disputa
    const kicks = state.short === 'PEN' ? SHOOTOUT[1].length : Math.floor(Math.max(0, t - 147));
    let home = 0;
    let away = 0;
    for (const [side, player, scored] of SHOOTOUT[1].slice(0, kicks)) {
      if (scored && side === 'home') home += 1;
      if (scored && side === 'away') away += 1;
      events.push(
        ev(m, {
          minute: 120,
          side,
          type: 'Goal',
          detail: scored ? 'Penalty' : 'Missed Penalty',
          comments: 'Penalty Shootout',
          player,
        }),
      );
    }
    penalty = { home, away };
  }
  return { ...f, events, score: { ...f.score, penalty } };
}

// ─── banco ───────────────────────────────────────────────────────────────────────────────────────

const admin = createDb(process.env.DATABASE_URL ?? simUrl.replace(`/${dbName}`, '/postgres'), { max: 1 });
const exists = await admin.execute(sql`select 1 from pg_database where datname = ${dbName}`);
if (!exists.length) await admin.execute(sql.raw(`CREATE DATABASE ${dbName}`));
await closeDb(admin);
await runMigrations(simUrl);
const db = createDb(simUrl, { max: 4 });
await db
  .insert(sport)
  .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
  .onConflictDoNothing();

// fornecedor falso com os lances extras (cartões, substituições, VAR e a disputa de pênaltis)
const simClock = { now: () => Date.now() };
const world = liveWorld({
  matches,
  plan: 'pro',
  start: simNow(),
  wrapFetch: (baseFetch) =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      const res = await baseFetch(input, init);
      if (!res.ok) return res;
      const body = (await res.json()) as { response: ApiFixture[] };
      const at = new Date(simClock.now());
      body.response = body.response.map((f) => enrich(f, at));
      return new Response(JSON.stringify(body), { headers: res.headers });
    }) as typeof fetch,
});
simClock.now = () => world.clock.now();
for (const m of matches) {
  teamId(m.home);
  teamId(m.away);
}
for (const [name, id] of teamIds)
  if (world.teamIds(name) !== id) throw new Error('IDs de time divergentes no mundo simulado');

// os jogos entram no core como o sync diário deixaria (pré-jogo), e o ao vivo assume dali
const seededAt = new Date(T0.getTime() - 3 * 60 * MIN);
await upsertBatch(
  db,
  normalizeFixtures(
    matches.map((m) => apiFixture(m, seededAt, teamId)),
    seededAt,
  ),
);
await db.update(competition).set({ tier: 1, livePriority: 'high' });

const store = new PgLiveStore(db);
const provider = new ApiSportsProvider(world.client, { priority: 'LIVE' }, () => new Date(world.clock.now()));
const poller = new LivePoller(provider, store, { sport: 'football' });

let stopping = false;
process.once('SIGINT', () => (stopping = true));
process.once('SIGTERM', () => (stopping = true));
console.log(
  `simulação em ${dbName}: ${matches.length} jogos, velocidade ${speed}x, tick a cada ${intervalMs / 1000} s`,
);

while (!stopping) {
  const now = simNow();
  world.clock.set(now);
  const tracked = await store.candidates(
    'football',
    'api-sports',
    new Date(now.getTime() - 6 * 60 * MIN),
    new Date(now.getTime() + 6 * 60 * MIN),
  );
  const leagues = [
    ...new Set(tracked.flatMap((c) => (c.providerCompetitionId ? [c.providerCompetitionId] : []))),
  ];
  const report = await poller.tick({ now, leagues, tracked, featured: null, finalizeBudget: 4 });
  const live = matches.map((m) => {
    const s = matchState(m, now);
    return `${m.home} ${s.home ?? '-'}x${s.away ?? '-'} ${m.away} (${s.short}${s.elapsed ? ` ${s.elapsed}'` : ''})`;
  });
  console.log(
    `${now.toISOString()} ${report.outcome} eventos=${report.events} mudanças=${report.changes.length} · ${live.join(' | ')}`,
  );
  if (
    matches.every((m) => ['FT', 'AET', 'PEN'].includes(matchState(m, now).short)) &&
    !report.vanished.length
  )
    break;
  await new Promise((r) => setTimeout(r, intervalMs));
}
await closeDb(db);
