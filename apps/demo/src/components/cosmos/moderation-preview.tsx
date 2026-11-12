'use client';

import type { ModerationPreview as Preview } from '@galaxie/cosmos';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/reui/badge';
import { SafetyNote, SettingsSection } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { previewCosmosModeration } from '@/lib/cosmos/moderation-actions';
import { CONTENT_KINDS, PREVIEW_MAX, type ContentKind } from '@/lib/cosmos/moderation-utils';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

const RULE_VARIANT = { allow: 'success-light', block: 'destructive-light', shadow: 'warning-light' } as const;

/**
 * "Testar com uma mensagem" (#999): mostra o que as regras fixas fazem na hora e o que a Cosmos faria depois, pela
 * configuração gravada, com o custo. Gasta créditos como uso normal (o aviso fica no topo) e não grava na fila.
 */
export function ModerationPreview() {
  const { t } = useI18n();
  const T = t.moderation.preview;
  const Q = t.moderation.queue;
  const cats = t.moderation.history.categories as Record<string, string>;
  const ids = useId();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ContentKind>('chat_message');
  const [room, setRoom] = useState('');
  const [result, setResult] = useState<Preview | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const r = await previewCosmosModeration({ text, kind, ...(room.trim() ? { room } : {}) });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setResult(r.preview);
    });

  const actions = (p: Preview) =>
    p
      .plan!.actions.map((a) =>
        fill(Q.suggestion.stepOf, {
          action: (Q.actionNames as Record<string, string>)[a.action] ?? a.action,
          step: Q.suggestion.steps[a.step],
        }),
      )
      .join(', ');

  return (
    <SettingsSection title={T.title} description={T.description}>
      <SafetyNote>{T.cost}</SafetyNote>
      <Field>
        <FieldLabel htmlFor={`${ids}-text`}>{T.label}</FieldLabel>
        <Textarea
          id={`${ids}-text`}
          value={text}
          maxLength={PREVIEW_MAX}
          placeholder={T.placeholder}
          onChange={(e) => setText(e.target.value)}
        />
        <FieldDescription>{fill(T.count, { count: [...text].length, max: PREVIEW_MAX })}</FieldDescription>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${ids}-kind`}>{T.kind}</FieldLabel>
          <Select value={kind} onValueChange={(v) => setKind(v as ContentKind)}>
            <SelectTrigger id={`${ids}-kind`}>
              <SelectValue>{(v: string) => T.kinds[v as ContentKind]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CONTENT_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {T.kinds[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${ids}-room`}>{T.room}</FieldLabel>
          <Input
            id={`${ids}-room`}
            value={room}
            maxLength={200}
            placeholder={T.roomPlaceholder}
            onChange={(e) => setRoom(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button onClick={run} disabled={pending || !text.trim()}>
          {T.submit}
        </Button>
      </div>

      {result ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3 text-sm" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{T.rulesTitle}</span>
            <Badge variant={RULE_VARIANT[result.rules.action]}>{T.rules[result.rules.action]}</Badge>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-medium">{T.cosmosTitle}</span>
            {result.verdict && result.plan ? (
              <>
                <p>
                  {fill(T.verdict, {
                    category: cats[result.verdict.category] ?? result.verdict.category,
                    severity: result.verdict.severity,
                  })}
                </p>
                {result.verdict.reason ? (
                  <p className="text-muted-foreground text-xs">{result.verdict.reason}</p>
                ) : null}
                <p>{result.plan.allow ? T.publish : fill(T.wouldDo, { actions: actions(result) })}</p>
                {!result.plan.allow ? <p>{result.plan.queue ? T.queue : T.noQueue}</p> : null}
              </>
            ) : (
              <p>
                {fill(T.noModel, {
                  reason:
                    (Q.fallback as Record<string, string>)[result.fallback ?? 'other'] ?? Q.fallback.other,
                })}
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              {result.by === 'classifier' ? T.byList : fill(T.spent, { credits: result.credits })}
            </p>
          </div>
        </div>
      ) : null}
    </SettingsSection>
  );
}
