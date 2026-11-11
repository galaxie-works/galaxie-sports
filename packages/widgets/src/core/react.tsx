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
  FAN_TOKEN_CHANGED_EVENT,
  FAN_TOKEN_RENEW_BEFORE_MS,
  fanTokenSubject,
  LIVE_STATUSES,
  PROBLEM_STATUSES,
  fanGateMessage,
  fanTokenExpiresAt,
  isFanToken,
  PUBLISHABLE_KEY_HEADER,
  WIDGET_CSS,
  apiLocale,
  liveClockText,
  eventIcs,
  flagEmoji,
  initials,
  pickCurrentGames,
  intlLocale,
  sidesOf,
  localTimeZone,
  textsFor,
  themeToCssVars,
  type FanCapability,
  type FanStatus,
  type GsCompetitionContext,
  type GsFanMe,
  type GsEvent,
  type GsGames,
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
  /**
   * Token do torcedor (`gft_`), emitido pelo servidor do site com a chave secreta (`POST /v1/fans/tokens`).
   * Nunca a chave secreta no navegador. Sem token, os recursos do torcedor mostram "entre para participar".
   */
  fanToken?: string | null | undefined;
  /**
   * Busca um token novo no servidor do site (chamada no começo, um minuto antes de o token vencer e quando a
   * API recusa o token). Vale mais que `fanToken`. Devolver null = torcedor saiu.
   */
  getFanToken?: (() => FanTokenResult | Promise<FanTokenResult>) | undefined;
  /** Clique em "Entrar" num recurso do torcedor: o site abre o login dele. Sem isso, o botão não aparece. */
  onFanSignIn?: (() => void) | undefined;
  children?: ReactNode;
}

export type FanTokenResult = string | null | undefined;

/** Sessão do torcedor nos widgets (token `gft_`, #1020). */
export interface GalaxieFanSession {
  status: FanStatus;
  me: GsFanMe | null;
  /** O Perfil pode fazer isso? (`read`, `predict`, `write`, `redeem`; vem da faixa etária, pela API) */
  can: (capability: FanCapability) => boolean;
  /**
   * fetch numa rota do torcedor (`/v1/fans/me/...`, `/v1/events/.../presence`…), com o token e a chave
   * publicável. Token recusado → pede outro uma vez e repete.
   */
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  onSignIn: (() => void) | undefined;
  /**
   * Confere a sessão de novo, pedindo outro token a `getFanToken`: chame depois de o torcedor entrar ou sair
   * sem recarregar a página. O evento `galaxie:fan-token-changed` no `document` faz o mesmo.
   */
  refresh: () => void;
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
  fan: GalaxieFanSession;
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
  fanToken,
  getFanToken,
  onFanSignIn,
  children,
}: GalaxieWidgetProviderProps) {
  const fan = useFanSessionState({
    baseUrl: baseUrl.replace(/\/+$/, ''),
    publishableKey,
    fetchImpl,
    fanToken,
    getFanToken,
    onFanSignIn,
  });
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
      fan,
    }),
    [baseUrl, publishableKey, theme, locale, market, timeZone, fetchImpl, fan],
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

// ─── torcedor ────────────────────────────────────────────────────────────────────────────────────

function useFanSessionState({
  baseUrl,
  publishableKey,
  fetchImpl,
  fanToken,
  getFanToken,
  onFanSignIn,
}: {
  baseUrl: string;
  publishableKey: string;
  fetchImpl: typeof fetch | undefined;
  fanToken: string | null | undefined;
  getFanToken: GalaxieWidgetProviderProps['getFanToken'];
  onFanSignIn: (() => void) | undefined;
}): GalaxieFanSession {
  const hasCallback = Boolean(getFanToken);
  const getRef = useRef(getFanToken);
  getRef.current = getFanToken;
  const signInRef = useRef(onFanSignIn);
  signInRef.current = onFanSignIn;
  const tokenRef = useRef<string | null>(null);
  // um pedido de token novo por vez: recusas ao mesmo tempo esperam o mesmo
  const renewRef = useRef<Promise<string | null> | null>(null);
  // sobe a cada refresh(): pedido de token iniciado antes do login ou logout não vale mais
  const generationRef = useRef(0);
  // de quem é o `me` na tela (cliente:Perfil do token), para não mostrar o Perfil anterior com o token novo
  const meSubjectRef = useRef<string | null>(null);
  const [state, setState] = useState<{ status: FanStatus; me: GsFanMe | null }>(() => ({
    status: hasCallback || isFanToken(fanToken) ? 'checking' : 'none',
    me: null,
  }));
  const [attempt, setAttempt] = useState(0);

  // o token novo: o do callback (se houver) ou o da prop; qualquer outra coisa conta como "sem login"
  const obtain = useCallback(async (): Promise<string | null> => {
    let t: FanTokenResult = fanToken;
    if (getRef.current) {
      try {
        t = await getRef.current();
      } catch {
        t = null;
      }
    }
    return isFanToken(t) ? t.trim() : null;
  }, [fanToken]);

  const renew = useCallback((): Promise<string | null> => {
    if (renewRef.current) return renewRef.current;
    const generation = generationRef.current;
    const pending = obtain()
      .then((t) => {
        if (generation === generationRef.current) tokenRef.current = t;
        return t;
      })
      .finally(() => {
        if (renewRef.current === pending) renewRef.current = null;
      });
    renewRef.current = pending;
    return pending;
  }, [obtain]);

  const call = useCallback(
    (token: string, path: string, init: RequestInit = {}) => {
      // só caminhos da API: `@outro.host/x`, `//outro.host` ou `/\outro.host` levariam o token para fora
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
        throw new TypeError(`Caminho da API inválido: ${path}`);
      const headers = new Headers(init.headers);
      headers.set('accept', headers.get('accept') ?? 'application/json');
      headers.set('authorization', `Bearer ${token}`);
      if (publishableKey) headers.set(PUBLISHABLE_KEY_HEADER, publishableKey);
      return (fetchImpl ?? globalThis.fetch)(`${baseUrl}${path}`, { ...init, headers, credentials: 'omit' });
    },
    [baseUrl, publishableKey, fetchImpl],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastToken: string | null = null;
    const check = async () => {
      let token = await renew();
      if (cancelled) return;
      tokenRef.current = token;
      if (!token) {
        meSubjectRef.current = null;
        setState({ status: 'none', me: null });
        return;
      }
      // outro torcedor no mesmo widget: o Perfil anterior sai da tela já
      if (meSubjectRef.current && meSubjectRef.current !== fanTokenSubject(token)) {
        meSubjectRef.current = null;
        setState({ status: 'checking', me: null });
      }
      try {
        let res = await call(token, '/v1/fans/me');
        if (cancelled) return;
        if (res.status === 403) {
          // não é a sessão: a chave não leva o torcedor (presa a um widget) ou o recurso está fechado
          meSubjectRef.current = null;
          setState({ status: 'unavailable', me: null });
          return;
        }
        if (res.status === 401 && getRef.current) {
          // o site pode ter devolvido um token guardado e vencido: pede outro uma vez
          const fresh = await renew();
          if (cancelled) return;
          if (fresh && fresh !== token) {
            token = fresh;
            tokenRef.current = fresh;
            res = await call(fresh, '/v1/fans/me');
            if (cancelled) return;
          }
        }
        if (res.status === 401) {
          // token vencido, de outro cliente ou de Perfil excluído; com o callback, o próximo pedido tenta outro
          tokenRef.current = null;
          meSubjectRef.current = null;
          setState({ status: 'expired', me: null });
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { data?: GsFanMe };
        if (cancelled) return;
        const ok = Boolean(body.data && Array.isArray(body.data.capabilities));
        meSubjectRef.current = ok ? fanTokenSubject(token) : null;
        setState(ok ? { status: 'ready', me: body.data! } : { status: 'unavailable', me: null });
      } catch {
        if (cancelled) return;
        setState((s) => (s.me ? s : { status: 'unavailable', me: null }));
      }
      // renova antes de vencer (só quem sabe pedir outro); se a fonte devolveu o mesmo token já perto de
      // vencer (token fixo), não adianta conferir de novo
      const exp = fanTokenExpiresAt(token);
      const wait = exp === null ? null : exp - Date.now() - FAN_TOKEN_RENEW_BEFORE_MS;
      const stuck = token === lastToken && wait !== null && wait < 5_000;
      lastToken = token;
      if (wait !== null && getRef.current && !stuck)
        timer = setTimeout(() => void check(), Math.max(5_000, wait));
    };
    // já pronto: segue pronto enquanto confere, para o widget não desmontar (texto digitado no chat fica)
    setState((s) => (s.status === 'checking' || s.status === 'ready' ? s : { ...s, status: 'checking' }));
    void check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [obtain, call, hasCallback, attempt]);

  const fanFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = tokenRef.current ?? (await renew());
      if (!token) return new Response(null, { status: 401 });
      const res = await call(token, path, init);
      if (res.status !== 401 || !getRef.current) return res;
      // recusado: se outra chamada já trocou o token, usa o novo; senão pede outro (um pedido por vez)
      const fresh = tokenRef.current && tokenRef.current !== token ? tokenRef.current : await renew();
      tokenRef.current = fresh;
      if (!fresh) {
        meSubjectRef.current = null;
        setState({ status: 'none', me: null });
        return res;
      }
      if (fresh === token) {
        // a fonte não tem outro (token fixo): a sessão terminou
        tokenRef.current = null;
        meSubjectRef.current = null;
        setState({ status: 'expired', me: null });
        return res;
      }
      const again = await call(fresh, path, init);
      // recusado de novo: a sessão é conferida (vencida, de outro cliente ou Perfil excluído)
      if (again.status === 401) setAttempt((n) => n + 1);
      return again;
    },
    [renew, call],
  );

  const refresh = useCallback(() => {
    // descarta o pedido de token em voo: ele começou antes do login ou do logout
    generationRef.current += 1;
    renewRef.current = null;
    setAttempt((n) => n + 1);
  }, []);
  // o site avisa que o torcedor entrou ou saiu (login sem recarregar a página)
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    doc.addEventListener(FAN_TOKEN_CHANGED_EVENT, refresh);
    return () => doc.removeEventListener(FAN_TOKEN_CHANGED_EVENT, refresh);
  }, [refresh]);

  const onSignIn = useCallback(() => signInRef.current?.(), []);
  return useMemo<GalaxieFanSession>(
    () => ({
      status: state.status,
      me: state.me,
      can: (c) => state.status === 'ready' && Boolean(state.me?.capabilities.includes(c)),
      fetch: fanFetch,
      onSignIn: onFanSignIn ? onSignIn : undefined,
      refresh,
    }),
    [state, fanFetch, onSignIn, Boolean(onFanSignIn), refresh],
  );
}

/** Sessão do torcedor (dentro de `<GalaxieWidgetProvider>`). */
export function useFanSession(): GalaxieFanSession {
  return useGalaxieWidget().fan;
}

/**
 * Portão dos recursos do torcedor: mostra `children` só se o Perfil pode `need` (padrão `write`). Sem token,
 * "entre para participar" (com o botão quando o site passa `onFanSignIn`); `13_17` onde precisa escrever, só
 * leitura; `under13`, indisponível.
 */
export function FanGate({ need = 'write', children }: { need?: FanCapability; children?: ReactNode }) {
  const { texts, fan } = useGalaxieWidget();
  const message = fanGateMessage(fan.status, fan.me?.capabilities ?? [], need);
  if (message === null) return <>{children}</>;
  if (message === 'checking') return <div className="gs-state">{texts.loading}</div>;
  const text =
    message === 'unavailable'
      ? texts.error
      : message === 'signIn'
        ? texts.fan.signIn
        : message === 'expired'
          ? texts.fan.expired
          : message === 'readOnly'
            ? texts.fan.readOnly
            : texts.fan.restricted;
  const canSignIn = (message === 'signIn' || message === 'expired') && fan.onSignIn;
  return (
    <div className="gs-state" data-gs-fan={message}>
      <p>{text}</p>
      {canSignIn && (
        <button type="button" className="gs-button" onClick={fan.onSignIn}>
          {texts.fan.signInAction}
        </button>
      )}
    </div>
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
 * A base é resolvida contra a página como o `fetch` faria (espaços, barras invertidas, `https:host`).
 * Base de outra origem (a API da Galaxie, ou um proxy num subdomínio) sem chave → `missing_key`.
 */
export function needsPublishableKey(
  baseUrl: string,
  /** Página atual; `null` = fora do navegador (sem `location`). */
  page: Pick<Location, 'href' | 'origin'> | null = globalThis.location ?? null,
): boolean {
  if (!page) return true;
  try {
    return new URL(baseUrl, page.href).origin !== page.origin;
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

/** Formatadores de data, hora e número no idioma do widget (datas no fuso do navegador). */
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
    const date = new Intl.DateTimeFormat(intl, {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      timeZone: tz,
    });
    const dayMonth = new Intl.DateTimeFormat(intl, {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: tz,
    });
    const safe = (f: Intl.DateTimeFormat) => (iso: string) => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? '' : f.format(d);
    };
    const integer = new Intl.NumberFormat(intl, { maximumFractionDigits: 0 });
    const decimal = new Intl.NumberFormat(intl, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return {
      intl,
      time: safe(time),
      dateTime: safe(dateTime),
      date: safe(date),
      dayMonth: safe(dayMonth),
      /** Inteiro com o separador de milhar do idioma (1.872 / 1,872). */
      integer: (n: number) => integer.format(n),
      /** Uma casa decimal com a vírgula ou o ponto do idioma (7,2 / 7.2). */
      decimal: (n: number) => decimal.format(n),
    };
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
  size?: 'lg' | 'md' | 'sm' | 'xs';
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
export function StatusBadge({
  event,
}: {
  event: Pick<GsEvent, 'status' | 'clock'> & { sport?: string | undefined };
}) {
  const { texts } = useGalaxieWidget();
  const label = texts.status[event.status] ?? event.status;
  if (LIVE_STATUSES.has(event.status) || event.status === 'starting') {
    // futebol: o minuto; outros esportes: a parcial em andamento ("3Q", "S4")
    const minute = event.status === 'live' ? liveClockText(event, texts) : null;
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

/** Números em destaque (perfil do atleta, do cavalo): o valor grande e o rótulo embaixo; null não aparece. */
export function StatGrid({ items }: { items: [string, string | number | null | undefined][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined);
  return shown.length ? (
    <div className="gs-stats">
      {shown.map(([label, value]) => (
        <div key={label} className="gs-stat">
          <strong>{value}</strong>
          <span className="gs-muted gs-small">{label}</span>
        </div>
      ))}
    </div>
  ) : null;
}

/** Bandeira do país: a imagem da fonte quando há; senão o emoji pelo código ISO; senão o código. */
export function Flag({
  url,
  iso2,
  code,
  name,
}: {
  url?: string | null | undefined;
  iso2?: string | null | undefined;
  code?: string | null | undefined;
  name?: string | null | undefined;
}) {
  const label = name ?? code ?? '';
  if (url) return <Crest src={url} name={label} size="xs" />;
  const emoji = flagEmoji(iso2);
  if (emoji)
    return (
      <span className="gs-flag" role="img" aria-label={label}>
        {emoji}
      </span>
    );
  return code ? <span className="gs-muted gs-small">{code}</span> : null;
}

/** Medalha (ouro, prata, bronze) em um círculo na cor dela. */
export function MedalDot({ medal, label }: { medal: 'G' | 'S' | 'B'; label: string }) {
  return (
    <span className="gs-medal" data-medal={medal} role="img" aria-label={label} title={label}>
      {medal === 'G' ? '1' : medal === 'S' ? '2' : '3'}
    </span>
  );
}

const GAMES_REFRESH_MS = 6 * 60 * 60_000;

/**
 * Edição dos Jogos do widget: a escolhida (`slug`) ou, sem ela, a atual pela lista (`pickCurrentGames`).
 * Devolve o slug quando há, mais o estado da lista para o carregando/erro.
 */
export function useGamesSlug(slug: string | null | undefined): {
  slug: string | null;
  loading: boolean;
  error: GalaxieWidgetError | null;
  retry: () => void;
} {
  const list = useGalaxieQuery<{ data: GsGames[] }>(
    slug ? null : '/v1/multisport/games',
    {},
    () => GAMES_REFRESH_MS,
  );
  if (slug) return { slug, loading: false, error: null, retry: list.retry };
  const current = list.data ? pickCurrentGames(list.data.data) : null;
  return { slug: current?.slug ?? null, loading: list.loading, error: list.error, retry: list.retry };
}

/**
 * Botão "adicionar ao calendário": baixa um `.ics` do jogo montado no navegador (Google Agenda, Outlook e o
 * calendário do celular abrem o arquivo). Só para jogo que ainda não começou.
 */
export function CalendarButton({ event, compact = false }: { event: GsEvent; compact?: boolean }) {
  const { texts } = useGalaxieWidget();
  if (event.status !== 'scheduled') return null;
  const download = () => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(new Blob([eventIcs(event)], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${event.id}.ics`;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  return (
    <button
      type="button"
      className="gs-button"
      data-gs-calendar={compact ? 'compact' : ''}
      aria-label={texts.extra.addToCalendar}
      title={texts.extra.addToCalendar}
      onClick={download}
    >
      {compact ? texts.extra.calendarShort : texts.extra.addToCalendar}
    </button>
  );
}

/** Líder (de cada grupo, quando há mais de um) e os próximos jogos decisivos. */
export function CompetitionSituation({ context, max = 3 }: { context: GsCompetitionContext; max?: number }) {
  const { texts } = useGalaxieWidget();
  const fmt = useFormatters();
  const day = fmt.dayMonth;
  const leaders = context.groups.filter((g) => g.leader);
  const games = (context.decisive_events ?? []).slice(0, max);
  if (!leaders.length && !games.length) return null;
  return (
    <div className="gs-group" data-gs-decisive="">
      {leaders.map((g, i) => (
        <div key={g.name ?? i} className="gs-line gs-small">
          <span className="gs-muted">
            {leaders.length > 1 && g.name ? `${texts.extra.leader} · ${g.name}` : texts.extra.leader}
          </span>
          <Crest src={g.leader!.participant.logo} name={g.leader!.participant.name} size="xs" />
          <span className="gs-truncate">
            {g.leader!.participant.short_name ?? g.leader!.participant.name}
          </span>
        </div>
      ))}
      {games.length ? (
        <>
          <div className="gs-group-title">{texts.extra.decisive}</div>
          <ul className="gs-list">
            {games.map((e) => {
              const { home, away } = sidesOf(e);
              return (
                <li key={e.id} className="gs-fixture">
                  <time className="gs-fixture-date" dateTime={e.starts_at}>
                    {day(e.starts_at)}
                  </time>
                  <span className="gs-truncate">
                    {`${home?.short_name ?? home?.name ?? '?'} ${texts.versus} ${away?.short_name ?? away?.name ?? '?'}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
