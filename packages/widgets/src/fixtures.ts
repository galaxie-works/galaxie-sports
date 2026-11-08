// Dados de exemplo para o preview do Builder e para os testes. Os objetos seguem os contratos completos
// da API (@galaxie/contracts): se um contrato mudar, o typecheck daqui acusa.
import { channelGuidePreviewBody } from './fixtures-channel-guide.js';
import type {
  Event,
  EventContext,
  HeadToHead,
  RelatedContent,
  Standings,
  WhereToWatch,
  WhereToWatchAvailability,
} from '@galaxie/contracts';

import type {
  GsEvent,
  GsEventContext,
  GsHeadToHead,
  GsRelated,
  GsStandings,
  GsWhereToWatch,
} from './core/model.js';
import { RACING_IDS, createFightFixtures, createRacingFixtures } from './fixtures-racing.js';
import { OLYMPIC_IDS, olympicPreviewBody } from './fixtures-olympic.js';
import { championsPreviewBody } from './fixtures-champions.js';
import { PLAYER_IDS, playerPreviewBody } from './fixtures-player.js';
import { transfersPreviewBody } from './fixtures-transfers.js';
import { sportifyEvent, sportifyH2hSummary, sportifyStandings } from './fixtures-sports.js';
import { previewLeaders } from './fixtures-leaders.js';
import { LEADER_CATEGORIES, type GsLeaderCategory } from './core/model.js';
import { previewSquad } from './fixtures-squad.js';
import { previewTeamStats } from './fixtures-team-stats.js';
import { sampleLineups } from './fixtures-lineups.js';
import { sampleOdds, samplePrediction } from './fixtures-prediction.js';

export const PREVIEW_IDS = {
  liveEvent: '0199a5c0-0000-7000-8000-000000000001',
  scheduledEvent: '0199a5c0-0000-7000-8000-000000000002',
  finishedEvent: '0199a5c0-0000-7000-8000-000000000003',
  competition: 'liga-exemplo',
  /** Clube Aurora (a agenda do time). */
  team: '0199a5c0-0000-7000-8000-0000000000a1',
  /** F1: a corrida do GP de exemplo, o campeonato e o piloto. */
  raceEvent: RACING_IDS.raceEvent,
  raceCompetition: RACING_IDS.raceCompetition,
  driver: RACING_IDS.driver,
  /** MMA: a luta principal do card de exemplo, a liga e o lutador. */
  fightEvent: RACING_IDS.fightEvent,
  nextFightEvent: RACING_IDS.nextFightEvent,
  fightCompetition: RACING_IDS.fightCompetition,
  fighter: RACING_IDS.fighter,
  /** Hipismo: a prova, o cavaleiro e o cavalo de exemplo; Jogos: a edição de exemplo. */
  eqCompetition: OLYMPIC_IDS.eqCompetition,
  eqAthlete: OLYMPIC_IDS.eqAthlete,
  eqHorse: OLYMPIC_IDS.eqHorse,
  games: OLYMPIC_IDS.games,
  /** Futebol: o jogador da ficha de exemplo. */
  person: PLAYER_IDS.person,
  /** Grade nos canais: o id de um widget de exemplo (a prévia responde a qualquer id). */
  channelGuideWidget: '0199a5c0-0000-7000-8000-0000000000e1',
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
  winner?: 'home' | 'away' | 'draw';
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
      participant(e.home, 'home', e.winner && e.winner !== 'draw' ? e.winner === 'home' : null),
      participant(e.away, 'away', e.winner && e.winner !== 'draw' ? e.winner === 'away' : null),
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

/** Zonas da tabela de exemplo (códigos das regras), para o preview mostrar as cores e a legenda. */
const SAMPLE_ZONES: Record<number, string> = {
  1: 'libertadores',
  2: 'libertadores_qualifying',
  3: 'sudamericana',
  6: 'relegation',
};

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
    description: SAMPLE_ZONES[rank] ?? null,
  } satisfies Standings['groups'][number]['rows'][number];
}

export interface PreviewFixtures {
  events: GsEvent[];
  standings: GsStandings;
  whereToWatch: GsWhereToWatch;
  /** Contexto de IA por evento (o agendado tem cenário; o encerrado, cenário e resumo). */
  contexts: Record<string, GsEventContext>;
  related: GsRelated;
  h2h: GsHeadToHead;
  /** Agenda do Clube Aurora: resultados das últimas semanas, o jogo ao vivo e os próximos. */
  teamEvents: GsEvent[];
}

const esporte = { id: 'esporte_exemplo', name: 'Esporte Exemplo 2', logo: null, logo_dark: null };
const play = { id: 'exemplo_play', name: 'Operadora Exemplo Play', logo: null, logo_dark: null };
const platform = (
  slug: string,
  name: string,
  kind: 'pay_tv_operator' | 'vmvpd' | 'streaming',
): WhereToWatchAvailability['platforms'][number]['platform'] => ({
  id: `plataforma-${slug}`,
  slug: `br-${slug}-exemplo`,
  name,
  kind,
  country: 'BR',
  broadcaster_id: null,
  logo: null,
  logo_dark: null,
  logo_credit: null,
});

/**
 * Três jogos (ao vivo, mais tarde e encerrado), a tabela e o onde assistir (com a grade: TV aberta,
 * canal pago e as plataformas com o plano), relativos a `now`.
 */
export function createPreviewFixtures(now: Date = new Date(), sport = 'football'): PreviewFixtures {
  const f = footballFixtures(now);
  if (sport === 'football') return f;
  // outros esportes coletivos: o mesmo roteiro com placar, parciais e tabela do esporte
  const events = f.events.map((e, i) => sportifyEvent(e, sport, i));
  const live = events[0]!;
  return {
    ...f,
    events,
    standings: sportifyStandings(f.standings, sport),
    h2h: {
      ...f.h2h,
      summary: sportifyH2hSummary(f.h2h.summary, sport),
      all_time: f.h2h.all_time ? sportifyH2hSummary(f.h2h.all_time, sport) : null,
      events: f.h2h.events.map((e, i) => sportifyEvent(e, sport, i)),
    },
    teamEvents: f.teamEvents.map((e, i) => (e.id === live.id ? live : sportifyEvent(e, sport, i))),
  };
}

function footballFixtures(now: Date): PreviewFixtures {
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
  // o jogo mais tarde: o que está em jogo, as tags do torcedor e o grito da torcida
  const later = events[1]!;
  later.derby = { slug: 'classico-exemplo', name: 'Clássico da Serra', intensity: 4 };
  later.participants[0] = {
    ...later.participants[0]!,
    fan_tags: [
      { code: 'in_title_race', priority: 15, text: { 'pt-BR': 'Na briga pelo título' } },
      { code: 'can_reach_top_4', priority: 40, text: { 'pt-BR': 'De olho no G-4' } },
    ],
    cheer: { text: 'Vamos, Serra!' },
  };
  later.participants[1] = {
    ...later.participants[1]!,
    fan_tags: [{ code: 'relegation_fight', priority: 20, text: { 'pt-BR': 'Contra o rebaixamento' } }],
    cheer: { text: 'Litoral até o fim!' },
  };
  later.stakes = [
    stake('home', TEAMS.serra.id, 'win_takes_lead', 'Com vitória, assume a liderança'),
    stake('home', TEAMS.serra.id, 'unbeaten_home', 'Invicto em casa há 8 jogos'),
    stake('away', TEAMS.litoral.id, 'needs_points_relegation', 'Precisa pontuar para sair do Z-4'),
    stake('both', null, 'derby_bragging', 'Vale a melhor campanha no clássico do ano'),
  ];

  const standings: Standings = {
    competition_id: COMPETITION_ID,
    sport: 'football',
    season: { year: now.getUTCFullYear(), label: String(now.getUTCFullYear()) },
    groups: [
      {
        name: null,
        display_name: null,
        table: null,
        table_key: null,
        current: null,
        source: 'computed',
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
        provider_id: 'tv_exemplo',
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
        provider_id: 'esporte_exemplo',
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
        provider_id: 'exemplo_play',
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
    availability: {
      free_tv: [{ id: 'tv_exemplo', name: 'TV Exemplo', logo: null, logo_dark: null }],
      pay_tv_channels: [esporte],
      platforms: [
        {
          platform: platform('operadora', 'Operadora Exemplo', 'pay_tv_operator'),
          plans: [
            {
              id: '0199a5c0-0000-7000-8000-0000000000e1',
              name: 'Plano Completo',
              access: 'included',
              via_channels: [{ ...esporte, access: 'included' }],
              included_services: [play],
            },
            {
              id: '0199a5c0-0000-7000-8000-0000000000e2',
              name: 'Plano Essencial',
              access: 'addon',
              via_channels: [{ ...esporte, access: 'addon' }],
              included_services: [],
            },
          ],
        },
        {
          platform: platform('tv-online', 'TV Online Exemplo', 'vmvpd'),
          plans: [
            {
              id: '0199a5c0-0000-7000-8000-0000000000e3',
              name: 'Plano Esportes',
              access: 'included',
              via_channels: [{ ...esporte, access: 'included' }],
              included_services: [],
            },
          ],
        },
        {
          platform: {
            ...platform('play', 'Operadora Exemplo Play', 'streaming'),
            broadcaster_id: 'exemplo_play',
          },
          plans: [
            {
              id: '0199a5c0-0000-7000-8000-0000000000e4',
              name: 'Plano Padrão',
              access: 'included',
              via_channels: [],
              included_services: [],
            },
          ],
        },
      ],
      your_operator: null,
      channel_status: 'confirmed',
      match_channel: {
        phase: 'pre',
        state: 'confirmed',
        headline: 'Passa em Exemplo Play',
        hint: null,
        channels: [
          {
            id: 'exemplo_play',
            name: 'Exemplo Play',
            logo: null,
            logo_dark: null,
            channel: null,
            medium: 'streaming_svod',
            confirmed_at: verified,
            post_match: false,
            source: null,
          },
        ],
      },
    },
    updated_at: verified,
  };
  const contexts = previewContexts(now);
  const related = previewRelated(now);
  const h2h = previewH2h(now);
  const teamEvents = previewTeamEvents(now, events[0]!);
  return { events, standings, whereToWatch, contexts, related, h2h, teamEvents };
}

function stake(
  team: 'home' | 'away' | 'both',
  teamId: string | null,
  code: string,
  text: string,
): Event['stakes'][number] {
  return { team, team_id: teamId, code, text: { 'pt-BR': text }, phase: 'pre_match', salient: true };
}

function contextText(kind: 'scenario' | 'recap', text: string, at: Date): EventContext['data'][number] {
  return {
    kind,
    locale: 'pt-BR',
    text,
    sentences: [text],
    origin: 'llm',
    model: 'exemplo',
    confidence: 0.9,
    review_status: 'auto',
    generated_at: at.toISOString(),
    fits: { tv: true, mobile: true, web: true },
    sources: [{ kind: 'core', ref: 'core.event', url: null }],
  };
}

function previewContexts(now: Date): Record<string, EventContext> {
  const ctx = (event_id: string, data: EventContext['data']): EventContext => ({
    event_id,
    locale: 'pt-BR',
    data,
  });
  return {
    [PREVIEW_IDS.liveEvent]: ctx(PREVIEW_IDS.liveEvent, [
      contextText(
        'scenario',
        'Líder da Liga Exemplo, o Aurora recebe o Estrela do Sul precisando vencer para abrir quatro pontos de vantagem. O Estrela não perde há cinco rodadas e chega embalado depois de eliminar o rival na copa.',
        now,
      ),
    ]),
    [PREVIEW_IDS.scheduledEvent]: ctx(PREVIEW_IDS.scheduledEvent, [
      contextText(
        'scenario',
        'O Atlético Serra assume a liderança se vencer o clássico e o Aurora tropeçar. Do outro lado, o União Litoral precisa pontuar para deixar a zona de rebaixamento: perdeu três dos últimos quatro jogos fora de casa.',
        now,
      ),
    ]),
    [PREVIEW_IDS.finishedEvent]: ctx(PREVIEW_IDS.finishedEvent, [
      contextText(
        'scenario',
        'Real Planalto e Sporting Vale decidem a vaga na final em jogo único. Em caso de empate, a decisão vai para os pênaltis.',
        new Date(now.getTime() - 6 * 60 * 60_000),
      ),
      contextText(
        'recap',
        'O Real Planalto está na final. Depois de um 0 a 0 truncado, com o Vale mais perigoso no segundo tempo, o goleiro do Planalto defendeu duas cobranças e garantiu a vitória por 4 a 3 nos pênaltis.',
        now,
      ),
    ]),
  };
}

/** Miniatura genérica (SVG em data URI) na cor do tipo de vídeo. */
function thumb(color: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="${color}"/><circle cx="160" cy="90" r="30" fill="#fff" fill-opacity=".9"/><path d="M151 75v30l25-15z" fill="${color}"/><text x="16" y="164" font-family="sans-serif" font-size="16" font-weight="700" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function previewRelated(now: Date): RelatedContent {
  const item = (
    n: number,
    type: RelatedContent['data'][number]['content_type'],
    label: string,
    title: string,
    channel: string,
    duration: number,
    color: string,
    format: 'short' | 'long' = 'long',
  ): RelatedContent['data'][number] => ({
    id: `0199a5c0-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
    provider: 'youtube',
    external_id: `exemplo-${n}`,
    url: `https://www.youtube.com/watch?v=exemplo-${n}`,
    // sem player nos dados de exemplo: a miniatura não toca nada
    embed_url: null,
    title,
    content_type: type,
    content_type_label: label,
    format,
    aspect_ratio: format === 'short' ? '9:16' : '16:9',
    duration_seconds: duration,
    published_at: new Date(now.getTime() - n * 20 * 60_000).toISOString(),
    thumbnail_url: thumb(color, channel),
    language: 'pt-BR',
    channel: { id: `canal-${n}`, title: channel, handle: null, source_tier: 'official' },
    views: 1000 * (10 - n),
    confidence: 0.95,
    classified_by: 'rules@v1',
    last_checked_at: now.toISOString(),
  });
  return {
    event_id: PREVIEW_IDS.finishedEvent,
    data: [
      item(
        1,
        'highlights',
        'Melhores momentos',
        'Planalto 0 (4) x (3) 0 Vale: melhores momentos',
        'Liga Exemplo',
        512,
        '#1d4ed8',
      ),
      item(
        2,
        'penalties',
        'Pênaltis',
        'Todas as cobranças da disputa de pênaltis',
        'Real Planalto',
        268,
        '#7c3aed',
      ),
      item(
        3,
        'interview',
        'Entrevista',
        'Goleiro do Planalto: "a gente treinou cada cobrança"',
        'TV Exemplo',
        194,
        '#0891b2',
      ),
      item(
        4,
        'press_conference',
        'Coletiva',
        'Coletiva do técnico do Sporting Vale',
        'Sporting Vale',
        1260,
        '#ca8a04',
      ),
      item(
        5,
        'fan_reaction',
        'Torcida',
        'A festa da torcida no apito final',
        'Real Planalto',
        41,
        '#dc2626',
        'short',
      ),
      item(
        6,
        'analysis',
        'Análise',
        'Como o Planalto segurou o Vale no segundo tempo',
        'Canal Exemplo',
        655,
        '#15803d',
      ),
    ],
    counts: { highlights: 1, penalties: 1, interview: 1, press_conference: 1, fan_reaction: 1, analysis: 1 },
    updated_at: now.toISOString(),
  };
}

function previewH2h(now: Date): HeadToHead {
  const days = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60_000);
  const meetings: [number, TeamKey, TeamKey, number, number][] = [
    [120, 'litoral', 'serra', 1, 2],
    [300, 'serra', 'litoral', 1, 1],
    [480, 'litoral', 'serra', 0, 3],
    [650, 'serra', 'litoral', 2, 0],
    [830, 'litoral', 'serra', 2, 1],
  ];
  const team = (key: TeamKey) => ({
    id: TEAMS[key].id,
    name: TEAMS[key].name,
    logo: shield(TEAMS[key].color),
  });
  return {
    event_id: PREVIEW_IDS.scheduledEvent,
    participants: [team('serra'), team('litoral')],
    summary: {
      scope: 'database',
      since: days(830).getUTCFullYear(),
      played: 5,
      draws: 1,
      teams: [
        { id: TEAMS.serra.id, wins: 3, goals: 8 },
        { id: TEAMS.litoral.id, wins: 1, goals: 4 },
      ],
    },
    all_time: {
      derby: { slug: 'classico-exemplo', name: 'Clássico da Serra' },
      matches: 214,
      draws: 61,
      teams: [
        { id: TEAMS.serra.id, wins: 88, goals: 301 },
        { id: TEAMS.litoral.id, wins: 65, goals: 254 },
      ],
      basis: 'official',
      as_of: now.toISOString().slice(0, 10),
      sources: [],
      review_status: 'reviewed',
    },
    events: meetings.map(([ago, home, away, h, a], i) =>
      makeEvent({
        id: `0199a5c0-0000-7000-8000-0000000002${String(i).padStart(2, '0')}`,
        home,
        away,
        startsAt: days(ago),
        status: 'finished',
        score: [h, a],
        winner: h === a ? 'draw' : h > a ? 'home' : 'away',
      }),
    ),
  };
}

function previewTeamEvents(now: Date, live: Event): Event[] {
  const days = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60_000);
  const past: [number, TeamKey, TeamKey, number, number][] = [
    [-4, 'vale', 'aurora', 1, 3],
    [-11, 'aurora', 'serra', 1, 1],
    [-18, 'litoral', 'aurora', 2, 1],
  ];
  const next: [number, TeamKey, TeamKey][] = [
    [4, 'aurora', 'planalto'],
    [11, 'serra', 'aurora'],
    [18, 'aurora', 'litoral'],
  ];
  return [
    ...past.map(([d, home, away, h, a], i) =>
      makeEvent({
        id: `0199a5c0-0000-7000-8000-0000000003${String(i).padStart(2, '0')}`,
        home,
        away,
        startsAt: days(d),
        status: 'finished',
        score: [h, a],
        winner: h === a ? 'draw' : h > a ? 'home' : 'away',
      }),
    ),
    live,
    ...next.map(([d, home, away], i) =>
      makeEvent({
        id: `0199a5c0-0000-7000-8000-0000000003${String(i + 5).padStart(2, '0')}`,
        home,
        away,
        startsAt: days(d),
        status: 'scheduled',
        score: [null, null],
      }),
    ),
  ];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * `fetch` que responde como a API pública com os dados de exemplo — para o preview do Builder sem chave
 * e para os testes. Passe em `<GalaxieWidgetProvider fetch={createPreviewFetch()}>`.
 */
export function createPreviewFetch(options: { now?: Date; sport?: string } = {}): typeof fetch {
  return async (input) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, 'http://preview.local');
    const path = url.pathname.replace(/\/+$/, '');
    const now = options.now ?? new Date();
    const olympic = olympicPreviewBody(url, now);
    if (olympic !== null) return json(olympic);
    const champions = championsPreviewBody(url);
    if (champions !== null) return json(champions);
    const player = playerPreviewBody(url, now);
    if (player !== null) return json(player);
    const transfers = transfersPreviewBody(url, now);
    if (transfers !== null) return json(transfers);
    const f = createPreviewFixtures(now, options.sport);
    const guide = channelGuidePreviewBody(url, f.events);
    if (guide) return json(guide);
    const racing = createRacingFixtures(now);
    const fights = createFightFixtures(now);
    const id = (re: RegExp) => {
      const m = re.exec(path);
      return m ? decodeURIComponent(m[1]!) : null;
    };
    // F1 e MMA: competição, eventos, card, atleta e carreira de exemplo
    const competitionParam = url.searchParams.get('competition');
    const competitionId = id(/\/v1\/competitions\/([^/]+)(?:\/|$)/) ?? competitionParam;
    const isRace = competitionId === racing.competition.id || competitionId === racing.competition.slug;
    const isFight = competitionId === fights.competition.id || competitionId === fights.competition.slug;
    if (/\/v1\/competitions\/[^/]+$/.test(path) && (isRace || isFight))
      return json(isRace ? racing.competition : fights.competition);
    if (path.endsWith('/v1/events') && (isRace || isFight)) {
      const from = Date.parse(url.searchParams.get('from') ?? '') || -Infinity;
      const to = Date.parse(url.searchParams.get('to') ?? '') + 86_400_000 || Infinity;
      const list = (isRace ? racing.events : fights.events).filter((e) => {
        const at = Date.parse(e.starts_at);
        return at >= from && at <= to;
      });
      return json({ data: list, next_cursor: null });
    }
    if (isRace && /\/standings$/.test(path)) return json(racing.standings);
    const card = id(/\/v1\/events\/([^/]+)\/card$/);
    if (card) {
      return fights.card.fights.some((e) => e.id === card)
        ? json(fights.card)
        : json({ type: 'about:blank', title: 'Card não encontrado', status: 404, code: 'NOT_FOUND' }, 404);
    }
    const eventId = id(/\/v1\/events\/([^/]+)$/);
    const special = eventId
      ? [...racing.events, ...fights.events, ...fights.fighterEvents].find((e) => e.id === eventId)
      : undefined;
    if (special) return json(special);
    const teamId = id(/\/v1\/teams\/([^/]+)(?:\/|$)/);
    if (teamId === racing.driver.id) {
      if (path.endsWith('/career')) return json(racing.career);
      if (path.endsWith(teamId)) return json(racing.driver);
    }
    // elenco do time (#825): o Clube Aurora com o elenco de exemplo
    if (teamId === PREVIEW_IDS.team) {
      // estatísticas do time (#893): a Liga Exemplo em 2026 e 2025
      if (path.endsWith('/statistics')) {
        const season = Number(url.searchParams.get('season'));
        return json(
          previewTeamStats(
            teamId,
            { id: COMPETITION_ID, slug: PREVIEW_IDS.competition, name: 'Liga Exemplo', logo: null },
            {
              competition: url.searchParams.get('competition'),
              season: Number.isInteger(season) && season > 0 ? season : null,
            },
          ),
        );
      }
      if (path.endsWith('/squad')) {
        const season = Number(url.searchParams.get('season'));
        return json(previewSquad(teamId, Number.isInteger(season) && season > 0 ? season : null));
      }
      if (path.endsWith(teamId)) {
        const t = TEAMS.aurora;
        return json({
          id: t.id,
          sport: 'football',
          kind: 'team',
          name: t.name,
          short_name: t.short,
          logo: shield(t.color),
        });
      }
    }
    if (teamId === fights.fighter.id) {
      if (path.endsWith('/events')) return json({ data: fights.fighterEvents, next_cursor: null });
      if (path.endsWith(teamId)) return json(fights.fighter);
    }
    if (path.endsWith('/v1/events/live')) {
      return json({ data: f.events.filter((e) => e.status === 'live' || e.status === 'break') });
    }
    if (path.endsWith('/v1/events')) return json({ data: f.events, next_cursor: null });
    const context = /\/v1\/events\/([^/]+)\/context$/.exec(path);
    if (context) {
      const id = decodeURIComponent(context[1]!);
      return json(f.contexts[id] ?? { event_id: id, locale: 'pt-BR', data: [] });
    }
    const related = /\/v1\/events\/([^/]+)\/related$/.exec(path);
    if (related) return json({ ...f.related, event_id: decodeURIComponent(related[1]!) });
    const h2h = /\/v1\/events\/([^/]+)\/h2h$/.exec(path);
    if (h2h) return json({ ...f.h2h, event_id: decodeURIComponent(h2h[1]!) });
    if (/\/v1\/teams\/[^/]+\/events$/.test(path)) return json({ data: f.teamEvents, next_cursor: null });
    const watch = /\/v1\/events\/([^/]+)\/where-to-watch$/.exec(path);
    if (watch) return json({ ...f.whereToWatch, event_id: decodeURIComponent(watch[1]!) });
    // palpite do jogo, montado a partir dos times do jogo de exemplo
    const prediction = /\/v1\/events\/([^/]+)\/predictions$/.exec(path);
    if (prediction) {
      const found = f.events.find((e) => e.id === decodeURIComponent(prediction[1]!));
      if (!found) return json({ type: 'about:blank', title: 'Evento não encontrado', status: 404 }, 404);
      return json(samplePrediction(found, now));
    }
    const odds = /\/v1\/events\/([^/]+)\/odds$/.exec(path);
    if (odds) {
      const found = f.events.find((e) => e.id === decodeURIComponent(odds[1]!));
      if (!found) return json({ type: 'about:blank', title: 'Evento não encontrado', status: 404 }, 404);
      return json(sampleOdds(found, now));
    }
    // detalhes do jogo (minuto a minuto, estatísticas, escalações) montados a partir do placar de exemplo
    const detail = /\/v1\/events\/([^/]+)\/(timeline|stats|lineups)$/.exec(path);
    if (detail) {
      const found = f.events.find((e) => e.id === decodeURIComponent(detail[1]!));
      if (!found) return json({ type: 'about:blank', title: 'Evento não encontrado', status: 404 }, 404);
      return json(sampleDetail(found, detail[2] as 'timeline' | 'stats' | 'lineups'));
    }
    if (/\/v1\/competitions\/[^/]+\/context$/.test(path)) {
      const leader = f.standings.groups[0]?.rows[0];
      return json({
        groups: [
          {
            name: null,
            leader: leader
              ? { rank: 1, points: leader.points, played: leader.played, participant: leader.participant }
              : null,
          },
        ],
        decisive_events: f.events.filter((e) => e.status === 'scheduled').slice(0, 2),
      });
    }
    if (/\/v1\/teams\/[^/]+\/overview$/.test(path)) {
      const row = f.standings.groups[0]?.rows.find((r) => r.participant.id === PREVIEW_IDS.team);
      const live = f.teamEvents.find((e) => e.status === 'live' || e.status === 'break') ?? null;
      return json({
        team: previewTeam(options.sport ?? 'football'),
        standings: row ? [{ competition: { id: COMPETITION_ID, name: 'Liga Exemplo' }, rank: row.rank }] : [],
        competitions: previewCampaigns(row?.rank ?? null, url.searchParams.get('locale') ?? 'en'),
        form: f.teamEvents
          // do mais recente ao mais antigo, como a API (a agenda já vem nessa ordem)
          .filter((e) => e.status === 'finished')
          .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))
          .slice(0, 5)
          .map((e) => {
            const r = teamResultOf(e, PREVIEW_IDS.team);
            const away = e.participants.find((p) => p.id === PREVIEW_IDS.team)?.side === 'away';
            const score = away ? `${e.score.away}-${e.score.home}` : `${e.score.home}-${e.score.away}`;
            return { event_id: e.id, result: r, score };
          }),
        live_event: live,
        next_event: f.teamEvents.find((e) => e.status === 'scheduled') ?? null,
      });
    }
    const event = /\/v1\/events\/([^/]+)$/.exec(path);
    if (event) {
      const found = f.events.find((e) => e.id === decodeURIComponent(event[1]!));
      return found
        ? json(found)
        : json({ type: 'about:blank', title: 'Evento não encontrado', status: 404, code: 'NOT_FOUND' }, 404);
    }
    if (/\/v1\/competitions\/[^/]+\/seasons\/[^/]+\/leaders$/.test(path)) {
      const raw = url.searchParams.get('category') ?? 'goals';
      const category = (LEADER_CATEGORIES as readonly string[]).includes(raw)
        ? (raw as GsLeaderCategory)
        : 'goals';
      return json(previewLeaders(f.standings, category, Number(url.searchParams.get('limit')) || 10));
    }
    if (/\/v1\/competitions\/[^/]+\/seasons\/[^/]+\/standings$/.test(path)) return json(f.standings);
    return json({ type: 'about:blank', title: 'Rota não encontrada', status: 404, code: 'NOT_FOUND' }, 404);
  };
}

/** O Clube Aurora no formato do `team` de `/v1/teams/{id}/overview` (o que o cartão do time lê). */
function previewTeam(sport: string) {
  const t = TEAMS.aurora;
  return {
    id: t.id,
    sport,
    kind: 'team',
    name: t.name,
    short_name: t.short,
    logo: shield(t.color),
    country_ref: { code: 'BR', name: 'Brasil', flag: null },
    founded: 1921,
    venue: { name: 'Estádio Aurora', city: 'Cidade Exemplo' },
  };
}

/** Campanhas do Clube Aurora: a liga (com a posição), uma copa em andamento e um torneio já encerrado. */
function previewCampaigns(rank: number | null, locale: string) {
  const lang = locale.startsWith('es') ? 1 : locale.startsWith('en') ? 2 : 0;
  const text = (...t: [string, string, string]) => ({ [locale]: t[lang] });
  const comp = (id: string, slug: string, name: string) => ({ id, slug, name, logo: null });
  const year = new Date().getUTCFullYear();
  return [
    {
      competition: comp(COMPETITION_ID, PREVIEW_IDS.competition, 'Liga Exemplo'),
      season: { year, label: String(year) },
      campaign: {
        status: 'league',
        label: rank
          ? text(
              `${rank}º lugar`,
              `${rank}.º puesto`,
              `${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'} place`,
            )
          : text('Em andamento', 'En curso', 'In progress'),
        ongoing: true,
        rank,
      },
    },
    {
      competition: comp('0199a5c0-0000-7000-8000-0000000000c2', 'copa-exemplo', 'Copa Exemplo'),
      season: { year, label: String(year) },
      campaign: {
        status: 'in_progress',
        label: text('Nas quartas de final', 'En cuartos de final', 'In the quarter-finals'),
        ongoing: true,
        rank: null,
      },
    },
    {
      competition: comp('0199a5c0-0000-7000-8000-0000000000c3', 'estadual-exemplo', 'Estadual Exemplo'),
      season: { year, label: String(year) },
      campaign: {
        status: 'champion',
        label: text('Campeão', 'Campeón', 'Champion'),
        ongoing: false,
        rank: 1,
      },
    },
  ];
}

function teamResultOf(e: GsEvent, teamId: string): 'W' | 'D' | 'L' {
  const me = e.participants.find((p) => p.id === teamId);
  const mine = me?.side === 'away' ? e.score.away : e.score.home;
  const theirs = me?.side === 'away' ? e.score.home : e.score.away;
  return (mine ?? 0) > (theirs ?? 0) ? 'W' : mine === theirs ? 'D' : 'L';
}

/** Gols nos minutos de exemplo, um "camisa 9" por time, posse e finalizações coerentes com o placar. */
function sampleDetail(e: GsEvent, kind: 'timeline' | 'stats' | 'lineups') {
  const sides = ['home', 'away'] as const;
  const teamOf = (side: 'home' | 'away') => {
    const p = e.participants.find((x) => x.side === side);
    return { id: p?.id ?? null, name: p?.name ?? null, side, logo: p?.logo ?? null };
  };
  if (kind === 'lineups') return sampleLineups(e);
  if (kind === 'stats') {
    const goals = [e.score.home ?? 0, e.score.away ?? 0];
    return {
      event_id: e.id,
      available: e.status !== 'scheduled',
      teams: sides.map((side, i) => ({
        team: teamOf(side),
        statistics: [
          { type: 'Ball Possession', code: 'possession_pct', value: i ? '46%' : '54%' },
          { type: 'Total Shots', code: 'shots_total', value: 8 + goals[i]! * 2 },
          { type: 'Shots on Goal', code: 'shots_on_goal', value: 2 + goals[i]! },
        ],
      })),
      players: [],
    };
  }
  const minutes = [12, 38, 57, 71, 84];
  const clock = (minute: number) => ({
    period: minute > 45 ? 'second_half' : 'first_half',
    minute,
    extra_minute: null,
    display: `${minute}'`,
  });
  const person = (side: 'home' | 'away', n: number) => ({
    id: null,
    name: `${teamOf(side).name ?? ''} ${n}`.trim(),
    number: n,
  });
  const goals = sides.flatMap((side, i) =>
    Array.from({ length: (i ? e.score.away : e.score.home) ?? 0 }, (_, n) => {
      const minute = minutes[(n * 2 + i) % minutes.length]!;
      return {
        sequence: minute * 10 + i,
        kind: 'goal',
        minute,
        extra: null,
        player: person(side, 9),
        assist: person(side, 10),
        team: teamOf(side),
        scoring_team: teamOf(side),
        clock: clock(minute),
        key_moment: true,
      };
    }),
  );
  const started = e.status !== 'scheduled' && e.status !== 'starting';
  // cartão, substituição e VAR de exemplo (o lance a lance mostra todos os tipos; o placar ignora estes)
  const others = started
    ? [
        { minute: 23, side: 'away' as const, kind: 'yellow_card', detail: 'Yellow Card' },
        { minute: 46, side: 'home' as const, kind: 'substitution', detail: 'Substitution 1' },
        { minute: 61, side: 'away' as const, kind: 'var', detail: 'Penalty cancelled' },
      ].map((x) => ({
        sequence: x.minute * 10 + 5,
        kind: x.kind,
        minute: x.minute,
        extra: null,
        detail: x.detail,
        player: person(x.side, x.kind === 'substitution' ? 7 : 5),
        assist: null,
        team: teamOf(x.side),
        scoring_team: null,
        clock: clock(x.minute),
        key_moment: false,
        ...(x.kind === 'substitution'
          ? { player_out: person(x.side, 7), player_in: person(x.side, 17) }
          : {}),
      }))
    : [];
  const incidents = [...goals, ...others].sort((a, b) => a.minute - b.minute || a.sequence - b.sequence);
  // placar depois de cada gol
  const tally = { home: 0, away: 0 };
  for (const i of incidents) {
    if (i.kind !== 'goal') continue;
    tally[i.team.side] += 1;
    Object.assign(i, { score_after: { ...tally } });
  }
  const at = (minute: number, extra: number | null = null) => ({
    period: minute > 45 ? 'second_half' : 'first_half',
    minute,
    extra_minute: extra,
    display: null,
  });
  const live = e.status === 'live' || e.status === 'break';
  const markers = !started
    ? []
    : [
        { kind: 'kickoff', clock: at(0) },
        { kind: 'halftime', clock: at(45, 2) },
        { kind: 'second_half', clock: at(46) },
        ...(e.status === 'finished' ? [{ kind: 'full_time', clock: at(90, 4) }] : []),
      ];
  return {
    event_id: e.id,
    status: e.status,
    live,
    clock: live && e.clock?.minute ? clock(e.clock.minute) : null,
    score: { home: e.score.home, away: e.score.away },
    incidents,
    markers,
  };
}
