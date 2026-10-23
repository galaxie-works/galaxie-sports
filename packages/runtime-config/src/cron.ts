import { Cron } from 'croner';
import { CRON_OFF_VALUES } from './registry.js';

const OPTIONS = { paused: true, mode: '5-part', timezone: 'UTC' } as const;

/** "off", "false", "disabled" ou "0": job desligado. */
export function isCronOff(value: string): boolean {
  return (CRON_OFF_VALUES as readonly string[]).includes(value.trim().toLowerCase());
}

/** Mensagem do croner quando a expressão (5 campos, UTC) é inválida; `null` quando é válida. */
export function cronError(pattern: string): string | null {
  try {
    new Cron(pattern, OPTIONS).stop();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Próximas execuções (UTC) de uma expressão de 5 campos; vazio quando é inválida ou "off". */
export function nextCronRuns(pattern: string, count = 3, from: Date = new Date()): Date[] {
  if (isCronOff(pattern) || cronError(pattern)) return [];
  const cron = new Cron(pattern, OPTIONS);
  const runs = cron.nextRuns(count, from);
  cron.stop();
  return runs;
}
