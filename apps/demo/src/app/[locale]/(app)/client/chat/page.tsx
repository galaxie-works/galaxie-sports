import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { ChatSettingsForm } from '@/components/chat/chat-settings-form';
import { ClientArea } from '@/components/client/client-area';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { loadChatRooms, loadChatSettings } from '@/lib/chat/panel-data';
import { roomTitle } from '@/lib/chat/panel-utils';
import { allowed } from '@/lib/client/permissions';
import { createFormatters } from '@/lib/i18n/format';
import { getRequestLocale, getT, getTimeZone } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.chatPanel.title };
}

async function Rooms() {
  const [t, locale, timeZone] = await Promise.all([getT(), getRequestLocale(), getTimeZone()]);
  const T = t.chatPanel;
  const f = createFormatters(locale, timeZone);
  return (
    <ClientArea section="chat">
      {async (ctx) => {
        // o tenant vem da sessão; o moderador com escopo vê só as salas (jogos) dele
        const [rooms, settings] = await Promise.all([
          loadChatRooms(ctx.tenant.id),
          loadChatSettings(ctx.tenant.id),
        ]);
        const visible = rooms.filter((r) => allowed(ctx, 'moderation.queue.view', { room: r.fixtureId }).ok);
        const canSettings = allowed(ctx, 'settings.manage').ok;
        return (
          <>
            <Frame>
              <FramePanel>
                <FrameHeader>
                  <FrameTitle>{T.rooms.title}</FrameTitle>
                  <FrameDescription>{T.description}</FrameDescription>
                </FrameHeader>
                {visible.length === 0 ? (
                  <EmptyState title={T.rooms.title} description={T.rooms.empty} />
                ) : (
                  <ul className="flex flex-col divide-y">
                    {visible.map((r) => (
                      <li key={r.roomId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <Link href={`/client/chat/${r.fixtureId}`} className="font-medium hover:underline">
                            {roomTitle(r)}
                          </Link>
                          <p className="text-muted-foreground text-xs">
                            {f.dayTime(r.startsAt)} · {fill(T.rooms.messages24h, { count: r.messages24h })}
                            {r.held ? ` · ${fill(T.rooms.held, { count: r.held })}` : ''}
                          </p>
                        </div>
                        <Badge variant={r.state === 'open' ? 'success-light' : 'warning-light'} radius="full">
                          {T.rooms.state[r.state]}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </FramePanel>
            </Frame>
            {canSettings ? <ChatSettingsForm initial={settings} /> : null}
          </>
        );
      }}
    </ClientArea>
  );
}

export default async function ClientChatPage() {
  const t = await getT();
  return (
    <>
      <PageHeader
        title={t.chatPanel.title}
        kind="cliente"
        parents={[{ path: '/client', label: t.client.title, kind: 'cliente' }]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
        <Suspense
          fallback={
            <LoadingStatus>
              <TablePanelSkeleton rows={4} columns={['flex-1', 'w-24']} />
            </LoadingStatus>
          }
        >
          <Rooms />
        </Suspense>
      </div>
    </>
  );
}
