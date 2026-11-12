/**
 * Frases do lance a lance editadas em Ajustes (#1167), lidas de `ops.narration_template`. A leitura fica 60 s em
 * memória por processo: a mudança chega à timeline em até 1 minuto, sem uma consulta a mais por requisição.
 * `stamp` muda a cada gravação e entra na chave do cache da timeline, então o jogo encerrado (cache de 1 h) também
 * troca a frase.
 */
import {
  NARRATION_LANGS,
  isNarrationKey,
  type NarrationLang,
  type NarrationOverrides,
} from '@galaxie/contracts';
import { narrationTemplate, type Database } from '@galaxie/db';

const TTL_MS = 60_000;

export interface NarrationOverridesSnapshot {
  overrides: NarrationOverrides;
  /** Muda a cada gravação (última `updated_at` e quantidade de linhas). */
  stamp: string;
}

let cached: { at: number; value: NarrationOverridesSnapshot } | null = null;

export function toNarrationOverrides(
  rows: readonly { key: string; lang: string; variants: readonly string[] }[],
): NarrationOverrides {
  const out: Record<string, Partial<Record<NarrationLang, readonly string[]>>> = {};
  for (const r of rows) {
    if (!isNarrationKey(r.key) || !(NARRATION_LANGS as readonly string[]).includes(r.lang)) continue;
    const variants = r.variants.filter((v) => v.trim());
    if (variants.length) (out[r.key] ??= {})[r.lang as NarrationLang] = variants;
  }
  return out;
}

export async function loadNarrationOverrides(
  db: Database,
  now = Date.now(),
): Promise<NarrationOverridesSnapshot> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  try {
    const rows = await db
      .select({
        key: narrationTemplate.key,
        lang: narrationTemplate.lang,
        variants: narrationTemplate.variants,
        updatedAt: narrationTemplate.updatedAt,
      })
      .from(narrationTemplate);
    const last = rows.reduce((m, r) => Math.max(m, r.updatedAt.getTime()), 0);
    const value = { overrides: toNarrationOverrides(rows), stamp: `${rows.length}.${last}` };
    cached = { at: now, value };
    return value;
  } catch {
    // tabela ainda não migrada ou banco fora: as frases padrão valem, e a próxima leitura tenta de novo
    return cached?.value ?? { overrides: {}, stamp: '0' };
  }
}

/** Só para testes. */
export function resetNarrationOverridesCache(): void {
  cached = null;
}
