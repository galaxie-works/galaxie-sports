import { DEFAULT_MIRROR_CONFIG, MIRROR_CATALOG, type MirrorConfig } from '@galaxie/runtime-config';

/**
 * Mapa de frescor do raw: cada endpoint da api-sports que usamos, o job que o renova e de quantos em quantos dias
 * ele volta. É a fonte do alerta `RawEndpointOverdue` (métricas `galaxie_raw_endpoint_*`) e da tabela "Mapa de
 * frescor" em docs/03 §11.1: os dois têm que andar juntos.
 *
 * Os endpoints do espelho (sync:mirror) não têm período aqui: vêm do catálogo do espelho (runtime-config, mirror.ts)
 * com as sobrescritas do painel, os mesmos que o job usa. Endpoint desligado em todos os tiers sai do mapa (sem
 * alerta); o período é o do tier mais frequente que estiver ligado.
 *
 * `periodDays` é o período do item mais frequente do endpoint (tier 1, temporada em jogo). Com vários itens no
 * rodízio, o endpoint é tocado ao menos nesse intervalo; a última busca dele no raw (`last_seen_at` ou
 * `fetched_at`) mais antiga que isso, com folga de meio dia para a duração do job, quer dizer que o job parou ou
 * que o endpoint saiu da fila.
 */
export interface RawCadence {
  sport: string;
  endpoint: string;
  /** Período do item mais frequente (dias). */
  periodDays: number;
  /** Job do scheduler que renova (`ops.job_run.job`). */
  job: string;
}

/** Folga além do período: o job diário roda num horário fixo e pode levar algumas horas. */
export const RAW_CADENCE_SLACK_HOURS = 12;

const football = (endpoint: string, periodDays: number, job: string): RawCadence => ({
  sport: 'football',
  endpoint,
  periodDays,
  job,
});

/** Endpoint do espelho: o período vem da configuração (`rawCadence`). */
interface MirrorCadence {
  sport: string;
  endpoint: string;
  job: 'sync:mirror';
  /** Piso do alerta (dias), maior que o período do job. */
  alertFloorDays?: number;
}

const mirror = (endpoint: string, alertFloorDays?: number, sport = 'football'): MirrorCadence => ({
  sport,
  endpoint,
  job: 'sync:mirror',
  ...(alertFloorDays ? { alertFloorDays } : {}),
});

/** Agenda diária das outras 11 APIs (sync:daily com `--outros-esportes`). */
const OTHER_SPORTS_AGENDA: Record<string, string> = {
  afl: '/games',
  'american-football': '/games',
  baseball: '/games',
  basketball: '/games',
  'formula-1': '/races',
  handball: '/games',
  hockey: '/games',
  mma: '/fights',
  nba: '/games',
  rugby: '/games',
  volleyball: '/games',
};

const CADENCE: readonly (RawCadence | MirrorCadence)[] = [
  // agenda, detalhe, ao vivo e temporada atual
  football('/fixtures', 1, 'sync:daily'),
  football('/leagues', 1, 'sync:daily'),
  football('/injuries', 1, 'sync:daily'),
  football('/players', 3, 'sync:daily'),
  // rodízio de pessoas tier 1 (sync:daily) e tier 2+ (sync:mirror)
  football('/players/squads', 7, 'sync:daily'),
  football('/coachs', 30, 'sync:daily'),
  football('/transfers', 7, 'sync:daily'),
  football('/trophies', 30, 'sync:daily'),
  football('/sidelined', 2, 'sync:daily'),
  // espelho (sync:mirror), temporada em jogo
  mirror('/standings'),
  mirror('/players/topscorers'),
  mirror('/players/topassists'),
  mirror('/players/topyellowcards'),
  mirror('/players/topredcards'),
  mirror('/fixtures/rounds'),
  mirror('/teams'),
  mirror('/venues'),
  // por jogo das próximas 48 h (tier ≤ 2): numa pausa de calendário (data FIFA) o espelho não tem o que buscar; o
  // alerta olha ao menos uma semana, não o dia do jogo
  mirror('/predictions', 7),
  mirror('/odds', 7),
  mirror('/teams/statistics'),
  mirror('/fixtures/headtohead'),
  // referência
  ...[
    '/timezone',
    '/countries',
    '/leagues/seasons',
    '/teams/countries',
    '/players/seasons',
    '/odds/bookmakers',
    '/odds/bets',
    '/odds/live/bets',
  ].map((e) => mirror(e)),
  ...Object.entries(OTHER_SPORTS_AGENDA).map(([sport, endpoint]) => ({
    sport,
    endpoint,
    periodDays: 1,
    job: 'sync:daily',
  })),
  // referência das outras 11 APIs (sync:mirror): buscada em qualquer plano e o ano todo, mostra o espelho parado. Os
  // itens de temporada, por jogo e por time ficam fora: somem na entressafra e o alerta dispararia por meses
  ...Object.entries(MIRROR_CATALOG)
    .filter(([sport]) => sport !== 'football')
    .flatMap(([sport, items]) =>
      items.filter((i) => i.reference).map((i) => mirror(i.endpoint, undefined, sport)),
    ),
];

const isMirror = (c: RawCadence | MirrorCadence): c is MirrorCadence =>
  c.job === 'sync:mirror' && !('periodDays' in c);

/**
 * Mapa com os períodos do espelho da configuração dada (a do painel, nas métricas). Sem configuração, os padrões
 * do código.
 */
export function rawCadence(config: MirrorConfig = DEFAULT_MIRROR_CONFIG): RawCadence[] {
  const out: RawCadence[] = [];
  for (const c of CADENCE) {
    if (!isMirror(c)) {
      out.push(c);
      continue;
    }
    const on = config
      .api(c.sport)
      .periods(c.endpoint)
      .filter((p): p is number => p !== null);
    if (!on.length) continue;
    const periodDays = Math.max(Math.min(...on), c.alertFloorDays ?? 0);
    out.push({ sport: c.sport, endpoint: c.endpoint, periodDays, job: c.job });
  }
  return out;
}

/** O mapa com os padrões do código: todos os endpoints olhados (a consulta do frescor busca todos). */
export const RAW_CADENCE: readonly RawCadence[] = rawCadence();

/** Idade máxima (s) da última busca antes do alerta. */
export function rawCadenceMaxAgeSeconds(c: RawCadence): number {
  return (c.periodDays * 24 + RAW_CADENCE_SLACK_HOURS) * 3600;
}
