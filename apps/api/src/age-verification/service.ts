/**
 * Verificação de idade feita pela Galaxie (#1109): abrir a sessão no provedor e aplicar a decisão que chega pelo
 * webhook. A rota fica em `routes.ts`; a leitura da decisão em `@galaxie/engage` (`diditOutcome`).
 *
 * Aplicar a decisão, numa transação com a linha da sessão travada:
 * 1. grava estado, caminho e faixa na `fan.age_verification` (idempotente pelo `event_id` do provedor);
 * 2. aprovada: sobe a comprovação do Perfil (`age_assurance`) para `estimated` ou `verified`, com o provedor
 *    `galaxie:didit`, mas só em Perfil adulto e não congelado (destravar a faixa congelada é o #1110) e nunca para
 *    baixo (quem já mandou `verified` continua `verified`);
 * 3. cobrável e ainda não medida: marca `metered_at`; a soma no medidor vai depois do commit.
 *
 * Decidida de vez (não `review`), os dados saem do provedor na hora (`purge`); falhou, fica para a varredura.
 */
import { AGE_CHECK_MIN_AGE, diditOutcome, type AgeCheckOutcome, type AgeCheckPath } from '@galaxie/engage';
import {
  auditFanEvent,
  fanAgeVerification,
  fanProfile,
  type Database,
  type FanAgeAssurance,
} from '@galaxie/db';
import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { ModuleUsageMeter } from '../engage/module-usage.js';
import { clocksFrom, policyForFan } from '../engage/moderation-routes.js';
import type { DiditClient, DiditWebhookEvent } from './didit.js';

/** Nome do provedor gravado no Perfil: o prefixo `galaxie:` diz que a verificação é nossa (o cliente não o usa). */
export const GALAXIE_DIDIT_PROVIDER = 'galaxie:didit';
/** Verificações abertas por Perfil em 24 h (o provedor cobra cada uma que o torcedor faz). */
export const AGE_VERIFICATION_DAILY_LIMIT = 5;

const RANK: Record<FanAgeAssurance, number> = { self: 0, estimated: 1, verified: 2 };

export interface AgeVerificationRow {
  id: string;
  status: string;
  path: AgeCheckPath | null;
  resultBand: string | null;
  method: 'estimated' | 'verified' | null;
  decidedAt: Date | null;
  createdAt: Date;
}

/** Verificações abertas pelo Perfil nas últimas 24 h. */
export async function openedToday(
  db: Database,
  tenantId: string,
  profileId: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(fanAgeVerification)
    .where(
      and(
        eq(fanAgeVerification.tenantId, tenantId),
        eq(fanAgeVerification.profileId, profileId),
        gte(fanAgeVerification.createdAt, new Date(now.getTime() - 86_400_000)),
      ),
    );
  return row?.n ?? 0;
}

export async function startAgeVerification(
  db: Database,
  client: DiditClient,
  input: {
    tenantId: string;
    profileId: string;
    language: string;
    returnUrl: string;
    consent: { givenAt: Date; textVersion: string };
    now: Date;
  },
): Promise<{ id: string; url: string; expiresAt: Date; createdAt: Date }> {
  // a referência que vai ao provedor é o id da linha: nada do torcedor sai daqui
  const id = randomUUID();
  const session = await client.createSession(
    { ref: id, language: input.language, returnUrl: input.returnUrl, consent: input.consent },
    input.now,
  );
  const [row] = await db
    .insert(fanAgeVerification)
    .values({
      tenantId: input.tenantId,
      id,
      profileId: input.profileId,
      provider: 'didit',
      providerSessionId: session.sessionId,
      expiresAt: session.expiresAt,
    })
    .returning({ createdAt: fanAgeVerification.createdAt });
  return { id, url: session.url, expiresAt: session.expiresAt, createdAt: row!.createdAt };
}

/** Última verificação do Perfil (null sem nenhuma). */
export async function latestAgeVerification(
  db: Database,
  tenantId: string,
  profileId: string,
): Promise<AgeVerificationRow | null> {
  const [row] = await db
    .select({
      id: fanAgeVerification.id,
      status: fanAgeVerification.status,
      path: fanAgeVerification.path,
      resultBand: fanAgeVerification.resultBand,
      decidedAt: fanAgeVerification.decidedAt,
      createdAt: fanAgeVerification.createdAt,
    })
    .from(fanAgeVerification)
    .where(and(eq(fanAgeVerification.tenantId, tenantId), eq(fanAgeVerification.profileId, profileId)))
    .orderBy(desc(fanAgeVerification.createdAt))
    .limit(1);
  if (!row) return null;
  const method = row.status === 'approved' ? (row.path === 'document' ? 'verified' : 'estimated') : null;
  return { ...row, method };
}

export type ApplyResult =
  | { outcome: 'unknown' | 'duplicate' | 'final' }
  | { outcome: 'applied'; status: AgeCheckOutcome['status']; profileUpdated: boolean; purge: boolean };

/**
 * Aplica um evento do webhook. A decisão vem sempre da API do provedor, nunca do corpo do webhook. Sessão que não é
 * nossa (ou com a referência trocada) é ignorada; evento repetido também.
 */
export async function applyDiditEvent(
  db: Database,
  client: DiditClient,
  event: DiditWebhookEvent,
  opts: { workflowId: string; meter?: ModuleUsageMeter | undefined; now: Date },
): Promise<ApplyResult> {
  const [found] = await db
    .select({
      tenantId: fanAgeVerification.tenantId,
      id: fanAgeVerification.id,
      status: fanAgeVerification.status,
      lastEventId: fanAgeVerification.lastEventId,
    })
    .from(fanAgeVerification)
    .where(
      and(
        eq(fanAgeVerification.provider, 'didit'),
        eq(fanAgeVerification.providerSessionId, event.sessionId),
      ),
    )
    .limit(1);
  if (!found || (event.vendorData !== null && event.vendorData !== found.id)) return { outcome: 'unknown' };
  if (found.lastEventId === event.eventId) return { outcome: 'duplicate' };
  // decidida de vez: só `pending` e `review` ainda mudam
  if (found.status !== 'pending' && found.status !== 'review') return { outcome: 'final' };

  const outcome = diditOutcome(await client.decision(event.sessionId), {
    workflowId: opts.workflowId,
    now: opts.now,
  });

  const done = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: fanAgeVerification.status,
        lastEventId: fanAgeVerification.lastEventId,
        meteredAt: fanAgeVerification.meteredAt,
        profileId: fanAgeVerification.profileId,
      })
      .from(fanAgeVerification)
      .where(and(eq(fanAgeVerification.tenantId, found.tenantId), eq(fanAgeVerification.id, found.id)))
      .for('update');
    if (!row || row.lastEventId === event.eventId) return null;
    if (row.status !== 'pending' && row.status !== 'review') return null;

    const decided = outcome.status !== 'pending';
    const meter = outcome.billable && row.meteredAt === null && outcome.path !== null ? outcome.path : null;
    await tx
      .update(fanAgeVerification)
      .set({
        status: outcome.status,
        path: outcome.path,
        resultBand: outcome.band,
        lastEventId: event.eventId,
        decidedAt: decided ? opts.now : null,
        ...(meter ? { meteredAt: opts.now } : {}),
        updatedAt: sql`now()`,
      })
      .where(and(eq(fanAgeVerification.tenantId, found.tenantId), eq(fanAgeVerification.id, found.id)));

    let profileUpdated = false;
    if (outcome.status === 'approved' && outcome.method && outcome.band === '18plus') {
      const [profile] = await tx
        .select({
          ageBand: fanProfile.ageBand,
          ageFrozenAt: fanProfile.ageFrozenAt,
          ageAssurance: fanProfile.ageAssurance,
          country: fanProfile.country,
        })
        .from(fanProfile)
        .where(
          and(
            eq(fanProfile.tenantId, found.tenantId),
            eq(fanProfile.id, row.profileId),
            isNull(fanProfile.deletedAt),
          ),
        )
        .for('update');
      // só confirma adulto declarado e solto; nunca rebaixa a comprovação que o Perfil já tem
      if (
        profile &&
        profile.ageBand === '18plus' &&
        profile.ageFrozenAt === null &&
        RANK[outcome.method] > RANK[profile.ageAssurance]
      ) {
        await tx
          .update(fanProfile)
          .set({
            ageAssurance: outcome.method,
            ageAssuranceAt: opts.now,
            ageAssuranceProvider: GALAXIE_DIDIT_PROVIDER,
            updatedAt: sql`now()`,
          })
          .where(and(eq(fanProfile.tenantId, found.tenantId), eq(fanProfile.id, row.profileId)));
        profileUpdated = true;
        const policy = await policyForFan(db, found.tenantId, profile.country);
        if (policy)
          await auditFanEvent(tx, {
            tenantId: found.tenantId,
            actor: { id: 'galaxie:age-verification', kind: 'system' },
            action: 'age.assured',
            clocks: clocksFrom(policy, opts.now),
            subjectProfileId: row.profileId,
            reason: 'verificação de idade da Galaxie',
            rules: { method: outcome.method, provider: GALAXIE_DIDIT_PROVIDER, minAge: AGE_CHECK_MIN_AGE },
          });
      }
    }
    return { meter, profileUpdated };
  });
  if (!done) return { outcome: 'duplicate' };

  if (done.meter && opts.meter)
    await opts.meter.add(
      found.tenantId,
      'age_verification',
      done.meter === 'document' ? 'age_checks_document' : 'age_checks_estimate',
      1,
      opts.now,
    );
  const purge = outcome.status !== 'pending' && outcome.status !== 'review';
  return { outcome: 'applied', status: outcome.status, profileUpdated: done.profileUpdated, purge };
}

/** Apaga a sessão no provedor e marca `purged_at`. Falhou ou ficou para depois: devolve false (a varredura tenta). */
export async function purgeAgeVerification(
  db: Database,
  client: DiditClient,
  sessionId: string,
  now: Date,
): Promise<boolean> {
  if (!(await client.purge(sessionId))) return false;
  await db
    .update(fanAgeVerification)
    .set({ purgedAt: now, updatedAt: sql`now()` })
    .where(
      and(eq(fanAgeVerification.provider, 'didit'), eq(fanAgeVerification.providerSessionId, sessionId)),
    );
  return true;
}
