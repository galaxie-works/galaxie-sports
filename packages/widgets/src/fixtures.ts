// Dados de exemplo para o preview do Builder e para os testes. Os objetos seguem os contratos completos
// da API (@galaxie/contracts): se um contrato mudar, o typecheck daqui acusa.
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

export const PREVIEW_IDS = {
  liveEvent: '0199a5c0-0000-7000-8000-000000000001',
  scheduledEvent: '0199a5c0-0000-7000-8000-000000000002',
  finishedEvent: '0199a5c0-0000-7000-8000-000000000003',
  competition: 'liga-exemplo',
  /** Clube Aurora (a agenda do time). */
  team: '0199a5c0-0000-7000-8000-0000000000a1',
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
export function createPreviewFetch(options: { now?: Date } = {}): typeof fetch {
  return async (input) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(raw, 'http://preview.local').pathname.replace(/\/+$/, '');
    const f = createPreviewFixtures(options.now ?? new Date());
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
