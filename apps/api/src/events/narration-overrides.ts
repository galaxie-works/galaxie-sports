/**
 * Frases do lance a lance editadas em Ajustes (#1167), lidas de `ops.narration_template`.
 *
 * A timeline não pode passar a esperar o banco antes do cache: um acerto no Valkey continua sem tocar no Postgres.
 * - A leitura fica 60 s em memória por processo, e a mudança chega à timeline em até 1 minuto.
 * - Vencido o prazo, a requisição usa a última leitura e a renovação corre ao lado, uma só por processo.
 * - Falha também conta como leitura: o banco fora não vira uma consulta por requisição, e as frases padrão (ou as da
 *   última leitura boa) seguem valendo.
 * - Só a primeira leitura do processo espera, e no máximo `FIRST_WAIT_MS`.
 *
 * `stamp` muda a cada gravação e a cada volta ao padrão. Ele entra na chave do cache da timeline, então o jogo
 * encerrado (cache de 1 h) também troca a frase.
 */
import {
  NARRATION_LANGS,
  isNarrationKey,
  type NarrationLang,
  type NarrationOverrides,
} from '@galaxie/contracts';
import { narrationTemplate, type Database } from '@galaxie/db';

const TTL_MS = 60_000;
const FIRST_WAIT_MS = 500;

export interface NarrationOverridesSnapshot {
  overrides: NarrationOverrides;
  /** Muda a cada gravação (quantidade de linhas e última `updated_at`). */
  stamp: string;
}

const DEFAULTS: NarrationOverridesSnapshot = { overrides: {}, stamp: '0' };

let value: NarrationOverridesSnapshot = DEFAULTS;
let at = 0;
let loaded = false;
let inflight: Promise<void> | null = null;

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

async function refresh(db: Database, now: () => number): Promise<void> {
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
    value = { overrides: toNarrationOverrides(rows), stamp: `${rows.length}.${last}` };
    loaded = true;
  } catch {
    // tabela ainda não migrada ou banco fora: fica a última leitura (ou o padrão) até a próxima tentativa
  } finally {
    at = now();
    inflight = null;
  }
}

export async function loadNarrationOverrides(
  db: Database,
  now: () => number = Date.now,
): Promise<NarrationOverridesSnapshot> {
  if (now() - at < TTL_MS) return value;
  inflight ??= refresh(db, now);
  if (!loaded && at === 0) {
    // primeira leitura do processo: espera pouco; depois disso nunca espera
    await Promise.race([inflight, new Promise<void>((r) => setTimeout(r, FIRST_WAIT_MS).unref?.())]);
  }
  return value;
}

/** Só para testes. */
export function resetNarrationOverridesCache(): void {
  value = DEFAULTS;
  at = 0;
  loaded = false;
  inflight = null;
}
