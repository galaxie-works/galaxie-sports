import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { ChatRoomPanel, type RoomPermissions } from '@/components/chat/chat-room-panel';
import { ClientArea } from '@/components/client/client-area';
import { EmptyState } from '@/components/app-shell/empty-state';
import { loadChatRoom, loadRoomMessages } from '@/lib/chat/panel-data';
import {
  AUTHOR_ACTION_RULE,
  MUTE_MINUTES,
  ROOM_ACTION_RULE,
  SUSPEND_DAYS,
  roomTitle,
} from '@/lib/chat/panel-utils';
import { allowed } from '@/lib/client/permissions';
import { getT, getTimeZone } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.chatPanel.title };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Room({ fixtureId }: { fixtureId: string }) {
  const [t, timeZone] = await Promise.all([getT(), getTimeZone()]);
  const T = t.chatPanel;
  return (
    <ClientArea section="chat">
      {async (ctx) => {
        const place = { room: fixtureId };
        if (!UUID.test(fixtureId) || !allowed(ctx, 'moderation.queue.view', place).ok)
          return <EmptyState title={t.client.tenant.denyTitle} description={t.client.tenant.denyBody} />;
        const room = await loadChatRoom(ctx.tenant.id, fixtureId);
        const messages = room ? await loadRoomMessages(ctx.tenant.id, room.roomId) : [];
        // botões que o cargo abre nesta sala; o silêncio respeita o teto de duração do cargo
        const minutesFor = (rule: typeof AUTHOR_ACTION_RULE.mute) =>
          MUTE_MINUTES.filter((m) => allowed(ctx, rule, { ...place, durationSec: m * 60 }).ok);
        const can: RoomPermissions = {
          hide: allowed(ctx, 'moderation.hide', place).ok,
          room: allowed(ctx, ROOM_ACTION_RULE, place).ok,
          muteMinutes: minutesFor(AUTHOR_ACTION_RULE.mute),
          shadowMinutes: minutesFor(AUTHOR_ACTION_RULE.shadow_mute),
          suspendDays: allowed(ctx, AUTHOR_ACTION_RULE.suspend, place).ok ? [...SUSPEND_DAYS] : [],
          ban: allowed(ctx, AUTHOR_ACTION_RULE.ban, place).ok,
        };
        return (
          <>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <Link href="/client/chat" className="hover:underline">
                ← {T.room.back}
              </Link>
              <Link href="/client/moderation?module=chat" className="hover:underline">
                {T.room.queue}
              </Link>
            </div>
            <ChatRoomPanel
              fixtureId={fixtureId}
              title={room ? roomTitle(room) : `#${fixtureId.slice(0, 8)}`}
              state={room?.state ?? null}
              slowModeSeconds={room?.slowModeSeconds ?? null}
              initial={messages}
              can={can}
              timeZone={timeZone}
            />
          </>
        );
      }}
    </ClientArea>
  );
}

// Os params só são lidos dentro do Suspense: fora dele o Next recusa o prerender (dado de requisição no shell)
async function RoomPage({ params }: { params: Promise<{ fixtureId: string }> }) {
  const [t, { fixtureId }] = await Promise.all([getT(), params]);
  return (
    <>
      <PageHeader
        title={t.chatPanel.title}
        kind="cliente"
        parents={[
          { path: '/client', label: t.client.title, kind: 'cliente' },
          { path: '/client/chat', label: t.chatPanel.title, kind: 'cliente' },
        ]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <Room fixtureId={fixtureId} />
      </div>
    </>
  );
}

export default function ClientChatRoomPage({ params }: { params: Promise<{ fixtureId: string }> }) {
  return (
    <Suspense
      fallback={
        <LoadingStatus className="mx-auto w-full max-w-6xl p-4 md:p-6">
          <TablePanelSkeleton rows={6} columns={['flex-1', 'w-16']} />
        </LoadingStatus>
      }
    >
      <RoomPage params={params} />
    </Suspense>
  );
}
