'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  GS_CHAT_REACTIONS,
  GS_CHAT_REACTION_EMOJI,
  PUBLISHABLE_KEY_HEADER,
  chatRetryMs,
  fillText,
  maxReactionTotals,
  mergeChatMessages,
  mergeGameMessages,
  parseSse,
  safeImageUrl,
  type GsChatGameMessage,
  type GsChatGuidelines,
  type GsChatMessage,
  type GsChatReaction,
  type GsChatRoom,
  type GsChatRoomState,
} from '../core/model.js';
import {
  ErrorState,
  FanGate,
  LoadingState,
  WidgetFrame,
  useFanSession,
  useFormatters,
  useGalaxieQuery,
  useGalaxieWidget,
} from '../core/react.js';

export interface LiveChatProps {
  /** Id do jogo na API Galaxie (a sala é uma por jogo e por cliente). */
  eventId: string;
  /** Altura da lista de mensagens, em px (padrão 420). */
  height?: number | undefined;
  /** Gol, cartão vermelho, VAR, início, intervalo e fim dentro do chat (padrão: sim). */
  showGame?: boolean | undefined;
  /** Reações ao jogo (padrão: sim). */
  showReactions?: boolean | undefined;
  /** Onde fica o campo de escrever (padrão: embaixo). */
  inputPosition?: 'bottom' | 'top' | undefined;
  /** Só leitura: sem campo de escrever, nem para quem pode (padrão: não). */
  readOnly?: boolean | undefined;
}

const enc = encodeURIComponent;
/** Mensagens guardadas na tela (as mais antigas saem). */
const MAX_MESSAGES = 200;
const HIDDEN_KEY = 'gs-live-chat-hidden';
/** Releitura da sala (estado, fixada) enquanto o stream não manda a mudança: a cada minuto. */
const ROOM_REFRESH_MS = 60_000;

type Item =
  | { type: 'message'; at: string; message: GsChatMessage; held: boolean }
  | { type: 'game'; at: string; game: GsChatGameMessage };

function readHidden(): boolean {
  try {
    return globalThis.localStorage?.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  try {
    if (hidden) globalThis.localStorage?.setItem(HIDDEN_KEY, '1');
    else globalThis.localStorage?.removeItem(HIDDEN_KEY);
  } catch {
    // armazenamento bloqueado: o botão vale só nesta visita
  }
}

/** Quando reler a sala: na abertura (sala ainda fechada), no fim da janela, ou a cada minuto. */
function roomRefreshMs(body: { data: GsChatRoom }): number | null {
  const room = body.data;
  const now = Date.now();
  const next =
    room.state === 'scheduled'
      ? Date.parse(room.opens_at)
      : room.state === 'closed'
        ? null
        : Math.min(Date.parse(room.closes_at), now + ROOM_REFRESH_MS);
  if (next === null || !Number.isFinite(next)) return room.state === 'closed' ? null : ROOM_REFRESH_MS;
  return Math.min(Math.max(next - now + 1_000, 5_000), ROOM_REFRESH_MS * 5);
}

/**
 * Chat ao vivo da sala do jogo (#976): as mensagens chegam em lotes pelo stream da sala, com o jogo dentro do chat e
 * as reações. Ler não exige login; escrever, o token do torcedor `18plus`; `13_17` lê e reage. Nada da conversa é
 * renderizado no servidor (só depois de montar no navegador), e o torcedor pode esconder o chat.
 */
export function LiveChat(props: LiveChatProps) {
  // outro jogo, outra sala: o estado inteiro recomeça (nada da conversa anterior fica na tela)
  return <LiveChatRoom key={props.eventId} {...props} />;
}

function LiveChatRoom({
  eventId,
  height = 420,
  showGame = true,
  showReactions = true,
  inputPosition = 'bottom',
  readOnly = false,
}: LiveChatProps) {
  const { texts, locale, baseUrl, publishableKey, fetchImpl } = useGalaxieWidget();
  const T = texts.liveChat;
  const fan = useFanSession();
  const fmt = useFormatters();
  const path = eventId ? `/v1/chat/rooms/${enc(eventId)}` : null;
  const query = useGalaxieQuery<{ data: GsChatRoom }>(path, {}, roomRefreshMs);
  const room = query.data?.data ?? null;

  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setMounted(true);
    setHidden(readHidden());
  }, []);

  const [messages, setMessages] = useState<GsChatMessage[]>([]);
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  const [game, setGame] = useState<GsChatGameMessage[]>([]);
  const [reactions, setReactions] = useState<Partial<Record<GsChatReaction, number>>>({});
  const [state, setState] = useState<GsChatRoomState | null>(null);
  const [pinned, setPinned] = useState<GsChatMessage | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  // a leitura da sala (e a releitura depois de um `chat.reset`) é a base; o stream soma por cima
  useEffect(() => {
    if (!room) return;
    setMessages((cur) => mergeChatMessages(cur, room.messages, MAX_MESSAGES));
    setGame((cur) => mergeGameMessages(cur, room.game_messages));
    setReactions((cur) => maxReactionTotals(cur, room.reactions));
    setState(room.state);
    setPinned(room.pinned ?? null);
  }, [room]);

  // cursor do stream fora do efeito: esconder e mostrar, ou reconectar, emenda de onde parou
  const lastIdRef = useRef<string | null>(null);
  const connectedOnce = useRef(false);
  const retryRoom = query.retry;
  useEffect(() => {
    if (!mounted || !path || hidden) return;
    const controller = new AbortController();
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const doFetch = fetchImpl ?? globalThis.fetch;

    const handle = (event: string, data: string, id: string | null) => {
      let payload: unknown;
      try {
        payload = data ? JSON.parse(data) : null;
      } catch {
        return;
      }
      const p = payload as Record<string, unknown> | null;
      if (event === 'chat.batch' && p && Array.isArray(p.messages)) {
        if (id) lastIdRef.current = id;
        const batch = p.messages as GsChatMessage[];
        // a retida que a moderação liberou chega no lote: deixa de ser "só você vê"
        setHeld((cur) =>
          batch.some((m) => cur.has(m.id))
            ? new Set([...cur].filter((x) => !batch.some((m) => m.id === x)))
            : cur,
        );
        setMessages((cur) => mergeChatMessages(cur, batch, MAX_MESSAGES));
      } else if (event === 'chat.state' && p && typeof p.state === 'string') {
        setState(p.state as GsChatRoomState);
      } else if (event === 'chat.game' && p && Array.isArray(p.messages)) {
        const list = p.messages as GsChatGameMessage[];
        // a abertura manda a lista inteira: troca (o lance que saiu da linha do tempo some)
        setGame((cur) => (p.snapshot === true ? mergeGameMessages([], list) : mergeGameMessages(cur, list)));
      } else if (event === 'chat.reactions' && p && p.total && typeof p.total === 'object') {
        setReactions((cur) => maxReactionTotals(cur, p.total as Partial<Record<GsChatReaction, number>>));
      } else if (event === 'ready' && p && typeof p.last_event_id === 'string') {
        lastIdRef.current = p.last_event_id || lastIdRef.current;
      } else if (event === 'chat.reset') {
        lastIdRef.current = null;
        retryRoom();
      }
    };

    const schedule = (retryAfter: string | null) => {
      setReconnecting(true);
      failures += 1;
      timer = setTimeout(() => void connect(), chatRetryMs(failures, retryAfter));
    };

    const connect = async () => {
      try {
        const headers: Record<string, string> = { accept: 'text/event-stream' };
        if (publishableKey) headers[PUBLISHABLE_KEY_HEADER] = publishableKey;
        if (lastIdRef.current) headers['last-event-id'] = lastIdRef.current;
        // sem cursor depois da primeira conexão (ainda sem lote, ou depois de um reset): relê a sala para não perder
        else if (connectedOnce.current) retryRoom();
        const res = await doFetch(`${baseUrl}${path}/stream`, {
          headers,
          signal: controller.signal,
          credentials: 'omit',
        });
        if (res.status >= 500 || res.status === 429) return schedule(res.headers.get('retry-after'));
        // sem stream (prévia com dados de exemplo, chave sem o módulo): fica com a leitura da sala
        if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
          if (res.status === 401 || res.status === 403) setUnavailable(true);
          return;
        }
        connectedOnce.current = true;
        setReconnecting(false);
        setUnavailable(false);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let gotEvent = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSse(buffer);
          buffer = parsed.rest;
          for (const e of parsed.events) {
            if (e.event === 'access_revoked') {
              setUnavailable(true);
              return;
            }
            gotEvent = true;
            handle(e.event, e.data, e.id);
          }
        }
        // a conexão rendeu: a próxima espera recomeça do mínimo
        if (gotEvent) failures = 0;
        schedule(null);
      } catch {
        if (controller.signal.aborted) return;
        schedule(null);
      }
    };
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [mounted, path, hidden, baseUrl, publishableKey, fetchImpl, retryRoom]);

  // rolagem: segue o fim da conversa enquanto a pessoa está lá embaixo
  const logRef = useRef<HTMLDivElement | null>(null);
  const atBottom = useRef(true);
  const items = useMemo<Item[]>(() => {
    const list: Item[] = messages.map((m) => ({
      type: 'message',
      at: m.created_at,
      message: m,
      held: held.has(m.id),
    }));
    if (showGame) for (const g of game) list.push({ type: 'game', at: g.created_at, game: g });
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [messages, held, game, showGame]);
  useEffect(() => {
    const el = logRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  // envio
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const roomState = state ?? room?.state ?? null;
  useEffect(() => setSendError(null), [roomState]);
  const maxChars = room?.settings.max_chars ?? 280;
  // Diretrizes (#957): a primeira mensagem pede o aceite das regras do chat
  const [guidelines, setGuidelines] = useState<GsChatGuidelines | null>(null);
  const [accepting, setAccepting] = useState(false);
  const guidelinesRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // trocou o torcedor ou a sala mudou de estado: as regras abertas não valem mais
  useEffect(() => setGuidelines(null), [fan.status, roomState]);
  // as regras abertas recebem o foco (quem usa leitor de tela fica sabendo); depois do aceite, volta ao texto
  useEffect(() => {
    if (guidelines) guidelinesRef.current?.focus();
  }, [guidelines]);
  const showGuidelines = useCallback(
    async (detail?: string) => {
      const res = await fan.fetch('/v1/chat/guidelines');
      const json = (await res.json().catch(() => null)) as { data?: GsChatGuidelines } | null;
      if (res.ok && json?.data) setGuidelines(json.data);
      // sem as regras, o aviso da API diz o que falta
      else setSendError(detail ?? T.sendError);
    },
    [fan, T],
  );
  const acceptGuidelines = useCallback(async () => {
    if (!guidelines || accepting) return;
    setAccepting(true);
    try {
      const res = await fan.fetch('/v1/chat/guidelines/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: guidelines.version }),
      });
      if (res.ok) {
        setGuidelines(null);
        setSendError(null);
        inputRef.current?.focus();
      } else if (res.status === 409) await showGuidelines();
      else setSendError(T.sendError);
    } catch {
      setSendError(T.sendError);
    } finally {
      setAccepting(false);
    }
  }, [guidelines, accepting, fan, showGuidelines, T]);
  // denúncia de mensagem (#971): o motivo e o envio ficam na própria mensagem
  const [reporting, setReporting] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<keyof typeof T.reportReasons>('hate');
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const sendReport = useCallback(
    async (m: GsChatMessage) => {
      try {
        const res = await fan.fetch('/v1/moderation/reports', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            targetType: 'message',
            targetId: m.id,
            targetProfileId: m.author.profile_id,
            module: 'chat',
            ...(room?.room_id ? { room: room.room_id } : {}),
            reason: reportReason,
          }),
        });
        setReportNotice(res.ok ? T.reportSent : T.reportError);
        if (res.ok) setReporting(null);
      } catch {
        setReportNotice(T.reportError);
      }
    },
    [fan, room, reportReason, T],
  );
  const canReport = fan.status === 'ready' && fan.me !== null;
  const send = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const body = draft.trim();
      if (!body || sending || !path) return;
      setSending(true);
      setSendError(null);
      try {
        const res = await fan.fetch(`${path}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        const json = (await res.json().catch(() => null)) as {
          data?: GsChatMessage & { status?: 'published' | 'held' };
          detail?: string;
          errors?: Array<{ path?: string; message?: string }>;
        } | null;
        if (res.status === 201 && json?.data) {
          const msg = json.data;
          setDraft('');
          // a retida só o autor vê: fica na tela dele, marcada
          if (msg.status === 'held') setHeld((cur) => new Set(cur).add(msg.id));
          setMessages((cur) => mergeChatMessages(cur, [msg], MAX_MESSAGES));
          atBottom.current = true;
          return;
        }
        // sem o aceite das Diretrizes: mostra as regras; o texto fica no rascunho para mandar depois do aceite
        if (
          res.status === 409 &&
          json?.errors?.some((x) => x.path === 'refusal' && x.message === 'guidelines')
        ) {
          await showGuidelines(json.detail);
          return;
        }
        const retry = res.headers.get('retry-after');
        // o aviso do filtro sai no idioma do torcedor em `errors` (o `detail` de algumas recusas é fixo)
        const fieldMessage = json?.errors?.find((x) => x.path === 'body')?.message;
        setSendError(
          res.status === 429 && retry && !json?.errors?.some((x) => x.message === 'flood')
            ? fillText(T.slowMode, { s: retry })
            : (fieldMessage ?? json?.detail ?? T.sendError),
        );
      } catch {
        setSendError(T.sendError);
      } finally {
        setSending(false);
      }
    },
    [draft, sending, path, fan, T, showGuidelines],
  );

  const react = useCallback(
    (reaction: GsChatReaction) => {
      if (!path) return;
      // a contagem volta pelo stream (uma vez por segundo); recusa e limite por segundo não incomodam ninguém
      void fan
        .fetch(`${path}/reactions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reaction }),
        })
        .catch(() => undefined);
    },
    [path, fan],
  );

  const toggleHidden = () => {
    const next = !hidden;
    setHidden(next);
    writeHidden(next);
  };

  if (!eventId || (!room && query.loading) || !mounted)
    return (
      <WidgetFrame kind="live_chat" busy>
        <LoadingState lines={4} />
      </WidgetFrame>
    );
  if (!room) {
    return (
      <WidgetFrame kind="live_chat">
        <ErrorState error={query.error} onRetry={query.retry} />
      </WidgetFrame>
    );
  }

  const header = (
    <div className="gs-header">
      <h3 className="gs-title gs-grow">{T.title}</h3>
      {reconnecting && !hidden ? (
        <span className="gs-small" role="status">
          {T.reconnecting}
        </span>
      ) : null}
      <button type="button" className="gs-button" onClick={toggleHidden}>
        {hidden ? T.show : T.hide}
      </button>
    </div>
  );
  if (hidden)
    return (
      <WidgetFrame kind="live_chat">
        {header}
        <p className="gs-chat-note">{T.hidden}</p>
      </WidgetFrame>
    );

  // menor de 13 identificado não entra em recurso social nenhum: nem a conversa aparece
  if (fan.status === 'ready' && !fan.can('read'))
    return (
      <WidgetFrame kind="live_chat">
        {header}
        <p className="gs-chat-note">{texts.fan.restricted}</p>
      </WidgetFrame>
    );

  const current = roomState ?? room.state;
  const notice = unavailable ? T.unavailable : T.states[current];
  const canReact =
    fan.status === 'ready' &&
    fan.can('read') &&
    current !== 'scheduled' &&
    current !== 'closed' &&
    !unavailable;
  const canWriteHere = current === 'open' && !unavailable;
  const lang = locale === 'pt-BR' || locale === 'es' || locale === 'en' ? locale : 'pt-BR';

  // a chave presa a um widget lê a sala, mas não leva o torcedor: explica em vez do erro genérico
  const keyHint = fan.status === 'unavailable' ? <p className="gs-chat-note">{T.siteKey}</p> : null;
  const composer =
    readOnly || !canWriteHere ? null : (
      <>
        {keyHint ?? (
          <FanGate need="write">
            <form className="gs-chat-form" onSubmit={send}>
              <textarea
                ref={inputRef}
                className="gs-chat-input"
                rows={2}
                value={draft}
                maxLength={maxChars}
                placeholder={T.placeholder}
                aria-label={T.placeholder}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                type="submit"
                className="gs-button"
                disabled={sending || !draft.trim() || guidelines !== null}
              >
                {T.send}
              </button>
            </form>
          </FanGate>
        )}
        {guidelines ? (
          <section
            className="gs-chat-guidelines"
            aria-labelledby="gs-chat-guidelines-title"
            tabIndex={-1}
            ref={guidelinesRef}
          >
            <h3 id="gs-chat-guidelines-title">{guidelines.title}</h3>
            <p>{guidelines.intro}</p>
            <p id="gs-chat-guidelines-not-allowed">{guidelines.not_allowed_title}</p>
            <ul aria-labelledby="gs-chat-guidelines-not-allowed">
              {guidelines.not_allowed.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <p>{guidelines.who_writes}</p>
            <p>{guidelines.consequences}</p>
            <p>{guidelines.report}</p>
            <button type="button" className="gs-button" disabled={accepting} onClick={acceptGuidelines}>
              {guidelines.accept}
            </button>
          </section>
        ) : null}
        {reportNotice ? (
          <p className="gs-small gs-muted" role="status">
            {reportNotice}
          </p>
        ) : null}
        {sendError ? (
          <p className="gs-chat-error" role="alert">
            {sendError}
          </p>
        ) : null}
      </>
    );

  const avatar = (url: string | null) => {
    const src = safeImageUrl(url);
    return src ? (
      <img className="gs-chat-avatar" src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
    ) : null;
  };

  return (
    <WidgetFrame kind="live_chat">
      {header}
      <div className="gs-chat">
        {notice ? <p className="gs-chat-note">{notice}</p> : null}
        {inputPosition === 'top' ? composer : null}
        {pinned ? (
          <div className="gs-chat-pinned">
            <span className="gs-small gs-muted">{T.pinned}</span>
            <span className="gs-chat-body">
              <span className="gs-chat-author">{pinned.author.nickname ?? T.unknownAuthor}</span>
              {pinned.body}
            </span>
          </div>
        ) : null}
        <div
          ref={logRef}
          className="gs-chat-log"
          role="log"
          aria-live="polite"
          aria-label={T.log}
          tabIndex={0}
          style={{ maxHeight: height }}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
        >
          {items.length === 0 ? <p className="gs-chat-note">{T.empty}</p> : null}
          <ol className="gs-chat-list">
            {items.map((item) =>
              item.type === 'game' ? (
                <li
                  key={`g${item.game.id}`}
                  className="gs-chat-game"
                  data-gs-cancelled={item.game.cancelled || undefined}
                >
                  {item.game.minute !== null ? (
                    <span className="gs-small gs-muted">
                      {item.game.minute}
                      {item.game.extra ? `+${item.game.extra}` : ''}&apos;
                    </span>
                  ) : null}
                  <span className="gs-chat-body">{item.game.text[lang]}</span>
                  {item.game.cancelled ? <span className="gs-small gs-muted">{T.cancelled}</span> : null}
                </li>
              ) : (
                <li key={item.message.id} className="gs-chat-msg" data-gs-held={item.held || undefined}>
                  {avatar(item.message.author.avatar_url)}
                  <span className="gs-chat-body">
                    <span className="gs-chat-author">{item.message.author.nickname ?? T.unknownAuthor}</span>
                    {item.message.body}
                    <span className="gs-small gs-muted">
                      {' · '}
                      <time dateTime={item.message.created_at}>{fmt.time(item.message.created_at)}</time>
                      {item.held ? ` · ${T.onlyYou}` : ''}
                    </span>
                    {canReport && item.message.author.profile_id !== fan.me?.profile_id ? (
                      <button
                        type="button"
                        className="gs-chat-report"
                        aria-label={fillText(T.reportLabel, {
                          name: item.message.author.nickname ?? T.unknownAuthor,
                        })}
                        aria-expanded={reporting === item.message.id}
                        onClick={() => {
                          setReportNotice(null);
                          setReporting((cur) => (cur === item.message.id ? null : item.message.id));
                        }}
                      >
                        {T.report}
                      </button>
                    ) : null}
                    {reporting === item.message.id ? (
                      <span className="gs-chat-report-form">
                        <label>
                          {T.reportReason}{' '}
                          <select
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value as keyof typeof T.reportReasons)}
                          >
                            {(Object.keys(T.reportReasons) as (keyof typeof T.reportReasons)[]).map((r) => (
                              <option key={r} value={r}>
                                {T.reportReasons[r]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          className="gs-button"
                          onClick={() => void sendReport(item.message)}
                        >
                          {T.reportSend}
                        </button>
                        <button type="button" className="gs-chat-report" onClick={() => setReporting(null)}>
                          {T.reportCancel}
                        </button>
                      </span>
                    ) : null}
                  </span>
                </li>
              ),
            )}
          </ol>
        </div>
        {showReactions ? (
          <div className="gs-chat-reactions" role="group" aria-label={T.reactionsLabel}>
            {GS_CHAT_REACTIONS.map((r) => (
              <button
                key={r}
                type="button"
                className="gs-chat-reaction"
                disabled={!canReact}
                aria-label={fillText(T.reactionCount, {
                  reaction: T.reactions[r],
                  n: fmt.integer(reactions[r] ?? 0),
                })}
                onClick={() => react(r)}
              >
                <span aria-hidden="true">{GS_CHAT_REACTION_EMOJI[r]}</span>
                <span aria-hidden="true">{fmt.integer(reactions[r] ?? 0)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {inputPosition === 'bottom' ? composer : null}
      </div>
    </WidgetFrame>
  );
}
