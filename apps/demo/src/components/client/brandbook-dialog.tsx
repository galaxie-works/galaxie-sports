'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import type { WidgetTheme } from '@/lib/builder/types';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

const MAX_BYTES = 20 * 1024 * 1024;

/** O que a Cosmos devolve: as duas versões, os ajustes de contraste, a nota e as fontes lidas. */
export interface BrandbookResult {
  light: WidgetTheme;
  dark: WidgetTheme;
  adjusted: { mode: 'light' | 'dark'; from: string; to: string }[];
  notes: string;
  fonts: string[];
  charged: number;
}

type Quote = { credits: number; pages: number };

/**
 * "Criar com a Cosmos" (#1004): envia o PDF, mostra o custo estimado e, com a confirmação, devolve os temas para o
 * editor. O mesmo arquivo vai nas duas etapas (o servidor não guarda o PDF entre elas).
 */
export function BrandbookDialog({ onResult }: { onResult: (r: BrandbookResult) => void }) {
  const { t } = useI18n();
  const c = t.client.themes.cosmos;
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [busy, setBusy] = useState<'estimar' | 'criar' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const message = (code: unknown) =>
    (typeof code === 'string' && (c.errors as Record<string, string>)[code]) || c.errors.generic;

  async function send(step: 'estimar' | 'criar') {
    if (!file) return;
    setBusy(step);
    setError(null);
    try {
      const body = new FormData();
      body.set('arquivo', file);
      if (step === 'criar' && quote) body.set('creditos', String(quote.credits));
      const res = await fetch(`/api/cliente/cosmos/tema?etapa=${step}`, { method: 'POST', body });
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!json?.ok) {
        if (json?.error === 'quote_changed') setQuote(null);
        return setError(message(json?.error));
      }
      if (step === 'estimar') return setQuote({ credits: Number(json.credits), pages: Number(json.pages) });
      onResult(json as unknown as BrandbookResult);
      setOpen(false);
      setFile(null);
      setQuote(null);
    } catch {
      setError(c.errors.generic);
    } finally {
      setBusy(null);
    }
  }

  function choose(f: File | null) {
    setQuote(null);
    setError(f && f.size > MAX_BYTES ? c.errors.too_large : null);
    setFile(f && f.size <= MAX_BYTES ? f : null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => busy === null && setOpen(o)}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Sparkles />
        {c.open}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{c.description}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="brandbook-file">{c.file}</FieldLabel>
          <Input
            id="brandbook-file"
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy !== null}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
          />
          <FieldDescription>{c.privacy}</FieldDescription>
        </Field>
        {quote ? (
          <Alert>
            <AlertDescription>
              {fill(c.cost, { credits: quote.credits, pages: quote.pages })}
            </AlertDescription>
          </Alert>
        ) : null}
        {busy === 'criar' ? (
          <Alert>
            <Spinner />
            <AlertDescription>{c.creating}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          {quote ? (
            <Button onClick={() => send('criar')} disabled={!file || busy !== null}>
              {busy === 'criar' ? <Spinner /> : <Sparkles />}
              {c.confirm}
            </Button>
          ) : (
            <Button onClick={() => send('estimar')} disabled={!file || busy !== null}>
              {busy === 'estimar' ? <Spinner /> : null}
              {busy === 'estimar' ? c.estimating : c.estimate}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
