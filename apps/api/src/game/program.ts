/**
 * Programa da Gamificação do torcedor (#904): cliente + país. O país é o do Perfil quando o cliente atende esse país
 * (`engage.tenant_country`); senão, o país principal do cliente. Cliente sem país cadastrado usa o do Perfil. O
 * programa nasce no primeiro uso, com a escala de Pontos da Galaxie em vigor.
 */
import { ensureGameProgram, tenant, tenantCountry, type Database } from '@galaxie/db';
import { DEFAULT_POINTS_SCALE, countryTimeZone } from '@galaxie/game-rules';
import { eq, sql } from 'drizzle-orm';

export interface GameProgram {
  tenantId: string;
  programCountry: string;
  ruleVersion: number;
  timeZone: string;
}

/** O cliente tem o módulo Gamificação ligado e está ativo? */
export async function tenantHasGamification(db: Database, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ ok: sql<boolean>`'gamification' = any(${tenant.modules}) and ${tenant.status} = 'active'` })
    .from(tenant)
    .where(eq(tenant.id, tenantId))
    .limit(1);
  return row?.ok === true;
}

export async function programCountryFor(
  db: Database,
  tenantId: string,
  profileCountry: string,
): Promise<string> {
  const countries = await db
    .select({ country: tenantCountry.country, primary: tenantCountry.isPrimary })
    .from(tenantCountry)
    .where(eq(tenantCountry.tenantId, tenantId));
  if (countries.length === 0 || countries.some((c) => c.country === profileCountry)) return profileCountry;
  return (countries.find((c) => c.primary) ?? countries[0]!).country;
}

export async function resolveProgram(
  db: Database,
  tenantId: string,
  profileCountry: string,
): Promise<GameProgram> {
  const programCountry = await programCountryFor(db, tenantId, profileCountry);
  const timeZone = countryTimeZone(programCountry);
  const ruleVersion = await ensureGameProgram(db, {
    tenantId,
    programCountry,
    timeZone,
    rules: { scale: { ...DEFAULT_POINTS_SCALE } },
    changedBy: 'system',
  });
  return { tenantId, programCountry, ruleVersion, timeZone };
}
