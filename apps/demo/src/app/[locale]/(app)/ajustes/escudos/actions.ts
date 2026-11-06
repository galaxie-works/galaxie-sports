'use server';

/**
 * Ações de Ajustes → Escudos (só admin): enviar o escudo de um time ou de uma competição e voltar ao
 * anterior. O arquivo é conferido pelo conteúdo, o PNG/WebP de 512 px e os tamanhos fixos saem dele, tudo
 * vai para o storage com a nomenclatura do acervo e o escudo é ligado na hora (a API é avisada pelo change
 * feed). Cada ação confere a sessão de admin no servidor e grava quem fez.
 */
import { CrestError, prepareCrest } from '@galaxie/crests';
import { CrestTargetError, revertPanelCrest, setPanelCrest } from '@galaxie/db/crests';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { CREST_MAX_MB, isCrestTargetId, isCrestTargetType } from '@/lib/crests/types';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { lineupDb, logoObjectStore } from '@/lib/lineup/store';

export interface CrestActionResult {
  ok: boolean;
  error?: string;
}

async function texts() {
  return getDictionary(await getRequestLocale()).crests.errors;
}

export async function uploadCrest(form: FormData): Promise<CrestActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  const type = form.get('targetType');
  const id = form.get('targetId');
  const file = form.get('file');
  if (!isCrestTargetType(type) || !isCrestTargetId(id)) return { ok: false, error: t.notFound };
  if (!(file instanceof Blob) || !file.size) return { ok: false, error: t.empty };
  // antes de ler o arquivo inteiro (o preparo confere de novo, pelo conteúdo)
  if (file.size > CREST_MAX_MB * 1024 * 1024)
    return { ok: false, error: fill(t.too_large, { mb: CREST_MAX_MB }) };
  const objects = logoObjectStore();
  if (!objects) return { ok: false, error: t.storage };
  try {
    const crest = await prepareCrest(type, id, new Uint8Array(await file.arrayBuffer()));
    // arquivos primeiro: o nome é o hash, então um envio que falhar depois não deixa nada com nome errado
    for (const o of crest.objects) await objects.put(o.key, o.body, o.contentType, o.sha256);
    await setPanelCrest(lineupDb(), { type, id }, crest, me.email);
  } catch (err) {
    if (err instanceof CrestError) return { ok: false, error: t[err.code] };
    if (err instanceof CrestTargetError) return { ok: false, error: t.notFound };
    console.error('[ajustes] falha no envio do escudo', err);
    return { ok: false, error: t.generic };
  }
  revalidatePath('/ajustes/escudos');
  return { ok: true };
}

/** Volta ao escudo de antes do último envio (o do acervo, ou o do fornecedor). */
export async function revertCrest(target: { type: string; id: string }): Promise<CrestActionResult> {
  const me = await requireAdmin();
  const t = await texts();
  const { type, id } = target ?? {};
  if (!isCrestTargetType(type) || !isCrestTargetId(id)) return { ok: false, error: t.notFound };
  try {
    if (!(await revertPanelCrest(lineupDb(), { type, id }, me.email)))
      return { ok: false, error: t.noRevert };
  } catch (err) {
    console.error('[ajustes] falha ao voltar o escudo', err);
    return { ok: false, error: t.generic };
  }
  revalidatePath('/ajustes/escudos');
  return { ok: true };
}
