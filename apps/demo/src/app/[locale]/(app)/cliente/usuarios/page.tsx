import { canAssign, TENANT_ROLES } from '@galaxie/engage';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { ClientArea } from '@/components/client/client-area';
import { MembersPanel } from '@/components/client/members-panel';
import { RolePermissionsPanel } from '@/components/client/role-permissions-panel';
import { listMemberEvents, listTenantMembers } from '@/lib/client/members';
import { permissionMatrix } from '@/lib/client/permission-matrix';
import { can } from '@/lib/client/permissions';
import { loadRoleOverrides } from '@/lib/client/role-permissions';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.members };
}

async function Members() {
  const timeZone = await getTimeZone();
  return (
    <ClientArea section="members">
      {async (ctx) => {
        const [members, events, overrides] = await Promise.all([
          listTenantMembers(ctx.tenant.id),
          listMemberEvents(ctx.tenant.id, 50),
          // direto do banco: logo depois de gravar, a tabela mostra o que ficou
          loadRoleOverrides(ctx.tenant.id, { fresh: true }),
        ]);
        const manage = can(ctx, 'members.manage');
        const actor = ctx.actor;
        return (
          <MembersPanel
            permissions={
              <RolePermissionsPanel
                rows={permissionMatrix(overrides, can(ctx, 'permissions.manage'))}
                editable={can(ctx, 'permissions.manage')}
                customized={overrides !== null}
              />
            }
            members={members.map((mb) => ({
              memberId: mb.memberId,
              email: mb.email,
              name: mb.name,
              role: mb.role,
              scopeCount: mb.scope
                ? (mb.scope.communities?.length ?? 0) + (mb.scope.rooms?.length ?? 0)
                : null,
              pending: mb.acceptedAt === null,
              createdAt: mb.createdAt,
              self: mb.userId === ctx.userId,
              // cargos que quem está vendo pode dar a esta pessoa (vazio = não pode trocar nem tirar)
              assignable:
                manage && actor
                  ? TENANT_ROLES.filter(
                      (r) => r !== 'volunteer' && canAssign(actor, ctx.tenant.id, r, mb.role),
                    )
                  : [],
              removable: manage && actor ? canAssign(actor, ctx.tenant.id, null, mb.role) : false,
            }))}
            invitable={
              manage && actor
                ? TENANT_ROLES.filter((r) => r !== 'volunteer' && canAssign(actor, ctx.tenant.id, r))
                : []
            }
            events={events}
            timeZone={timeZone}
          />
        );
      }}
    </ClientArea>
  );
}

export default async function ClientMembersPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.nav.members}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <Suspense
          fallback={
            <LoadingStatus>
              <TablePanelSkeleton action rows={4} columns={['flex-1', 'w-32', 'w-24', 'w-20']} />
            </LoadingStatus>
          }
        >
          <Members />
        </Suspense>
      </div>
    </>
  );
}
