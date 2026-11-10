'use server';

/**
 * Estimativa antes de perguntar ao assistente da Cosmos (#1003): os mesmos prompt e conta que a rota em fluxo usa
 * para reservar, então o "cerca de N créditos" é o que a reserva pede. Não reserva nada.
 */
import { readClientContext } from '@/lib/client/session';
import { getRequestLocale } from '@/lib/i18n/server';

import { assistantApiKey, parseAssistantRequest, prepareQuestion } from './assistant-server';

export type EstimateResult =
  { ok: true; credits: number } | { ok: false; error: 'unauthorized' | 'unavailable' };

export async function estimateAssistantQuestion(body: unknown): Promise<EstimateResult> {
  const ctx = await readClientContext();
  if (!ctx?.tenant) return { ok: false, error: 'unauthorized' };
  const req = parseAssistantRequest(body);
  if (!req || !assistantApiKey()) return { ok: false, error: 'unavailable' };
  const prepared = await prepareQuestion(ctx.tenant.id, req, await getRequestLocale());
  if (!prepared) return { ok: false, error: 'unavailable' };
  return { ok: true, credits: prepared.credits };
}
