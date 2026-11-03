import { sql, type SQL } from 'drizzle-orm';
import type { EventStatus } from '@galaxie/contracts';
import { event } from '@galaxie/db';
import { DEFAULT_FRESHNESS_MS } from '@galaxie/providers';

/** Status de jogo em andamento (o relógio ainda conta: ao vivo, intervalo, interrompido). */
export const IN_PLAY: EventStatus[] = ['live', 'break', 'suspended'];

/** Interrompido parado há mais que isso depois do fim previsto não conta como "ao vivo". */
export const SUSPENDED_LIVE_GRACE_MS = 24 * 3600_000;

/**
 * "Ao vivo de verdade" (`GET /v1/events/live`): descarta o que o relógio dos eventos (`events-clock`, docs/04
 * §3.1) já teria encerrado — `live`/`break` sem dado fresco do fornecedor (stale ou última leitura há mais
 * de 10 min) depois de `ends_at_expected` — e o interrompido parado há mais de 24 h depois do fim previsto.
 * Protege a lista quando o job do relógio atrasa ou está parado (o evento fica em `live` com placar vazio).
 * Mora aqui (e não só na API) porque o resumo pré-calculado da home conta os jogos ao vivo com a mesma regra.
 */
export function actuallyLiveCond(now: Date): SQL {
  const at = now.toISOString();
  const freshSince = new Date(now.getTime() - DEFAULT_FRESHNESS_MS).toISOString();
  const suspendedUntil = new Date(now.getTime() - SUSPENDED_LIVE_GRACE_MS).toISOString();
  return sql`not (
    (${event.status} in ('live', 'break') and ${event.endsAtExpected} <= ${at}::timestamptz
      and (${event.isStale} or ${event.lastValidAt} is null or ${event.lastValidAt} < ${freshSince}::timestamptz))
    or (${event.status} = 'suspended' and ${event.endsAtExpected} <= ${suspendedUntil}::timestamptz)
  )`;
}
