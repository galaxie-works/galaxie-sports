/**
 * Sessão de um fim de semana de corrida (F1) a partir do texto do provedor: api-sports ("1st Practice",
 * "2nd Qualifying", "1st Sprint Shootout", "Sprint", "Race") e F1DB (o normalizador usa os mesmos rótulos;
 * a classificação inteira é "Qualifying", sem número). A chave casa a mesma sessão vinda de provedores
 * diferentes.
 */
export type RaceSessionType = 'practice' | 'qualifying' | 'sprint_qualifying' | 'sprint' | 'race';

export function parseRaceSession(
  raw: string | null | undefined,
): { type: RaceSessionType; number: number | null } | null {
  const t = (raw ?? '').trim().toLowerCase();
  if (!t) return null;
  const number = Number(/^(\d+)(st|nd|rd|th)\b/.exec(t)?.[1]) || null;
  if (t === 'race') return { type: 'race', number: null };
  if (/sprint (shootout|qualifying)/.test(t)) return { type: 'sprint_qualifying', number };
  if (t === 'sprint') return { type: 'sprint', number: null };
  if (/qualifying/.test(t)) return { type: 'qualifying', number };
  if (/practice/.test(t)) return { type: 'practice', number };
  return null;
}

/** "2nd Practice" → `practice-2`; "Race" → `race`; "Qualifying" (classificação inteira) → `qualifying`. */
export function raceSessionKey(raw: string | null | undefined): string | null {
  const s = parseRaceSession(raw);
  if (!s) return null;
  return s.number == null ? s.type : `${s.type}-${s.number}`;
}
