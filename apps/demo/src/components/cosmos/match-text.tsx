'use client';

import { Bot, Copy, Sparkles } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { SafetyNote } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { MatchText as Draft, MatchTextKind } from '@/lib/cosmos/match-text';
import { draftMatchTextWithCosmos } from '@/lib/cosmos/match-text-actions';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/**
 * "Texto para publicar" na página do jogo (#1009): a Cosmos reescreve o cenário (pré) ou o resumo (pós) no tom da
 * marca do cliente. O rascunho fica aqui para revisar e copiar, com o rótulo de texto gerado com IA à mão.
 */
export function MatchText({
  eventId,
  locale,
  kinds,
  minCredits,
  voiceSaved,
}: {
  eventId: string;
  /** Locale do conteúdo (o mesmo do cenário e do resumo da página). */
  locale: string;
  /** Textos de partida que o jogo já tem. */
  kinds: MatchTextKind[];
  minCredits: number | null;
  /** O cliente já salvou o guia de tom? Sem guia, vale o padrão (formal, médio). */
  voiceSaved: boolean;
}) {
  const { t } = useI18n();
  const T = t.client.cosmosMatchText;
  const [draft, setDraft] = useState<{ kind: MatchTextKind; text: Draft } | null>(null);
  const [asking, setAsking] = useState<MatchTextKind | null>(null);
  const [pending, startTransition] = useTransition();
  const asked = useRef(0);

  const run = (kind: MatchTextKind) => {
    const n = ++asked.current;
    setAsking(kind);
    startTransition(async () => {
      const r = await draftMatchTextWithCosmos({ eventId, kind, locale });
      if (n !== asked.current) return;
      setAsking(null);
      if (!r.ok) return void toast.error(r.error);
      setDraft({ kind, text: r.text });
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(T.copied);
    } catch {
      toast.error(T.copyFailed);
    }
  };

  const full = draft ? `${draft.text.title}\n\n${draft.text.dek}\n\n${draft.text.body}` : '';

  return (
    <Frame id="cosmos-text">
      <FramePanel className="flex flex-col gap-3">
        <FrameHeader className="p-0">
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{voiceSaved ? T.description : T.descriptionDefault}</FrameDescription>
        </FrameHeader>
        {minCredits !== null ? <SafetyNote>{fill(T.cost, { min: minCredits })}</SafetyNote> : null}
        <div className="flex flex-wrap gap-2">
          {kinds.map((kind) => (
            <Button key={kind} variant="outline" onClick={() => run(kind)} disabled={pending}>
              {pending && asking === kind ? <Spinner /> : <Sparkles aria-hidden />}
              {T.kinds[kind]}
            </Button>
          ))}
        </div>

        {draft ? (
          <article className="flex flex-col gap-2 rounded-lg border p-3 text-sm" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="primary-light">{T.kinds[draft.kind]}</Badge>
              <Badge variant="outline">
                <Bot aria-hidden />
                {T.aiLabel}
              </Badge>
            </div>
            <h3 className="text-base font-semibold">{draft.text.title}</h3>
            <p className="text-muted-foreground">{draft.text.dek}</p>
            {draft.text.body.split('\n\n').map((p, i) => (
              <p key={i} className="leading-relaxed">
                {p}
              </p>
            ))}
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => copy(T.aiLabel)}>
                <Copy aria-hidden />
                {T.copyLabel}
              </Button>
              <Button size="sm" onClick={() => copy(full)}>
                <Copy aria-hidden />
                {T.copy}
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">{T.review}</p>
          </article>
        ) : null}
      </FramePanel>
    </Frame>
  );
}
