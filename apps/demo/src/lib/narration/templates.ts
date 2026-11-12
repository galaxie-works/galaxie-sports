/**
 * Frases do lance a lance editadas em Ajustes → Produtos → Lance a lance (#1167), só no servidor. O catálogo, os
 * padrões e a validação ficam em `@galaxie/contracts` (o mesmo código que a API usa para narrar). Aqui a leitura e a
 * gravação em `ops.narration_template`, com versão otimista e histórico na mesma transação.
 */
import {
  NARRATION_LANGS,
  cleanNarrationVariants,
  isNarrationKey,
  validateNarration,
  type NarrationKey,
  type NarrationLang,
  type NarrationProblem,
} from '@galaxie/contracts';

import { pool } from '@/lib/auth/db';

export interface NarrationTemplateRow {
  key: NarrationKey;
  lang: NarrationLang;
  variants: string[];
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface NarrationLogRow {
  key: string;
  lang: string;
  action: 'set' | 'reset';
  variants: string[] | null;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

export class NarrationTemplateError extends Error {
  constructor(
    readonly code: 'invalid' | 'stale' | 'problems',
    readonly problems: NarrationProblem[] = [],
  ) {
    super(code);
    this.name = 'NarrationTemplateError';
  }
}

const isLang = (l: string): l is NarrationLang => (NARRATION_LANGS as readonly string[]).includes(l);

/** Frases editadas (as que faltam usam o padrão do catálogo). */
export async function listNarrationTemplates(): Promise<NarrationTemplateRow[]> {
  const { rows } = await pool.query<{
    key: string;
    lang: string;
    variants: string[];
    version: number;
    updated_by: string;
    updated_at: Date;
  }>(`select key, lang, variants, version, updated_by, updated_at from ops.narration_template`);
  return rows
    .filter((r) => isNarrationKey(r.key) && isLang(r.lang))
    .map((r) => ({
      key: r.key as NarrationKey,
      lang: r.lang as NarrationLang,
      variants: r.variants,
      version: r.version,
      updatedBy: r.updated_by,
      updatedAt: r.updated_at.toISOString(),
    }));
}

export async function narrationLog(limit = 30): Promise<NarrationLogRow[]> {
  const { rows } = await pool.query<{
    key: string;
    lang: string;
    action: 'set' | 'reset';
    new_variants: string[] | null;
    changed_by: string;
    reason: string | null;
    changed_at: Date;
  }>(
    `select key, lang, action, new_variants, changed_by, reason, changed_at
       from ops.narration_template_log order by changed_at desc, id desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    key: r.key,
    lang: r.lang,
    action: r.action,
    variants: r.new_variants,
    changedBy: r.changed_by,
    reason: r.reason,
    changedAt: r.changed_at.toISOString(),
  }));
}

/**
 * Grava as variações de uma chave e idioma (`variants`), ou volta ao padrão (`variants` null). `expectedVersion` é a
 * versão que a tela abriu (null = ainda no padrão): se outra pessoa gravou antes, recusa com `stale`.
 */
export async function saveNarrationTemplate(input: {
  key: string;
  lang: string;
  variants: string[] | null;
  expectedVersion: number | null;
  reason: string | null;
  actor: string;
}): Promise<{ version: number | null }> {
  if (!isNarrationKey(input.key) || !isLang(input.lang)) throw new NarrationTemplateError('invalid');
  const key = input.key;
  const lang = input.lang;
  const variants = input.variants ? cleanNarrationVariants(input.variants.map(String)) : null;
  if (variants) {
    const problems = validateNarration(key, variants);
    if (problems.length) throw new NarrationTemplateError('problems', problems);
  }
  const reason = input.reason?.trim().slice(0, 500) || null;
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ version: number; variants: string[] }>(
      `select version, variants from ops.narration_template where key = $1 and lang = $2 for update`,
      [key, lang],
    );
    const prev = rows[0] ?? null;
    if ((prev?.version ?? null) !== input.expectedVersion) throw new NarrationTemplateError('stale');
    let version: number | null = null;
    if (variants) {
      version = (prev?.version ?? 0) + 1;
      await client.query(
        `insert into ops.narration_template (key, lang, variants, version, updated_by, updated_at)
         values ($1, $2, $3::text[], $4, $5, now())
         on conflict (key, lang) do update
           set variants = excluded.variants, version = excluded.version,
               updated_by = excluded.updated_by, updated_at = now()`,
        [key, lang, variants, version, input.actor],
      );
    } else if (prev) {
      await client.query(`delete from ops.narration_template where key = $1 and lang = $2`, [key, lang]);
    }
    if (variants || prev)
      await client.query(
        `insert into ops.narration_template_log (key, lang, action, old_variants, new_variants, changed_by, reason)
         values ($1, $2, $3, $4::text[], $5::text[], $6, $7)`,
        [key, lang, variants ? 'set' : 'reset', prev?.variants ?? null, variants, input.actor, reason],
      );
    await client.query('commit');
    return { version };
  } catch (err) {
    await client.query('rollback').catch(() => {});
    // duas gravações da mesma frase ao mesmo tempo: a segunda bate na chave primária
    if ((err as { code?: string }).code === '23505') throw new NarrationTemplateError('stale');
    throw err;
  } finally {
    client.release();
  }
}
