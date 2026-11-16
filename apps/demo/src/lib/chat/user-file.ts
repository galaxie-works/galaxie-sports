/**
 * Ficha do torcedor para a equipe do cliente (#973): avisos e punições (inclusive o Silêncio invisível, que o
 * torcedor não vê), as apelações de cada uma e as notas internas. Só leitura; quem pode ver é a página que decide.
 */
import { appealsForSanctions, moderationNotesFor } from '@galaxie/db/moderation-queue';

import { pool } from '@/lib/auth/db';
import { builderDb } from '@/lib/builder/store';

export interface UserFileSanction {
  id: string;
  level: 'warning' | 'mute' | 'suspension' | 'expulsion' | 'ban';
  hidden: boolean;
  scope: 'tenant' | 'place' | 'community';
  reason: string;
  decidedByKind: 'person' | 'cosmos' | 'galaxie' | 'system';
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
  appeals: Array<{ stage: number; status: 'pending' | 'upheld' | 'overturned' }>;
}

export interface UserFile {
  profileId: string;
  nickname: string | null;
  createdAt: string;
  deleted: boolean;
  sanctions: UserFileSanction[];
  notes: Array<{ id: string; body: string; createdAt: string }>;
}

/** A ficha do torcedor no tenant, ou null se o Perfil não é deste tenant. */
export async function loadUserFile(tenantId: string, profileId: string): Promise<UserFile | null> {
  const profile = await pool.query<{ nickname: string | null; created_at: Date; deleted_at: Date | null }>(
    `select nickname, created_at, deleted_at from fan.profile where tenant_id = $1 and id = $2`,
    [tenantId, profileId],
  );
  const p = profile.rows[0];
  if (!p) return null;
  const { rows } = await pool.query<{
    id: string;
    level: UserFileSanction['level'];
    hidden: boolean;
    scope: UserFileSanction['scope'];
    reason: string;
    decided_by_kind: UserFileSanction['decidedByKind'];
    starts_at: Date;
    ends_at: Date | null;
    revoked_at: Date | null;
  }>(
    `select id, level, hidden, scope, reason, decided_by_kind, starts_at, ends_at, revoked_at
       from engage.moderation_sanction
      where tenant_id = $1 and profile_id = $2
      order by starts_at desc
      limit 100`,
    [tenantId, profileId],
  );
  const db = builderDb();
  const [appeals, notes] = await Promise.all([
    appealsForSanctions(
      db,
      tenantId,
      rows.map((r) => r.id),
    ),
    moderationNotesFor(db, tenantId, profileId),
  ]);
  return {
    profileId,
    nickname: p.nickname,
    createdAt: p.created_at.toISOString(),
    deleted: p.deleted_at !== null,
    sanctions: rows.map((r) => ({
      id: r.id,
      level: r.level,
      hidden: r.hidden,
      scope: r.scope,
      reason: r.reason,
      decidedByKind: r.decided_by_kind,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at?.toISOString() ?? null,
      revokedAt: r.revoked_at?.toISOString() ?? null,
      appeals: appeals
        .filter((a) => a.sanctionId === r.id)
        .map((a) => ({ stage: a.stage, status: a.status as UserFileSanction['appeals'][number]['status'] })),
    })),
    notes: notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt.toISOString() })),
  };
}
