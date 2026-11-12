'use client';

import { Sparkles } from 'lucide-react';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { CodeSnippet } from '@/components/client/code-snippet';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { SafetyNote } from '@/components/settings';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { askCosmosHelp } from '@/lib/cosmos/integration-actions';
import {
  RECEIVER_LANGUAGES,
  receiverFile,
  type HelpAnswer,
  type HelpKind,
  type ReceiverLanguage,
} from '@/lib/cosmos/integration-help';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/**
 * Ajuda de integração da Cosmos (#1007) nas telas Chaves, Webhooks e Visão geral: um botão, o aviso de custo e o que a
 * Cosmos encontrou. Os fatos (erros, entregas, uso) saem do servidor; daqui só vai o tipo do pedido e o webhook.
 */
export function CosmosHelp({
  kind,
  minCredits,
  webhooks,
}: {
  kind: HelpKind;
  /** Mínimo da função para o aviso de custo; null = a equipe Galaxie (sem custo para o cliente). */
  minCredits: number | null;
  /** Só na tela Webhooks: os endpoints do tenant. */
  webhooks?: { id: string; url: string }[];
}) {
  const { t } = useI18n();
  const T = t.client.cosmosHelp;
  const S = T[kind];
  const ids = useId();
  const [webhookId, setWebhookId] = useState(webhooks?.[0]?.id ?? '');
  const [result, setResult] = useState<{ answer: HelpAnswer | null } | null>(null);
  const [pending, startTransition] = useTransition();
  // webhook apagado ou lista nova: volta para o primeiro da lista em vez de pedir por um id que não existe mais
  const selected = webhooks?.some((w) => w.id === webhookId) ? webhookId : (webhooks?.[0]?.id ?? '');

  const run = () =>
    startTransition(async () => {
      const r = await askCosmosHelp({ kind, webhookId: selected });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setResult({ answer: r.answer });
    });

  if (kind === 'webhooks' && !webhooks?.length) return null;

  return (
    <Frame>
      <FramePanel className="flex flex-col gap-3">
        <FrameHeader className="p-0">
          <FrameTitle>{S.title}</FrameTitle>
          <FrameDescription>{S.description}</FrameDescription>
        </FrameHeader>
        {minCredits !== null ? <SafetyNote>{fill(T.cost, { min: minCredits })}</SafetyNote> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {kind === 'webhooks' && webhooks ? (
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor={`${ids}-webhook`}>{T.webhooks.endpoint}</FieldLabel>
              <Select
                value={selected}
                onValueChange={(v) => {
                  setWebhookId(v as string);
                  setResult(null);
                }}
              >
                <SelectTrigger id={`${ids}-webhook`}>
                  <SelectValue>{(v: string) => webhooks.find((w) => w.id === v)?.url ?? ''}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {webhooks.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.url}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <div className="flex justify-end sm:ml-auto">
            <Button onClick={run} disabled={pending || (kind === 'webhooks' && !selected)}>
              {pending ? <Spinner /> : <Sparkles aria-hidden />}
              {S.submit}
            </Button>
          </div>
        </div>

        {result ? (
          <div className="flex flex-col gap-2" aria-live="polite">
            {result.answer ? (
              <>
                <span className="text-sm font-medium">{T.result}</span>
                {result.answer.summary ? <p className="text-sm">{result.answer.summary}</p> : null}
                <ul className="flex flex-col gap-2">
                  {result.answer.items.map((it, i) => (
                    <li key={i} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                      <span className="font-medium">{it.title}</span>
                      <p className="text-muted-foreground">{it.action}</p>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">{S.nothing}</p>
            )}
          </div>
        ) : null}
      </FramePanel>
    </Frame>
  );
}

const LANGUAGE_NAMES: Record<ReceiverLanguage, string> = { node: 'Node.js', python: 'Python', php: 'PHP' };

/** Receptor de webhooks com a verificação da assinatura (#1007): código dos modelos, sem IA e sem custo. */
export function WebhookReceiver() {
  const { t } = useI18n();
  const T = t.client.cosmosHelp.receiver;
  const ids = useId();
  const [lang, setLang] = useState<ReceiverLanguage>('node');
  return (
    <Frame>
      <FramePanel className="flex flex-col gap-3">
        <FrameHeader className="p-0">
          <FrameTitle>{T.title}</FrameTitle>
          <FrameDescription>{T.description}</FrameDescription>
        </FrameHeader>
        <Field className="sm:max-w-56">
          <FieldLabel htmlFor={`${ids}-lang`}>{T.language}</FieldLabel>
          <Select value={lang} onValueChange={(v) => setLang(v as ReceiverLanguage)}>
            <SelectTrigger id={`${ids}-lang`}>
              <SelectValue>{(v: string) => LANGUAGE_NAMES[v as ReceiverLanguage]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RECEIVER_LANGUAGES.map((l) => (
                <SelectItem key={l} value={l}>
                  {LANGUAGE_NAMES[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <CodeSnippet code={receiverFile(lang)} />
      </FramePanel>
    </Frame>
  );
}
