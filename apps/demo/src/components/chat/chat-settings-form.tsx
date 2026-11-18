'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { saveChatSettingsAction } from '@/lib/chat/panel-actions';
import type { ChatTenantSettings } from '@/lib/chat/panel-data';
import { sortByLabel } from '@/lib/alphabetical';
import { useI18n } from '@/lib/i18n/client';

const KINDS = ['kickoff', 'goal', 'red_card', 'var', 'half_time', 'full_time'] as const;
const num = (v: string) => (v.trim() === '' ? null : Number(v));

/** Padrão do cliente para as salas (#973): janela, modo lento, rigor e os lances do jogo que entram no chat. */
export function ChatSettingsForm({ initial }: { initial: ChatTenantSettings }) {
  const { t } = useI18n();
  const T = t.chatPanel.settings;
  const [openBefore, setOpenBefore] = useState(initial.openBeforeMinutes?.toString() ?? '');
  const [closeAfter, setCloseAfter] = useState(initial.closeAfterMinutes?.toString() ?? '');
  const [slow, setSlow] = useState(initial.slowModeSeconds?.toString() ?? '');
  const [strictness, setStrictness] = useState<string>(initial.strictness ?? 'default');
  const [kinds, setKinds] = useState<string[]>(initial.eventKinds ?? [...KINDS]);
  const [floodMax, setFloodMax] = useState(initial.floodMaxPerMinute?.toString() ?? '');
  const [floodBlock, setFloodBlock] = useState(initial.floodBlockSeconds?.toString() ?? '');
  const [handles, setHandles] = useState(initial.allowedHandles.map((h) => `@${h}`).join('\n'));
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const r = await saveChatSettingsAction({
        openBeforeMinutes: num(openBefore),
        closeAfterMinutes: num(closeAfter),
        slowModeSeconds: num(slow),
        strictness: strictness === 'default' ? null : (strictness as 'standard' | 'strict'),
        // as seis ligadas = padrão (null): um tipo novo do jogo entra sozinho
        eventKinds: kinds.length === KINDS.length ? null : kinds,
        floodMaxPerMinute: num(floodMax),
        floodBlockSeconds: num(floodBlock),
        allowedHandles: handles.split('\n'),
      });
      if (!r.ok) return void toast.error(r.error ?? t.chatPanel.errors.generic);
      toast.success(T.saved);
    });

  const kindOptions = sortByLabel(KINDS.map((k) => ({ id: k, label: T.kinds[k] })));

  return (
    <Frame>
      <FramePanel>
        <FrameHeader>
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{T.description}</FrameDescription>
        </FrameHeader>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="chat-open-before">{T.openBefore}</FieldLabel>
            <Input
              id="chat-open-before"
              inputMode="numeric"
              value={openBefore}
              onChange={(e) => setOpenBefore(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="chat-close-after">{T.closeAfter}</FieldLabel>
            <Input
              id="chat-close-after"
              inputMode="numeric"
              value={closeAfter}
              onChange={(e) => setCloseAfter(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="chat-slow">{T.slowMode}</FieldLabel>
            <Input
              id="chat-slow"
              inputMode="numeric"
              value={slow}
              onChange={(e) => setSlow(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="chat-flood-max">{T.floodMax}</FieldLabel>
            <Input
              id="chat-flood-max"
              inputMode="numeric"
              placeholder="10"
              value={floodMax}
              onChange={(e) => setFloodMax(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="chat-flood-block">{T.floodBlock}</FieldLabel>
            <Input
              id="chat-flood-block"
              inputMode="numeric"
              placeholder="180"
              value={floodBlock}
              onChange={(e) => setFloodBlock(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="chat-strictness">{T.strictness}</FieldLabel>
            <Select value={strictness} onValueChange={(v) => setStrictness(v ?? 'default')}>
              <SelectTrigger id="chat-strictness">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{T.strictnessDefault}</SelectItem>
                <SelectItem value="standard">{T.standard}</SelectItem>
                <SelectItem value="strict">{T.strict}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
        <fieldset className="mt-4 flex flex-col gap-2">
          <legend className="text-sm font-medium">{T.eventKinds}</legend>
          <div className="flex flex-wrap gap-4">
            {kindOptions.map((k) => (
              <label key={k.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={kinds.includes(k.id)}
                  onCheckedChange={(on) =>
                    setKinds((cur) => (on ? [...new Set([...cur, k.id])] : cur.filter((x) => x !== k.id)))
                  }
                />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Field className="mt-4">
          <FieldLabel htmlFor="chat-handles">{T.allowedHandles}</FieldLabel>
          <Textarea
            id="chat-handles"
            rows={3}
            value={handles}
            placeholder="@seuclube"
            onChange={(e) => setHandles(e.target.value)}
          />
          <FieldDescription>{T.allowedHandlesHint}</FieldDescription>
        </Field>
        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={pending}>
            {T.save}
          </Button>
        </div>
      </FramePanel>
    </Frame>
  );
}
