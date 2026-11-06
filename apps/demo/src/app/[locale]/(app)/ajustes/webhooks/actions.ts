'use server';

/**
 * Ações de Ajustes → Webhooks: pausa geral das entregas, recusa de segredo em texto puro e a cifra dos segredos
 * legados. Cada uma revalida a sessão de admin no servidor; as regras (não recusar com legado no banco, não cifrar
 * sem KEK) ficam em `@galaxie/db/webhooks`, o mesmo código que a CLI usa.
 */
import {
  sealWebhookSecrets,
  setWebhookDelivery,
  setWebhookRejectPlaintext,
  WebhookControlError,
} from '@galaxie/db/webhooks';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { builderDb } from '@/lib/builder/store';
import { webhookSecrets } from '@/lib/client/webhooks';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface WebhookControlResult {
  ok: boolean;
  error?: string;
  sealed?: number;
  failed?: number;
}

const PATH = '/ajustes/webhooks';

async function texts() {
  return getDictionary(await getRequestLocale()).webhooksAdmin;
}

async function run(fn: (by: string) => Promise<Omit<WebhookControlResult, 'ok'> | void>) {
  const me = await requireAdmin();
  const t = await texts();
  try {
    const extra = await fn(me.email);
    revalidatePath(PATH);
    return { ok: true, ...(extra ?? {}) } satisfies WebhookControlResult;
  } catch (err) {
    if (err instanceof WebhookControlError)
      return { ok: false, error: err.code === 'no_kek' ? t.errors.noKek : t.errors.plaintextLeft };
    console.error('ajustes/webhooks: ação falhou', err);
    return { ok: false, error: t.errors.generic };
  }
}

export async function setDeliveryAction(enabled: boolean): Promise<WebhookControlResult> {
  return run((by) => setWebhookDelivery(builderDb(), enabled === true, by));
}

export async function setRejectPlaintextAction(reject: boolean): Promise<WebhookControlResult> {
  return run((by) => setWebhookRejectPlaintext(builderDb(), reject === true, by));
}

export async function sealSecretsAction(): Promise<WebhookControlResult> {
  const t = await texts();
  const box = webhookSecrets();
  if (!box) {
    await requireAdmin();
    return { ok: false, error: t.errors.noKek };
  }
  return run(async () => {
    const r = await sealWebhookSecrets(builderDb(), box);
    return { sealed: r.sealed, failed: r.failed.length };
  });
}
