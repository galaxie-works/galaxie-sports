/**
 * Painel do cliente da Gamificação (#917), só leitura e gravação do que o cliente controla: os programas (um por
 * país-alvo), as Conquistas do Catálogo que ele liga ou desliga, e o relatório do programa. Tudo filtrado pelo tenant
 * da sessão; o Catálogo é da Galaxie e aqui só se lê.
 */
export {
  listFraudSignals,
  listProfileFreezes,
  releaseProfileFreeze,
  reviewFraudSignal,
  fanNicknames,
  type FraudSignalView,
} from './game-fraud.js';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { appendGameAudit, type GameProgramKey } from './game.js';
import { tenantCountry } from './schema/engage.js';
import { gameProgram, gameProgramAchievement, type GameI18n } from './schema/game.js';

export { ensureGameProgram } from './game.js';

export interface GameProgramView {
  country: string;
  /** O país é o principal do cliente. */
  primary: boolean;
  /** Programa já existe (nasce no primeiro torcedor ou quando o cliente ativa). */
  active: boolean;
  status: 'active' | 'paused' | null;
  ruleVersion: number | null;
  timeZone: string | null;
}

/** Países-alvo do cliente com o estado do programa em cada um. Programa sem país cadastrado também aparece. */
export async function listGamePrograms(db: Database, tenantId: string): Promise<GameProgramView[]> {
  const [countries, programs] = await Promise.all([
    db
      .select({ country: tenantCountry.country, primary: tenantCountry.isPrimary })
      .from(tenantCountry)
      .where(eq(tenantCountry.tenantId, tenantId)),
    db
      .select({
        country: gameProgram.programCountry,
        status: gameProgram.status,
        ruleVersion: gameProgram.ruleVersion,
        timeZone: gameProgram.timeZone,
      })
      .from(gameProgram)
      .where(eq(gameProgram.tenantId, tenantId)),
  ]);
  const byCountry = new Map(programs.map((p) => [p.country, p]));
  const all = new Set([...countries.map((c) => c.country), ...programs.map((p) => p.country)]);
  return [...all]
    .map((country) => {
      const p = byCountry.get(country);
      return {
        country,
        primary: countries.some((c) => c.country === country && c.primary),
        active: !!p,
        status: p?.status ?? null,
        ruleVersion: p?.ruleVersion ?? null,
        timeZone: p?.timeZone ?? null,
      };
    })
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.country.localeCompare(b.country));
}

export interface GameCatalogItemView {
  id: string;
  sport: string | null;
  category: string;
  family: string;
  name: GameI18n;
  description: GameI18n;
  /** Ligada pela Galaxie no Catálogo (dado disponível). */
  available: boolean;
  inactiveReason: string | null;
  /** Ligada no programa do cliente (sem linha do cliente, vale o Catálogo). */
  enabled: boolean;
  thresholds: number[];
  /** Torcedores do programa com o primeiro Degrau. */
  holders: number;
}

/** Catálogo da Galaxie com o estado no programa do cliente e quantos torcedores já têm cada Conquista. */
export async function listGameCatalog(db: Database, key: GameProgramKey): Promise<GameCatalogItemView[]> {
  const rows = await db.execute<{
    id: string;
    sport: string | null;
    category: string;
    family: string;
    name: GameI18n;
    description: GameI18n;
    active: boolean;
    inactive_reason: string | null;
    enabled: boolean | null;
    thresholds: number[] | null;
    catalog_thresholds: number[];
    holders: string;
  }>(sql`
    select a.id, a.sport, a.category, a.family, a.name, a.description, a.active, a.inactive_reason,
           pa.enabled, pa.thresholds,
           array(select s.threshold from game.catalog_step s where s.achievement_id = a.id order by s.step) as catalog_thresholds,
           (select count(*) from game.step_grant g
             where g.tenant_id = ${key.tenantId} and g.program_country = ${key.programCountry}
               and g.achievement_id = a.id and g.season = 'all' and g.step = 1) as holders
      from game.catalog_achievement a
      left join game.program_achievement pa
        on pa.tenant_id = ${key.tenantId} and pa.program_country = ${key.programCountry} and pa.achievement_id = a.id
     order by a.family, a.id`);
  return rows.map((r) => ({
    id: r.id,
    sport: r.sport,
    category: r.category,
    family: r.family,
    name: r.name,
    description: r.description,
    available: r.active,
    inactiveReason: r.inactive_reason,
    enabled: r.enabled ?? true,
    // por Degrau, como o motor (`activeAchievements`): o limite do cliente onde houver, senão o do Catálogo
    thresholds: r.catalog_thresholds.map((t, i) => r.thresholds?.[i] ?? t),
    holders: Number(r.holders),
  }));
}

/** Liga ou desliga uma Conquista do Catálogo no programa. Guarda a versão de regra vigente e audita. */
export async function setGameAchievementEnabled(
  db: Database,
  key: GameProgramKey & { achievementId: string; enabled: boolean; changedBy: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [program] = await tx
      .select({ ruleVersion: gameProgram.ruleVersion })
      .from(gameProgram)
      .where(and(eq(gameProgram.tenantId, key.tenantId), eq(gameProgram.programCountry, key.programCountry)));
    if (!program) return false;
    const [exists] = await tx.execute<{ ok: number }>(
      sql`select 1 as ok from game.catalog_achievement where id = ${key.achievementId}`,
    );
    if (!exists) return false;
    await tx
      .insert(gameProgramAchievement)
      .values({
        tenantId: key.tenantId,
        programCountry: key.programCountry,
        achievementId: key.achievementId,
        enabled: key.enabled,
        ruleVersion: program.ruleVersion,
      })
      .onConflictDoUpdate({
        target: [
          gameProgramAchievement.tenantId,
          gameProgramAchievement.programCountry,
          gameProgramAchievement.achievementId,
        ],
        set: { enabled: key.enabled, ruleVersion: program.ruleVersion, updatedAt: sql`now()` as never },
      });
    await appendGameAudit(tx, {
      tenantId: key.tenantId,
      programCountry: key.programCountry,
      kind: 'program.achievement_changed',
      subject: `achievement:${key.achievementId}`,
      ruleVersion: program.ruleVersion,
      detail: { enabled: key.enabled, by: key.changedBy },
    });
    return true;
  });
}

export interface GameProgramReport {
  /** Torcedores com Pontos no programa. */
  fans: number;
  /** Palpites feitos e fechados (com o resultado). */
  predictions: number;
  predictionsFinal: number;
  /** Degraus e Cartas concedidos. */
  steps: number;
  cards: number;
  /** Pontos emitidos pela Gamificação no programa. */
  pointsIssued: number;
}

export async function gameProgramReport(db: Database, key: GameProgramKey): Promise<GameProgramReport> {
  const [r] = await db.execute<{
    fans: string;
    predictions: string;
    predictions_final: string;
    steps: string;
    cards: string;
    points: string;
  }>(sql`
    select
      (select count(*) from fan.wallet w
        where w.tenant_id = ${key.tenantId} and w.program_country = ${key.programCountry} and w.points > 0) as fans,
      (select count(*) from game.prediction p
        where p.tenant_id = ${key.tenantId} and p.program_country = ${key.programCountry}) as predictions,
      (select count(*) from game.prediction p
        where p.tenant_id = ${key.tenantId} and p.program_country = ${key.programCountry} and p.state = 'final') as predictions_final,
      (select count(*) from game.step_grant g
        where g.tenant_id = ${key.tenantId} and g.program_country = ${key.programCountry} and g.season = 'all') as steps,
      (select count(*) from game.card_grant c
        where c.tenant_id = ${key.tenantId} and c.program_country = ${key.programCountry} and c.season = 'all') as cards,
      (select coalesce(sum(l.points_delta), 0) from fan.points_ledger l
        where l.tenant_id = ${key.tenantId} and l.program_country = ${key.programCountry}
          and l.source = 'gamification') as points`);
  return {
    fans: Number(r?.fans ?? 0),
    predictions: Number(r?.predictions ?? 0),
    predictionsFinal: Number(r?.predictions_final ?? 0),
    steps: Number(r?.steps ?? 0),
    cards: Number(r?.cards ?? 0),
    pointsIssued: Number(r?.points ?? 0),
  };
}

/**
 * O país pode virar programa deste cliente? Com países-alvo cadastrados, só eles; sem nenhum, qualquer país (a API
 * usa o país do Perfil nesse caso).
 */
export async function gameCountryAllowed(db: Database, tenantId: string, country: string): Promise<boolean> {
  const rows = await db
    .select({ country: tenantCountry.country })
    .from(tenantCountry)
    .where(eq(tenantCountry.tenantId, tenantId));
  return rows.length === 0 || rows.some((r) => r.country === country);
}
