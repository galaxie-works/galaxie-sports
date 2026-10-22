/**
 * Leituras do painel de usuários (só no servidor). Toda função exige uma sessão de admin: a verificação
 * fica aqui, junto do dado, e não só no proxy.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { pool } from './db';
import { auth, isAccessExpired, type AuthUser } from './server';

export type UserStatus = 'active' | 'pending' | 'expired' | 'disabled';

export const STATUS_LABEL: Record<UserStatus, string> = {
  active: 'Ativo',
  pending: 'Convite pendente',
  expired: 'Expirado',
  disabled: 'Desativado',
};

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  jobTitle: string | null;
  company: string | null;
  phone: string | null;
  notes: string | null;
  accessExpiresAt: string | null;
  createdAt: string;
  status: UserStatus;
  lastLoginAt: string | null;
  pageViews: number;
  lastInvite: { at: string; delivered: boolean; kind: string } | null;
}

export async function requireAdmin(): Promise<AuthUser> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== 'admin') redirect('/');
  return session.user;
}

type RawUser = AuthUser & {
  role?: string | null;
  banned?: boolean | null;
  jobTitle?: string | null;
  company?: string | null;
  phone?: string | null;
  notes?: string | null;
  accessExpiresAt?: Date | string | null;
};

interface ActivitySummary {
  lastLoginAt: string | null;
  pageViews: number;
  /** Tem (ou teve) sessão: vale para quem entrou antes de existir o registro de atividade. */
  hasSession: boolean;
}

/** "Convite pendente" = a pessoa nunca entrou: nenhum login registrado e nenhuma sessão. */
function statusOf(u: RawUser, act: ActivitySummary | undefined): UserStatus {
  if (u.banned) return 'disabled';
  if (!act?.lastLoginAt && !act?.hasSession) return 'pending';
  if (isAccessExpired(u)) return 'expired';
  return 'active';
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

async function activitySummary(userIds: string[]) {
  if (!userIds.length) return new Map<string, ActivitySummary>();
  const { rows } = await pool.query<{
    user_id: string;
    last_login: Date | null;
    page_views: number;
    has_session: boolean;
  }>(
    `select u.id as user_id,
            (select max(a.created_at) from activity a where a.user_id = u.id and a.kind = 'login') as last_login,
            (select count(*) from activity a where a.user_id = u.id and a.kind = 'page')::int as page_views,
            exists (select 1 from session s where s."userId" = u.id) as has_session
       from unnest($1::text[]) as u(id)`,
    [userIds],
  );
  return new Map(
    rows.map((r) => [
      r.user_id,
      { lastLoginAt: iso(r.last_login), pageViews: r.page_views, hasSession: r.has_session },
    ]),
  );
}

async function lastInvites(userIds: string[]) {
  if (!userIds.length) return new Map<string, DemoUser['lastInvite']>();
  const { rows } = await pool.query<{ user_id: string; created_at: Date; delivered: boolean; kind: string }>(
    `select distinct on (user_id) user_id, created_at, delivered, kind
       from invite where user_id = any($1) order by user_id, created_at desc`,
    [userIds],
  );
  return new Map(
    rows.map((r) => [r.user_id, { at: r.created_at.toISOString(), delivered: r.delivered, kind: r.kind }]),
  );
}

function toDemoUser(
  u: RawUser,
  act: ActivitySummary | undefined,
  invite: DemoUser['lastInvite'] | undefined,
): DemoUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === 'admin' ? 'admin' : 'user',
    jobTitle: u.jobTitle ?? null,
    company: u.company ?? null,
    phone: u.phone ?? null,
    notes: u.notes ?? null,
    accessExpiresAt: iso(u.accessExpiresAt),
    createdAt: iso(u.createdAt)!,
    status: statusOf(u, act),
    lastLoginAt: act?.lastLoginAt ?? null,
    pageViews: act?.pageViews ?? 0,
    lastInvite: invite ?? null,
  };
}

export async function listDemoUsers(): Promise<DemoUser[]> {
  await requireAdmin();
  const res = await auth.api.listUsers({
    headers: await headers(),
    query: { limit: 1000, sortBy: 'createdAt', sortDirection: 'desc' },
  });
  const users = res.users as RawUser[];
  const ids = users.map((u) => u.id);
  const [acts, invites] = await Promise.all([activitySummary(ids), lastInvites(ids)]);
  return users.map((u) => toDemoUser(u, acts.get(u.id), invites.get(u.id)));
}

export interface DemoSession {
  id: string;
  token: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface DemoActivity {
  id: string;
  kind: 'login' | 'page';
  path: string | null;
  title: string | null;
  /** Trilha de navegação: caminho do item anterior e profundidade (nulos em registros antigos). */
  fromPath: string | null;
  trailDepth: number | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export async function getDemoUser(id: string) {
  const me = await requireAdmin();
  const h = await headers();
  const user = (await auth.api.getUser({ headers: h, query: { id } }).catch(() => null)) as RawUser | null;
  if (!user) return null;
  const [acts, invites, sessionsRes, activity] = await Promise.all([
    activitySummary([id]),
    lastInvites([id]),
    auth.api.listUserSessions({ headers: h, body: { userId: id } }),
    pool.query<{
      id: string;
      kind: 'login' | 'page';
      path: string | null;
      title: string | null;
      from_path: string | null;
      trail_depth: number | null;
      ip_address: string | null;
      user_agent: string | null;
      created_at: Date;
    }>(
      `select id::text, kind, path, title, from_path, trail_depth, ip_address, user_agent, created_at
         from activity where user_id = $1 order by created_at desc limit 100`,
      [id],
    ),
  ]);
  const sessions: DemoSession[] = sessionsRes.sessions
    .filter((s) => new Date(s.expiresAt).getTime() > Date.now())
    .map((s) => ({
      id: s.id,
      token: s.token,
      createdAt: iso(s.createdAt)!,
      updatedAt: iso(s.updatedAt)!,
      expiresAt: iso(s.expiresAt)!,
      ipAddress: s.ipAddress ?? null,
      userAgent: s.userAgent ?? null,
    }));
  return {
    currentUserId: me.id,
    user: toDemoUser(user, acts.get(id), invites.get(id)),
    sessions,
    activity: activity.rows.map<DemoActivity>((r) => ({
      id: r.id,
      kind: r.kind,
      path: r.path,
      title: r.title,
      fromPath: r.from_path,
      trailDepth: r.trail_depth,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      createdAt: r.created_at.toISOString(),
    })),
  };
}
