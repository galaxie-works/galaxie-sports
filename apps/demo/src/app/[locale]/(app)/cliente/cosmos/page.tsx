import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { ClientArea } from '@/components/client/client-area';
import { BrandVoiceForm } from '@/components/cosmos/brand-voice-form';
import { CosmosArea } from '@/components/cosmos/cosmos-area';
import { CosmosModeration } from '@/components/cosmos/cosmos-moderation';
import { CosmosOverview } from '@/components/cosmos/cosmos-overview';
import { CosmosUsage } from '@/components/cosmos/cosmos-usage';
import { ModerationPreview } from '@/components/cosmos/moderation-preview';
import { CreditRequests } from '@/components/cosmos/credit-requests';
import { Skeleton } from '@/components/ui/skeleton';
import { can } from '@/lib/client/permissions';
import { isUuid } from '@/lib/client/tenants';
import { loadCreditRequests } from '@/lib/cosmos/credit-request-data';
import { loadCosmosOverview, loadCosmosStatement } from '@/lib/cosmos/data';
import { brandVoiceFor, matchTextAccess, matchTextMinimum } from '@/lib/cosmos/match-text-tasks';
import { COSMOS_TABS, type CosmosTab } from '@/lib/cosmos/data-utils';
import { loadCosmosModeration } from '@/lib/cosmos/moderation-data';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.client.meta.cosmos };
}

type Params = Awaited<PageProps<'/[locale]/cliente/cosmos'>['searchParams']>;

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);
const many = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

async function Cosmos({
  searchParams,
}: {
  searchParams: PageProps<'/[locale]/cliente/cosmos'>['searchParams'];
}) {
  const [timeZone, params] = await Promise.all([getTimeZone(), searchParams as Promise<Params>]);
  const tab: CosmosTab = (COSMOS_TABS as readonly string[]).includes(one(params.tab) ?? '')
    ? (one(params.tab) as CosmosTab)
    : 'overview';
  const purchaseId = one(params.purchase);
  const status = one(params.status);
  const purchase: { id: string; status: 'success' | 'canceled' } | null =
    purchaseId && isUuid(purchaseId) && (status === 'success' || status === 'canceled')
      ? { id: purchaseId, status }
      : null;
  return (
    <ClientArea section="cosmos">
      {async (ctx) => {
        const { tenant } = ctx;
        // o tenant vem da sessão (ClientArea, que já exigiu `cosmos.view`): o cliente só vê a carteira e o extrato dele
        const canManage = can(ctx, 'cosmos.manage');
        // guia de tom (#1009): na visão geral, quando a função de texto do jogo está no catálogo e o tenant a usa
        const voiceShown = tab === 'overview' && tenant.modules.includes('cosmos_ai');
        const [overview, statement, moderation, requests, voice, voiceMinimum] = await Promise.all([
          loadCosmosOverview(tenant, timeZone),
          loadCosmosStatement(
            tenant.id,
            {
              from: one(params.from),
              to: one(params.to),
              kind: many(params.kind),
              fn: many(params.fn),
              scope: many(params.scope),
              cursor: one(params.cursor),
            },
            timeZone,
          ),
          // só na aba Moderação: o histórico traz quem mudou, e as outras abas não precisam dele
          tab === 'moderation' ? loadCosmosModeration(tenant.id) : null,
          // quem compra vê os pedidos do tenant; quem não compra, só os próprios (#996)
          tab === 'overview' ? loadCreditRequests(tenant.id, ctx.userId, canManage) : [],
          voiceShown ? brandVoiceFor(tenant.id) : null,
          voiceShown ? matchTextMinimum() : null,
        ]);
        return (
          <CosmosArea
            tab={tab}
            overview={
              <div className="flex flex-col gap-6">
                <CosmosOverview
                  data={overview}
                  purchase={purchase}
                  // botões de compra, recarga e o interruptor; o servidor confere de novo em cada ação
                  canManage={canManage}
                />
                {overview.wallet ? (
                  <CreditRequests requests={requests} canManage={canManage} packages={overview.packages} />
                ) : null}
                {voice && voiceMinimum !== null ? (
                  // o servidor confere de novo ao salvar (configurações do cliente: Admin e Dono)
                  <BrandVoiceForm initial={voice.voice} canEdit={!matchTextAccess(ctx)} />
                ) : null}
              </div>
            }
            usage={<CosmosUsage data={statement} timeZone={timeZone} />}
            // mudar regras e réguas é configuração do cliente (Admin e Dono); o servidor confere de novo ao salvar
            moderation={
              moderation ? (
                // a versão na chave: depois de salvar (ou de um conflito), o formulário recomeça do que está gravado
                <div className="flex flex-col gap-6">
                  <CosmosModeration
                    key={moderation.version}
                    data={moderation}
                    canEdit={can(ctx, 'settings.manage')}
                  />
                  {/* testar gasta créditos: só quem configura (o servidor confere de novo) */}
                  {can(ctx, 'settings.manage') ? <ModerationPreview /> : null}
                </div>
              ) : null
            }
          />
        );
      }}
    </ClientArea>
  );
}

export default async function ClientCosmosPage({
  searchParams,
}: {
  searchParams: PageProps<'/[locale]/cliente/cosmos'>['searchParams'];
}) {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.client.nav.cosmos}
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
          <Cosmos searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
