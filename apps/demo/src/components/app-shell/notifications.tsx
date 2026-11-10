'use client';

/**
 * Caixa de entrada do app logado:
 *
 * - `NotificationsProvider` (no layout do app): busca os avisos de quem está logado ao abrir o app e quando a aba volta
 *   a ficar visível (no máximo a cada 10 minutos: o andamento das sugestões é conferido uma vez por dia). Sem sessão, o
 *   sino não aparece.
 * - `NotificationsButton`: o sino do cabeçalho, ao lado do "Sugerir ou reportar algo", com o número de avisos novos.
 *   Abre o painel lateral (composição do c-sheet-1), que marca tudo como lido ao abrir.
 * - `NotificationsAlert`: a faixa logo abaixo do cabeçalho (composição do ReUI c-alert-18) com o aviso novo mais
 *   recente. "Ver na caixa de entrada" abre o painel; o X só dispensa a faixa neste navegador, sem marcar como lido.
 *
 * Os textos dos avisos (coluna nova, resposta da equipe) são montados aqui, no idioma da tela; o banco guarda só a
 * chave da coluna e a resposta da equipe.
 */
import {
  Bell,
  CircleCheck,
  Eye,
  Hammer,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  MessageSquareReply,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';

import { useInExample } from '@/components/example/example-provider';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Frame, FramePanel } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { FeedbackStatus } from '@/lib/feedback/progress';
import { FEEDBACK_MESSAGE_MAX, FEEDBACK_MESSAGE_MIN } from '@/lib/feedback/rules';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { answerNotice, loadInbox, markRead, type AnswerError } from '@/lib/notifications/actions';
import type { Inbox, InboxItem } from '@/lib/notifications/store';

const REFRESH_MS = 10 * 60_000;
const DISMISSED_KEY = 'galaxie.inbox.dismissed';

interface InboxContextValue {
  inbox: Inbox | null;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Aviso novo mais recente que ainda não foi dispensado na faixa. */
  alertItem: InboxItem | null;
  dismissAlert: (id: string) => void;
  /** Atualiza um aviso depois da resposta, sem buscar tudo de novo. */
  markItemAnswered: (id: string) => void;
}

const InboxContext = createContext<InboxContextValue | null>(null);

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const inExample = useInExample();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [open, setOpenState] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const loadedAt = useRef(0);

  const refresh = useCallback(async () => {
    loadedAt.current = Date.now();
    try {
      setInbox(await loadInbox());
    } catch {
      // rede ou servidor fora: fica o que já estava na tela
    }
  }, []);

  useEffect(() => {
    if (inExample) return;
    setDismissed(readDismissed());
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > REFRESH_MS)
        void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [inExample, refresh]);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      // ao fechar, o que foi visto deixa de ser "nova"
      if (!next)
        return setInbox((cur) =>
          cur ? { ...cur, items: cur.items.map((i) => ({ ...i, read: true })) } : cur,
        );
      if (!inbox?.unread) return;
      // abrir é ler: o contador zera na hora, o ponto de "nova" fica até fechar
      setInbox((cur) => (cur ? { ...cur, unread: 0 } : cur));
      void markRead().catch(() => {});
    },
    [inbox?.unread],
  );

  const value = useMemo<InboxContextValue>(() => {
    const latest = inbox?.items.find((i) => !i.read) ?? null;
    return {
      inbox,
      open,
      setOpen,
      alertItem: latest && latest.id !== dismissed && inbox?.unread ? latest : null,
      dismissAlert: (id) => {
        setDismissed(id);
        try {
          window.localStorage.setItem(DISMISSED_KEY, id);
        } catch {
          // navegador sem armazenamento: dispensa só nesta tela
        }
      },
      markItemAnswered: (id) =>
        setInbox((cur) =>
          cur
            ? {
                ...cur,
                items: cur.items.map((i) => (i.id === id ? { ...i, canAnswer: false, answered: true } : i)),
              }
            : cur,
        ),
    };
  }, [inbox, open, setOpen, dismissed]);

  return (
    <InboxContext value={value}>
      {children}
      {inbox ? <InboxSheet /> : null}
    </InboxContext>
  );
}

const STATUS_ICON: Record<FeedbackStatus | 'reply', LucideIcon> = {
  backlog: Lightbulb,
  review: Eye,
  selected: ListChecks,
  needsInfo: MessageCircleQuestion,
  inProgress: Hammer,
  delivered: CircleCheck,
  reply: MessageSquareReply,
};

type NoticeKind = Exclude<FeedbackStatus, 'backlog'> | 'reply';
const kindOf = (item: InboxItem): NoticeKind =>
  item.status && item.status !== 'backlog' ? item.status : 'reply';

/** Sino do cabeçalho; some sem sessão e no exemplo público. */
export function NotificationsButton({ className }: { className?: string }) {
  const ctx = useContext(InboxContext);
  const T = useI18n().t.notifications;
  if (!ctx?.inbox) return null;
  const unread = ctx.inbox.unread;
  const label = unread ? fill(T.buttonUnread, { count: unread }) : T.button;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={`relative ${className ?? ''}`}
            aria-label={label}
            onClick={() => ctx.setOpen(true)}
          />
        }
      >
        <Bell aria-hidden />
        {unread ? (
          <span
            aria-hidden
            className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Faixa do aviso novo, logo abaixo do cabeçalho da página (ReUI c-alert-18). */
export function NotificationsAlert() {
  const ctx = useContext(InboxContext);
  const T = useI18n().t.notifications;
  const item = ctx?.alertItem;
  if (!ctx || !item) return null;
  const kind = kindOf(item);
  const Icon = STATUS_ICON[kind];
  const description = item.body ?? (kind === 'reply' ? null : T.statusHint[kind]);
  return (
    <div className="px-4 pt-3">
      <Frame variant="ghost">
        <FramePanel className="overflow-hidden p-0!">
          {/* aviso, não urgência: status em vez de alert */}
          <Alert variant="info" role="status" className="border-0 shadow-none">
            <Icon aria-hidden />
            <AlertTitle>{T.status[kind]}</AlertTitle>
            <AlertAction>
              <Button
                size="xs"
                variant="ghost"
                aria-label={T.alertDismiss}
                className="text-muted-foreground hover:text-foreground -mt-1 -mr-2 size-7 p-0 hover:bg-transparent"
                onClick={() => ctx.dismissAlert(item.id)}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </AlertAction>
            <AlertDescription>
              {item.snippet ? (
                <p className="line-clamp-1">{fill(T.yourSuggestion, { snippet: item.snippet })}</p>
              ) : null}
              {description ? <p className="line-clamp-2 whitespace-pre-line">{description}</p> : null}
              <Button
                variant="link"
                size="sm"
                className="text-info h-auto p-0 underline"
                onClick={() => ctx.setOpen(true)}
              >
                {T.alertOpen}
              </Button>
            </AlertDescription>
          </Alert>
        </FramePanel>
      </Frame>
    </div>
  );
}

function InboxSheet() {
  const ctx = useContext(InboxContext)!;
  const T = useI18n().t.notifications;
  const f = useFormatters(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const items = ctx.inbox?.items ?? [];
  return (
    <Sheet open={ctx.open} onOpenChange={ctx.setOpen}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{T.title}</SheetTitle>
          <SheetDescription>{T.description}</SheetDescription>
        </SheetHeader>
        {items.length ? (
          <ul className="flex-1 divide-y overflow-y-auto">
            {items.map((item) => (
              <InboxEntry key={item.id} item={item} when={f.relative(item.createdAt)} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <Bell className="text-muted-foreground size-8" aria-hidden />
            <p className="font-medium">{T.empty}</p>
            <p className="text-muted-foreground text-sm">{T.emptyHint}</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function InboxEntry({ item, when }: { item: InboxItem; when: string }) {
  const T = useI18n().t.notifications;
  const kind = kindOf(item);
  const Icon = STATUS_ICON[kind];
  const hint = kind === 'reply' ? null : T.statusHint[kind];
  return (
    <li className="flex gap-3 p-4">
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${kind === 'delivered' ? 'text-success' : kind === 'needsInfo' ? 'text-warning' : 'text-info'}`}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">{T.status[kind]}</p>
          {!item.read ? (
            <span className="bg-primary mt-1.5 size-2 shrink-0 rounded-full" title={T.unreadDot}>
              <span className="sr-only">{T.unreadDot}</span>
            </span>
          ) : null}
        </div>
        {item.snippet ? (
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {fill(T.yourSuggestion, { snippet: item.snippet })}
          </p>
        ) : null}
        {hint && !item.body ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
        {item.body ? (
          <div className="bg-muted/50 rounded-md border p-3">
            <p className="text-muted-foreground mb-1 text-xs font-medium">{T.teamReply}</p>
            {/* texto puro da equipe: o React escapa, e as quebras de linha ficam */}
            <p className="text-sm break-words whitespace-pre-wrap">{item.body}</p>
          </div>
        ) : null}
        {item.canAnswer ? <AnswerForm id={item.id} /> : null}
        {item.answered ? <p className="text-success text-xs">{T.answered}</p> : null}
        <p className="text-muted-foreground text-xs">{when}</p>
      </div>
    </li>
  );
}

function AnswerForm({ id }: { id: string }) {
  const ctx = useContext(InboxContext)!;
  const T = useI18n().t.notifications;
  const ids = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<AnswerError | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (text.trim().length < FEEDBACK_MESSAGE_MIN) return setError('message');
    setError(null);
    startTransition(async () => {
      try {
        const res = await answerNotice(id, text);
        if (res.ok) ctx.markItemAnswered(id);
        else setError(res.error ?? 'generic');
      } catch {
        setError('generic');
      }
    });
  };

  const errorText = error
    ? fill(T.errors[error], { min: FEEDBACK_MESSAGE_MIN, max: FEEDBACK_MESSAGE_MAX })
    : null;
  return (
    <form onSubmit={submit} className="mt-1 flex flex-col gap-2">
      <Field>
        <FieldLabel htmlFor={`${ids}-answer`}>{T.answer}</FieldLabel>
        <Textarea
          id={`${ids}-answer`}
          value={text}
          maxLength={FEEDBACK_MESSAGE_MAX}
          placeholder={T.answerPlaceholder}
          aria-invalid={error === 'message' || error === 'tooLong' || undefined}
          aria-describedby={errorText ? `${ids}-error` : undefined}
          className="min-h-24"
          onChange={(e) => setText(e.target.value)}
        />
        <FieldDescription className="text-right tabular-nums">
          {text.length}/{FEEDBACK_MESSAGE_MAX}
        </FieldDescription>
        {errorText ? <FieldError id={`${ids}-error`}>{errorText}</FieldError> : null}
      </Field>
      <Button type="submit" size="sm" className="self-end" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? T.sending : T.send}
      </Button>
    </form>
  );
}
