/**
 * Limite da estimativa do assistente (#1003): ela não chama o provedor nem reserva, mas lê o banco a cada pausa na
 * digitação. Janela de um minuto por pessoa, na memória do processo; a pergunta de verdade tem o limite no banco
 * (`assistantLimitError`), que vale para todos os processos.
 */
export const ESTIMATES_PER_MINUTE = 30;

const windows = new Map<string, number[]>();

export function allowEstimate(userId: string, now: number = Date.now()): boolean {
  const since = now - 60_000;
  const recent = (windows.get(userId) ?? []).filter((t) => t > since);
  if (recent.length >= ESTIMATES_PER_MINUTE) {
    windows.set(userId, recent);
    return false;
  }
  recent.push(now);
  windows.set(userId, recent);
  // não cresce sem fim: quem sumiu sai na próxima passada
  if (windows.size > 10_000) for (const [k, v] of windows) if (!v.some((t) => t > since)) windows.delete(k);
  return true;
}
