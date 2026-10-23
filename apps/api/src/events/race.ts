/**
 * Eventos de corrida (F1): a sessão do fim de semana (treino, classificação, sprint, corrida) vem do espelho
 * `core.sport_event_detail` (`kind = race`), e o resultado de cada piloto de `event_participant.result`.
 */
import type { EventSession, ParticipantResult, SupportedLocale, TeamColors } from '@galaxie/contracts';
import {
  asset,
  event,
  eventParticipant,
  participant,
  providerMap,
  sportEventDetail,
  type Database,
} from '@galaxie/db';
import { F1_DRIVER_PREFIX } from '@galaxie/providers';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { teamLogoId } from '../assets/custom-logos.js';
import { teamColors } from '../teams/colors.js';
import { assetUrl } from '../util.js';

/** Fontes da F1: a api-sports (temporada atual, ao vivo) e o F1DB (histórico desde 1950, CC BY 4.0). */
export const RACE_PROVIDERS = ['api-sports', 'f1db'];

type SessionType = EventSession['type'];

/** "3rd Qualifying" → classificação nº 3; "Sprint Shootout" → classificação da sprint; "Race" → corrida. */
export function parseSessionType(
  raw: string | null | undefined,
): { type: SessionType; number: number | null } | null {
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

const SESSION_NAMES: Record<'pt' | 'es' | 'en', Record<SessionType, string>> = {
  pt: {
    practice: 'Treino livre',
    qualifying: 'Classificação',
    sprint_qualifying: 'Classificação da sprint',
    sprint: 'Sprint',
    race: 'Corrida',
  },
  es: {
    practice: 'Práctica libre',
    qualifying: 'Clasificación',
    sprint_qualifying: 'Clasificación sprint',
    sprint: 'Sprint',
    race: 'Carrera',
  },
  en: {
    practice: 'Practice',
    qualifying: 'Qualifying',
    sprint_qualifying: 'Sprint qualifying',
    sprint: 'Sprint',
    race: 'Race',
  },
};

/** Nome da sessão no locale: "Treino livre 2", "Classificação · Q3", "Corrida". */
export function sessionName(type: SessionType, number: number | null, locale: SupportedLocale): string {
  const lang = locale.split('-')[0] as 'pt' | 'es' | 'en';
  const base = (SESSION_NAMES[lang] ?? SESSION_NAMES.en)[type];
  if (number == null) return base;
  if (type === 'practice') return `${base} ${number}`;
  return `${base} · ${type === 'sprint_qualifying' ? 'SQ' : 'Q'}${number}`;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};

/** Sessões dos eventos de corrida, por evento. Eventos que não são corrida ficam de fora. */
export async function loadRaceSessions(
  db: Database,
  ids: string[],
  locale: SupportedLocale,
): Promise<Map<string, EventSession>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({
      eventId: sportEventDetail.eventId,
      sport: sportEventDetail.sport,
      summary: sportEventDetail.summary,
    })
    .from(sportEventDetail)
    .where(and(inArray(sportEventDetail.eventId, ids), eq(sportEventDetail.kind, 'race')));
  if (!rows.length) return new Map();
  // volta mais rápida: o fornecedor manda só o ID do piloto
  const fastestIds = rows
    .map((r) => text(obj(obj(obj(r.summary).fastest_lap).driver).id))
    .filter((x): x is string => !!x);
  const drivers = await providerIds(
    db,
    'formula-1',
    fastestIds.map((id) => `${F1_DRIVER_PREFIX}${id}`),
  );
  const out = new Map<string, EventSession>();
  for (const r of rows) {
    const s = obj(r.summary);
    const parsed = parseSessionType(text(s.type));
    if (!parsed) continue;
    const fastest = obj(s.fastest_lap);
    const fastestDriver = text(obj(fastest.driver).id);
    out.set(r.eventId, {
      type: parsed.type,
      number: parsed.number,
      name: sessionName(parsed.type, parsed.number, locale),
      laps: int(obj(s.laps).total),
      distance: text(s.distance),
      fastest_lap:
        fastestDriver || text(fastest.time)
          ? {
              participant_id: fastestDriver
                ? (drivers.get(`${F1_DRIVER_PREFIX}${fastestDriver}`) ?? null)
                : null,
              time: text(fastest.time),
            }
          : null,
    });
  }
  return out;
}

/** IDs do fornecedor → participantes nossos (mesmo esporte; os IDs das duas fontes não colidem). */
async function providerIds(db: Database, sport: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ providerId: providerMap.providerId, entityId: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        inArray(providerMap.provider, RACE_PROVIDERS),
        eq(providerMap.sport, sport),
        eq(providerMap.entityType, 'participant'),
        inArray(providerMap.providerId, [...new Set(ids)]),
      ),
    );
  return new Map(rows.map((r) => [r.providerId, r.entityId]));
}

export type RaceTeams = Map<
  string,
  { id: string; name: string; logo: string | null; colors: TeamColors | null }
>;

/** Equipes (construtores) citadas nos resultados, pelo ID do fornecedor, com o escudo do nosso cadastro. */
export async function loadRaceTeams(
  db: Database,
  sport: string,
  results: unknown[],
  assetsBaseUrl: string | undefined,
  customLogos = false,
): Promise<RaceTeams> {
  const ids = [...new Set(results.map((r) => text(obj(obj(r).team).id)).filter((x): x is string => !!x))];
  const map = await providerIds(db, sport, ids);
  if (!map.size) return new Map();
  const rows = await db
    .select({
      id: participant.id,
      name: participant.name,
      key: asset.storageKey,
      url: asset.sourceUrl,
      palette: asset.palette,
    })
    .from(participant)
    .leftJoin(asset, eq(asset.id, teamLogoId(customLogos)))
    .where(inArray(participant.id, [...new Set(map.values())]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: RaceTeams = new Map();
  for (const [providerId, id] of map) {
    const r = byId.get(id);
    if (r)
      out.set(providerId, {
        id,
        name: r.name,
        logo: assetUrl(assetsBaseUrl, r.key, r.url),
        colors: teamColors(r.palette),
      });
  }
  return out;
}

/** `event_participant.result` (normalizador da F1) → resultado público do participante. */
export function raceResult(raw: unknown, teams: RaceTeams): ParticipantResult | null {
  const r = obj(raw);
  if (!Object.keys(r).length) return null;
  const team = obj(r.team);
  const teamName = text(team.name);
  const known = teams.get(text(team.id) ?? '');
  return {
    time: text(r.time) ?? text(r.qualifying_time),
    gap: text(r.gap),
    laps: int(r.laps),
    grid: int(r.grid),
    pits: int(r.pits),
    team: known
      ? { id: known.id, name: known.name, logo: known.logo }
      : teamName
        ? { id: null, name: teamName, logo: null }
        : null,
  };
}

/**
 * IDs de fornecedor de um construtor nas fontes da F1. Pode haver mais de um por fonte: o F1DB separa fases de
 * uma equipe que a api-sports mantém numa só (RB 2024–25 e Racing Bulls 2026).
 */
export async function constructorProviderIds(db: Database, participantId: string): Promise<string[]> {
  const rows = await db
    .select({ providerId: providerMap.providerId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.entityType, 'participant'),
        eq(providerMap.entityId, participantId),
        inArray(providerMap.provider, RACE_PROVIDERS),
      ),
    );
  return rows.map((r) => r.providerId);
}

/**
 * Sessões de uma equipe (construtor): ela não corre, os pilotos dela sim. O vínculo é a equipe no resultado de
 * cada piloto (`result.team.id`, ID do fornecedor de cada fonte), dentro do esporte para não varrer os outros.
 */
export function constructorEvents(
  db: Database,
  sport: string,
  teamProviderIds: string[],
  where: SQL | undefined,
  order: 'asc' | 'desc',
  limit: number,
) {
  return db
    .selectDistinct({ id: event.id, startsAt: event.startsAt })
    .from(event)
    .innerJoin(eventParticipant, eq(eventParticipant.eventId, event.id))
    .where(
      and(
        eq(event.sport, sport),
        eq(eventParticipant.side, 'grid'),
        inArray(sql<string>`${eventParticipant.result} -> 'team' ->> 'id'`, teamProviderIds),
        where,
      ),
    )
    .orderBy(order === 'asc' ? asc(event.startsAt) : desc(event.startsAt), asc(event.id))
    .limit(limit);
}
