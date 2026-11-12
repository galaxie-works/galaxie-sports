'use client';

/**
 * Painel do assistente da Cosmos AI (#1003), aberto pelo ícone da Cosmos no cabeçalho em qualquer tela: lateral
 * no desktop, tela cheia no celular (sheet). Composição dos exemplos aprovados: conversa com rolagem ancorada
 * (c-message-scroller-3), resposta em fluxo com marcador de espera (c-message-7), ações de copiar e perguntar de
 * novo (c-message-4, sem avaliação), sugestões em bolhas (c-bubble-6), vazio com pilha de ícone (c-icon-stack-5),
 * campo com botão de enviar (c-input-group-18, sem microfone, busca nem seletor de modelo) e blocos de código
 * (c-code-block-18). Anexos na pergunta (#1065) pelo exemplo c-attachment-2: imagem, PDF ou texto, lidos e
 * conferidos aqui antes de mandar, com a estimativa já contando o anexo. O arquivo fica só na memória da tela e da
 * pergunta. O cliente vê só créditos: a estimativa antes e o gasto real depois.
 */
import {
  ASSISTANT_ATTACHMENT_LIMITS,
  ATTACHMENT_ACCEPT,
  type AttachmentError,
  type AttachmentKind,
  checkAttachments,
  readAttachment,
} from '@galaxie/cosmos/assistant-attachments';
import {
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  FileTextIcon,
  ImageIcon,
  PaperclipIcon,
  RefreshCwIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { IconStack } from '@/components/reui/icon-stack';
import {
  CodeBlock,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
  markdownFences,
} from '@/components/reui/code-block/code-block';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment';
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldError } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import { Message, MessageAvatar, MessageContent, MessageFooter } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { estimateAssistantQuestion } from '@/lib/cosmos/assistant-actions';
import { readAssistantStream, type AssistantErrorCode } from '@/lib/cosmos/assistant-stream';
import { readScreenContext, routeOf, suggestionGroup } from '@/lib/cosmos/screen-context';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

import { CosmosIcon } from './cosmos-icon';

/** Mesmo limite do servidor (`QUESTION_MAX`). */
const QUESTION_MAX = 2000;
const ESTIMATE_DELAY_MS = 600;
const MB = (bytes: number) => Math.round((bytes / 1_000_000) * 100) / 100;

/** Anexo lido no navegador: o que a estimativa precisa e o conteúdo em base64 para a pergunta. */
interface PendingFile {
  id: string;
  name: string;
  kind: AttachmentKind;
  bytes: number;
  pages?: number;
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const metaOf = (f: PendingFile) => ({ kind: f.kind, bytes: f.bytes, ...(f.pages ? { pages: f.pages } : {}) });

interface Turn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Só da resposta. */
  status?: 'waiting' | 'streaming' | 'done' | 'error';
  error?: AssistantErrorCode;
  charged?: number;
  available?: number;
  /** Assinatura do servidor: só resposta assinada volta para o histórico do prompt. */
  sig?: string;
  /** Pergunta que gerou a resposta (para "perguntar de novo"). */
  question?: string;
  /** Anexos da pergunta: os nomes na conversa e, na resposta, os arquivos para "perguntar de novo". */
  files?: PendingFile[];
}

const history = (turns: Turn[]) =>
  turns
    .filter((t) => t.role === 'user' || (t.status === 'done' && t.sig))
    .map((t) => ({ role: t.role, text: t.text, ...(t.sig ? { sig: t.sig } : {}) }));

export function CosmosAssistant({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const T = t.cosmos.assistant;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [route, setRoute] = useState('/');
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const busy = turns.some((x) => x.status === 'waiting' || x.status === 'streaming');
  // a estimativa só muda com a conversa já fechada, não a cada pedaço da resposta
  const turnsRef = useRef(turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);
  const settled = history(turns).length;

  // a rota é lida ao abrir e a cada troca de tela (o painel mora no layout): sugestões e contexto são da tela de trás
  const pathname = usePathname();
  useEffect(() => {
    if (open) setRoute(routeOf(window.location.pathname));
  }, [open, pathname]);

  // para a resposta em andamento se o painel for desmontado
  useEffect(() => () => abortRef.current?.abort(), []);

  // estimativa antes de perguntar, com uma pausa para não chamar a cada tecla
  useEffect(() => {
    const question = draft.trim();
    if (!open || !question || question.length > QUESTION_MAX) {
      setEstimate(null);
      setEstimating(false);
      return;
    }
    setEstimating(true);
    let live = true;
    const id = window.setTimeout(async () => {
      try {
        const r = await estimateAssistantQuestion({
          question,
          context: readScreenContext(),
          history: history(turnsRef.current),
          // só o tipo e o tamanho: o conteúdo vai na pergunta de verdade
          attachments: files.map(metaOf),
        });
        // 0 = equipe Galaxie (não gasta créditos do cliente): sem o "cerca de N créditos"
        if (live) setEstimate(r.ok && r.credits > 0 ? r.credits : null);
      } catch {
        if (live) setEstimate(null);
      } finally {
        if (live) setEstimating(false);
      }
    }, ESTIMATE_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [draft, open, settled, files]);

  const L = ASSISTANT_ATTACHMENT_LIMITS;
  const attachmentText = (error: AttachmentError, name = '') =>
    fill(T.attachmentErrors[error], {
      name,
      max: L.maxFiles,
      pages: L.maxPdfPages,
      mb: MB(
        error === 'total'
          ? L.maxTotalBytes
          : name && /\.(txt|md|csv|json|log|xml|ya?ml)$/i.test(name)
            ? L.maxTextBytes
            : L.maxImageBytes,
      ),
    });

  /** Lê os arquivos escolhidos com a mesma regra do servidor; o que não cabe nem entra na lista. */
  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setFileError(null);
    const next = [...files];
    for (const file of Array.from(list)) {
      if (next.length >= L.maxFiles) {
        setFileError(attachmentText('count'));
        break;
      }
      // tamanho antes de ler: um arquivo enorme nem chega à memória
      if (file.size > Math.max(L.maxImageBytes, L.maxPdfBytes)) {
        setFileError(attachmentText('size', file.name));
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const read = readAttachment(file.name, bytes);
      if (!read.ok) {
        setFileError(attachmentText(read.error, file.name));
        continue;
      }
      const candidate = [...next, { bytes: read.file.bytes }];
      const over = checkAttachments(candidate);
      if (over) {
        setFileError(attachmentText(over));
        continue;
      }
      next.push({
        id: `f${counter.current++}`,
        name: read.file.name,
        kind: read.file.kind,
        bytes: read.file.bytes,
        ...(read.file.pages ? { pages: read.file.pages } : {}),
        data: toBase64(bytes),
      });
    }
    setFiles(next);
  }

  const patch = (id: string, change: Partial<Turn>) =>
    setTurns((all) => all.map((x) => (x.id === id ? { ...x, ...change } : x)));

  async function ask(question: string, attached: PendingFile[] = files) {
    const q = question.trim();
    if (!q || busy) return;
    if (q.length > QUESTION_MAX) return;
    const round = counter.current++;
    const userId = `q${round}`;
    const answerId = `a${round}`;
    const before = history(turns);
    setDraft('');
    setEstimate(null);
    setFiles([]);
    setFileError(null);
    const withFiles = attached.length ? { files: attached } : {};
    setTurns((all) => [
      ...all,
      { id: userId, role: 'user', text: q, ...withFiles },
      { id: answerId, role: 'assistant', text: '', status: 'waiting', question: q, ...withFiles },
    ]);
    const controller = new AbortController();
    abortRef.current = controller;
    let text = '';
    try {
      const res = await fetch('/api/cliente/cosmos/assistente', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: q,
          context: readScreenContext(),
          history: before,
          ...(attached.length ? { attachments: attached.map((f) => ({ name: f.name, data: f.data })) } : {}),
        }),
        signal: controller.signal,
      });
      for await (const event of readAssistantStream(res)) {
        if (event.type === 'start') patch(answerId, { status: 'streaming' });
        else if (event.type === 'delta') {
          text += event.text;
          patch(answerId, { text, status: 'streaming' });
        } else if (event.type === 'done')
          patch(answerId, {
            status: 'done',
            // a equipe Galaxie não gasta créditos do cliente: sem a linha de cobrança
            ...(event.staff ? {} : { charged: event.charged, available: event.available }),
            ...(event.sig ? { sig: event.sig } : {}),
          });
        else patch(answerId, { status: 'error', error: event.code, text: '' });
      }
    } catch {
      // "Parar" depois de chegar texto: fica o que veio (o servidor cobra só o que entregou); antes, nada foi gasto
      if (text) patch(answerId, { status: 'done', text });
      else patch(answerId, { status: 'error', error: 'failed', text: '' });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  const group = suggestionGroup(route);
  const suggestions = Object.values(T.suggestions[group]);
  const errorText = (code: AssistantErrorCode) => fill(T.errors[code], { max: QUESTION_MAX });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-cosmos-assistant
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-2">
            <CosmosIcon aria-hidden className="size-5" />
            {T.title}
          </SheetTitle>
          <SheetDescription>{T.description}</SheetDescription>
          <Link
            href="/cliente/cosmos"
            onClick={() => onOpenChange(false)}
            className={buttonVariants({ variant: 'outline', size: 'xs', className: 'self-start' })}
          >
            {T.wallet}
          </Link>
        </SheetHeader>

        <div className="min-h-0 flex-1">
          {turns.length === 0 ? (
            <div className="flex h-full flex-col overflow-y-auto">
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyMedia>
                    <IconStack aria-hidden="true" className="text-primary h-24 w-22">
                      <CosmosIcon className="text-primary size-5" />
                    </IconStack>
                  </EmptyMedia>
                  <EmptyTitle>{T.emptyTitle}</EmptyTitle>
                  <EmptyDescription>{T.emptyDescription}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <BubbleGroup aria-label={T.suggestionsLabel} className="w-full">
                    {suggestions.map((s) => (
                      <Bubble key={s} variant="tinted" align="end">
                        <BubbleContent render={<button type="button" onClick={() => void ask(s)} />}>
                          {s}
                        </BubbleContent>
                      </Bubble>
                    ))}
                  </BubbleGroup>
                </EmptyContent>
              </Empty>
            </div>
          ) : (
            <MessageScrollerProvider scrollPreviousItemPeek={64} scrollMargin={16}>
              <MessageScroller className="h-full">
                <MessageScrollerViewport aria-label={T.title}>
                  <MessageScrollerContent className="gap-5 p-4">
                    {turns.map((turn) => (
                      <MessageScrollerItem
                        key={turn.id}
                        messageId={turn.id}
                        scrollAnchor={turn.role === 'user'}
                      >
                        {turn.role === 'user' ? (
                          <Message align="end">
                            <MessageContent>
                              <Bubble variant="muted" align="end">
                                <BubbleContent className="space-y-2">
                                  <span className="sr-only">{T.you}: </span>
                                  {turn.files?.length ? (
                                    <FileChips files={turn.files} label={T.attachments} />
                                  ) : null}
                                  <p className="whitespace-pre-wrap">{turn.text}</p>
                                </BubbleContent>
                              </Bubble>
                            </MessageContent>
                          </Message>
                        ) : (
                          <AnswerMessage
                            turn={turn}
                            busy={busy}
                            labels={T}
                            errorText={errorText}
                            format={(v) => n.format(v)}
                            onRetry={() => turn.question && void ask(turn.question, turn.files ?? [])}
                            onNavigate={() => onOpenChange(false)}
                          />
                        )}
                      </MessageScrollerItem>
                    ))}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton variant="outline" className="rounded-full shadow-sm" />
              </MessageScroller>
            </MessageScrollerProvider>
          )}
        </div>

        <form
          className="shrink-0 border-t p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
        >
          <Field>
            <input
              ref={fileInput}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              hidden
              tabIndex={-1}
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <InputGroup>
              {files.length ? (
                <InputGroupAddon align="block-start">
                  <FileChips
                    files={files}
                    label={T.attachments}
                    removeLabel={(name) => fill(T.removeAttachment, { name })}
                    onRemove={(id) => {
                      setFiles((all) => all.filter((f) => f.id !== id));
                      setFileError(null);
                    }}
                  />
                </InputGroupAddon>
              ) : null}
              <InputGroupTextarea
                aria-label={T.inputLabel}
                placeholder={T.placeholder}
                className="max-h-48 min-h-24 pb-12"
                value={draft}
                maxLength={QUESTION_MAX}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void ask(draft);
                  }
                }}
              />
              <InputGroupAddon align="block-end">
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={T.attach}
                  title={fill(T.attachHint, { max: L.maxFiles })}
                  disabled={busy || files.length >= L.maxFiles}
                  onClick={() => fileInput.current?.click()}
                >
                  <PaperclipIcon aria-hidden />
                </InputGroupButton>
                <span className="text-muted-foreground text-xs" aria-live="polite">
                  {estimating
                    ? T.estimating
                    : estimate !== null
                      ? fill(T.estimate, { credits: n.format(estimate) })
                      : null}
                </span>
                {busy ? (
                  <InputGroupButton
                    type="button"
                    variant="outline"
                    size="icon-xs"
                    className="ml-auto"
                    aria-label={T.stop}
                    title={T.stop}
                    onClick={() => abortRef.current?.abort()}
                  >
                    <SquareIcon className="size-3.5" aria-hidden />
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    type="submit"
                    variant="default"
                    size="icon-xs"
                    className="ml-auto"
                    aria-label={T.send}
                    title={T.send}
                    disabled={!draft.trim()}
                  >
                    <ArrowUpIcon className="size-4" aria-hidden />
                  </InputGroupButton>
                )}
              </InputGroupAddon>
            </InputGroup>
            {fileError ? <FieldError>{fileError}</FieldError> : null}
          </Field>
        </form>
      </SheetContent>
    </Sheet>
  );
}

type Labels = ReturnType<typeof useI18n>['t']['cosmos']['assistant'];

/** Anexos em fila (c-attachment-2): rolam de lado em vez de empurrar a conversa. */
function FileChips({
  files,
  label,
  removeLabel,
  onRemove,
}: {
  files: PendingFile[];
  label: string;
  removeLabel?: (name: string) => string;
  onRemove?: (id: string) => void;
}) {
  return (
    <AttachmentGroup role="group" aria-label={label}>
      {files.map((file) => (
        <Attachment key={file.id} size="xs" className="max-w-52">
          <AttachmentMedia>
            {file.kind === 'image' ? <ImageIcon aria-hidden="true" /> : <FileTextIcon aria-hidden="true" />}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{file.name}</AttachmentTitle>
          </AttachmentContent>
          {onRemove ? (
            <AttachmentActions>
              <AttachmentAction
                type="button"
                aria-label={removeLabel?.(file.name) ?? file.name}
                onClick={() => onRemove(file.id)}
              >
                <XIcon aria-hidden="true" />
              </AttachmentAction>
            </AttachmentActions>
          ) : null}
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

function AnswerMessage({
  turn,
  busy,
  labels: T,
  errorText,
  format,
  onRetry,
  onNavigate,
}: {
  turn: Turn;
  busy: boolean;
  labels: Labels;
  errorText: (code: AssistantErrorCode) => string;
  format: (v: number) => string;
  onRetry: () => void;
  onNavigate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);

  const done = turn.status === 'done';
  const waiting = turn.status === 'waiting' || (turn.status === 'streaming' && !turn.text);

  if (turn.status === 'error') {
    const action =
      turn.error === 'insufficient'
        ? T.recharge
        : turn.error === 'disabled' || turn.error === 'no_wallet'
          ? T.enable
          : null;
    return (
      <Message>
        <MessageAvatar className="size-8">
          <CosmosIcon aria-hidden className="text-muted-foreground size-4" />
        </MessageAvatar>
        <MessageContent>
          <Bubble variant="outline" className="max-w-full">
            <BubbleContent>
              <p role="alert">{errorText(turn.error ?? 'failed')}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {action ? (
                  <Link
                    href="/cliente/cosmos"
                    onClick={onNavigate}
                    className={buttonVariants({ size: 'sm' })}
                  >
                    {action}
                  </Link>
                ) : null}
                {turn.error === 'failed' ||
                turn.error === 'unavailable' ||
                turn.error === 'busy' ||
                turn.error === 'rate_limited' ? (
                  <Button variant="outline" size="sm" disabled={busy} onClick={onRetry}>
                    <RefreshCwIcon data-icon="inline-start" aria-hidden />
                    {T.retry}
                  </Button>
                ) : null}
              </div>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message>
      <MessageAvatar className="size-8">
        <CosmosIcon aria-hidden className="text-muted-foreground size-4" />
      </MessageAvatar>
      <MessageContent>
        <span role="status" className="sr-only">
          {done ? T.ready : waiting ? T.generating : ''}
        </span>
        <Bubble variant="ghost" aria-busy={!done}>
          <BubbleContent className="space-y-3">
            {waiting ? (
              <Marker>
                <MarkerIcon>
                  <Spinner />
                </MarkerIcon>
                <MarkerContent>
                  <span className="animate-pulse motion-reduce:animate-none">{T.thinking}</span>
                </MarkerContent>
              </Marker>
            ) : (
              markdownFences(turn.text).map((part, i) =>
                part.type === 'code' ? (
                  <CodeBlock
                    key={i}
                    code={part.content}
                    language={part.language}
                    streaming={part.open}
                    label={part.language ?? 'code'}
                  >
                    <CodeBlockHeader>
                      <CodeBlockTitle>{part.language ?? 'code'}</CodeBlockTitle>
                      <div className="ml-auto flex items-center gap-1.5">
                        <CodeBlockCopyButton />
                      </div>
                    </CodeBlockHeader>
                  </CodeBlock>
                ) : (
                  <p key={i} className="whitespace-pre-wrap">
                    {part.content}
                  </p>
                ),
              )
            )}
          </BubbleContent>
        </Bubble>
        <MessageFooter className="gap-0.5">
          {done && turn.charged !== undefined ? (
            <span className="pe-1 tabular-nums">
              {fill(T.charged, { credits: format(turn.charged), available: format(turn.available ?? 0) })}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!done}
            aria-label={copied ? T.copied : T.copy}
            title={copied ? T.copied : T.copy}
            onClick={() => {
              void navigator.clipboard?.writeText?.(turn.text);
              setCopied(true);
            }}
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={!done || busy}
            aria-label={T.retry}
            title={T.retry}
            onClick={onRetry}
          >
            <RefreshCwIcon aria-hidden="true" />
          </Button>
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}
