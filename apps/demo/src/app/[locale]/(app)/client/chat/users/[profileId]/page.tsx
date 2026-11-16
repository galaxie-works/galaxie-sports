import type { Metadata } from 'next';
import { Suspense } from 'react';

import { EmptyState } from '@/components/app-shell/empty-state';
import { LoadingStatus } from '@/components/app-shell/loading-status';
import { PageHeader } from '@/components/app-shell/page-header';
import { TablePanelSkeleton } from '@/components/app-shell/skeletons';
import { UserNotesForm } from '@/components/chat/user-notes-form';
import { ClientArea } from '@/components/client/client-area';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { loadUserFile } from '@/lib/chat/user-file';
import { allowed } from '@/lib/client/permissions';
import { createFormatters } from '@/lib/i18n/format';
import { getLocale, getT, getTimeZone } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.chatPanel.userFile.title };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function UserFileView({ profileId }: { profileId: string }) {
  const [t, locale, timeZone] = await Promise.all([getT(), getLocale(), getTimeZone()]);
  const T = t.chatPanel.userFile;
  const f = createFormatters(locale, timeZone);
  return (
    <ClientArea section="chat">
      {async (ctx) => {
        // a ficha é do tenant inteiro: cargo com escopo de sala não a abre
        const deny = <EmptyState title={t.client.tenant.denyTitle} description={t.client.tenant.denyBody} />;
        if (!UUID.test(profileId) || !allowed(ctx, 'moderation.queue.view').ok) return deny;
        const file = await loadUserFile(ctx.tenant.id, profileId);
        if (!file) return <EmptyState title={t.chatPanel.errors.notFound} />;
        const canNote = allowed(ctx, 'moderation.hide').ok;
        return (
          <>
            <Frame>
              <FramePanel>
                <FrameHeader>
                  <FrameTitle>{file.nickname ?? t.chatPanel.room.author.unknown}</FrameTitle>
                  <FrameDescription>
                    {file.deleted ? T.deleted : fill(T.since, { date: f.date(file.createdAt) })}
                  </FrameDescription>
                </FrameHeader>
              </FramePanel>
            </Frame>

            <Frame>
              <FramePanel>
                <FrameHeader>
                  <FrameTitle>{T.sanctions}</FrameTitle>
                </FrameHeader>
                {file.sanctions.length === 0 ? (
                  <p className="text-muted-foreground py-4 text-sm">{T.noSanctions}</p>
                ) : (
                  <ul className="flex flex-col divide-y">
                    {file.sanctions.map((s) => (
                      <li key={s.id} className="flex flex-col gap-1 py-2 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{T.level[s.level]}</span>
                          {s.hidden ? (
                            <Badge variant="warning-light" radius="full">
                              {T.hidden}
                            </Badge>
                          ) : null}
                          <span className="text-muted-foreground text-xs">{T.scope[s.scope]}</span>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {f.dateTime(s.startsAt)} ·{' '}
                          {s.revokedAt
                            ? fill(T.revoked, { date: f.dateTime(s.revokedAt) })
                            : s.endsAt
                              ? fill(T.until, { date: f.dateTime(s.endsAt) })
                              : s.level === 'warning'
                                ? ''
                                : T.noEnd}{' '}
                          · {T.by[s.decidedByKind]}
                        </p>
                        <p>{s.reason}</p>
                        {s.appeals.map((a) => (
                          <p key={a.stage} className="text-muted-foreground text-xs">
                            {fill(T.appeal, { stage: a.stage, status: T.appealStatus[a.status] })}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
              </FramePanel>
            </Frame>

            <Frame>
              <FramePanel>
                <FrameHeader>
                  <FrameTitle>{T.notes}</FrameTitle>
                  <FrameDescription>{T.notesHint}</FrameDescription>
                </FrameHeader>
                {canNote && !file.deleted ? <UserNotesForm profileId={file.profileId} /> : null}
                {file.notes.length === 0 ? (
                  <p className="text-muted-foreground py-4 text-sm">{T.noNotes}</p>
                ) : (
                  <ul className="mt-2 flex flex-col divide-y">
                    {file.notes.map((n) => (
                      <li key={n.id} className="py-2 text-sm">
                        <p className="text-muted-foreground text-xs">{f.dateTime(n.createdAt)}</p>
                        <p className="whitespace-pre-wrap">{n.body}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </FramePanel>
            </Frame>
          </>
        );
      }}
    </ClientArea>
  );
}

// Os params só são lidos dentro do Suspense (o Next recusa dado de requisição no shell do prerender)
async function UserFilePage({ params }: { params: Promise<{ profileId: string }> }) {
  const [t, { profileId: raw }] = await Promise.all([getT(), params]);
  return (
    <>
      <PageHeader
        title={t.chatPanel.userFile.title}
        kind="cliente"
        parents={[
          { path: '/client', label: t.client.title, kind: 'cliente' },
          { path: '/client/chat', label: t.chatPanel.title, kind: 'cliente' },
        ]}
      />
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 md:p-6">
        <UserFileView profileId={raw.toLowerCase()} />
      </div>
    </>
  );
}

export default function ClientChatUserFilePage({ params }: { params: Promise<{ profileId: string }> }) {
  return (
    <Suspense
      fallback={
        <LoadingStatus className="mx-auto w-full max-w-4xl p-4 md:p-6">
          <TablePanelSkeleton rows={4} columns={['flex-1', 'w-16']} />
        </LoadingStatus>
      }
    >
      <UserFilePage params={params} />
    </Suspense>
  );
}
