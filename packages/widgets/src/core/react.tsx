'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

import {
  LIVE_STATUSES,
  PROBLEM_STATUSES,
  PUBLISHABLE_KEY_HEADER,
  WIDGET_CSS,
  apiLocale,
  clockText,
  initials,
  intlLocale,
  localTimeZone,
  textsFor,
  themeToCssVars,
  type GsEvent,
  type WidgetKind,
  type WidgetLocale,
  type WidgetTexts,
  type WidgetTheme,
} from './model.js';

// ─── provider ────────────────────────────────────────────────────────────────────────────────────

export interface GalaxieWidgetProviderProps {
  /**
   * Base da API pública, ex.: https://api.galaxie.sports, ou um proxy no backend da operadora
   * (`/api/galaxie`, docs/05 §1.3), que injeta a chave secreta.
   */
  baseUrl: string;
  /**
   * Chave publicável da operadora (vai no header `x-galaxie-publishable-key`). Obrigatória quando
   * `baseUrl` é de outra origem; com o proxy na mesma origem, fica vazia e nenhum header vai.
   */
  publishableKey?: string | undefined;
  theme: WidgetTheme;
  locale: WidgetLocale;
  /** País ISO2: onde assistir e variante do espanhol. */
  market?: string | undefined;
  /** Fuso IANA das datas; padrão: o do navegador. */
  timeZone?: string | undefined;
  /** fetch alternativo (testes, preview do Builder com dados de exemplo). */
  fetch?: typeof fetch | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

export interface GalaxieWidgetContextValue {
  baseUrl: string;
  publishableKey: string;
  theme: WidgetTheme;
  locale: WidgetLocale;
  market: string | undefined;
  timeZone: string | undefined;
  fetchImpl: typeof fetch | undefined;
  texts: WidgetTexts;
}

const GalaxieWidgetContext = createContext<GalaxieWidgetContextValue | null>(null);

export function useGalaxieWidget(): GalaxieWidgetContextValue {
  const value = useContext(GalaxieWidgetContext);
  if (!value) throw new Error('Os widgets Galaxie precisam estar dentro de <GalaxieWidgetProvider>.');
  return value;
}

/** Contexto dos widgets (API, chave, idioma) e a raiz `.gs-root` com as CSS variables do tema. */
export function GalaxieWidgetProvider({
  baseUrl,
  publishableKey = '',
  theme,
  locale,
  market,
  timeZone,
  fetch: fetchImpl,
  className,
  children,
}: GalaxieWidgetProviderProps) {
  const value = useMemo<GalaxieWidgetContextValue>(
    () => ({
      baseUrl: baseUrl.replace(/\/+$/, ''),
      publishableKey,
      theme,
      locale,
      market: market?.toUpperCase(),
      timeZone,
      fetchImpl,
      texts: textsFor(locale),
    }),
    [baseUrl, publishableKey, theme, locale, market, timeZone, fetchImpl],
  );
  return (
    <GalaxieWidgetContext.Provider value={value}>
      <div
        className={className ? `gs-root ${className}` : 'gs-root'}
        data-gs-mode={theme.mode}
        style={themeToCssVars(theme) as CSSProperties}
      >
        <style>{WIDGET_CSS}</style>
        {children}
      </div>
    </GalaxieWidgetContext.Provider>
  );
}

// ─── dados ───────────────────────────────────────────────────────────────────────────────────────

export class GalaxieWidgetError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GalaxieWidgetError';
  }
}

export interface GalaxieQueryState<T> {
  data: T | null;
  error: GalaxieWidgetError | null;
  loading: boolean;
  retry: () => void;
}

type QueryParams = Record<string, string | number | undefined>;

/** Depois de um erro com dados na tela, tenta de novo neste intervalo. */
const ERROR_RETRY_MS = 60_000;

/**
 * Sem chave publicável, o widget só chama uma base da mesma origem da página (caminho relativo ou a
 * própria origem): é o proxy no backend da operadora, que repassa com a chave secreta (docs/05 §1.3).
 * Base de outra origem (a API da Galaxie) sem chave → `missing_key`, sem chamar.
 */
export function needsPublishableKey(
  baseUrl: string,
  pageOrigin: string | undefined = globalThis.location?.origin,
): boolean {
  if (!/^([a-z][a-z0-9+.-]*:)?\/\//i.test(baseUrl)) return false;
  try {
    return new URL(baseUrl, pageOrigin).origin !== pageOrigin;
  } catch {
    return true;
  }
}

/**
 * GET na API pública com a chave publicável (ou no proxy da operadora, sem chave). `refreshMs(data)`
 * decide o próximo polling (null = parar); com a aba escondida o polling espera ela voltar.
 */
export function useGalaxieQuery<T>(
  path: string | null,
  params: QueryParams = {},
  refreshMs?: (data: T) => number | null,
): GalaxieQueryState<T> {
  const { baseUrl, publishableKey, fetchImpl, locale, market, timeZone } = useGalaxieWidget();
  const query = new URLSearchParams();
  const all: QueryParams = { locale: apiLocale(locale, market), tz: timeZone ?? localTimeZone(), ...params };
  for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== '') query.set(k, String(v));
  const url = path ? `${baseUrl}${path}${query.size ? `?${query}` : ''}` : null;

  const [state, setState] = useState<Omit<GalaxieQueryState<T>, 'retry'>>({
    data: null,
    error: null,
    loading: url !== null,
  });
  const [attempt, setAttempt] = useState(0);
  const refreshRef = useRef(refreshMs);
  refreshRef.current = refreshMs;
  const lastUrl = useRef<string | null>(null);
  const hasData = useRef(false);

  useEffect(() => {
    if (!url) {
      // a entidade saiu das props: nada de dados velhos (nem de "carregando") na tela
      lastUrl.current = null;
      hasData.current = false;
      setState((s) =>
        s.data === null && s.error === null && !s.loading ? s : { data: null, error: null, loading: false },
      );
      return;
    }
    if (lastUrl.current !== url) {
      lastUrl.current = url;
      hasData.current = false;
      setState({ data: null, error: null, loading: true });
    } else {
      setState((s) => ({ ...s, error: null, loading: true }));
    }
    if (!publishableKey && !fetchImpl && needsPublishableKey(baseUrl)) {
      setState({ data: null, error: new GalaxieWidgetError(401, 'missing_key'), loading: false });
      return;
    }

    let cancelled = false;
    let waitingVisible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const doc = typeof document === 'undefined' ? null : document;

    const schedule = (ms: number | null) => {
      if (ms === null || cancelled) return;
      timer = setTimeout(() => {
        if (doc?.hidden) waitingVisible = true;
        else void load();
      }, ms);
    };

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await (fetchImpl ?? globalThis.fetch)(url, {
          headers: publishableKey
            ? { accept: 'application/json', [PUBLISHABLE_KEY_HEADER]: publishableKey }
            : { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!res.ok) {
          const problem = (await res.json().catch(() => null)) as { title?: string } | null;
          throw new GalaxieWidgetError(res.status, problem?.title ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as T;
        if (cancelled) return;
        hasData.current = true;
        setState({ data, error: null, loading: false });
        schedule(refreshRef.current?.(data) ?? null);
      } catch (err) {
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) return;
        const error =
          err instanceof GalaxieWidgetError
            ? err
            : new GalaxieWidgetError(0, err instanceof Error ? err.message : String(err));
        setState((s) => ({ data: s.data, error, loading: false }));
        // erro passageiro no polling: os dados continuam na tela e a próxima tentativa vem sozinha
        if (hasData.current) schedule(ERROR_RETRY_MS);
      }
    };

    const onVisibility = () => {
      if (doc && !doc.hidden && waitingVisible) {
        waitingVisible = false;
        void load();
      }
    };
    doc?.addEventListener('visibilitychange', onVisibility);
    void load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      doc?.removeEventListener('visibilitychange', onVisibility);
    };
  }, [url, baseUrl, publishableKey, fetchImpl, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

/** Formatadores de data e hora no idioma do widget e no fuso do navegador. */
export function useFormatters() {
  const { locale, market, timeZone } = useGalaxieWidget();
  return useMemo(() => {
    const intl = intlLocale(locale, market);
    const tz = timeZone ?? localTimeZone();
    const time = new Intl.DateTimeFormat(intl, { hour: '2-digit', minute: '2-digit', timeZone: tz });
    const dateTime = new Intl.DateTimeFormat(intl, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });
    const safe = (f: Intl.DateTimeFormat) => (iso: string) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? '' : f.format(d);
    };
    return { time: safe(time), dateTime: safe(dateTime) };
  }, [locale, market, timeZone]);
}

// ─── peças visuais ───────────────────────────────────────────────────────────────────────────────

/** Moldura do widget (o cartão com borda e fundo do tema). */
export function WidgetFrame({
  kind,
  busy = false,
  children,
}: {
  kind: WidgetKind;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="gs-card" data-gs-widget={kind} aria-busy={busy || undefined}>
      {children}
    </section>
  );
}

/** Escudo, logo ou bandeira com as iniciais como reserva (sem logo ou com a imagem quebrada). */
export function Crest({
  src,
  name,
  size = 'md',
  className = 'gs-crest',
}: {
  src: string | null | undefined;
  name: string;
  size?: 'md' | 'sm' | 'xs';
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <span className={`${className} gs-initials`} data-size={size} role="img" aria-label={name}>
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      className={className}
      data-size={size}
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

/** Estado do jogo: minuto ao vivo pulsando, intervalo, encerrado, adiado… */
export function StatusBadge({ event }: { event: Pick<GsEvent, 'status' | 'clock'> }) {
  const { texts } = useGalaxieWidget();
  const label = texts.status[event.status] ?? event.status;
  if (LIVE_STATUSES.has(event.status) || event.status === 'starting') {
    const minute = event.status === 'live' ? clockText(event.clock) : null;
    return (
      <span className="gs-badge" data-tone="live">
        <span className="gs-dot" aria-hidden="true" />
        {minute ?? label}
        {minute ? <span className="gs-sr-only"> {label}</span> : null}
      </span>
    );
  }
  if (PROBLEM_STATUSES.has(event.status)) {
    return (
      <span className="gs-badge" data-tone="warn">
        {label}
      </span>
    );
  }
  if (event.status === 'finished') {
    return (
      <span className="gs-badge" data-tone="done">
        {label}
      </span>
    );
  }
  return <span className="gs-badge">{label}</span>;
}

export function LoadingState({ lines = 3 }: { lines?: number }) {
  const { texts } = useGalaxieWidget();
  return (
    <div className="gs-group" role="status">
      <span className="gs-sr-only">{texts.loading}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="gs-skeleton" style={{ width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: GalaxieWidgetError | null; onRetry: () => void }) {
  const { texts } = useGalaxieWidget();
  const message =
    error?.message === 'missing_key'
      ? texts.missingKey
      : error?.status === 401
        ? texts.invalidKey
        : error?.status === 403
          ? texts.forbidden
          : error?.status === 404
            ? texts.notFound
            : texts.error;
  // sem chave, chave inválida ou sem módulo: tentar de novo não resolve
  const retryable = error?.message !== 'missing_key' && error?.status !== 401 && error?.status !== 403;
  return (
    <div className="gs-state" role="alert" data-gs-error={error?.status ?? 0}>
      <span>{message}</span>
      {!retryable ? null : (
        <button type="button" className="gs-button" onClick={onRetry}>
          {texts.retry}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="gs-state">{children}</div>;
}
