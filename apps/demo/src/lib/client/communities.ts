/**
 * Comunidades no painel do cliente (#939), só no servidor: escopo, configuração de cada Comunidade, termos por
 * versão, convites e a fila de aprovação. As regras puras ficam em `@galaxie/engage`; a leitura e a gravação em
 * `@galaxie/db/community`, sempre com o tenant da sessão (um id de outro cliente não acha nada).
 */
import { createDb, type Database } from '@galaxie/db/client';
import {
  communityLimit,
  describeScopeRules,
  listCommunities,
  listJoinRequests,
  listSportsForScope,
  type CommunityRow,
} from '@galaxie/db/community';

import { moduleLimits } from '@/lib/client/entitlements';

declare global {
  var __galaxieCommunityDb: Database | undefined;
}

const url = process.env.DEMO_DATABASE_URL ?? process.env.DATABASE_URL;

/** Conexão das funções de Comunidades (uma por processo; o dev server recarrega módulos). */
export function communityDb(): Database {
  if (!url) throw new Error('DEMO_DATABASE_URL/DATABASE_URL não definido: as Comunidades precisam do banco.');
  globalThis.__galaxieCommunityDb ??= createDb(url, {
    max: 2,
    profile: 'api',
    applicationName: 'galaxie-demo-communities',
  });
  return globalThis.__galaxieCommunityDb;
}

/** Comunidade como vai para o navegador (datas em ISO). */
export interface CommunityView {
  id: string;
  name: string | null;
  anchorType: CommunityRow['anchorType'];
  anchorId: string;
  sport: string | null;
  joinMode: CommunityRow['joinMode'];
  memberPosts: boolean;
  chatEnabled: boolean;
  historyDays: number | null;
  state: CommunityRow['state'];
  termsVersion: number | null;
  version: number;
  members: number;
  pendingRequests: number;
}

export interface ScopeRuleView {
  id: string;
  kind: string;
  target: string;
  name: string | null;
  createdAt: string;
}

export interface JoinRequestView {
  id: string;
  communityId: string;
  profileId: string;
  createdAt: string;
}

export interface CommunitiesOverview {
  rules: ScopeRuleView[];
  communities: CommunityView[];
  requests: JoinRequestView[];
  sports: { slug: string; name: string }[];
  limit: number;
  active: number;
}

export async function communitiesOverview(tenantId: string, locale: string): Promise<CommunitiesOverview> {
  const db = communityDb();
  const [rules, rows, sports, limit] = await Promise.all([
    describeScopeRules(db, tenantId, locale),
    listCommunities(db, tenantId, { locale }),
    listSportsForScope(db, locale),
    communityLimit(db, tenantId, moduleLimits()['communities.max_communities']),
  ]);
  const withApproval = rows.filter((c) => c.joinMode === 'approval' && c.state === 'active');
  const requests = (
    await Promise.all(
      withApproval.map(async (c) =>
        (await listJoinRequests(db, tenantId, c.id, 100)).map((r) => ({
          id: r.id,
          communityId: c.id,
          profileId: r.profileId,
          createdAt: r.createdAt.toISOString(),
        })),
      ),
    )
  ).flat();
  const pending = new Map<string, number>();
  for (const r of requests) pending.set(r.communityId, (pending.get(r.communityId) ?? 0) + 1);
  return {
    rules: rules.map((r) => ({
      id: r.id,
      kind: r.kind,
      target: r.target,
      name: r.name,
      createdAt: r.createdAt.toISOString(),
    })),
    communities: rows.map((c) => ({
      id: c.id,
      name: c.name,
      anchorType: c.anchorType,
      anchorId: c.anchorId,
      sport: c.sport,
      joinMode: c.joinMode,
      memberPosts: c.memberPosts,
      chatEnabled: c.chatEnabled,
      historyDays: c.historyDays,
      state: c.state,
      termsVersion: c.termsVersion,
      version: c.version,
      members: c.members,
      pendingRequests: pending.get(c.id) ?? 0,
    })),
    requests,
    sports,
    limit,
    active: rows.filter((c) => c.state === 'active').length,
  };
}
