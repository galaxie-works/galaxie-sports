import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Person } from '@galaxie/contracts';
import { asset, participant, person, providerMap, roster, season, type Database } from '@galaxie/db';
import { problems } from '../errors.js';
import { assetUrl } from '../util.js';

/** Idade completa em anos numa data (UTC). */
export function ageAt(birthDate: string | null, now: Date): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Pessoas com a foto (espelhada ou de origem), para as listas de elenco. */
export async function selectPeople(db: Database, ids: string[]) {
  if (!ids.length) return [];
  return db
    .select({
      id: person.id,
      name: person.name,
      nationality: person.nationality,
      birthDate: person.birthDate,
      photoKey: asset.storageKey,
      photoUrl: asset.sourceUrl,
    })
    .from(person)
    .leftJoin(asset, eq(asset.id, person.photoAssetId))
    .where(inArray(person.id, [...new Set(ids)]));
}

/** `GET /v1/people/{id}`: dados pessoais, foto, times dos elencos e IDs externos. */
export async function loadPerson(
  db: Database,
  assetsBaseUrl: string | undefined,
  now: Date,
  id: string,
): Promise<Person> {
  const [row] = await db
    .select({ p: person, key: asset.storageKey, url: asset.sourceUrl })
    .from(person)
    .leftJoin(asset, eq(asset.id, person.photoAssetId))
    .where(eq(person.id, id))
    .limit(1);
  if (!row) throw problems.notFound('Pessoa');
  const teams = await db
    .select({
      r: roster,
      team: { id: participant.id, name: participant.name, shortName: participant.shortName },
      logoKey: asset.storageKey,
      logoUrl: asset.sourceUrl,
      seasonYear: season.year,
    })
    .from(roster)
    .innerJoin(participant, eq(participant.id, roster.participantId))
    .leftJoin(asset, eq(asset.id, participant.logoAssetId))
    .leftJoin(season, eq(season.id, roster.seasonId))
    .where(eq(roster.personId, row.p.id))
    .orderBy(sql`${season.year} desc nulls first`, asc(participant.name));
  const ids = await db
    .select({ provider: providerMap.provider, providerId: providerMap.providerId })
    .from(providerMap)
    .where(and(eq(providerMap.entityType, 'person'), eq(providerMap.entityId, row.p.id)));
  return {
    id: row.p.id,
    name: row.p.name,
    first_name: row.p.firstName,
    last_name: row.p.lastName,
    birth_date: row.p.birthDate,
    age: ageAt(row.p.birthDate, now),
    nationality: row.p.nationality,
    height_cm: row.p.heightCm,
    weight_kg: row.p.weightKg,
    photo: assetUrl(assetsBaseUrl, row.key, row.url),
    teams: teams.map((t) => ({
      team: {
        id: t.team.id,
        name: t.team.name,
        short_name: t.team.shortName,
        logo: assetUrl(assetsBaseUrl, t.logoKey, t.logoUrl),
      },
      role: t.r.role,
      number: t.r.number,
      position: t.r.position,
      season: t.seasonYear ?? null,
    })),
    external_ids: Object.fromEntries(ids.map((i) => [i.provider, i.providerId])),
  };
}
