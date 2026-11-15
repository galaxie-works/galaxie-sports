'use server';

/**
 * Ações de Ajustes → Produtos → Lance a lance (#1167), só admin da Galaxie: gravar as frases de uma chave e idioma,
 * ou voltar ao padrão. A sessão de admin é conferida de novo no servidor; a validação fica em `@galaxie/contracts`.
 */
import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/admin';
import { getDictionary } from '@/lib/i18n/dictionary';
import { getRequestLocale } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { NarrationTemplateError, saveNarrationTemplate } from '@/lib/narration/templates';

export interface NarrationActionResult {
  ok: boolean;
  error?: string;
  version?: number | null;
}

const PATH = '/ajustes/lance-a-lance';

export async function saveNarrationAction(input: {
  key: string;
  lang: string;
  /** null = voltar ao padrão. */
  variants: string[] | null;
  expectedVersion: number | null;
  reason: string;
}): Promise<NarrationActionResult> {
  const me = await requireAdmin();
  const t = getDictionary(await getRequestLocale()).narrationAdmin.errors;
  try {
    const r = await saveNarrationTemplate({
      key: String(input?.key ?? ''),
      lang: String(input?.lang ?? ''),
      variants: Array.isArray(input?.variants) ? input.variants.map(String).slice(0, 50) : null,
      expectedVersion: typeof input?.expectedVersion === 'number' ? input.expectedVersion : null,
      reason: typeof input?.reason === 'string' ? input.reason : null,
      actor: `galaxie:${me.id}`,
    });
    revalidatePath(PATH);
    return { ok: true, version: r.version };
  } catch (err) {
    if (err instanceof NarrationTemplateError) {
      if (err.code !== 'problems') return { ok: false, error: t[err.code] };
      const p = err.problems[0]!;
      const line = 'variant' in p ? p.variant + 1 : 1;
      const error =
        p.code === 'unknown_placeholder'
          ? fill(t.unknown_placeholder, { line, placeholder: `{${p.placeholder}}` })
          : fill(t[p.code], { line });
      return { ok: false, error };
    }
    console.error('ajustes/lance-a-lance: gravação falhou', err);
    return { ok: false, error: t.generic };
  }
}
