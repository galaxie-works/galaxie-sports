/**
 * Junção do jogo provisório com o oficial: quando o fornecedor publica o jogo, a normalização procura o
 * provisório da mesma competição e temporada, com os mesmos participantes (em qualquer mando) e data a
 * até 2 dias, e assume aquele evento (mesmo `event.id`).
 */

/** Provedor gravado em `core.event.source_provider` nos jogos provisórios (curadoria). */
export const PROVISIONAL_PROVIDER = 'galaxie-curated';

/** Tolerância de data: o anúncio pode trazer a data errada ou o jogo pode mudar de dia. */
export const PROVISIONAL_MATCH_MS = 2 * 86_400_000;

/** Jogo do fornecedor ainda sem evento no core, com as referências já resolvidas para os nossos IDs. */
export interface ProvisionalCandidate {
  providerId: string;
  competitionId: string | null;
  seasonId: string | null;
  startsAt: Date;
  participants: string[];
}

/** Evento provisório gravado no core. */
export interface ProvisionalEventRow {
  id: string;
  competitionId: string | null;
  seasonId: string | null;
  startsAt: Date;
  participants: string[];
}

const participantsKey = (ids: string[]) => [...new Set(ids)].sort().join(',');

/**
 * Pares jogo do fornecedor → evento provisório. Cada provisório é assumido por um jogo só (o de data mais
 * próxima); jogo sem competição/temporada ou com menos de dois participantes nunca casa.
 */
export function matchProvisional(
  candidates: readonly ProvisionalCandidate[],
  rows: readonly ProvisionalEventRow[],
): Map<string, string> {
  const pairs: { providerId: string; eventId: string; distance: number }[] = [];
  for (const c of candidates) {
    if (!c.competitionId || !c.seasonId || new Set(c.participants).size < 2) continue;
    const key = participantsKey(c.participants);
    for (const r of rows) {
      if (r.competitionId !== c.competitionId || r.seasonId !== c.seasonId) continue;
      if (participantsKey(r.participants) !== key) continue;
      const distance = Math.abs(r.startsAt.getTime() - c.startsAt.getTime());
      if (distance <= PROVISIONAL_MATCH_MS) pairs.push({ providerId: c.providerId, eventId: r.id, distance });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance || a.providerId.localeCompare(b.providerId));
  const out = new Map<string, string>();
  const taken = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.providerId) || taken.has(p.eventId)) continue;
    out.set(p.providerId, p.eventId);
    taken.add(p.eventId);
  }
  return out;
}
