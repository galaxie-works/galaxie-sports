'use client';

import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { SafetyNote } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useKindTexts } from '@/components/client/widgets-panel';
import { isWidgetKind } from '@/lib/builder/config';
import { COMPOSE_MODES, COMPOSE_TEXT_MAX, type ComposeMode } from '@/lib/cosmos/widget-compose';
import { composeWithCosmos, type ComposedCard } from '@/lib/cosmos/widget-task-actions';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/**
 * "Montar com a Cosmos" no Builder (#1005): o cliente descreve o widget (ou a página) e recebe widgets válidos para o
 * plano, cada um com o link que abre o editor preenchido. Nada é salvo aqui: só o cliente salva no editor.
 */
export function WidgetComposer({ minCredits }: { minCredits: number | null }) {
  const { t } = useI18n();
  const T = t.client.cosmosBuilder;
  const ids = useId();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ComposeMode>('widget');
  const [result, setResult] = useState<{ widgets: ComposedCard[]; skipped: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const kindTexts = useKindTexts();

  const run = () =>
    startTransition(async () => {
      const r = await composeWithCosmos({ text, mode });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setResult({ widgets: r.widgets, skipped: r.skipped });
    });

  return (
    <Frame>
      <FramePanel className="flex flex-col gap-3">
        <FrameHeader className="p-0">
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{T.description}</FrameDescription>
        </FrameHeader>
        {minCredits !== null ? <SafetyNote>{fill(T.cost, { min: minCredits })}</SafetyNote> : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <Field>
            <FieldLabel htmlFor={`${ids}-text`}>{T.label}</FieldLabel>
            <Textarea
              id={`${ids}-text`}
              value={text}
              maxLength={COMPOSE_TEXT_MAX}
              placeholder={mode === 'page' ? T.pagePlaceholder : T.placeholder}
              onChange={(e) => setText(e.target.value)}
            />
            <FieldDescription>
              {fill(T.count, { count: [...text].length, max: COMPOSE_TEXT_MAX })}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-mode`}>{T.mode}</FieldLabel>
            <Select value={mode} onValueChange={(v) => setMode(v as ComposeMode)}>
              <SelectTrigger id={`${ids}-mode`}>
                <SelectValue>{(v: string) => T.modes[v as ComposeMode]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COMPOSE_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {T.modes[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="flex justify-end">
          <Button onClick={run} disabled={pending || !text.trim()}>
            {pending ? <Spinner /> : <Sparkles aria-hidden />}
            {T.submit}
          </Button>
        </div>

        {result ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <span className="text-sm font-medium">{T.results}</span>
            <ul className="flex flex-col gap-2">
              {result.widgets.map((w, i) => (
                <li
                  key={`${i}:${w.kind}`}
                  className="flex flex-col gap-2 rounded-lg border p-3 text-sm sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{w.name}</span>
                      <Badge variant="secondary">
                        {isWidgetKind(w.kind) ? kindTexts(w.kind).name : w.kind}
                      </Badge>
                    </div>
                    {w.entity ? (
                      <span className="text-muted-foreground text-xs">
                        {fill(T.entity, { name: w.entity })}
                      </span>
                    ) : null}
                    {w.why ? <p className="text-muted-foreground text-xs">{w.why}</p> : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<Link href={`/cliente/builder/novo?cosmos=${encodeURIComponent(w.draft)}`} />}
                    nativeButton={false}
                  >
                    {T.open}
                  </Button>
                </li>
              ))}
            </ul>
            {result.skipped > 0 ? (
              <p className="text-muted-foreground text-xs">{fill(T.skipped, { count: result.skipped })}</p>
            ) : null}
          </div>
        ) : null}
      </FramePanel>
    </Frame>
  );
}
