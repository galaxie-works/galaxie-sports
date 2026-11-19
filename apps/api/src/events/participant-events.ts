import { sql, type SQL } from 'drizzle-orm';
import { event, eventParticipant, type Database } from '@galaxie/db';

/**
 * Consulta dos últimos (`desc`) ou próximos (`asc`) eventos de um participante, partindo dele.
 *
 * Os eventos do participante (com o filtro de `where`) ficam numa CTE `materialized`, e só a CTE é ordenada e
 * cortada. Com o `join` direto, `order by starts_at` e `limit` pequeno, o Postgres pode preferir descer
 * `event_starts_at_idx` de trás para frente e conferir o participante em cada evento, apostando que acha as
 * linhas cedo. Para quem parou de competir (piloto lendário: ~1.400 linhas entre ~690 mil eventos terminados)
 * isso percorre o índice quase inteiro e estoura o `statement_timeout`. Dentro da CTE não há ordem nem limite,
 * então o planejador escolhe pelo custo total (pelo `event_participant_participant_idx`, ou pelo status quando
 * há poucos eventos nele, como os ao vivo); fora dela, o único caminho é ordenar as linhas da CTE. O plano bom
 * não depende de estatística.
 *
 * `where` pode citar as colunas de `event` (`core.event` entra sem apelido).
 */
export function participantEventsQuery(
  participantId: string,
  where: SQL | undefined,
  order: 'asc' | 'desc',
  limit: number,
): SQL {
  return sql`
    with mine as materialized (
      select ${event.id} as id, ${event.startsAt} as starts_at
        from ${eventParticipant}
        join ${event} on ${event.id} = ${eventParticipant.eventId}
       where ${eventParticipant.participantId} = ${participantId}::uuid${where ? sql` and ${where}` : sql``}
    )
    select id::text as id from mine
     order by mine.starts_at ${order === 'asc' ? sql`asc` : sql`desc`}, mine.id asc
     limit ${limit}`;
}

/** IDs dos últimos ou próximos eventos do participante (ver {@link participantEventsQuery}). */
export async function participantEventIds(
  db: Database,
  participantId: string,
  where: SQL | undefined,
  order: 'asc' | 'desc',
  limit: number,
): Promise<{ id: string }[]> {
  const rows = await db.execute<{ id: string } & Record<string, unknown>>(
    participantEventsQuery(participantId, where, order, limit),
  );
  return rows.map((r) => ({ id: r.id }));
}
