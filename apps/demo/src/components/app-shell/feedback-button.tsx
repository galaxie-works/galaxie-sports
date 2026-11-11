'use client';

/**
 * "Sugerir ou reportar algo": ícone de chat no cabeçalho, à esquerda da lupa, com tooltip (composição do ReUI
 * c-tooltip-3: botão fantasma só com ícone, nomeado pelo aria-label). O clique abre o painel lateral com o
 * formulário (composição do c-sheet-1): assunto, mensagem e imagens JPG/PNG. O envio é a ação do servidor
 * `sendFeedback`, que abre a issue no GitHub; nada de token ou dado da sessão passa por aqui.
 */
import { CheckCircle2, ImagePlus, Loader2, MessageSquareText, X } from 'lucide-react';
import {
  createContext,
  Suspense,
  use,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react';

import { useInExample } from '@/components/example/example-provider';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { sendFeedback } from '@/lib/feedback/actions';
import {
  FEEDBACK_ACCEPT,
  FEEDBACK_MAX_BYTES,
  FEEDBACK_MAX_FILES,
  FEEDBACK_MAX_MB,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN,
  FEEDBACK_SUBJECTS,
  checkFeedbackText,
  isAcceptedImageType,
  type FeedbackErrorCode,
  type FeedbackSubject,
} from '@/lib/feedback/rules';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/** Ajuste "ligado/desligado" do painel (o layout passa a promessa). Fora do layout do app, vale o padrão: ligado. */
const FeedbackEnabledContext = createContext<Promise<boolean>>(Promise.resolve(true));

export function FeedbackEnabledProvider({
  enabled,
  children,
}: {
  enabled: Promise<boolean>;
  children: React.ReactNode;
}) {
  return <FeedbackEnabledContext value={enabled}>{children}</FeedbackEnabledContext>;
}

/** Some no exemplo público, onde não há sessão para identificar quem enviou, e quando o painel desliga. */
export function FeedbackButton(props: { className?: string }) {
  const inExample = useInExample();
  if (inExample) return null;
  return (
    <Suspense fallback={null}>
      <FeedbackGate {...props} />
    </Suspense>
  );
}

function FeedbackGate(props: { className?: string }) {
  return use(useContext(FeedbackEnabledContext)) ? <FeedbackButtonInner {...props} /> : null;
}

interface Attachment {
  id: string;
  file: File;
  url: string;
}

function FeedbackButtonInner({ className }: { className?: string }) {
  const T = useI18n().t.feedback;
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState('');
  const [subject, setSubject] = useState<FeedbackSubject | null>(null);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState<{ code: FeedbackErrorCode; file?: string } | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = useId();
  const sentRef = useRef<HTMLParagraphElement>(null);
  // depois do envio o formulário some: o foco vai para a confirmação, não para o corpo da página
  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  // as prévias são URLs de objeto: soltas ao remover a imagem, ao limpar o formulário e ao desmontar
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => () => filesRef.current.forEach((f) => URL.revokeObjectURL(f.url)), []);

  const reset = () => {
    files.forEach((f) => URL.revokeObjectURL(f.url));
    setSubject(null);
    setMessage('');
    setFiles([]);
    setError(null);
    setSent(false);
  };

  const onOpenChange = (next: boolean) => {
    if (next) setPage(window.location.pathname);
    // depois de enviar, fechar limpa o formulário para a próxima vez
    else if (sent) reset();
    setOpen(next);
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list);
    const wrong = picked.find((f) => !isAcceptedImageType(f.type, f.name));
    if (wrong) return setError({ code: 'fileType', file: wrong.name });
    if (files.length + picked.length > FEEDBACK_MAX_FILES) return setError({ code: 'tooMany' });
    const total = [...files.map((f) => f.file), ...picked].reduce((sum, f) => sum + f.size, 0);
    if (total > FEEDBACK_MAX_BYTES) return setError({ code: 'tooLarge' });
    setError(null);
    setFiles([...files, ...picked.map(toAttachment)]);
  };

  const removeFile = (id: string) => {
    const gone = files.find((f) => f.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    setFiles(files.filter((f) => f.id !== id));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const local = checkFeedbackText(subject, message);
    if (local) return setError({ code: local });
    const form = new FormData();
    form.set('subject', subject!);
    form.set('message', message);
    form.set('page', page);
    form.set('viewport', `${window.innerWidth}x${window.innerHeight}`);
    for (const f of files) form.append('files', f.file, f.file.name);
    setError(null);
    startTransition(async () => {
      try {
        const res = await sendFeedback(form);
        if (res.ok) setSent(true);
        else setError({ code: res.error ?? 'generic', file: res.file });
      } catch {
        setError({ code: 'generic' });
      }
    });
  };

  const errorText = error
    ? fill(T.errors[error.code], {
        min: FEEDBACK_MESSAGE_MIN,
        max: error.code === 'tooMany' ? FEEDBACK_MAX_FILES : FEEDBACK_MESSAGE_MAX,
        mb: FEEDBACK_MAX_MB,
        name: error.file ?? '',
      })
    : null;
  const items = FEEDBACK_SUBJECTS.map((value) => ({ value, label: T.subjects[value] }));

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={className}
              aria-label={T.button}
              onClick={() => onOpenChange(true)}
            />
          }
        >
          <MessageSquareText aria-hidden />
        </TooltipTrigger>
        <TooltipContent>{T.button}</TooltipContent>
      </Tooltip>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b">
            <SheetTitle>{T.title}</SheetTitle>
            <SheetDescription>{T.description}</SheetDescription>
          </SheetHeader>

          {sent ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <CheckCircle2 className="text-success size-10" aria-hidden />
              <p ref={sentRef} tabIndex={-1} className="text-base font-medium outline-none">
                {T.sentTitle}
              </p>
              <p className="text-muted-foreground text-sm">{T.sentDescription}</p>
              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={reset}>
                  {T.sendAnother}
                </Button>
                <Button onClick={() => onOpenChange(false)}>{T.close}</Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto p-4">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor={`${ids}-subject`}>{T.subject}</FieldLabel>
                    <Select
                      items={items}
                      value={subject}
                      onValueChange={(v) => {
                        setSubject(FEEDBACK_SUBJECTS.find((s) => s === v) ?? null);
                        if (error?.code === 'subject') setError(null);
                      }}
                    >
                      <SelectTrigger id={`${ids}-subject`} className="w-full">
                        <SelectValue placeholder={T.subjectPlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map((i) => (
                          <SelectItem key={i.value} value={i.value}>
                            {i.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {subject ? <FieldDescription>{T.hints[subject]}</FieldDescription> : null}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`${ids}-message`}>{T.message}</FieldLabel>
                    <Textarea
                      aria-invalid={error?.code === 'message' || error?.code === 'tooLong' || undefined}
                      aria-describedby={errorText ? `${ids}-error` : undefined}
                      id={`${ids}-message`}
                      value={message}
                      maxLength={FEEDBACK_MESSAGE_MAX}
                      placeholder={T.messagePlaceholder}
                      className="min-h-36"
                      onChange={(e) => setMessage(e.target.value)}
                    />
                    <FieldDescription className="text-right tabular-nums">
                      {fill(T.counter, { count: message.length, max: FEEDBACK_MESSAGE_MAX })}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor={`${ids}-files`}>{T.attachments}</FieldLabel>
                    <input
                      ref={inputRef}
                      id={`${ids}-files`}
                      type="file"
                      accept={FEEDBACK_ACCEPT}
                      multiple
                      className="hidden"
                      tabIndex={-1}
                      onChange={(e) => {
                        addFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    {files.length ? (
                      <ul className="grid grid-cols-4 gap-2">
                        {files.map((f) => (
                          <li
                            key={f.id}
                            className="bg-muted relative aspect-square overflow-hidden rounded-md border"
                          >
                            {/* prévia local (URL de objeto): next/image não serve aqui */}
                            <img src={f.url} alt={f.file.name} className="size-full object-cover" />
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon-xs"
                              className="absolute top-1 right-1"
                              aria-label={fill(T.remove, { name: f.file.name })}
                              onClick={() => removeFile(f.id)}
                            >
                              <X aria-hidden />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      className="w-fit"
                      disabled={files.length >= FEEDBACK_MAX_FILES}
                      onClick={() => inputRef.current?.click()}
                    >
                      <ImagePlus aria-hidden />
                      {T.attach}
                    </Button>
                    <FieldDescription>
                      {fill(T.attachmentsHint, { max: FEEDBACK_MAX_FILES, mb: FEEDBACK_MAX_MB })}
                    </FieldDescription>
                  </Field>

                  <div className="text-muted-foreground flex flex-col gap-1 text-xs">
                    {page ? <p className="truncate">{fill(T.page, { page })}</p> : null}
                    <p>{T.privacy}</p>
                  </div>

                  {errorText ? <FieldError id={`${ids}-error`}>{errorText}</FieldError> : null}
                </FieldGroup>
              </div>

              <SheetFooter className="flex-row justify-end border-t">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {T.cancel}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                  {pending ? T.sending : T.send}
                </Button>
              </SheetFooter>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

const toAttachment = (file: File): Attachment => ({
  id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
  file,
  url: URL.createObjectURL(file),
});
