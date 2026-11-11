'use server';

/**
 * Grava o perfil de torcedor da pessoa logada (#1020). O usuário sai da sessão no servidor, nunca do
 * formulário; os campos são `input: false` no Better Auth, então só esta ação escreve neles.
 */
import { headers } from 'next/headers';

import { pool } from '@/lib/auth/db';
import { auth, isAccessExpired } from '@/lib/auth/server';

import { parseFanProfile, type FanProfileField } from './profile';

export interface FanProfileResult {
  ok: boolean;
  error?: 'session' | 'invalid' | 'unavailable';
  field?: FanProfileField;
}

export async function saveFanProfile(input: unknown): Promise<FanProfileResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || isAccessExpired(session.user)) return { ok: false, error: 'session' };
  const parsed = parseFanProfile(input);
  if (!parsed.ok) return { ok: false, error: 'invalid', field: parsed.field };
  try {
    await pool.query(
      `update "user" set fan_nickname = $2, fan_age_band = $3, fan_country = $4, "updatedAt" = now() where id = $1`,
      [session.user.id, parsed.value.nickname, parsed.value.ageBand, parsed.value.country],
    );
  } catch (err) {
    console.error('[torcedor] não deu para gravar o perfil', err);
    return { ok: false, error: 'unavailable' };
  }
  return { ok: true };
}
