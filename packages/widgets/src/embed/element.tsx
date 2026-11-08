/**
 * Embed HTML dos widgets: o elemento `<galaxie-widget>` para qualquer página (WordPress, CMS de portal,
 * HTML puro), sem React nem build do lado de quem instala.
 *
 * ```html
 * <script src="https://sports.galaxie.works/embed.js" async></script>
 * <galaxie-widget widget="<id do widget>" key="gs_pk_live_..."></galaxie-widget>
 * ```
 *
 * O script (`scripts/build-embed.mjs` empacota este arquivo com o React) registra o elemento uma vez. Cada
 * elemento lê a configuração salva no Builder em `<origem do script>/e/<id>.json` (tema, idioma, mercado,
 * entidade padrão e a base da API, sem segredo) e desenha o widget num Shadow DOM, isolado do CSS do tema
 * do site. As chamadas à API saem da própria página, então a API confere a origem do site contra as
 * origens permitidas da chave publicável, como no componente instalado pelo registry.
 */
import { createRoot, type Root } from 'react-dom/client';

import type { WidgetDefaults, WidgetKind, WidgetLocale, WidgetTheme } from '../core/model.js';
import { WIDGET_KINDS, WIDGET_LOCALES, parseLiveListOptions, parseStandingsOptions } from '../core/model.js';
import type { LiveListOptions, StandingsOptions } from '../core/model.js';
import { GalaxieWidgetProvider } from '../core/react.js';
import { optionProps, parseWidgetOptions, type WidgetOptions } from '../options.js';
import { AiContext } from '../widgets/ai-context.js';
import { AthleteProfile } from '../widgets/athlete-profile.js';
import { Countdown } from '../widgets/countdown.js';
import { FightCard } from '../widgets/fight-card.js';
import { MatchTimeline } from '../widgets/match-timeline.js';
import { EquestrianResults } from '../widgets/equestrian-results.js';
import { EquestrianRanking } from '../widgets/equestrian-ranking.js';
import { EquestrianCalendar } from '../widgets/equestrian-calendar.js';
import { RiderProfile } from '../widgets/rider-profile.js';
import { HorseProfile } from '../widgets/horse-profile.js';
import { MedalTable } from '../widgets/medal-table.js';
import { CountryToday } from '../widgets/country-today.js';
import { GamesSchedule } from '../widgets/games-schedule.js';
import { CountryAthletes } from '../widgets/country-athletes.js';
import { MedalHistory } from '../widgets/medal-history.js';
import { Sidelined } from '../widgets/sidelined.js';
import { ChampionsGallery } from '../widgets/champions-gallery.js';
import { CompetitionLeaders } from '../widgets/competition-leaders.js';
import { PlayerProfile } from '../widgets/player-profile.js';
import { Lineups } from '../widgets/lineups.js';
import { MatchPrediction } from '../widgets/match-prediction.js';
import { MatchOdds } from '../widgets/match-odds.js';
import { TeamStats } from '../widgets/team-stats.js';
import { TransferMarket } from '../widgets/transfer-market.js';
import { Bracket } from '../widgets/bracket.js';
import { HeadToHead } from '../widgets/head-to-head.js';
import { LiveList } from '../widgets/live-list.js';
import { MatchCard } from '../widgets/match-card.js';
import { MatchStakes } from '../widgets/match-stakes.js';
import { RaceResult } from '../widgets/race-result.js';
import { RaceWeekend } from '../widgets/race-weekend.js';
import { RelatedVideos } from '../widgets/related-videos.js';
import { ScoreTicker } from '../widgets/score-ticker.js';
import { SeasonCalendar } from '../widgets/season-calendar.js';
import { StandingsTable } from '../widgets/standings-table.js';
import { TeamCard } from '../widgets/team-card.js';
import { TeamSchedule } from '../widgets/team-schedule.js';
import { TeamSquad } from '../widgets/team-squad.js';
import { UpcomingDerbies } from '../widgets/upcoming-derbies.js';
import { WhereToWatch } from '../widgets/where-to-watch.js';

export const EMBED_TAG = 'galaxie-widget';

/** O que `/e/<id>.json` devolve: a configuração pública do widget salvo. */
export interface EmbedConfig {
  id: string;
  kind: WidgetKind;
  version: number;
  theme: WidgetTheme;
  locale: WidgetLocale;
  market: string;
  defaults: WidgetDefaults;
  /** Legenda e cores das zonas (só na tabela de classificação). */
  standings?: StandingsOptions | undefined;
  /** Modo, agrupamento, atualização e dados extras (só na lista de jogos). */
  liveList?: LiveListOptions | undefined;
  /** Opções de conteúdo do tipo (`WIDGET_OPTIONS`): campos liga/desliga, quantidades, filtros. */
  options?: WidgetOptions | undefined;
  /** Base da API pública que o widget chama. */
  apiBaseUrl: string;
}

/** Atributos que trocam o salvo no Builder (um mesmo widget servindo a vários jogos ou competições). */
export const EMBED_ATTRIBUTES = [
  'widget',
  'key',
  'locale',
  'market',
  'event-id',
  'competition-id',
  'team-id',
  'person-id',
] as const;

export interface EmbedOverrides {
  locale?: string | null;
  market?: string | null;
  eventId?: string | null;
  competitionId?: string | null;
  teamId?: string | null;
  personId?: string | null;
}

const isLocale = (v: unknown): v is WidgetLocale => (WIDGET_LOCALES as readonly unknown[]).includes(v);

/** Configuração salva + atributos do elemento → idioma, mercado e props do componente. */
export function resolveEmbed(config: EmbedConfig, overrides: EmbedOverrides = {}) {
  const locale = isLocale(overrides.locale) ? overrides.locale : config.locale;
  const market = (
    /^[A-Za-z]{2}$/.test(overrides.market ?? '') ? overrides.market! : config.market
  ).toUpperCase();
  const eventId = overrides.eventId || config.defaults.eventId;
  const competitionId = overrides.competitionId || config.defaults.competitionId;
  const teamId = overrides.teamId || config.defaults.teamId;
  const personId = overrides.personId || config.defaults.personId;
  return { locale, market, eventId, competitionId, teamId, personId, sport: config.defaults.sport };
}

/** Lê e confere a resposta de `/e/<id>.json` (vem da rede: nada de confiar no formato). */
export function parseEmbedConfig(raw: unknown): EmbedConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<EmbedConfig>;
  if (typeof c.id !== 'string' || !(WIDGET_KINDS as readonly unknown[]).includes(c.kind)) return null;
  if (!c.theme || typeof c.theme !== 'object' || !isLocale(c.locale)) return null;
  if (typeof c.market !== 'string' || typeof c.apiBaseUrl !== 'string') return null;
  return {
    ...c,
    defaults: c.defaults && typeof c.defaults === 'object' ? c.defaults : {},
    standings: parseStandingsOptions(c.standings),
    liveList: parseLiveListOptions(c.liveList),
    options: parseWidgetOptions(c.kind as WidgetKind, c.options),
  } as EmbedConfig;
}

function EmbeddedWidget({ config, overrides }: { config: EmbedConfig; overrides: EmbedOverrides }) {
  const { eventId, competitionId, teamId, personId, market, sport } = resolveEmbed(config, overrides);
  const o = optionProps(config.kind, config.options);
  switch (config.kind) {
    case 'match_card':
      return <MatchCard {...o} eventId={eventId ?? ''} />;
    case 'where_to_watch':
      return <WhereToWatch {...o} eventId={eventId ?? ''} market={market} />;
    case 'standings':
      return (
        <StandingsTable
          season="current"
          {...o}
          competitionId={competitionId ?? ''}
          showLegend={config.standings?.showLegend}
          zoneColors={config.standings?.zoneColors}
        />
      );
    case 'live_list':
      return <LiveList {...config.liveList} competitionId={competitionId} teamId={teamId} sport={sport} />;
    case 'score_ticker':
      return <ScoreTicker {...o} competitionId={competitionId} sport={sport} />;
    case 'ai_context':
      return <AiContext {...o} eventId={eventId ?? ''} />;
    case 'match_stakes':
      return <MatchStakes {...o} eventId={eventId ?? ''} />;
    case 'related_videos':
      return <RelatedVideos {...o} eventId={eventId ?? ''} />;
    case 'head_to_head':
      return <HeadToHead {...o} eventId={eventId ?? ''} />;
    case 'team_schedule':
      return <TeamSchedule {...o} teamId={teamId ?? ''} />;
    case 'team_card':
      return <TeamCard {...o} teamId={teamId ?? ''} />;
    case 'race_result':
      return <RaceResult {...o} eventId={eventId ?? ''} />;
    case 'race_weekend':
      return <RaceWeekend {...o} eventId={eventId ?? ''} />;
    case 'season_calendar':
      return <SeasonCalendar {...o} competitionId={competitionId ?? ''} />;
    case 'athlete_profile':
      return <AthleteProfile {...o} teamId={teamId ?? ''} />;
    case 'fight_card':
      return <FightCard {...o} eventId={eventId ?? ''} />;
    case 'match_timeline':
      return <MatchTimeline {...o} eventId={eventId ?? ''} />;
    case 'equestrian_results':
      return <EquestrianResults {...o} />;
    case 'equestrian_ranking':
      return <EquestrianRanking {...o} />;
    case 'equestrian_calendar':
      return <EquestrianCalendar {...o} />;
    case 'rider_profile':
      return <RiderProfile {...o} />;
    case 'horse_profile':
      return <HorseProfile {...o} />;
    case 'medal_table':
      return <MedalTable {...o} />;
    case 'country_today':
      return <CountryToday {...o} />;
    case 'games_schedule':
      return <GamesSchedule {...o} />;
    case 'country_athletes':
      return <CountryAthletes {...o} />;
    case 'medal_history':
      return <MedalHistory {...o} />;
    case 'sidelined':
      return eventId ? <Sidelined {...o} eventId={eventId} /> : <Sidelined {...o} teamId={teamId} />;
    case 'champions_gallery':
      return <ChampionsGallery {...o} competitionId={competitionId ?? ''} />;
    case 'competition_leaders':
      return <CompetitionLeaders {...o} competitionId={competitionId ?? ''} />;
    case 'countdown':
      return <Countdown {...o} eventId={eventId ?? ''} />;
    case 'team_squad':
      return <TeamSquad {...o} teamId={teamId ?? ''} />;
    case 'player_profile':
      return <PlayerProfile {...o} personId={personId ?? ''} />;
    case 'lineups':
      return <Lineups {...o} eventId={eventId ?? ''} />;
    case 'match_prediction':
      return <MatchPrediction {...o} eventId={eventId ?? ''} />;
    case 'match_odds':
      return <MatchOdds {...o} eventId={eventId ?? ''} />;
    case 'team_stats':
      return <TeamStats {...o} teamId={teamId ?? ''} />;
    case 'transfer_market':
      return <TransferMarket {...o} teamId={teamId} competitionId={teamId ? undefined : competitionId} />;
    case 'bracket':
      return <Bracket {...o} competitionId={competitionId ?? ''} />;
    case 'upcoming_derbies':
      return <UpcomingDerbies {...o} />;
  }
}

/** Origem de onde o script foi carregado: é dela que sai a configuração dos widgets. */
function scriptOrigin(): string | null {
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (!src) return null;
  try {
    return new URL(src).origin;
  } catch {
    return null;
  }
}

/** Validade da configuração lida (igual ao `max-age` de `/e/<id>.json`). */
const CONFIG_TTL_MS = 60_000;

const HOST_CSS =
  ':host{display:block}:host([hidden]){display:none}.gs-embed-error{font:13px/1.4 system-ui,sans-serif;opacity:.7}';

export interface DefineEmbedOptions {
  /** Origem das configurações (`/e/<id>.json`). Padrão: a do próprio script. */
  origin?: string | null;
  /** fetch da configuração e da API (testes). Padrão: o do navegador. */
  fetch?: typeof fetch;
}

/** Registra `<galaxie-widget>` (uma vez só: o script pode aparecer duas vezes na mesma página). */
export function defineGalaxieWidgetElement(options: DefineEmbedOptions = {}): void {
  if (typeof customElements === 'undefined' || customElements.get(EMBED_TAG)) return;
  const baseOrigin = options.origin ?? scriptOrigin() ?? globalThis.location?.origin ?? '';
  const fetchImpl = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  // vários elementos com o mesmo widget na página: uma leitura da configuração por CONFIG_TTL_MS (o mesmo
  // cache da rota), para um widget salvo de novo chegar a páginas abertas há muito tempo; falha não fica
  const configs = new Map<string, { pending: Promise<EmbedConfig | null>; expiresAt: number }>();
  const loadConfig = (id: string) => {
    const cached = configs.get(id);
    if (cached && cached.expiresAt > Date.now()) return cached.pending;
    const pending = fetchImpl(`${baseOrigin}/e/${encodeURIComponent(id)}.json`, { credentials: 'omit' })
      .then((res) => (res.ok ? res.json() : null))
      .then(parseEmbedConfig)
      .catch(() => null)
      .then((config) => {
        if (!config) configs.delete(id);
        return config;
      });
    configs.set(id, { pending, expiresAt: Date.now() + CONFIG_TTL_MS });
    return pending;
  };

  class GalaxieWidgetElement extends HTMLElement {
    static observedAttributes = [...EMBED_ATTRIBUTES];
    private root: Root | null = null;
    private mount: HTMLDivElement | null = null;
    private renderId = 0;

    connectedCallback() {
      if (!this.mount) {
        const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = HOST_CSS;
        this.mount = document.createElement('div');
        shadow.append(style, this.mount);
      }
      this.root ??= createRoot(this.mount);
      void this.update();
    }

    disconnectedCallback() {
      // o React desmonta fora do ciclo do elemento (desmontar durante o callback gera aviso)
      const root = this.root;
      this.root = null;
      if (root) queueMicrotask(() => root.unmount());
    }

    attributeChangedCallback() {
      if (this.root) void this.update();
    }

    private async update() {
      const id = this.getAttribute('widget')?.trim();
      const ticket = ++this.renderId;
      const config = id ? await loadConfig(id) : null;
      if (ticket !== this.renderId || !this.root) return;
      if (!config) {
        this.root.render(<p className="gs-embed-error">Galaxie Sports: widget indisponível.</p>);
        return;
      }
      const overrides: EmbedOverrides = {
        locale: this.getAttribute('locale'),
        market: this.getAttribute('market'),
        eventId: this.getAttribute('event-id'),
        competitionId: this.getAttribute('competition-id'),
        teamId: this.getAttribute('team-id'),
        personId: this.getAttribute('person-id'),
      };
      const { locale, market } = resolveEmbed(config, overrides);
      this.root.render(
        <GalaxieWidgetProvider
          baseUrl={config.apiBaseUrl}
          publishableKey={this.getAttribute('key')?.trim() ?? ''}
          theme={config.theme}
          locale={locale}
          market={market}
          fetch={options.fetch}
        >
          <EmbeddedWidget config={config} overrides={overrides} />
        </GalaxieWidgetProvider>,
      );
    }
  }

  customElements.define(EMBED_TAG, GalaxieWidgetElement);
}
