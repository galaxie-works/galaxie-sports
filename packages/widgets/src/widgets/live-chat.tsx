'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  GS_CHAT_REACTIONS,
  GS_CHAT_REACTION_EMOJI,
  PUBLISHABLE_KEY_HEADER,
  fillText,
  maxReactionTotals,
  mergeChatMessages,
  mergeGameMessages,
  parseSse,
  type GsChatGameMessage,
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
/** Espera entre reconexões do stream: dobra a cada falha, até o teto. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const HIDDEN_KEY = 'gs-live-chat-hidden';

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

/**
 * Chat ao vivo da sala do jogo (#976): as mensagens chegam em lotes pelo stream da sala, com o jogo dentro do chat e
 * as reações. Ler não exige login; escrever, o token do torcedor `18plus`; `13_17` lê e reage. Nada da conversa é
 * renderizado no servidor (só depois de montar no navegador), e o torcedor pode esconder o chat.
 */
export function LiveChat({
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
  const query = useGalaxieQuery<{ data: GsChatRoom }>(path);
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

  // a leitura da sala (e a releitura depois de um `chat.reset`) é a base; o stream soma por cima
  useEffect(() => {
    if (!room) return;
    setMessages((cur) => mergeChatMessages(room.messages, cur, MAX_MESSAGES));
    setGame((cur) => mergeGameMessages(cur, room.game_messages));
    setReactions((cur) => maxReactionTotals(cur, room.reactions));
    setState(room.state);
    setPinned(room.pinned ?? null);
  }, [room]);

  // stream SSE sobre fetch: a chave publicável vai no header, nunca na URL
  const retryRoom = query.retry;
  useEffect(() => {
    if (!mounted || !path || hidden) return;
    const controller = new AbortController();
    let lastId: string | null = null;
    let wait = RECONNECT_MIN_MS;
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
        if (id) lastId = id;
        setMessages((cur) => mergeChatMessages(cur, p.messages as GsChatMessage[], MAX_MESSAGES));
      } else if (event === 'chat.state' && p && typeof p.state === 'string') {
        setState(p.state as GsChatRoomState);
      } else if (event === 'chat.game' && p && Array.isArray(p.messages)) {
        setGame((cur) => mergeGameMessages(cur, p.messages as GsChatGameMessage[]));
      } else if (event === 'chat.reactions' && p && p.total && typeof p.total === 'object') {
        setReactions((cur) => maxReactionTotals(cur, p.total as Partial<Record<GsChatReaction, number>>));
      } else if (event === 'ready' && p && typeof p.last_event_id === 'string') {
        lastId = p.last_event_id;
      } else if (event === 'chat.reset') {
        lastId = null;
        retryRoom();
      }
    };

    const connect = async () => {
      try {
        const headers: Record<string, string> = { accept: 'text/event-stream' };
        if (publishableKey) headers[PUBLISHABLE_KEY_HEADER] = publishableKey;
        if (lastId) headers['last-event-id'] = lastId;
        const res = await doFetch(`${baseUrl}${path}/stream`, {
          headers,
          signal: controller.signal,
          credentials: 'omit',
        });
        // sem stream (prévia com dados de exemplo, chave sem o módulo): fica com a leitura da sala
        if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
          if (res.status >= 500 || res.status === 429) throw new Error(String(res.status));
          return;
        }
        setReconnecting(false);
        wait = RECONNECT_MIN_MS;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSse(buffer);
          buffer = parsed.rest;
          for (const e of parsed.events) {
            if (e.event === 'access_revoked') return;
            handle(e.event, e.data, e.id);
          }
        }
        throw new Error('closed');
      } catch {
        if (controller.signal.aborted) return;
        setReconnecting(true);
        timer = setTimeout(() => void connect(), wait);
        wait = Math.min(wait * 2, RECONNECT_MAX_MS);
      }
    };
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [mounted, path, hidden, baseUrl, publishableKey, fetchImpl, retryRoom]);

  // rolagem: segue o fim da conversa enquanto a pessoa está lá embaixo
  const logRef = useRef<HTMLOListElement | null>(null);
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
  const maxChars = room?.settings.max_chars ?? 280;
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
        const retry = res.headers.get('retry-after');
        setSendError(
          json?.detail ?? (res.status === 429 && retry ? fillText(T.slowMode, { s: retry }) : T.sendError),
        );
      } catch {
        setSendError(T.sendError);
      } finally {
        setSending(false);
      }
    },
    [draft, sending, path, fan, T],
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
      {reconnecting && !hidden ? <span className="gs-small">{T.reconnecting}</span> : null}
      <button type="button" className="gs-button" aria-pressed={hidden} onClick={toggleHidden}>
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

  const roomState = state ?? room.state;
  const notice = T.states[roomState];
  const canReact = fan.status === 'ready' && roomState !== 'scheduled' && roomState !== 'closed';
  const canWriteHere = roomState === 'open';
  const lang = locale === 'pt-BR' || locale === 'es' || locale === 'en' ? locale : 'pt-BR';

  const composer = readOnly ? null : (
    <FanGate need="write">
      {canWriteHere ? (
        <form className="gs-chat-form" onSubmit={send}>
          <textarea
            className="gs-chat-input"
            rows={2}
            value={draft}
            maxLength={maxChars}
            placeholder={T.placeholder}
            aria-label={T.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" className="gs-button" disabled={sending || !draft.trim()}>
            {T.send}
          </button>
        </form>
      ) : null}
      {sendError ? (
        <p className="gs-chat-error" role="alert">
          {sendError}
        </p>
      ) : null}
    </FanGate>
  );

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
        <ol
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
          {items.length === 0 ? <li className="gs-chat-note">{T.empty}</li> : null}
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
                    {item.game.extra ? `+${item.game.extra}` : ''}'
                  </span>
                ) : null}
                <span className="gs-chat-body">{item.game.text[lang]}</span>
                {item.game.cancelled ? <span className="gs-small gs-muted">{T.cancelled}</span> : null}
              </li>
            ) : (
              <li key={item.message.id} className="gs-chat-msg" data-gs-held={item.held || undefined}>
                {item.message.author.avatar_url ? (
                  <img
                    className="gs-chat-avatar"
                    src={item.message.author.avatar_url}
                    alt=""
                    loading="lazy"
                  />
                ) : null}
                <span className="gs-chat-body">
                  <span className="gs-chat-author">{item.message.author.nickname ?? T.unknownAuthor}</span>
                  {item.message.body}
                  <span className="gs-small gs-muted">
                    {' · '}
                    <time dateTime={item.message.created_at}>{fmt.time(item.message.created_at)}</time>
                    {item.held ? ` · ${T.onlyYou}` : ''}
                  </span>
                </span>
              </li>
            ),
          )}
        </ol>
        {showReactions ? (
          <div className="gs-chat-reactions" role="group" aria-label={T.reactionsLabel}>
            {GS_CHAT_REACTIONS.map((r) => (
              <button
                key={r}
                type="button"
                className="gs-chat-reaction"
                disabled={!canReact}
                aria-label={T.reactions[r]}
                onClick={() => react(r)}
              >
                <span aria-hidden="true">{GS_CHAT_REACTION_EMOJI[r]}</span>
                <span>{fmt.integer(reactions[r] ?? 0)}</span>
              </button>
            ))}
          </div>
        ) : null}
        {inputPosition === 'bottom' ? composer : null}
      </div>
    </WidgetFrame>
  );
}
