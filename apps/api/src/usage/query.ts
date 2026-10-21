import * as z from 'zod';
import { utcDay } from './counter.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDay = (d: string) => {
  if (!DAY_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && utcDay(new Date(t)) === d;
};
const Day = z.string().refine(isRealDay, 'use uma data YYYY-MM-DD');

/** Maior intervalo consultável de uma vez (dias). */
export const MAX_USAGE_RANGE_DAYS = 92;

/** `?from=&to=` (dias UTC inclusivos). Padrão: os últimos 7 dias até hoje. */
export const UsageQuery = z.object({ from: Day.optional(), to: Day.optional() }).transform((q, ctx) => {
  const to = q.to ?? utcDay();
  const from = q.from ?? utcDay(new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86_400_000));
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (span < 1) ctx.addIssue({ code: 'custom', path: ['from'], message: 'from deve ser ≤ to' });
  else if (span > MAX_USAGE_RANGE_DAYS)
    ctx.addIssue({
      code: 'custom',
      path: ['from'],
      message: `intervalo máximo de ${MAX_USAGE_RANGE_DAYS} dias`,
    });
  return { from, to };
});
