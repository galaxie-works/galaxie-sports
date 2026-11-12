'use client';

import { Send, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { requestLineupReview } from '@/app/[locale]/(app)/cliente/grade/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { SafetyNote } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { LINEUP_REVIEW_TEXT_MAX, type LineupReviewDraft } from '@/lib/cosmos/lineup-review';
import { draftLineupReviewWithCosmos } from '@/lib/cosmos/lineup-review-actions';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { MESSAGE_MAX } from '@/lib/lineup/types';

/**
 * "Pedir revisão com a Cosmos" na Grade e ofertas (#1008): o cliente escreve solto o que mudou, a Cosmos acha o item e
 * preenche o pedido, e o cliente confere a mensagem e envia pela ação de sempre (o pedido cai na mesma fila).
 */
export function LineupReviewComposer({ minCredits }: { minCredits: number | null }) {
  const { t } = useI18n();
  const T = t.client.cosmosLineup;
  const ids = useId();
  const router = useRouter();
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<LineupReviewDraft | null>(null);
  const [message, setMessage] = useState('');
  // só a resposta do último pedido vale: descartar ou mudar o texto no meio invalida a que ainda vai chegar
  const asked = useRef(0);
  const [asking, startAsk] = useTransition();
  const [sending, startSend] = useTransition();

  const ask = () => {
    const n = ++asked.current;
    startAsk(async () => {
      const r = await draftLineupReviewWithCosmos({ text });
      if (n !== asked.current) return;
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setDraft(r.draft);
      setMessage(r.draft.message);
    });
  };
  const discard = () => {
    asked.current++;
    setDraft(null);
  };

  const send = () => {
    if (!draft) return;
    startSend(async () => {
      const r = await requestLineupReview({
        targetType: draft.targetType,
        targetId: draft.targetId,
        message,
        proposed: draft.proposed,
      });
      if (!r.ok) {
        toast.error(r.error ?? t.lineup.errors.generic);
        return;
      }
      toast.success(t.lineup.request.sent);
      setDraft(null);
      setText('');
      router.refresh();
    });
  };

  const valueText = (field: string, value: string | boolean) =>
    field === 'access' && typeof value === 'string'
      ? ((t.lineup.access as Record<string, string>)[value] ?? value)
      : String(value);

  return (
    <Frame id="cosmos-review">
      <FramePanel className="flex flex-col gap-3">
        <FrameHeader className="p-0">
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{T.description}</FrameDescription>
        </FrameHeader>
        {minCredits !== null ? <SafetyNote>{fill(T.cost, { min: minCredits })}</SafetyNote> : null}
        <Field>
          <FieldLabel htmlFor={`${ids}-text`}>{T.label}</FieldLabel>
          <Textarea
            id={`${ids}-text`}
            value={text}
            maxLength={LINEUP_REVIEW_TEXT_MAX}
            placeholder={T.placeholder}
            onChange={(e) => {
              setText(e.target.value);
              // o rascunho era do texto anterior
              if (draft) discard();
            }}
          />
          <FieldDescription>
            {fill(T.count, { count: [...text].length, max: LINEUP_REVIEW_TEXT_MAX })}
          </FieldDescription>
        </Field>
        <div className="flex justify-end">
          <Button onClick={ask} disabled={asking || sending || !text.trim()}>
            {asking ? <Spinner /> : <Sparkles aria-hidden />}
            {T.submit}
          </Button>
        </div>

        {draft ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3" aria-live="polite">
            <span className="text-sm font-medium">{T.draft}</span>
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">{T.target}</span>
              <span className="font-medium">
                {draft.adding
                  ? fill(T.adding, { name: draft.targetName, plan: draft.plan ?? '' })
                  : draft.plan
                    ? fill(T.inPlan, { name: draft.targetName, plan: draft.plan })
                    : draft.targetName}
              </span>
            </div>
            {draft.proposed ? (
              <div className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs">{T.proposed}</span>
                <div className="flex flex-wrap gap-1.5">
                  {draft.proposed.removed === true ? (
                    <Badge variant="destructive-light">{T.removed}</Badge>
                  ) : (
                    Object.entries(draft.proposed).map(([field, value]) => (
                      <Badge key={field} variant="secondary">
                        {`${(t.lineup.fields as Record<string, string>)[field] ?? field}: ${valueText(field, value)}`}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            ) : null}
            <Field>
              <FieldLabel htmlFor={`${ids}-message`}>{T.message}</FieldLabel>
              <Textarea
                id={`${ids}-message`}
                rows={3}
                maxLength={MESSAGE_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={discard} disabled={sending}>
                {T.discard}
              </Button>
              <Button onClick={send} disabled={sending || !message.trim()}>
                {sending ? <Spinner /> : <Send />}
                {T.send}
              </Button>
            </div>
          </div>
        ) : null}
      </FramePanel>
    </Frame>
  );
}
