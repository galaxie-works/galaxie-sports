/**
 * Gamificação (#904, #905): serviço mínimo do schema `game` que os outros pedaços usam. Programa (cliente + país) com
 * a primeira versão de regra, troca de regra que só vale para o que vem depois, registro de auditoria só de acréscimo
 * e a exclusão do torcedor. Pontos continuam na carteira da base (`fan-wallet`, #938).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  gameAchievementProgress,
  gameAuditLog,
  gameCardGrant,
  gameParticipationDaily,
  gamePeriodPoints,
  gamePrediction,
  gameProgram,
  gameRuleVersion,
  gameStepGrant,
  type GameAuditKind,
} from './schema/game.js';

type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

export interface GameProgramKey {
  tenantId: string;
  programCountry: string;
}

/**
 * Cria o programa do cliente no país, com a versão 1 das regras, se ainda não existir. Devolve a versão vigente.
 * `rules` é a escala de Pontos da Galaxie da época (`DEFAULT_POINTS_SCALE` do `@galaxie/game-rules`) e o que o
 * programa acrescentar.
 */
export async function ensureGameProgram(
  db: Database,
  key: GameProgramKey & { timeZone: string; rules: Record<string, unknown>; changedBy: string },
): Promise<number> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(gameProgram)
      .values({ tenantId: key.tenantId, programCountry: key.programCountry, timeZone: key.timeZone })
      .onConflictDoNothing()
      .returning({ ruleVersion: gameProgram.ruleVersion });
    if (inserted.length > 0) {
      await tx.insert(gameRuleVersion).values({
        tenantId: key.tenantId,
        programCountry: key.programCountry,
        version: 1,
        rules: key.rules,
        changedBy: key.changedBy,
      });
      await appendGameAudit(tx, {
        ...key,
        kind: 'program.rules_changed',
        subject: 'rule_version:1',
        ruleVersion: 1,
        detail: { created: true },
      });
      return 1;
    }
    const [row] = await tx
      .select({ ruleVersion: gameProgram.ruleVersion })
      .from(gameProgram)
      .where(and(eq(gameProgram.tenantId, key.tenantId), eq(gameProgram.programCountry, key.programCountry)));
    return row!.ruleVersion;
  });
}

/**
 * Troca as regras do programa: grava a versão nova e passa a apontar para ela. Nada já ganho muda, porque Palpite,
 * Degrau, Carta e auditoria guardam a versão da época.
 */
export async function changeGameRules(
  db: Database,
  key: GameProgramKey & { rules: Record<string, unknown>; changedBy: string; note?: string },
): Promise<number> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(gameProgram)
      .set({ ruleVersion: sql`${gameProgram.ruleVersion} + 1`, updatedAt: sql`now()` as never })
      .where(and(eq(gameProgram.tenantId, key.tenantId), eq(gameProgram.programCountry, key.programCountry)))
      .returning({ ruleVersion: gameProgram.ruleVersion });
    if (!row) throw new Error(`programa ${key.programCountry} não existe neste cliente`);
    await tx.insert(gameRuleVersion).values({
      tenantId: key.tenantId,
      programCountry: key.programCountry,
      version: row.ruleVersion,
      rules: key.rules,
      changedBy: key.changedBy,
      note: key.note ?? null,
    });
    await appendGameAudit(tx, {
      ...key,
      kind: 'program.rules_changed',
      subject: `rule_version:${row.ruleVersion}`,
      ruleVersion: row.ruleVersion,
      detail: key.note ? { note: key.note } : {},
    });
    return row.ruleVersion;
  });
}

/** Linha nova no registro de auditoria (nunca muda nem sai). */
export async function appendGameAudit(
  tx: Executor,
  entry: GameProgramKey & {
    kind: GameAuditKind;
    subject: string;
    profileId?: string | null;
    sourceEvent?: string | null;
    ruleVersion?: number | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(gameAuditLog).values({
    tenantId: entry.tenantId,
    programCountry: entry.programCountry,
    profileId: entry.profileId ?? null,
    kind: entry.kind,
    subject: entry.subject,
    sourceEvent: entry.sourceEvent ?? null,
    ruleVersion: entry.ruleVersion ?? null,
    detail: entry.detail ?? {},
  });
}

/**
 * Exclusão do torcedor (#937): Palpites, soma do Ranking, progresso, Degraus, Cartas e participação saem na mesma
 * transação do `eraseFan`. O registro de auditoria fica, com o id interno do Perfil, que já não liga a ninguém.
 */
export async function eraseGame(tx: Executor, tenantId: string, profileId: string): Promise<void> {
  for (const table of [
    gamePrediction,
    gamePeriodPoints,
    gameAchievementProgress,
    gameStepGrant,
    gameCardGrant,
    gameParticipationDaily,
  ] as const) {
    await tx.delete(table).where(and(eq(table.tenantId, tenantId), eq(table.profileId, profileId)));
  }
}
