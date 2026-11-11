'use server';

/**
 * Estimativa antes de perguntar ao assistente da Cosmos (#1003): os mesmos prompt e conta que a rota em fluxo usa
 * para reservar, então o "cerca de N créditos" é o que a reserva pede. Não reserva nada. Mesmas travas de acesso da
 * rota, com um limite por pessoa (a estimativa roda enquanto a pessoa digita).
 */
import { readClientContext } from '@/lib/client/session';
import { getRequestLocale } from '@/lib/i18n/server';

import {
  assistantAccessError,
  assistantApiKey,
  parseAssistantRequest,
  prepareQuestion,
} from './assistant-server';
import { allowEstimate } from './assistant-limits';

export type EstimateResult =
  | { ok: true; credits: number }
  | { ok: false; error: 'unauthorized' | 'staff' | 'module' | 'unavailable' | 'rate_limited' };

export async function estimateAssistantQuestion(body: unknown): Promise<EstimateResult> {
  const ctx = await readClientContext();
  if (!ctx) return { ok: false, error: 'unauthorized' };
  const denied = assistantAccessError(ctx);
  if (denied) return { ok: false, error: denied };
  if (!allowEstimate(ctx.userId)) return { ok: false, error: 'rate_limited' };
  const req = parseAssistantRequest(body);
  if (!req || !assistantApiKey()) return { ok: false, error: 'unavailable' };
  const prepared = await prepareQuestion(
    { tenantId: ctx.tenant!.id, userId: ctx.userId },
    req,
    await getRequestLocale(),
  );
  if (!prepared) return { ok: false, error: 'unavailable' };
  return { ok: true, credits: prepared.credits };
}
