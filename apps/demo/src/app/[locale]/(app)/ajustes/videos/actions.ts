'use server';

/**
 * Ações de Ajustes → Vídeos relacionados (só admin): regra manual do canal (bloquear, liberar ou voltar ao
 * automático) e limpeza das recusas do player. Cada uma confere a sessão de admin no servidor e grava quem
 * fez; o change feed avisa os jogos do canal (purga do cache da API).
 */
import { clearRelatedChannelRefusals, setRelatedChannelRule } from '@galaxie/db/related';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { builderDb } from '@/lib/builder/store';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export interface ChannelActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/** Id de canal do YouTube (UC + 22) ou um id curto de teste; nada de texto livre. */
const isChannelId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{3,64}$/.test(id);

async function texts() {
  return getDictionary(await getRequestLocale()).relatedAdmin;
}

export async function setChannelMode(
  channelId: string,
  mode: 'auto' | 'block' | 'allow',
  channelTitle: string,
): Promise<ChannelActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  if (!isChannelId(channelId) || !['auto', 'block', 'allow'].includes(mode))
    return { ok: false, error: t.errors.invalid };
  try {
    const events = await setRelatedChannelRule(builderDb(), {
      channelId,
      mode: mode === 'auto' ? null : mode,
      channelTitle: channelTitle.slice(0, 200) || null,
      by: me.email,
    });
    revalidatePath('/ajustes/videos');
    return { ok: true, message: fill(t.saved, { events }) };
  } catch {
    return { ok: false, error: t.errors.generic };
  }
}

export async function clearChannelRefusals(channelId: string): Promise<ChannelActionResult> {
  await requireAdmin();
  const t = await texts();
  if (!isChannelId(channelId)) return { ok: false, error: t.errors.invalid };
  try {
    const count = await clearRelatedChannelRefusals(builderDb(), { channelId });
    revalidatePath('/ajustes/videos');
    return { ok: true, message: fill(t.cleared, { count }) };
  } catch {
    return { ok: false, error: t.errors.generic };
  }
}
