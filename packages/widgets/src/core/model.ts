// ─── Modelo dos widgets Galaxie Sports ───────────────────────────────────────────────────────────
// Tipos, tema (CSS variables `--gs-*`), textos e utilitários sem React. Este arquivo e o `react.tsx`
// formam o `galaxie-core.tsx` que vai para o app da operadora pelo registry shadcn (scripts/embed-sources.mjs):
// não importe nada aqui.

// ─── configuração (mesmo formato salvo no banco pelo Builder) ───────────────────────────────────

export const WIDGET_KINDS = ['match_card', 'live_list', 'standings', 'where_to_watch'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const WIDGET_LOCALES = ['pt-BR', 'es', 'en'] as const;
export type WidgetLocale = (typeof WIDGET_LOCALES)[number];

export type WidgetDensity = 'compact' | 'comfortable';
export type WidgetMode = 'light' | 'dark';

export interface WidgetTheme {
  primary: string;
  background: string;
  surface: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  /** Raio dos cantos, em px. */
  radius: number;
  fontFamily: string;
  density: WidgetDensity;
  mode: WidgetMode;
}

export interface WidgetDefaults {
  competitionId?: string | undefined;
  teamId?: string | undefined;
  eventId?: string | undefined;
  sport?: string | undefined;
}

/** Configuração salva do widget (mesmo formato do banco: locale e market obrigatórios). */
export interface WidgetConfig {
  theme: WidgetTheme;
  locale: WidgetLocale;
  /** País ISO2 (onde assistir, relevância e variante do espanhol). */
  market: string;
  defaults: WidgetDefaults;
}

// ─── respostas da API pública (o recorte que os widgets leem; ver @galaxie/contracts) ─────────────

export type GsEventStatus =
  | 'scheduled'
  | 'starting'
  | 'live'
  | 'break'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'suspended'
  | 'abandoned';

export interface GsSidePair {
  home: number | null;
  away: number | null;
}

export interface GsParticipant {
  side: string;
  id: string;
  name: string;
  short_name: string | null;
  logo: string | null;
  winner: boolean | null;
}

export interface GsEvent {
  id: string;
  sport: string;
  competition: { id: string; slug: string; name: string; logo: string | null } | null;
  stage: { name: string | null } | null;
  starts_at: string;
  status: GsEventStatus;
  clock: { minute: number | null; extra: number | null; period: string | null } | null;
  participants: GsParticipant[];
  score: GsSidePair & { penalty: GsSidePair | null };
  venue: { name: string; city: string | null } | null;
}

export interface GsEventList {
  data: GsEvent[];
}

export interface GsStandingRow {
  rank: number;
  participant: { id: string; name: string; short_name: string | null; logo: string | null };
  points: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goal_diff: number;
  form: string | null;
  description: string | null;
}

export interface GsStandings {
  competition_id: string;
  season: { year: number; label: string };
  groups: { name: string | null; rows: GsStandingRow[] }[];
  updated_at: string | null;
}

export const BROADCAST_MEDIA = [
  'free_tv',
  'pay_tv',
  'streaming_svod',
  'streaming_free',
  'youtube',
  'official_app',
  'radio',
] as const;
export type GsBroadcastMedium = (typeof BROADCAST_MEDIA)[number];
export type GsAccessModel = 'free' | 'subscription' | 'ppv' | 'unknown';

export interface GsWatchOption {
  id: string;
  provider: string;
  /** Id da emissora na biblioteca (liga a opção aos canais do bloco `availability`). */
  provider_id?: string | null;
  channel: string | null;
  medium: GsBroadcastMedium;
  access_model: GsAccessModel;
  region: string | null;
  watch_url: string | null;
  logo: string | null;
  logo_dark: string | null;
}

export interface GsWatchToConfirm {
  provider: string;
  provider_id?: string | null;
  medium: GsBroadcastMedium;
  access_model: GsAccessModel;
  logo: string | null;
  logo_dark: string | null;
}

/** Canal ou streaming da biblioteca de emissoras (bloco `availability`). */
export interface GsAvailabilityLogo {
  id: string;
  name: string;
  logo: string | null;
  logo_dark: string | null;
}

export type GsPlanAccess = 'included' | 'addon';
export type GsPlatformKind = 'pay_tv_operator' | 'vmvpd' | 'telco_bundle' | 'streaming';

export interface GsPlatform {
  id: string;
  name: string;
  kind: GsPlatformKind;
  broadcaster_id: string | null;
  logo: string | null;
  logo_dark: string | null;
  /** Crédito do logo da Commons (null no acervo oficial); `text` pronto para exibir. */
  logo_credit?: { text: string; page_url: string; attribution_required: boolean } | null;
}

export interface GsAvailabilityPlan {
  id: string;
  name: string;
  access: GsPlanAccess;
  via_channels: (GsAvailabilityLogo & { access: GsPlanAccess })[];
  included_services: GsAvailabilityLogo[];
}

/** Complemento da plataforma (contratado à parte por qualquer plano), "a partir de" o menor preço. */
export interface GsPlatformAddon extends GsAvailabilityLogo {
  kind: 'service' | 'channel';
  channel: string | null;
  price_from: number | null;
  currency: string | null;
}

export interface GsPlatformAvailability {
  platform: GsPlatform;
  plans: GsAvailabilityPlan[];
  /** Ausente nas respostas antigas da API. */
  addons?: GsPlatformAddon[] | undefined;
}

/** Canal deste jogo por momento (antes, ao vivo, encerrado), com a melhor fonte. */
export interface GsMatchChannel {
  phase: 'pre' | 'live' | 'post';
  state: 'confirmed' | 'to_confirm' | 'not_confirmed';
  headline: string;
  hint: string | null;
  channels: {
    id: string;
    name: string;
    source: { publisher: string; url: string; kind: string } | null;
  }[];
}

/** Onde assistir agrupado: TV aberta, canais pagos e as plataformas ("disponível também em"). */
export interface GsAvailability {
  free_tv: GsAvailabilityLogo[];
  pay_tv_channels: GsAvailabilityLogo[];
  platforms: GsPlatformAvailability[];
  your_operator: GsPlatformAvailability | null;
  /** `to_confirm`: o canal do jogo não foi confirmado; os grupos são os dos detentores dos direitos. */
  channel_status?: 'confirmed' | 'to_confirm';
  /** Ausente nas respostas antigas da API. */
  match_channel?: GsMatchChannel | null;
}

export interface GsWhereToWatch {
  event_id: string;
  country: string;
  status: 'resolved' | 'unknown';
  message: string | null;
  options: GsWatchOption[];
  to_confirm: GsWatchToConfirm[];
  /** Ausente em respostas antigas (cópias em cache): o widget cai para a lista por mídia. */
  availability?: GsAvailability | null;
}

// ─── tema ────────────────────────────────────────────────────────────────────────────────────────

/** Header da chave publicável (a única credencial que vai para o navegador). */
export const PUBLISHABLE_KEY_HEADER = 'x-galaxie-publishable-key';

export const THEME_PRESET_IDS = ['dark', 'light', 'emerald', 'sunset'] as const;
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

const SYSTEM_FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Presets do Builder: escuro e claro na linha da demo e duas marcas genéricas. */
export const DEFAULT_THEMES: Record<ThemePresetId, WidgetTheme> = {
  dark: {
    primary: '#7c6cff',
    background: '#0b0d12',
    surface: '#131722',
    foreground: '#f3f5fa',
    mutedForeground: '#8d95a8',
    border: '#252b39',
    radius: 12,
    fontFamily: SYSTEM_FONT,
    density: 'comfortable',
    mode: 'dark',
  },
  light: {
    primary: '#5b4bff',
    background: '#f6f7fb',
    surface: '#ffffff',
    foreground: '#10131a',
    mutedForeground: '#5f6779',
    border: '#e3e6ee',
    radius: 12,
    fontFamily: SYSTEM_FONT,
    density: 'comfortable',
    mode: 'light',
  },
  emerald: {
    primary: '#12b76a',
    background: '#06140e',
    surface: '#0c2219',
    foreground: '#eafbf2',
    mutedForeground: '#86a99a',
    border: '#1a3a2c',
    radius: 6,
    fontFamily: SYSTEM_FONT,
    density: 'compact',
    mode: 'dark',
  },
  sunset: {
    primary: '#f05a28',
    background: '#fff8f3',
    surface: '#ffffff',
    foreground: '#1f1410',
    mutedForeground: '#7a6258',
    border: '#f1e1d6',
    radius: 18,
    fontFamily: SYSTEM_FONT,
    density: 'comfortable',
    mode: 'light',
  },
};

export const THEME_PRESET_LABELS: Record<ThemePresetId, Record<WidgetLocale, string>> = {
  dark: { 'pt-BR': 'Escuro', es: 'Oscuro', en: 'Dark' },
  light: { 'pt-BR': 'Claro', es: 'Claro', en: 'Light' },
  emerald: { 'pt-BR': 'Marca esmeralda', es: 'Marca esmeralda', en: 'Emerald brand' },
  sunset: { 'pt-BR': 'Marca pôr do sol', es: 'Marca atardecer', en: 'Sunset brand' },
};

/** CSS variables do widget. As chaves são estáveis: o app da operadora pode sobrescrever qualquer uma. */
export type GsCssVars = Record<`--gs-${string}`, string>;

function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, '');
  const full =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split('')
          .map((c) => c + c)
          .join('')
      : hex.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** Texto legível sobre a cor primária (luminância relativa WCAG). */
export function readableOn(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#0b0d12' : '#ffffff';
}

/** Converte o tema salvo nas CSS variables `--gs-*` que os widgets usam. */
export function themeToCssVars(theme: WidgetTheme): GsCssVars {
  const compact = theme.density === 'compact';
  const radius = Number.isFinite(theme.radius) ? Math.min(Math.max(theme.radius, 0), 32) : 12;
  return {
    '--gs-primary': theme.primary,
    '--gs-primary-foreground': readableOn(theme.primary),
    '--gs-background': theme.background,
    '--gs-surface': theme.surface,
    '--gs-foreground': theme.foreground,
    '--gs-muted-foreground': theme.mutedForeground,
    '--gs-border': theme.border,
    '--gs-live': theme.mode === 'dark' ? '#ff6b6b' : '#e5383b',
    '--gs-radius': `${radius}px`,
    '--gs-font-family': theme.fontFamily,
    '--gs-font-size': compact ? '13px' : '14px',
    '--gs-gap': compact ? '8px' : '12px',
    '--gs-pad': compact ? '12px' : '16px',
    '--gs-crest': compact ? '32px' : '44px',
  };
}

/** Folha de estilo dos widgets: só classes `gs-*` e as variables do tema, sem Tailwind. */
export const WIDGET_CSS = `
.gs-root{font-family:var(--gs-font-family);font-size:var(--gs-font-size);line-height:1.4;color:var(--gs-foreground);-webkit-font-smoothing:antialiased}
.gs-root[data-gs-mode=dark]{color-scheme:dark}.gs-root[data-gs-mode=light]{color-scheme:light}
.gs-root *,.gs-root *::before,.gs-root *::after{box-sizing:border-box}
.gs-card{display:flex;flex-direction:column;gap:var(--gs-gap);padding:var(--gs-pad);background:var(--gs-surface);border:1px solid var(--gs-border);border-radius:var(--gs-radius);min-width:0}
.gs-header{display:flex;align-items:center;gap:8px;min-width:0;color:var(--gs-muted-foreground);font-size:.85em}
.gs-title{margin:0;font-size:1em;font-weight:700;color:var(--gs-foreground)}
.gs-spacer{flex:1}
.gs-muted{color:var(--gs-muted-foreground)}
.gs-small{font-size:.8em}
.gs-truncate{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gs-crest{flex:none;width:var(--gs-crest);height:var(--gs-crest);object-fit:contain}
.gs-crest[data-size=sm]{width:20px;height:20px}
.gs-crest[data-size=xs]{width:16px;height:16px}
.gs-initials{display:inline-grid;place-items:center;border-radius:calc(var(--gs-radius)/2);background:color-mix(in srgb,var(--gs-foreground) 9%,transparent);color:var(--gs-muted-foreground);font-weight:700;font-size:.8em;letter-spacing:.02em}
.gs-initials[data-size=sm],.gs-initials[data-size=xs]{font-size:8px}
.gs-match{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:var(--gs-gap)}
.gs-team{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;text-align:center;font-weight:600}
.gs-team[data-lost]{color:var(--gs-muted-foreground)}
.gs-score{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:1.9em;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.gs-score[data-live]{color:var(--gs-primary)}
.gs-score small{font-size:.38em;font-weight:600;color:var(--gs-muted-foreground)}
.gs-versus{font-size:1.1em;font-weight:700;color:var(--gs-muted-foreground)}
.gs-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;color:var(--gs-muted-foreground);font-size:.85em}
.gs-badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border:1px solid var(--gs-border);border-radius:999px;font-size:.78em;font-weight:700;white-space:nowrap;color:var(--gs-muted-foreground)}
.gs-badge[data-tone=live]{color:var(--gs-live);border-color:color-mix(in srgb,var(--gs-live) 45%,transparent);background:color-mix(in srgb,var(--gs-live) 12%,transparent)}
.gs-badge[data-tone=done]{color:var(--gs-foreground);background:color-mix(in srgb,var(--gs-foreground) 7%,transparent);border-color:transparent}
.gs-badge[data-tone=warn]{color:#d97706;border-color:color-mix(in srgb,#d97706 45%,transparent)}
.gs-badge[data-tone=primary]{color:var(--gs-primary-foreground);background:var(--gs-primary);border-color:transparent}
.gs-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:gs-pulse 1.4s ease-in-out infinite}
@keyframes gs-pulse{50%{opacity:.3}}
.gs-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.gs-group{display:flex;flex-direction:column;gap:4px}
.gs-group+.gs-group{margin-top:var(--gs-gap)}
.gs-group-title{display:flex;align-items:center;gap:6px;font-size:.72em;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--gs-muted-foreground)}
.gs-row{display:grid;grid-template-columns:64px 1fr;align-items:center;gap:var(--gs-gap);padding:calc(var(--gs-gap)*.7) 0;border-top:1px solid var(--gs-border)}
.gs-row:first-child{border-top:0}
.gs-row-status{display:flex;justify-content:flex-start;font-size:.85em;font-variant-numeric:tabular-nums;color:var(--gs-muted-foreground)}
.gs-row-teams{display:flex;flex-direction:column;gap:4px;min-width:0}
.gs-line{display:flex;align-items:center;gap:8px;min-width:0}
.gs-line[data-lost]{color:var(--gs-muted-foreground)}
.gs-line-score{margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums}
.gs-scroll{overflow-x:auto;margin:0 calc(var(--gs-pad)*-1);padding:0 var(--gs-pad)}
.gs-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.gs-table th{padding:4px 6px;border-bottom:1px solid var(--gs-border);font-size:.75em;font-weight:700;text-align:right;color:var(--gs-muted-foreground)}
.gs-table td{padding:calc(var(--gs-gap)*.55) 6px;border-bottom:1px solid var(--gs-border);text-align:right}
.gs-table tr:last-child td{border-bottom:0}
.gs-table .gs-left{text-align:left}
.gs-table .gs-strong{font-weight:800}
.gs-rank{width:28px;color:var(--gs-muted-foreground)}
.gs-rank[data-zone]{box-shadow:inset 3px 0 0 var(--gs-primary);color:var(--gs-foreground);font-weight:700}
.gs-form{display:inline-flex;gap:2px}
.gs-form span{width:6px;height:6px;border-radius:50%;background:var(--gs-muted-foreground)}
.gs-form span[data-r=W]{background:#16a34a}.gs-form span[data-r=L]{background:var(--gs-live)}
.gs-watch{display:flex;align-items:center;gap:var(--gs-gap);padding:calc(var(--gs-gap)*.7) 0;border-top:1px solid var(--gs-border)}
.gs-watch:first-child{border-top:0}
.gs-logo{flex:none;width:72px;height:32px;object-fit:contain;object-position:left center}
.gs-logo.gs-initials{width:72px;height:32px}
.gs-watch-text{display:flex;flex-direction:column;min-width:0;flex:1}
.gs-link{display:inline-flex;align-items:center;padding:4px 12px;border-radius:999px;background:var(--gs-primary);color:var(--gs-primary-foreground);font-size:.82em;font-weight:700;text-decoration:none;white-space:nowrap}
.gs-link:hover{filter:brightness(1.08)}
.gs-link:focus-visible,.gs-button:focus-visible{outline:2px solid var(--gs-primary);outline-offset:2px}
.gs-state{display:flex;flex-direction:column;align-items:center;gap:10px;padding:calc(var(--gs-pad)*1.2) var(--gs-pad);text-align:center;color:var(--gs-muted-foreground)}
.gs-button{appearance:none;padding:4px 14px;border:1px solid var(--gs-border);border-radius:999px;background:transparent;color:var(--gs-foreground);font:inherit;font-size:.85em;font-weight:600;cursor:pointer}
.gs-button:hover{border-color:var(--gs-primary)}
.gs-skeleton{display:block;height:12px;border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb,var(--gs-foreground) 6%,transparent) 0%,color-mix(in srgb,var(--gs-foreground) 13%,transparent) 50%,color-mix(in srgb,var(--gs-foreground) 6%,transparent) 100%);background-size:200% 100%;animation:gs-shimmer 1.3s linear infinite}
@keyframes gs-shimmer{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.gs-dot,.gs-skeleton{animation:none}}
.gs-tiles{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.gs-tile{display:flex;flex-direction:column;align-items:center;gap:6px;width:96px;padding:8px;border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)*.75);text-align:center;font-size:.8em;font-weight:600;line-height:1.2;color:var(--gs-foreground);text-decoration:none}
.gs-tile[data-to-confirm]{border-style:dashed}
a.gs-tile:hover{border-color:var(--gs-primary)}
.gs-tile .gs-logo{width:72px;height:32px;object-position:center}
.gs-cards{display:flex;flex-direction:column;gap:8px}
.gs-platform{display:flex;flex-direction:column;gap:8px;padding:calc(var(--gs-pad)*.75);border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)*.75);min-width:0}
.gs-platform[data-mine]{border-color:color-mix(in srgb,var(--gs-primary) 55%,transparent);background:color-mix(in srgb,var(--gs-primary) 7%,transparent)}
.gs-platform-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--gs-gap);min-width:0}
.gs-platform-head .gs-watch-text{min-width:8em}
.gs-platform-name{overflow-wrap:break-word;line-height:1.2}
.gs-plan{display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px solid var(--gs-border)}
.gs-plan-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-weight:600}
.gs-pill{display:inline-flex;padding:1px 8px;border-radius:999px;font-size:.72em;font-weight:700;color:#15803d;background:color-mix(in srgb,#16a34a 14%,transparent)}
.gs-pill[data-access=addon]{color:#b45309;background:color-mix(in srgb,#d97706 15%,transparent)}
.gs-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.gs-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 8px 3px 4px;border:1px solid var(--gs-border);border-radius:calc(var(--gs-radius)/2);font-size:.8em}
.gs-chip .gs-logo,.gs-chip .gs-logo.gs-initials{width:36px;height:20px;font-size:8px}
.gs-notice{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border:1px dashed var(--gs-border);border-radius:calc(var(--gs-radius)*.75);background:color-mix(in srgb,var(--gs-foreground) 4%,transparent)}
.gs-notice strong{font-size:.9em}
.gs-credit{font-size:.68em;color:var(--gs-muted-foreground);text-decoration:none}
.gs-credit:hover{text-decoration:underline}
.gs-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);border:0}
`;

// ─── textos ──────────────────────────────────────────────────────────────────────────────────────

export interface WidgetTexts {
  status: Record<GsEventStatus, string>;
  loading: string;
  error: string;
  notFound: string;
  missingKey: string;
  invalidKey: string;
  forbidden: string;
  retry: string;
  versus: string;
  penalties: string;
  emptyLive: string;
  emptyDay: string;
  emptyStandings: string;
  emptyWatch: string;
  liveNow: string;
  todayGames: string;
  standings: string;
  whereToWatch: string;
  toConfirm: string;
  watch: string;
  updated: string;
  columns: {
    team: string;
    points: string;
    played: string;
    won: string;
    drawn: string;
    lost: string;
    goalDiff: string;
  };
  media: Record<GsBroadcastMedium, string>;
  access: Record<GsAccessModel, string>;
  /** Onde assistir agrupado (bloco `availability`). */
  watchGroups: {
    freeTv: string;
    payTv: string;
    alsoOn: string;
    included: string;
    addon: string;
    includedServices: string;
    /** "Disponível como complemento" (contratado à parte). */
    addonsAvailable: string;
    /** "a partir de {price}". */
    priceFrom: string;
    yourOperator: string;
    notInYourOperator: string;
    toConfirmTitle: string;
    toConfirmHint: string;
    /** Sem a frase "sai mais perto da partida" (ao vivo). */
    toConfirmLiveHint: string;
    notConfirmedTitle: string;
    /** "Passa em {channels}", "Ao vivo em {channels}", "Transmitido por {channels}". */
    confirmedPre: string;
    confirmedLive: string;
    confirmedPost: string;
    /** "Fonte: {publisher}". */
    confirmedSource: string;
    kind: Record<GsPlatformKind, string>;
  };
}

const TEXTS: Record<WidgetLocale, WidgetTexts> = {
  'pt-BR': {
    status: {
      scheduled: 'Agendado',
      starting: 'Começando',
      live: 'Ao vivo',
      break: 'Intervalo',
      finished: 'Encerrado',
      postponed: 'Adiado',
      cancelled: 'Cancelado',
      suspended: 'Suspenso',
      abandoned: 'Abandonado',
    },
    loading: 'Carregando…',
    error: 'Não foi possível carregar os dados agora.',
    notFound: 'Não encontramos esse conteúdo.',
    missingKey: 'Configure a chave publicável da Galaxie Sports.',
    invalidKey: 'Chave publicável inválida ou revogada.',
    forbidden: 'Esta chave não libera este conteúdo. Confira o widget e o plano no portal Galaxie.',
    retry: 'Tentar de novo',
    versus: 'x',
    penalties: 'pên.',
    emptyLive: 'Nenhum jogo ao vivo agora.',
    emptyDay: 'Nenhum jogo nesta data.',
    emptyStandings: 'A tabela ainda não está disponível.',
    emptyWatch: 'Transmissão ainda não confirmada.',
    liveNow: 'Ao vivo agora',
    todayGames: 'Jogos do dia',
    standings: 'Classificação',
    whereToWatch: 'Onde assistir',
    toConfirm: 'Canal a confirmar',
    watch: 'Assistir',
    updated: 'Atualizado',
    columns: { team: 'Time', points: 'P', played: 'J', won: 'V', drawn: 'E', lost: 'D', goalDiff: 'SG' },
    media: {
      free_tv: 'TV aberta',
      pay_tv: 'TV por assinatura',
      streaming_svod: 'Streaming',
      streaming_free: 'Streaming grátis',
      youtube: 'YouTube',
      official_app: 'App oficial',
      radio: 'Rádio',
    },
    access: { free: 'Grátis', subscription: 'Assinatura', ppv: 'Pay-per-view', unknown: '' },
    watchGroups: {
      freeTv: 'TV aberta',
      payTv: 'Canais pagos',
      alsoOn: 'Disponível também em',
      included: 'Incluso',
      addon: 'Adicional',
      includedServices: 'Streamings inclusos',
      addonsAvailable: 'Disponível como complemento',
      priceFrom: 'a partir de {price}',
      yourOperator: 'Sua operadora',
      notInYourOperator: 'Este jogo não está na grade da sua operadora.',
      toConfirmTitle: 'Canal deste jogo a confirmar',
      toConfirmHint:
        'Quem tem os direitos no país e onde esses canais estão. O canal do jogo sai mais perto da partida.',
      toConfirmLiveHint: 'Quem tem os direitos no país e onde esses canais estão.',
      notConfirmedTitle: 'Não confirmamos o canal deste jogo',
      confirmedPre: 'Passa em {channels}',
      confirmedLive: 'Ao vivo em {channels}',
      confirmedPost: 'Transmitido por {channels}',
      confirmedSource: 'Fonte: {publisher}',
      kind: {
        pay_tv_operator: 'Operadora de TV paga',
        vmvpd: 'TV paga pela internet',
        telco_bundle: 'Pacote de telefonia e TV',
        streaming: 'Streaming',
      },
    },
  },
  es: {
    status: {
      scheduled: 'Programado',
      starting: 'Por comenzar',
      live: 'En vivo',
      break: 'Entretiempo',
      finished: 'Finalizado',
      postponed: 'Aplazado',
      cancelled: 'Cancelado',
      suspended: 'Suspendido',
      abandoned: 'Abandonado',
    },
    loading: 'Cargando…',
    error: 'No pudimos cargar los datos ahora.',
    notFound: 'No encontramos este contenido.',
    missingKey: 'Configura la clave publicable de Galaxie Sports.',
    invalidKey: 'Clave publicable inválida o revocada.',
    forbidden: 'Esta clave no habilita este contenido. Revisa el widget y el plan en el portal Galaxie.',
    retry: 'Reintentar',
    versus: 'vs',
    penalties: 'pen.',
    emptyLive: 'No hay partidos en vivo ahora.',
    emptyDay: 'No hay partidos en esta fecha.',
    emptyStandings: 'La tabla aún no está disponible.',
    emptyWatch: 'Transmisión aún no confirmada.',
    liveNow: 'En vivo ahora',
    todayGames: 'Partidos del día',
    standings: 'Posiciones',
    whereToWatch: 'Dónde ver',
    toConfirm: 'Canal por confirmar',
    watch: 'Ver',
    updated: 'Actualizado',
    columns: { team: 'Equipo', points: 'Pts', played: 'PJ', won: 'G', drawn: 'E', lost: 'P', goalDiff: 'DG' },
    media: {
      free_tv: 'TV abierta',
      pay_tv: 'TV paga',
      streaming_svod: 'Streaming',
      streaming_free: 'Streaming gratis',
      youtube: 'YouTube',
      official_app: 'App oficial',
      radio: 'Radio',
    },
    access: { free: 'Gratis', subscription: 'Suscripción', ppv: 'Pay-per-view', unknown: '' },
    watchGroups: {
      freeTv: 'TV abierta',
      payTv: 'Canales pagos',
      alsoOn: 'Disponible también en',
      included: 'Incluido',
      addon: 'Adicional',
      includedServices: 'Streamings incluidos',
      addonsAvailable: 'Disponible como adicional',
      priceFrom: 'desde {price}',
      yourOperator: 'Tu operadora',
      notInYourOperator: 'Este partido no está en la grilla de tu operadora.',
      toConfirmTitle: 'Canal de este partido a confirmar',
      toConfirmHint:
        'Quién tiene los derechos en el país y dónde están esos canales. El canal del partido se conoce más cerca del encuentro.',
      toConfirmLiveHint: 'Quién tiene los derechos en el país y dónde están esos canales.',
      notConfirmedTitle: 'No confirmamos el canal de este partido',
      confirmedPre: 'Se ve por {channels}',
      confirmedLive: 'En vivo por {channels}',
      confirmedPost: 'Transmitido por {channels}',
      confirmedSource: 'Fuente: {publisher}',
      kind: {
        pay_tv_operator: 'Operadora de TV paga',
        vmvpd: 'TV paga por internet',
        telco_bundle: 'Paquete de telefonía y TV',
        streaming: 'Streaming',
      },
    },
  },
  en: {
    status: {
      scheduled: 'Scheduled',
      starting: 'Starting',
      live: 'Live',
      break: 'Half-time',
      finished: 'Full time',
      postponed: 'Postponed',
      cancelled: 'Cancelled',
      suspended: 'Suspended',
      abandoned: 'Abandoned',
    },
    loading: 'Loading…',
    error: "We couldn't load the data right now.",
    notFound: "We couldn't find this content.",
    missingKey: 'Set your Galaxie Sports publishable key.',
    invalidKey: 'Invalid or revoked publishable key.',
    forbidden: "This key doesn't unlock this content. Check the widget and plan in the Galaxie portal.",
    retry: 'Try again',
    versus: 'vs',
    penalties: 'pens',
    emptyLive: 'No live games right now.',
    emptyDay: 'No games on this date.',
    emptyStandings: 'Standings are not available yet.',
    emptyWatch: 'Broadcast not confirmed yet.',
    liveNow: 'Live now',
    todayGames: "Today's games",
    standings: 'Standings',
    whereToWatch: 'Where to watch',
    toConfirm: 'Channel to be confirmed',
    watch: 'Watch',
    updated: 'Updated',
    columns: { team: 'Team', points: 'Pts', played: 'P', won: 'W', drawn: 'D', lost: 'L', goalDiff: 'GD' },
    media: {
      free_tv: 'Free-to-air TV',
      pay_tv: 'Pay TV',
      streaming_svod: 'Streaming',
      streaming_free: 'Free streaming',
      youtube: 'YouTube',
      official_app: 'Official app',
      radio: 'Radio',
    },
    access: { free: 'Free', subscription: 'Subscription', ppv: 'Pay-per-view', unknown: '' },
    watchGroups: {
      freeTv: 'Free-to-air TV',
      payTv: 'Pay TV channels',
      alsoOn: 'Also available on',
      included: 'Included',
      addon: 'Add-on',
      includedServices: 'Streaming included',
      addonsAvailable: 'Available as an add-on',
      priceFrom: 'from {price}',
      yourOperator: 'Your operator',
      notInYourOperator: 'This match is not in the lineup of your operator.',
      toConfirmTitle: 'Channel for this match to be confirmed',
      toConfirmHint:
        'Rights holders in this country and where those channels are. The match channel is announced closer to kick-off.',
      toConfirmLiveHint: 'Rights holders in this country and where those channels are.',
      notConfirmedTitle: "We couldn't confirm the channel for this match",
      confirmedPre: 'On {channels}',
      confirmedLive: 'Live on {channels}',
      confirmedPost: 'Broadcast on {channels}',
      confirmedSource: 'Source: {publisher}',
      kind: {
        pay_tv_operator: 'Pay TV operator',
        vmvpd: 'Live TV streaming',
        telco_bundle: 'Telecom bundle with TV',
        streaming: 'Streaming',
      },
    },
  },
};

export function textsFor(locale: WidgetLocale): WidgetTexts {
  return TEXTS[locale] ?? TEXTS['pt-BR'];
}

// ─── locale, fuso e datas ────────────────────────────────────────────────────────────────────────

const SPANISH_MARKETS = ['AR', 'MX', 'CO', 'CL', 'PE', 'UY', 'EC'];

/** Locale pedido à API (`?locale`): o espanhol segue o mercado; em inglês a API devolve o padrão. */
export function apiLocale(locale: WidgetLocale, market?: string | undefined): string | undefined {
  if (locale === 'pt-BR') return 'pt-BR';
  if (locale === 'es') {
    const m = market?.toUpperCase() ?? '';
    return SPANISH_MARKETS.includes(m) ? `es-${m}` : 'es-AR';
  }
  return undefined;
}

/** Locale do `Intl` (datas e horas). */
export function intlLocale(locale: WidgetLocale, market?: string | undefined): string {
  return locale === 'es' ? (apiLocale(locale, market) ?? 'es') : locale;
}

/** Fuso do navegador (IANA); undefined fora do navegador. */
export function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Dia civil (AAAA-MM-DD) num fuso. */
export function isoDate(date: Date, timeZone?: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// ─── eventos ─────────────────────────────────────────────────────────────────────────────────────

export const LIVE_STATUSES: ReadonlySet<GsEventStatus> = new Set(['live', 'break']);
export const STARTED_STATUSES: ReadonlySet<GsEventStatus> = new Set([
  'live',
  'break',
  'finished',
  'suspended',
  'abandoned',
]);
export const PROBLEM_STATUSES: ReadonlySet<GsEventStatus> = new Set([
  'postponed',
  'cancelled',
  'suspended',
  'abandoned',
]);

export function sidesOf(event: Pick<GsEvent, 'participants'>): {
  home: GsParticipant | undefined;
  away: GsParticipant | undefined;
} {
  const home = event.participants.find((p) => p.side === 'home') ?? event.participants[0];
  const away = event.participants.find((p) => p.side === 'away') ?? event.participants[1];
  return { home, away };
}

/** Minuto do jogo como o torcedor lê: 45+2'. */
export function clockText(clock: GsEvent['clock']): string | null {
  if (!clock?.minute) return null;
  return clock.extra ? `${clock.minute}+${clock.extra}'` : `${clock.minute}'`;
}

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

const MINUTE = 60_000;
/** Teto do despertar de um jogo distante: o horário pode mudar (e a página fica aberta por dias). */
const SCHEDULED_WAKE_MAX_MS = 6 * 60 * MINUTE;

/**
 * Polling do placar: 30 s com bola rolando, 1 min perto do início, nada depois do fim. Jogo agendado
 * mais longe acorda quando entra na janela de 30 min (no máximo a cada 6 h), para não ficar parado.
 */
export function eventRefreshMs(
  event: Pick<GsEvent, 'status' | 'starts_at'>,
  now = Date.now(),
): number | null {
  if (LIVE_STATUSES.has(event.status) || event.status === 'starting') return 30_000;
  if (event.status === 'scheduled') {
    const until = Date.parse(event.starts_at) - now;
    if (!Number.isFinite(until)) return null;
    if (until < 30 * MINUTE) return MINUTE;
    return Math.min(Math.max(until - 30 * MINUTE, MINUTE), SCHEDULED_WAKE_MAX_MS);
  }
  return null;
}
