'use client';

import { toast } from 'sonner';

/** Copia e avisa num toast (a área de transferência pode estar bloqueada: http, permissão). */
export async function copyWithToast(text: string, messages: { done: string; failed: string }) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(messages.done);
  } catch {
    toast.error(messages.failed);
  }
}

/** URL absoluta de um caminho da demo (com `#âncora`). */
export const absoluteUrl = (href: string) => new URL(href, window.location.origin).toString();
