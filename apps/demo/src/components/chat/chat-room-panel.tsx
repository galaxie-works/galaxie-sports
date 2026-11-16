'use client';

import { MoreHorizontal, Pin } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/reui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  authorAction,
  roomAction,
  pinMessageAction,
  roomMessagesAction,
  setMessageHiddenAction,
} from '@/lib/chat/panel-actions';
import type { PanelMessage } from '@/lib/chat/panel-data';
import { SLOW_MODE_OPTIONS, type AuthorAction } from '@/lib/chat/panel-utils';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/** O que o cargo abre nesta sala (o servidor confere de novo a cada ação). */
export interface RoomPermissions {
  hide: boolean;
  pin: boolean;
  /** Abre a ficha do torcedor (cargo do tenant inteiro, não de uma sala). */
  file: boolean;
  room: boolean;
  muteMinutes: number[];
  shadowMinutes: number[];
  suspendDays: number[];
  ban: boolean;
}

const POLL_MS = 3_000;

/** Painel ao vivo de uma sala (#973): mensagens a cada 3 s, ações na mensagem, no autor e na sala. */
export function ChatRoomPanel({
  fixtureId,
  title,
  state,
  slowModeSeconds,
  initial,
  can,
  timeZone,
}: {
  fixtureId: string;
  title: string;
  state: 'open' | 'frozen' | 'read_only_peak' | null;
  slowModeSeconds: number | null;
  initial: PanelMessage[];
  can: RoomPermissions;
  timeZone: string;
}) {
  const { t } = useI18n();
  const T = t.chatPanel.room;
  const f = useFormatters(timeZone);
  const [messages, setMessages] = useState(initial);
  const [roomState, setRoomState] = useState(state);
  const [slow, setSlow] = useState<string>(slowModeSeconds === null ? 'default' : String(slowModeSeconds));
  const [pending, start] = useTransition();
  const [banTarget, setBanTarget] = useState<{ profileId: string; name: string } | null>(null);

  // uma consulta por vez (a próxima só sai depois da resposta) e nada com a aba escondida
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (!document.hidden) {
        const next = await roomMessagesAction(fixtureId).catch(() => null);
        if (alive && next) setMessages(next);
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [fixtureId]);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void, undo?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        undo?.();
        return void toast.error(r.error ?? t.chatPanel.errors.generic);
      }
      after?.();
      toast.success(T.done);
      const next = await roomMessagesAction(fixtureId).catch(() => null);
      if (next) setMessages(next);
    });

  const punish = (profileId: string, action: AuthorAction, amount?: number) =>
    run(() => authorAction({ fixtureId, profileId, action, ...(amount !== undefined ? { amount } : {}) }));

  const minutesLabel = (m: number) => T.author.minutes[String(m) as keyof typeof T.author.minutes];
  const daysLabel = (d: number) => (d === 1 ? T.author.day : fill(T.author.days, { count: d }));

  return (
    <Frame>
      <FramePanel>
        <FrameHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <FrameTitle>{title}</FrameTitle>
            <FrameDescription>{T.live}</FrameDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {roomState ? (
              <Badge variant={roomState === 'open' ? 'success-light' : 'warning-light'} radius="full">
                {t.chatPanel.rooms.state[roomState]}
              </Badge>
            ) : null}
            {can.room ? (
              <>
                <Select
                  value={slow}
                  onValueChange={(picked) => {
                    const v = picked ?? 'default';
                    const before = slow;
                    setSlow(v);
                    run(
                      () =>
                        roomAction({
                          fixtureId,
                          action: 'slow_mode',
                          slowModeSeconds: v === 'default' ? null : Number(v),
                        }),
                      undefined,
                      () => setSlow(before),
                    );
                  }}
                >
                  <SelectTrigger aria-label={T.slowMode} className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{T.slowDefault}</SelectItem>
                    {SLOW_MODE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s === 0 ? T.slowOff : fill(T.slowSeconds, { count: s })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {roomState !== 'read_only_peak' ? (
                  <Button
                    variant={roomState === 'frozen' ? 'outline' : 'destructive'}
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      const next = roomState === 'frozen' ? 'open' : 'frozen';
                      run(
                        () => roomAction({ fixtureId, action: next === 'frozen' ? 'freeze' : 'open' }),
                        () => setRoomState(next),
                      );
                    }}
                  >
                    {roomState === 'frozen' ? T.unfreeze : T.freeze}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </FrameHeader>

        {messages.length === 0 ? (
          <p className="text-muted-foreground py-6 text-sm">{roomState ? T.empty : T.noRoom}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {messages.map((m) => {
              const name = m.nickname ?? T.author.unknown;
              const anyAuthor =
                can.muteMinutes.length || can.shadowMinutes.length || can.suspendDays.length || can.ban;
              return (
                <li key={m.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium">{name}</span>
                      <span className="text-muted-foreground">{f.time(m.createdAt)}</span>
                      {m.pinned ? (
                        <Badge variant="info-light" radius="full">
                          <Pin aria-hidden />
                          {T.pinned}
                        </Badge>
                      ) : null}
                      {m.visibility !== 'public' ? (
                        <Badge
                          variant={m.visibility === 'hidden' ? 'destructive-light' : 'warning-light'}
                          radius="full"
                        >
                          {T.visibility[m.visibility]}
                        </Badge>
                      ) : null}
                    </div>
                    <p
                      className={
                        m.visibility === 'hidden' ? 'text-muted-foreground text-sm line-through' : 'text-sm'
                      }
                    >
                      {m.body}
                    </p>
                  </div>
                  {can.hide || can.pin || can.file || anyAuthor ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={pending}
                            aria-label={fill(T.author.menu, { name })}
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-60">
                        {can.hide ? (
                          <DropdownMenuItem
                            onClick={() =>
                              run(() =>
                                setMessageHiddenAction({
                                  fixtureId,
                                  messageId: m.id,
                                  hidden: m.visibility !== 'hidden',
                                }),
                              )
                            }
                          >
                            {m.visibility === 'hidden' ? T.restore : T.hide}
                          </DropdownMenuItem>
                        ) : null}
                        {can.pin && (m.pinned || m.visibility === 'public') ? (
                          <DropdownMenuItem
                            onClick={() =>
                              run(() => pinMessageAction({ fixtureId, messageId: m.pinned ? null : m.id }))
                            }
                          >
                            {m.pinned ? T.unpin : T.pin}
                          </DropdownMenuItem>
                        ) : null}
                        {can.file ? (
                          <DropdownMenuItem render={<Link href={`/client/chat/users/${m.profileId}`} />}>
                            {T.file}
                          </DropdownMenuItem>
                        ) : null}
                        {can.muteMinutes.length ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>{T.author.mute}</DropdownMenuLabel>
                            {can.muteMinutes.map((min) => (
                              <DropdownMenuItem
                                key={`m${min}`}
                                onClick={() => punish(m.profileId, 'mute', min)}
                              >
                                {minutesLabel(min)}
                              </DropdownMenuItem>
                            ))}
                          </>
                        ) : null}
                        {can.shadowMinutes.length ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>{T.author.shadowMute}</DropdownMenuLabel>
                            {can.shadowMinutes.map((min) => (
                              <DropdownMenuItem
                                key={`s${min}`}
                                onClick={() => punish(m.profileId, 'shadow_mute', min)}
                              >
                                {minutesLabel(min)}
                              </DropdownMenuItem>
                            ))}
                          </>
                        ) : null}
                        {can.suspendDays.length ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>{T.author.suspend}</DropdownMenuLabel>
                            {can.suspendDays.map((d) => (
                              <DropdownMenuItem
                                key={`d${d}`}
                                onClick={() => punish(m.profileId, 'suspend', d)}
                              >
                                {daysLabel(d)}
                              </DropdownMenuItem>
                            ))}
                          </>
                        ) : null}
                        {can.ban ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setBanTarget({ profileId: m.profileId, name })}
                            >
                              {T.author.ban}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </FramePanel>
      <AlertDialog open={banTarget !== null} onOpenChange={(open) => !open && setBanTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{T.author.ban}</AlertDialogTitle>
            <AlertDialogDescription>
              {banTarget ? fill(T.author.confirmBan, { name: banTarget.name }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (banTarget) punish(banTarget.profileId, 'ban');
                setBanTarget(null);
              }}
            >
              {T.author.ban}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Frame>
  );
}
