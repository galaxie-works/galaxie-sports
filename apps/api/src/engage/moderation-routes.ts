/**
 * Moderação do torcedor (#953, B8, docs/05 §9), com o token `gft_`:
 *
 * - `POST /v1/moderation/reports`: denúncia, que entra na fila única do cliente;
 * - `GET /v1/fans/me/blocks`, `PUT` e `DELETE /v1/fans/me/blocks/{perfil}`: bloqueio entre torcedores;
 * - `GET /v1/fans/me/sanctions`: punições do Perfil (o Silêncio oculto não aparece);
 * - `POST /v1/fans/me/sanctions/{punição}/appeals`: apelação.
 *
 * As regras (gravidade, quando ocultar, para onde vai a apelação, os relógios da ficha do país) vêm de
 * `@galaxie/engage`; a gravação, de `@galaxie/db`. A fila em si é lida e decidida pelo painel do cliente.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  FanAppealBody,
  FanBlockParams,
  FanSanctionParams,
  ModerationReportBody,
  type FanAppealResponse,
  type FanBlocks,
  type FanSanctions,
  type ModerationReportResponse,
} from '@galaxie/contracts';
import {
  appealJudges,
  appealsForSanctions,
  blockFan,
  countryPolicy,
  fanProfile,
  fileAppeal,
  fileReport,
  listBlocks,
  readAppeal,
  sanctionsForFan,
  tenantCountry,
  tenantMember,
  tenantRolePermission,
  unblockFan,
  type Database,
  type ModerationClocks,
} from '@galaxie/db';
import {
  APPEAL_DUE_DEFAULT_H,
  REASON_SEVERITY,
  REPORTS_PER_HOUR,
  appealRoute,
  caseSeverity,
  hideThreshold,
  isTenantRole,
  normalizeOverrides,
  resolvePolicy,
  retentionDeadlines,
  roleAllows,
  sanctionActive,
  shouldHide,
  type CountryPolicy,
  type PolicyHardening,
  type ReportReason,
  type RoleOverrides,
} from '@galaxie/engage';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { problems } from '../errors.js';
import { parseInput } from '../util.js';
import { fanCan } from './fan-rules.js';
import { readFan } from './fans.js';

export interface ModerationRoutesDeps {
  db: Database | undefined;
  now?: (() => Date) | undefined;
}

/** Relógios da ficha que vale para o torcedor; sem ficha, recusa (o módulo não guarda o que não sabe apagar). */
async function clocksFor(
  db: Database,
  tenantId: string,
  fanCountry: string,
  at: Date,
): Promise<ModerationClocks> {
  const [policies, countries] = await Promise.all([
    db.select({ country: countryPolicy.country, policy: countryPolicy.policy }).from(countryPolicy),
    db
      .select({
        country: tenantCountry.country,
        primary: tenantCountry.isPrimary,
        hardening: tenantCountry.hardening,
      })
      .from(tenantCountry)
      .where(eq(tenantCountry.tenantId, tenantId)),
  ]);
  const resolved = resolvePolicy(
    fanCountry,
    new Map(policies.map((p) => [p.country, p.policy as unknown as CountryPolicy])),
    countries.map((c) => ({
      country: c.country,
      primary: c.primary,
      hardening: (c.hardening as PolicyHardening | null) ?? null,
    })),
  );
  if (!resolved) throw problems.degraded('Ficha do país não configurada para este cliente.');
  const d = retentionDeadlines(resolved.policy, at.getTime());
  return { contentPurgeAt: new Date(d.contentPurgeAt), decisionPurgeAt: new Date(d.decisionPurgeAt) };
}

/** Alguém da equipe do cliente (pessoa do console, com convite aceito) pode julgar a segunda apelação? */
async function teamCanJudgeSecond(db: Database, tenantId: string): Promise<boolean> {
  const [members, perms] = await Promise.all([
    db
      .select({ role: tenantMember.role })
      .from(tenantMember)
      .where(
        and(
          eq(tenantMember.tenantId, tenantId),
          isNotNull(tenantMember.userId),
          isNotNull(tenantMember.acceptedAt),
        ),
      ),
    db
      .select({
        role: tenantRolePermission.role,
        action: tenantRolePermission.action,
        allowed: tenantRolePermission.allowed,
      })
      .from(tenantRolePermission)
      .where(eq(tenantRolePermission.tenantId, tenantId)),
  ]);
  const raw: RoleOverrides = {};
  for (const p of perms) {
    if (!isTenantRole(p.role)) continue;
    (raw[p.role] ??= {})[p.action as keyof NonNullable<RoleOverrides[typeof p.role]>] = p.allowed;
  }
  const overrides = normalizeOverrides(raw);
  return members.some(
    (m) => isTenantRole(m.role) && roleAllows(m.role, 'moderation.appeal.second', overrides),
  );
}

export async function moderationRoutes(app: FastifyInstance, deps: ModerationRoutesDeps): Promise<void> {
  const db = () => {
    if (!deps.db) throw problems.degraded('Banco de dados não configurado.');
    return deps.db;
  };
  const now = () => deps.now?.() ?? new Date();

  /** Torcedor do token, com Perfil ativo e faixa que participa (menor de 13 fica fora, D1). */
  async function activeFan(request: FastifyRequest) {
    const fan = request.fan!;
    if (!fanCan(fan.ageBand, 'read'))
      throw problems.fanAgeRestricted('Perfis com menos de 13 anos não usam os recursos sociais.');
    const profile = await readFan(db(), fan.tenantId, fan.profileId);
    if (!profile) throw problems.invalidFanToken('Perfil excluído.');
    return { fan, profile };
  }

  /** O Perfil existe e é do mesmo cliente (e não foi excluído)? */
  async function profileExists(tenantId: string, profileId: string) {
    const [row] = await db()
      .select({ id: fanProfile.id })
      .from(fanProfile)
      .where(
        and(eq(fanProfile.tenantId, tenantId), eq(fanProfile.id, profileId), isNull(fanProfile.deletedAt)),
      );
    return row !== undefined;
  }

  app.post('/v1/moderation/reports', { config: { fan: true } }, async (request, reply) => {
    const { fan, profile } = await activeFan(request);
    const body = parseInput(ModerationReportBody, request.body);
    if (body.targetProfileId && !(await profileExists(fan.tenantId, body.targetProfileId)))
      throw problems.notFound('Perfil');
    const at = now();
    const res = await fileReport(db(), {
      tenantId: fan.tenantId,
      targetType: body.targetType,
      targetId: body.targetId,
      targetProfileId: body.targetType === 'profile' ? body.targetId : (body.targetProfileId ?? null),
      module: body.module,
      room: body.room ?? null,
      community: body.community ?? null,
      reporterProfileId: fan.profileId,
      reason: body.reason,
      note: body.note ?? null,
      // o texto denunciado vem do módulo (chat, mural), nunca do torcedor que denuncia
      content: null,
      clocks: await clocksFor(db(), fan.tenantId, profile.country, at),
      rules: {
        perHour: REPORTS_PER_HOUR,
        hideAt: hideThreshold(null),
        hides: shouldHide(body.targetType, Number.MAX_SAFE_INTEGER, 1),
        severity: (reasons, reports) => caseSeverity(reasons as ReportReason[], reports),
      },
      now: at,
    });
    if (!res.ok) {
      if (res.reason === 'rate_limited') throw problems.rateLimited(3600);
      throw problems.conflict('Não dá para denunciar o próprio conteúdo.');
    }
    reply.header('cache-control', 'no-store');
    const out: ModerationReportResponse = {
      data: { case_id: res.caseId, hidden: res.hidden, duplicate: res.duplicate },
    };
    return reply.code(201).send(out);
  });

  app.get('/v1/fans/me/blocks', { config: { fan: true } }, async (request, reply) => {
    const { fan } = await activeFan(request);
    const rows = await listBlocks(db(), fan.tenantId, fan.profileId);
    reply.header('cache-control', 'no-store');
    const out: FanBlocks = {
      data: rows.map((r) => ({ profile_id: r.profileId, created_at: r.createdAt.toISOString() })),
    };
    return out;
  });

  app.put('/v1/fans/me/blocks/:profileId', { config: { fan: true } }, async (request, reply) => {
    const { fan } = await activeFan(request);
    const { profileId } = parseInput(FanBlockParams, request.params);
    if (profileId === fan.profileId) throw problems.conflict('Não dá para bloquear o próprio Perfil.');
    if (!(await profileExists(fan.tenantId, profileId))) throw problems.notFound('Perfil');
    await blockFan(db(), {
      tenantId: fan.tenantId,
      blockerProfileId: fan.profileId,
      blockedProfileId: profileId,
    });
    return reply.code(204).send();
  });

  app.delete('/v1/fans/me/blocks/:profileId', { config: { fan: true } }, async (request, reply) => {
    const { fan } = await activeFan(request);
    const { profileId } = parseInput(FanBlockParams, request.params);
    await unblockFan(db(), {
      tenantId: fan.tenantId,
      blockerProfileId: fan.profileId,
      blockedProfileId: profileId,
    });
    return reply.code(204).send();
  });

  app.get('/v1/fans/me/sanctions', { config: { fan: true } }, async (request, reply) => {
    const { fan } = await activeFan(request);
    const rows = await sanctionsForFan(db(), { tenantId: fan.tenantId, profileId: fan.profileId });
    const at = now().getTime();
    const appeals = await appealsForSanctions(
      db(),
      fan.tenantId,
      rows.map((s) => s.id),
    );
    reply.header('cache-control', 'no-store');
    const out: FanSanctions = {
      data: rows.map((s) => ({
        id: s.id,
        level: s.level as FanSanctions['data'][number]['level'],
        scope: s.scope as FanSanctions['data'][number]['scope'],
        scope_id: s.scopeId,
        reason: s.reason,
        starts_at: s.startsAt.toISOString(),
        ends_at: s.endsAt?.toISOString() ?? null,
        revoked_at: s.revokedAt?.toISOString() ?? null,
        active: sanctionActive(
          { endsAt: s.endsAt?.getTime() ?? null, revokedAt: s.revokedAt?.getTime() ?? null },
          at,
        ),
        appeals: appeals
          .filter((a) => a.sanctionId === s.id)
          .map((a) => ({
            id: a.id,
            stage: a.stage,
            status: a.status as 'pending' | 'upheld' | 'overturned',
            due_at: a.dueAt.toISOString(),
          })),
      })),
    };
    return out;
  });

  app.post('/v1/fans/me/sanctions/:sanctionId/appeals', { config: { fan: true } }, async (request, reply) => {
    const { fan, profile } = await activeFan(request);
    const { sanctionId } = parseInput(FanSanctionParams, request.params);
    const body = parseInput(FanAppealBody, request.body ?? {});
    const judges = await appealJudges(db(), fan.tenantId, sanctionId);
    const last = judges.at(-1);
    if (last?.status === 'pending') throw problems.conflict('Já existe uma apelação pendente desta punição.');
    const stage = last ? 2 : 1;
    if (stage === 2 && (last!.stage !== 1 || last!.status !== 'upheld'))
      throw problems.conflict('Esta punição não aceita outra apelação.');
    const route = appealRoute(stage, {
      firstDecidedBy: last?.decidedByKind === 'cosmos' ? 'cosmos' : 'person',
      teamCanJudge: stage === 2 ? await teamCanJudgeSecond(db(), fan.tenantId) : true,
    });
    if (!route)
      throw problems.conflict('A segunda apelação só existe quando a primeira resposta veio da Cosmos.');
    const at = now();
    const dueAt = new Date(at.getTime() + APPEAL_DUE_DEFAULT_H * 3600_000);
    const res = await fileAppeal(db(), {
      tenantId: fan.tenantId,
      profileId: fan.profileId,
      sanctionId,
      stage,
      route: route.to,
      statement: body.statement ?? null,
      dueAt,
      clocks: await clocksFor(db(), fan.tenantId, profile.country, at),
      severity: REASON_SEVERITY.other,
      now: at,
    });
    if (!res.ok) {
      if (res.reason === 'already') throw problems.conflict('Esta etapa da apelação já foi pedida.');
      throw problems.notFound('Punição');
    }
    const appeal = await readAppeal(db(), fan.tenantId, res.appealId);
    reply.header('cache-control', 'no-store');
    const out: FanAppealResponse = {
      data: {
        appeal_id: res.appealId,
        stage,
        route: res.route,
        due_at: (appeal?.dueAt ?? dueAt).toISOString(),
      },
    };
    return reply.code(201).send(out);
  });
}
