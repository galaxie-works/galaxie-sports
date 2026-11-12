'use client';

import { Send, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { uploadChannels } from '@/app/[locale]/(app)/cliente/canais/actions';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { SafetyNote } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  IMAGE_MAX_BYTES,
  IMPORT_ACCEPT,
  IMPORT_MAX_BYTES,
  importKind,
  type ChannelImport as Result,
} from '@/lib/cosmos/channel-import';
import { importChannelsWithCosmos } from '@/lib/cosmos/channel-import-actions';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

const MAX_LABEL = `${IMPORT_MAX_BYTES / 1024 / 1024} MB`;
const IMAGE_MAX_LABEL = `${IMAGE_MAX_BYTES / 1024 / 1024} MB`;

/**
 * "Ler a grade com a Cosmos" na Minha lista de canais (#1008): PDF, print ou planilha viram a lista de nomes, que o
 * cliente revisa e envia pelo fluxo de sempre. Depois do envio, os canais que não casaram aparecem com a explicação
 * da Cosmos (ou a geral).
 */
export function ChannelImport({
  minCredits,
  country,
  unmatched,
}: {
  minCredits: number | null;
  /** País da operadora quando o tenant tem um mercado só (ajuda a leitura); null = automático. */
  country: string | null;
  /** Canais da lista atual sem emissora no casamento. */
  unmatched: string[];
}) {
  const { t } = useI18n();
  const T = t.client.cosmosChannels;
  const ids = useId();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [list, setList] = useState('');
  // o que foi enviado da última leitura (nomes e notas), para explicar só esses canais quando não casarem
  const [sent, setSent] = useState<{ names: Set<string>; notes: Record<string, string> } | null>(null);
  // troca a chave do campo de arquivo para limpá-lo depois do envio
  const [inputKey, setInputKey] = useState(0);
  const [reading, startRead] = useTransition();
  const [sending, startSend] = useTransition();
  const asked = useRef(0);

  const read = () => {
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES)
      return void toast.error(fill(T.errors.fileTooLarge, { max: MAX_LABEL }));
    if (importKind(file.name) === 'image' && file.size > IMAGE_MAX_BYTES)
      return void toast.error(fill(T.errors.imageTooLarge, { max: IMAGE_MAX_LABEL }));
    const n = ++asked.current;
    startRead(async () => {
      const form = new FormData();
      form.set('file', file);
      if (country) form.set('country', country);
      const r = await importChannelsWithCosmos(form);
      if (n !== asked.current) return;
      if (!r.ok) return void toast.error(r.error);
      setResult(r.result);
      setList(r.result.names.join('\n'));
    });
  };

  const discard = () => {
    asked.current++;
    setResult(null);
    setList('');
  };

  const send = () =>
    startSend(async () => {
      const names = list
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const r = await uploadChannels({ content: names.join('\n'), format: 'text', defaultCountry: country });
      if (!r.ok) return void toast.error(r.error ?? T.errors.failed);
      toast.success(T.sent);
      setSent({ names: new Set(names.map((n) => n.toLocaleLowerCase())), notes: result?.notes ?? {} });
      discard();
      setFile(null);
      setInputKey((k) => k + 1);
      router.refresh();
    });

  const lines = list.split(/\r?\n/).filter((l) => l.trim()).length;
  const explained = sent ? unmatched.filter((n) => sent.names.has(n.toLocaleLowerCase())).slice(0, 50) : [];

  return (
    <Frame id="cosmos-import">
      <FramePanel className="flex flex-col gap-3">
        <FrameHeader className="p-0">
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{T.description}</FrameDescription>
        </FrameHeader>
        {minCredits !== null ? <SafetyNote>{fill(T.cost, { min: minCredits })}</SafetyNote> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor={`${ids}-file`}>{T.file}</FieldLabel>
            <Input
              key={inputKey}
              id={`${ids}-file`}
              type="file"
              accept={IMPORT_ACCEPT}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setSent(null);
                discard();
              }}
            />
            <FieldDescription>{fill(T.fileHint, { max: MAX_LABEL })}</FieldDescription>
          </Field>
          <Button onClick={read} disabled={!file || reading || sending} className="sm:mb-6">
            {reading ? <Spinner /> : <Sparkles aria-hidden />}
            {T.submit}
          </Button>
        </div>

        {result ? (
          <div className="flex flex-col gap-3 rounded-lg border p-3" aria-live="polite">
            <Field>
              <FieldLabel htmlFor={`${ids}-list`}>{fill(T.result, { count: lines })}</FieldLabel>
              <Textarea
                id={`${ids}-list`}
                rows={10}
                value={list}
                onChange={(e) => setList(e.target.value)}
                className="font-mono text-xs"
              />
              <FieldDescription>{result.note ?? T.resultHint}</FieldDescription>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={discard} disabled={sending}>
                {T.discard}
              </Button>
              <Button onClick={send} disabled={sending || !lines}>
                {sending ? <Spinner /> : <Send />}
                {T.send}
              </Button>
            </div>
          </div>
        ) : null}

        {explained.length ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            <span className="text-sm font-medium">{T.unmatchedTitle}</span>
            <ul className="flex flex-col gap-1.5">
              {explained.map((name) => (
                <li key={name} className="flex flex-col rounded-lg border p-2 text-sm">
                  <span className="font-medium">{name}</span>
                  <span className="text-muted-foreground text-xs">
                    {sent?.notes[name] ?? T.unmatchedGeneric}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </FramePanel>
    </Frame>
  );
}
