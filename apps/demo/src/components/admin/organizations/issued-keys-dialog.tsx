'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import type { IssuedBrandKeys } from '@/app/[locale]/(app)/settings/organizations/actions';
import { Alert, AlertDescription } from '@/components/reui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n/client';

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const K = t.platformStaff.keys;
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <code className="bg-muted min-w-0 flex-1 overflow-x-auto rounded-md px-2 py-1.5 font-mono text-xs break-all">
          {value}
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? K.copied : K.copy}
        </Button>
      </div>
    </div>
  );
}

/** Chaves emitidas pelo provisionamento (criação assistida ou aprovação da revisão), mostradas uma única vez. */
export function IssuedKeysDialog({
  issued,
  notice,
  onClose,
}: {
  issued: IssuedBrandKeys[] | null;
  /** Frase acima das chaves (o convite saiu, a revisão foi aprovada…). */
  notice?: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const K = t.platformStaff.keys;
  return (
    <Dialog open={issued !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{K.title}</DialogTitle>
          <DialogDescription>{K.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {notice ? (
            <Alert variant="info">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
          {(issued ?? []).map((b) => (
            <div key={b.tenantId} className="flex flex-col gap-3">
              {issued && issued.length > 1 ? <span className="text-sm font-medium">{b.brand}</span> : null}
              {b.keys.live ? <CopyRow label={K.live} value={b.keys.live} /> : null}
              {b.keys.test ? <CopyRow label={K.test} value={b.keys.test} /> : null}
              {b.keys.publishable ? <CopyRow label={K.publishable} value={b.keys.publishable} /> : null}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{K.close}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
