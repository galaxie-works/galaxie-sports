'use client';

import type { BrandVoice, BrandVoiceLength, BrandVoiceTone } from '@galaxie/cosmos';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { saveBrandVoiceAction } from '@/lib/cosmos/match-text-actions';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

const TONES: BrandVoiceTone[] = ['formal', 'fan', 'young'];
const LENGTHS: BrandVoiceLength[] = ['short', 'medium', 'long'];
const AVOID_MAX = 20;

const splitAvoid = (text: string) =>
  text
    .split(/[\n,;]/)
    .map((w) => w.trim())
    .filter(Boolean);

/**
 * Guia de tom da marca (#1009), nas configurações da Cosmos: como os textos de pré e pós-jogo soam (formal, torcedor
 * ou jovem), o tamanho e as palavras a evitar. Salvo uma vez e usado em cada pedido.
 */
export function BrandVoiceForm({ initial, canEdit }: { initial: BrandVoice; canEdit: boolean }) {
  const { t } = useI18n();
  const T = t.client.cosmosMatchText.voice;
  const ids = useId();
  const [tone, setTone] = useState(initial.tone);
  const [length, setLength] = useState(initial.length);
  const [avoid, setAvoid] = useState(initial.avoid.join('\n'));
  const [pending, startTransition] = useTransition();
  const words = splitAvoid(avoid);

  const save = () =>
    startTransition(async () => {
      const r = await saveBrandVoiceAction({ tone, length, avoid: words });
      if (!r.ok) return void toast.error(r.error);
      setAvoid(r.voice.avoid.join('\n'));
      toast.success(T.saved);
    });

  return (
    <Frame>
      <FramePanel className="flex flex-col gap-4">
        <FrameHeader className="p-0">
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{T.description}</FrameDescription>
        </FrameHeader>
        <Field>
          <FieldLabel>{T.tone}</FieldLabel>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label={T.tone}
            value={[tone]}
            disabled={!canEdit}
            onValueChange={(next) => {
              const v = next[0] as BrandVoiceTone | undefined;
              if (v) setTone(v);
            }}
          >
            {TONES.map((v) => (
              <ToggleGroupItem key={v} value={v}>
                {T.tones[v]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>{T.toneHints[tone]}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>{T.length}</FieldLabel>
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            aria-label={T.length}
            value={[length]}
            disabled={!canEdit}
            onValueChange={(next) => {
              const v = next[0] as BrandVoiceLength | undefined;
              if (v) setLength(v);
            }}
          >
            {LENGTHS.map((v) => (
              <ToggleGroupItem key={v} value={v}>
                {T.lengths[v]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${ids}-avoid`}>{T.avoid}</FieldLabel>
          <Textarea
            id={`${ids}-avoid`}
            rows={4}
            value={avoid}
            disabled={!canEdit}
            placeholder={T.avoidPlaceholder}
            onChange={(e) => setAvoid(e.target.value)}
          />
          <FieldDescription>{fill(T.avoidHint, { count: words.length, max: AVOID_MAX })}</FieldDescription>
        </Field>
        {canEdit ? (
          <div className="flex justify-end">
            <Button onClick={save} disabled={pending || words.length > AVOID_MAX}>
              {pending ? <Spinner /> : null}
              {T.save}
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">{T.readOnly}</p>
        )}
      </FramePanel>
    </Frame>
  );
}
