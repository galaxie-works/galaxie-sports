/**
 * Horário de cada sessão de um GP do F1DB. O release traz data e hora (UTC) de todas as sessões só de 2024
 * em diante; antes disso, só a data da corrida. Para as temporadas antigas o horário é **estimado**: dia
 * relativo à corrida conforme o formato do fim de semana e hora local típica convertida para UTC pela
 * longitude do circuito. O espelho do evento marca `time_estimated: true` nesses casos.
 */
import { num, str, type F1dbRow } from './tables.js';

const DAY_MS = 86_400_000;

/** Colunas de data e hora de cada sessão em `race`. */
const SESSION_COLUMNS: Record<string, { date: string; time: string }> = {
  'practice-1': { date: 'free_practice_1_date', time: 'free_practice_1_time' },
  'practice-2': { date: 'free_practice_2_date', time: 'free_practice_2_time' },
  'practice-3': { date: 'free_practice_3_date', time: 'free_practice_3_time' },
  'practice-4': { date: 'free_practice_4_date', time: 'free_practice_4_time' },
  qualifying: { date: 'qualifying_date', time: 'qualifying_time' },
  sprint_qualifying: { date: 'sprint_qualifying_date', time: 'sprint_qualifying_time' },
  sprint: { date: 'sprint_race_date', time: 'sprint_race_time' },
  race: { date: 'date', time: 'time' },
};

/** Dia (relativo à corrida) e hora local típicos de cada sessão, conforme o formato do fim de semana. */
function typicalSlot(
  key: string,
  ctx: { year: number; sprintWeekend: boolean; monaco: boolean },
): { dayOffset: number; localHour: number } {
  const thursday = ctx.monaco && ctx.year < 2022;
  switch (key) {
    case 'race':
      return { dayOffset: 0, localHour: 14 };
    case 'sprint':
      return { dayOffset: -1, localHour: 15.5 };
    case 'sprint_qualifying':
      return { dayOffset: -1, localHour: 11 };
    case 'qualifying':
      // fim de semana com sprint (2021–2023): a classificação foi na sexta
      return ctx.sprintWeekend ? { dayOffset: -2, localHour: 17 } : { dayOffset: -1, localHour: 14 };
    case 'practice-1':
      return { dayOffset: thursday ? -3 : -2, localHour: ctx.sprintWeekend ? 13.5 : 10 };
    case 'practice-2':
      // 2021–2022 com sprint: o TL2 foi no sábado de manhã
      if (ctx.sprintWeekend) return { dayOffset: -1, localHour: 11.5 };
      return { dayOffset: thursday ? -3 : -2, localHour: 14 };
    case 'practice-3':
      return { dayOffset: -1, localHour: 11 };
    default:
      return { dayOffset: -2, localHour: 9 };
  }
}

const atUtc = (date: string, time: string) => {
  const d = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Início da sessão em UTC. `estimated` = o release não tinha o horário (ou nem a data) da sessão.
 * `null` quando nem a data da corrida existe.
 */
export function sessionStart(
  race: F1dbRow,
  key: string,
  ctx: { sprintWeekend: boolean; longitude: number | null },
): { startsAt: Date; estimated: boolean } | null {
  const cols = SESSION_COLUMNS[key];
  const date = cols ? str(race[cols.date]) : null;
  const time = cols ? str(race[cols.time]) : null;
  if (date && time) {
    const exact = atUtc(date, time);
    if (exact) return { startsAt: exact, estimated: false };
  }
  const raceDate = str(race.date);
  if (!raceDate) return null;
  const year = num(race.year) ?? Number(raceDate.slice(0, 4));
  const slot = typicalSlot(key, {
    year,
    sprintWeekend: ctx.sprintWeekend,
    monaco: str(race.grand_prix_id) === 'monaco',
  });
  // hora local → UTC pelo fuso "solar" do circuito (longitude / 15°)
  const offset = ctx.longitude == null ? 0 : Math.round(ctx.longitude / 15);
  const day = date ?? raceDate;
  const base = new Date(`${day}T00:00:00Z`).getTime() + (date ? 0 : slot.dayOffset * DAY_MS);
  if (Number.isNaN(base)) return null;
  return { startsAt: new Date(base + (slot.localHour - offset) * 3_600_000), estimated: true };
}
