'use server';

/**
 * Ações de Ajustes → Conformidade → Moderação (#969), só admin da Galaxie: gravar uma lista base (com versão e motivo)
 * e testar um texto contra a base. A sessão de admin é conferida de novo no servidor; o filtro fica em
 * `@galaxie/engage`.
 */
import { SCREEN_KINDS, screen, screenNotice, type ScreenKind, type ScreenResult } from '@galaxie/engage';
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { ModerationListError, compiledBaseLists, saveBaseList } from '@/lib/engage/moderation-lists';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';

export interface ModerationActionResult {
  ok: boolean;
  error?: string;
  version?: number;
  count?: number;
}

const PATH = '/ajustes/moderacao';

export async function saveModerationListAction(input: {
  list: string;
  locale: string;
  terms: string[];
  expectedVersion: number | null;
  reason: string;
}): Promise<ModerationActionResult> {
  const me = await requireAdmin();
  const t = getDictionary(await getRequestLocale()).moderationLists.errors;
  try {
    const r = await saveBaseList({
      list: String(input?.list ?? ''),
      locale: String(input?.locale ?? ''),
      terms: Array.isArray(input?.terms) ? input.terms.map(String) : [],
      expectedVersion: typeof input?.expectedVersion === 'number' ? input.expectedVersion : null,
      reason: typeof input?.reason === 'string' ? input.reason : null,
      actor: `galaxie:${me.id}`,
    });
    revalidatePath(PATH);
    return { ok: true, version: r.version, count: r.count };
  } catch (err) {
    if (err instanceof ModerationListError) return { ok: false, error: t[err.code] };
    console.error('ajustes/moderacao: gravação falhou', err);
    return { ok: false, error: t.generic };
  }
}

export interface ScreenTestResult extends ScreenResult {
  notice: string | null;
}

export async function testScreenAction(input: {
  text: string;
  kind: string;
  locale: string;
}): Promise<ScreenTestResult | null> {
  await requireAdmin();
  const kind = (SCREEN_KINDS as readonly string[]).includes(input?.kind)
    ? (input.kind as ScreenKind)
    : 'chat_message';
  const text = String(input?.text ?? '').slice(0, 5000);
  const locale = String(input?.locale ?? 'pt-BR').slice(0, 10);
  try {
    const r = screen(text, { kind, locale }, await compiledBaseLists());
    return { ...r, notice: screenNotice(r, locale) };
  } catch (err) {
    console.error('ajustes/moderacao: teste do texto falhou', err);
    return null;
  }
}
