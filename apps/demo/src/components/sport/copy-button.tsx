'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

/** Copia um valor (ex.: o CSS do gradiente sugerido) para a área de transferência. */
export function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value).catch(() => {
        // sem foco/permissão para a Clipboard API (ex.: iframe): cai no execCommand com o gesto do clique
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.append(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        if (!ok) throw new Error('cópia recusada');
      });
      setCopied(true);
      toast.success('Copiado');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Não foi possível copiar');
    }
  }

  return (
    <Button variant="ghost" size="icon-xs" onClick={copy} aria-label={label} title={label}>
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </Button>
  );
}
