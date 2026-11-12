'use client';

import { Sparkles } from 'lucide-react';
import { useId, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { CodeSnippet } from '@/components/client/code-snippet';
import { SafetyNote } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import type { WidgetKind } from '@/lib/builder/types';
import {
  checkPublishableKey,
  INSTALL_SITE_MAX,
  INSTALL_TARGETS,
  installFiles,
  type InstallGuide as Guide,
  type InstallTarget,
} from '@/lib/cosmos/widget-install';
import { installWithCosmos } from '@/lib/cosmos/widget-task-actions';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/**
 * Código de instalação nos cinco alvos (#1005), com a chave publicável que o cliente colar (fica no navegador), e o
 * passo a passo da Cosmos no jeito do site dele. O código sai dos modelos de `widget-install`, nunca do modelo de IA.
 */
export function InstallGuide({
  widget,
  minCredits,
}: {
  widget: { id: string; kind: WidgetKind; name: string };
  /** Mínimo da função para o aviso de custo; null = a equipe Galaxie (sem custo para o cliente). */
  minCredits: number | null;
}) {
  const { t } = useI18n();
  const T = t.client.cosmosBuilder.install;
  const ids = useId();
  const [target, setTarget] = useState<InstallTarget>('html');
  const [rawKey, setRawKey] = useState('');
  const [origin, setOrigin] = useState('');
  const [site, setSite] = useState('');
  const [guide, setGuide] = useState<{ target: InstallTarget; guide: Guide } | null>(null);
  const [pending, startTransition] = useTransition();

  const key = checkPublishableKey(rawKey);
  const keyValue = key.ok ? key.key : null;
  const files = useMemo(
    () =>
      installFiles(target, widget, {
        key: keyValue,
        ...(origin.trim() ? { origin: origin.trim() } : {}),
      }),
    [target, widget, keyValue, origin],
  );

  const run = () =>
    startTransition(async () => {
      const r = await installWithCosmos({ widgetId: widget.id, target, site });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setGuide({ target, guide: r.guide });
    });

  return (
    <div className="flex flex-col gap-3">
      <span className="text-muted-foreground text-xs">{T.description}</span>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${ids}-target`}>{T.target}</FieldLabel>
          <Select value={target} onValueChange={(v) => setTarget(v as InstallTarget)}>
            <SelectTrigger id={`${ids}-target`}>
              <SelectValue>{(v: string) => T.targets[v as InstallTarget]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {INSTALL_TARGETS.map((x) => (
                <SelectItem key={x} value={x}>
                  {T.targets[x]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field data-invalid={!key.ok || undefined}>
          <FieldLabel htmlFor={`${ids}-key`}>{T.key}</FieldLabel>
          <Input
            id={`${ids}-key`}
            value={rawKey}
            autoComplete="off"
            spellCheck={false}
            placeholder="gs_pk_live_…"
            aria-invalid={!key.ok || undefined}
            onChange={(e) => setRawKey(e.target.value)}
          />
          {key.ok ? (
            <FieldDescription>{T.keyHint}</FieldDescription>
          ) : (
            <FieldError>{T.keyInvalid}</FieldError>
          )}
        </Field>
      </div>
      {target === 'webview' ? (
        <Field>
          <FieldLabel htmlFor={`${ids}-origin`}>{T.origin}</FieldLabel>
          <Input
            id={`${ids}-origin`}
            value={origin}
            placeholder="https://app.exemplo.com"
            onChange={(e) => setOrigin(e.target.value)}
          />
          <FieldDescription>{T.originHint}</FieldDescription>
        </Field>
      ) : null}
      {files.map((f) => (
        <div key={f.part} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{T.parts[f.part]}</span>
          <CodeSnippet code={f.code} />
        </div>
      ))}

      <Field>
        <FieldLabel htmlFor={`${ids}-site`}>{T.site}</FieldLabel>
        <Textarea
          id={`${ids}-site`}
          value={site}
          maxLength={INSTALL_SITE_MAX}
          placeholder={T.sitePlaceholder}
          onChange={(e) => setSite(e.target.value)}
        />
      </Field>
      {minCredits !== null ? <SafetyNote>{fill(T.cost, { min: minCredits })}</SafetyNote> : null}
      <div className="flex justify-end">
        <Button onClick={run} disabled={pending}>
          {pending ? <Spinner /> : <Sparkles aria-hidden />}
          {T.submit}
        </Button>
      </div>
      {guide && guide.target === target ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm" aria-live="polite">
          <span className="font-medium">{T.steps}</span>
          <ol className="flex list-decimal flex-col gap-1 pl-5">
            {guide.guide.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {guide.guide.note ? <p className="text-muted-foreground text-xs">{guide.guide.note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
