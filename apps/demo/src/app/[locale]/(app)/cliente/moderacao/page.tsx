import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { DecisionHistory } from '@/components/moderation/decision-history';
import { ModerationArea } from '@/components/moderation/moderation-area';
import { ReviewQueue } from '@/components/moderation/review-queue';
import { SafetyNote } from '@/components/settings';
import { Skeleton } from '@/components/ui/skeleton';
import { allowed, canSomewhere, placeOf } from '@/lib/client/permissions';
import { getT } from '@/lib/i18n/server';
import { loadDecisions, loadModerationQueue } from '@/lib/moderation/queue-data';
import {
  applicableDecisions,
  decisionAction,
  MODERATION_TABS,
  MUTE_HOURS,
  pickHistoryFilters,
  QUEUE_MODULES,
  type ModerationTab,
} from '@/lib/moderation/queue-utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.moderation };
}

type Params = Awaited<PageProps<'/[locale]/cliente/moderacao'>['searchParams']>;
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

async function Moderation({
  searchParams,
}: {
  searchParams: PageProps<'/[locale]/cliente/moderacao'>['searchParams'];
}) {
  const [t, params] = await Promise.all([getT(), searchParams as Promise<Params>]);
  const tab: ModerationTab = (MODERATION_TABS as readonly string[]).includes(one(params.tab) ?? '')
    ? (one(params.tab) as ModerationTab)
    : 'queue';
  const module = (QUEUE_MODULES as readonly string[]).includes(one(params.module) ?? '')
    ? one(params.module)!
    : null;
  const filters = pickHistoryFilters({
    module: one(params.module),
    category: one(params.category),
    action: one(params.action),
    actorKind: one(params.actorKind),
  });
  return (
    <ClientArea section="moderation">
      {async (ctx) => {
        // o tenant vem da sessão (ClientArea já exigiu `moderation.queue.view` em algum lugar do escopo)
        const canAudit = canSomewhere(ctx, 'audit.view');
        const [queue, history] = await Promise.all([
          tab === 'queue' ? loadModerationQueue(ctx.tenant.id, module ? { module } : {}) : [],
          tab === 'history' && canAudit ? loadDecisions(ctx.tenant.id, filters) : null,
        ]);
        // membro com escopo: só o que é da sala ou da comunidade dele
        const visible = queue.filter((item) => allowed(ctx, 'moderation.queue.view', placeOf(item)).ok);
        // decisões que o cargo abre no lugar de cada item e as durações de silêncio dentro do teto do cargo (o
        // servidor confere de novo ao decidir)
        const rows = visible.map((item) => {
          const muteHours = MUTE_HOURS.filter(
            (h) => allowed(ctx, 'moderation.mute', { ...placeOf(item), durationSec: h * 3600 }).ok,
          );
          return {
            ...item,
            muteHours,
            decisions: applicableDecisions(item).filter((d) =>
              d === 'mute' ? muteHours.length > 0 : allowed(ctx, decisionAction(d), placeOf(item)).ok,
            ),
          };
        });
        const decisions = history
          ? {
              ...history,
              items: history.items
                .filter((d) => allowed(ctx, 'audit.view', placeOf(d)).ok)
                // desfazer daqui: só onde o cargo esconde conteúdo (o servidor confere as punições de novo)
                .map((d) => ({
                  ...d,
                  undoable: d.undoable && allowed(ctx, 'moderation.hide', placeOf(d)).ok,
                })),
            }
          : null;
        return (
          <ModerationArea
            tab={tab}
            queue={<ReviewQueue items={rows} module={module} />}
            history={
              decisions ? (
                <DecisionHistory
                  key={JSON.stringify(filters)}
                  items={decisions.items}
                  next={decisions.next}
                  filters={filters}
                />
              ) : (
                <SafetyNote>{t.moderation.history.denied}</SafetyNote>
              )
            }
          />
        );
      }}
    </ClientArea>
  );
}

export default async function ClientModerationPage({
  searchParams,
}: {
  searchParams: PageProps<'/[locale]/cliente/moderacao'>['searchParams'];
}) {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.nav.moderation}
        kind="cliente"
        parents={[{ path: '/cliente', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        {/* Lê a sessão (headers): fica fora do shell estático. */}
        <Suspense
          fallback={
            <LoadingStatus>
              <Skeleton className="h-64 w-full rounded-xl" />
            </LoadingStatus>
          }
        >
          <Moderation searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
