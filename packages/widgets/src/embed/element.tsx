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
import { WIDGET_KINDS, WIDGET_LOCALES } from '../core/model.js';
import { GalaxieWidgetProvider } from '../core/react.js';
import { LiveList } from '../widgets/live-list.js';
import { MatchCard } from '../widgets/match-card.js';
import { StandingsTable } from '../widgets/standings-table.js';
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
  /** Base da API pública que o widget chama. */
  apiBaseUrl: string;
}

/** Atributos que trocam o salvo no Builder (um mesmo widget servindo a vários jogos ou competições). */
export const EMBED_ATTRIBUTES = ['widget', 'key', 'locale', 'market', 'event-id', 'competition-id'] as const;

export interface EmbedOverrides {
  locale?: string | null;
  market?: string | null;
  eventId?: string | null;
  competitionId?: string | null;
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
  return { locale, market, eventId, competitionId, sport: config.defaults.sport };
}

/** Lê e confere a resposta de `/e/<id>.json` (vem da rede: nada de confiar no formato). */
export function parseEmbedConfig(raw: unknown): EmbedConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<EmbedConfig>;
  if (typeof c.id !== 'string' || !(WIDGET_KINDS as readonly unknown[]).includes(c.kind)) return null;
  if (!c.theme || typeof c.theme !== 'object' || !isLocale(c.locale)) return null;
  if (typeof c.market !== 'string' || typeof c.apiBaseUrl !== 'string') return null;
  return { ...c, defaults: c.defaults && typeof c.defaults === 'object' ? c.defaults : {} } as EmbedConfig;
}

function EmbeddedWidget({ config, overrides }: { config: EmbedConfig; overrides: EmbedOverrides }) {
  const { eventId, competitionId, market, sport } = resolveEmbed(config, overrides);
  switch (config.kind) {
    case 'match_card':
      return <MatchCard eventId={eventId ?? ''} />;
    case 'where_to_watch':
      return <WhereToWatch eventId={eventId ?? ''} market={market} />;
    case 'standings':
      return <StandingsTable competitionId={competitionId ?? ''} season="current" />;
    case 'live_list':
      return <LiveList competitionId={competitionId} sport={sport} />;
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
