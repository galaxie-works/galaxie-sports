/**
 * Guia de tom do cliente (#1009): como a marca escreve nos textos que a Cosmos redige (pré e pós-jogo). Salvo uma vez
 * nas configurações da Cosmos; o servidor valida tudo de novo (`parseBrandVoice`) antes de gravar.
 */
import { eq, sql } from 'drizzle-orm';
// subcaminhos, não o índice: o índice traz o migrator (pasta drizzle/), que o bundler do Next não resolve
import type { Database } from '@galaxie/db/client';
import {
  BRAND_VOICE_LENGTHS,
  BRAND_VOICE_TONES,
  brandVoice,
  type BrandVoiceLength,
  type BrandVoiceTone,
} from '@galaxie/db/schema';

export { BRAND_VOICE_LENGTHS, BRAND_VOICE_TONES, type BrandVoiceLength, type BrandVoiceTone };

/** Teto de palavras a evitar e do tamanho de cada uma. */
export const BRAND_VOICE_AVOID_MAX = 20;
export const BRAND_VOICE_AVOID_CHARS = 40;

export interface BrandVoice {
  tone: BrandVoiceTone;
  /** Palavras e expressões que o texto não usa (sem repetição, na ordem em que o cliente escreveu). */
  avoid: string[];
  length: BrandVoiceLength;
}

/** Padrão de quem nunca salvou: neutro e médio. */
export const DEFAULT_BRAND_VOICE: BrandVoice = { tone: 'formal', avoid: [], length: 'medium' };

/** Valida o guia vindo da tela; null se algo não serve (campo desconhecido, tom fora da lista, lista grande demais). */
export function parseBrandVoice(input: unknown): BrandVoice | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some((k) => k !== 'tone' && k !== 'avoid' && k !== 'length')) return null;
  if (!(BRAND_VOICE_TONES as readonly unknown[]).includes(v.tone)) return null;
  if (!(BRAND_VOICE_LENGTHS as readonly unknown[]).includes(v.length)) return null;
  if (!Array.isArray(v.avoid)) return null;
  const seen = new Set<string>();
  const avoid: string[] = [];
  for (const item of v.avoid) {
    if (typeof item !== 'string') return null;
    const word = item.trim().replace(/\s+/g, ' ');
    if (!word) continue;
    if (word.length > BRAND_VOICE_AVOID_CHARS) return null;
    const key = word.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    avoid.push(word);
  }
  if (avoid.length > BRAND_VOICE_AVOID_MAX) return null;
  return { tone: v.tone as BrandVoiceTone, avoid, length: v.length as BrandVoiceLength };
}

export interface StoredBrandVoice extends BrandVoice {
  updatedBy: string;
  updatedAt: Date;
}

/** Guia salvo do tenant; null = nunca salvou. */
export async function readBrandVoice(
  db: Pick<Database, 'select'>,
  tenantId: string,
): Promise<StoredBrandVoice | null> {
  const [row] = await db.select().from(brandVoice).where(eq(brandVoice.tenantId, tenantId)).limit(1);
  if (!row) return null;
  // o banco só guarda o que passou pela validação; ainda assim, linha estranha vira o padrão
  const parsed =
    parseBrandVoice({ tone: row.tone, avoid: row.avoid, length: row.length }) ?? DEFAULT_BRAND_VOICE;
  return { ...parsed, updatedBy: row.updatedBy, updatedAt: row.updatedAt };
}

/** Grava o guia (uma linha por tenant). */
export async function saveBrandVoice(
  db: Pick<Database, 'insert'>,
  tenantId: string,
  voice: BrandVoice,
  updatedBy: string,
): Promise<void> {
  await db
    .insert(brandVoice)
    .values({ tenantId, ...voice, updatedBy })
    .onConflictDoUpdate({
      target: brandVoice.tenantId,
      set: { tone: voice.tone, avoid: voice.avoid, length: voice.length, updatedBy, updatedAt: sql`now()` },
    });
}
