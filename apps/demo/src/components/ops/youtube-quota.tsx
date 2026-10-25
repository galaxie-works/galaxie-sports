'use client';

import { Video } from 'lucide-react';

import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import type { YoutubeSnapshot } from '@/lib/ops/types';

/** Rendimento zero recorrente (o mesmo corte do agente: ≥ 6 consultas e nenhum vídeo). */
const ZERO_YIELD_MIN_SEARCHES = 6;

/** Barra empilhada: gasto, reservado e livre (a reserva só existe no balde de busca). */
function StackedBar({ limit, used, reserved = 0 }: { limit: number; used: number; reserved?: number }) {
  const pct = (n: number) => (limit > 0 ? Math.max(0, Math.min(100, (n / limit) * 100)) : 0);
  const usedPct = pct(used);
  const reservedPct = Math.min(100 - usedPct, pct(reserved));
  return (
    <div className="bg-muted flex h-2 w-full overflow-hidden rounded-full" aria-hidden>
      <div className="bg-primary h-full" style={{ width: `${usedPct}%` }} />
      <div className="bg-warning h-full opacity-70" style={{ width: `${reservedPct}%` }} />
    </div>
  );
}

/** Os dois baldes da cota do YouTube no dia de cota (resumo do Status e topo da aba Conteúdo relacionado). */
export function YoutubeQuotaCard({ youtube, timeZone }: { youtube: YoutubeSnapshot; timeZone: string }) {
  const { t } = useI18n();
  const T = t.ops.youtube;
  const f = useFormatters(timeZone);
  const n = (v: number) => f.number(v);
  const s = youtube.search;
  const a = youtube.api;
  const searchFree = Math.max(0, s.limit - s.used - s.reserved);
  return (
    <Frame>
      <FramePanel className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Video className="text-muted-foreground size-4" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold">{T.title}</span>
            <span className="text-muted-foreground text-xs">
              {fill(T.day, { day: youtube.quotaDay })}
              {youtube.updatedAt ? ` · ${fill(T.updated, { when: f.time(youtube.updatedAt) })}` : ''}
            </span>
          </div>
        </div>
        {!youtube.updatedAt ? <p className="text-muted-foreground text-xs">{T.never}</p> : null}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">{T.search}</span>
            <span className="text-xs tabular-nums">
              {fill(T.ofLimit, { used: n(s.used), limit: n(s.limit), unit: T.searchUnit })}
            </span>
          </div>
          <StackedBar limit={s.limit} used={s.used} reserved={s.reserved} />
          <div className="text-muted-foreground flex flex-wrap gap-x-3 text-[11px] tabular-nums">
            <span>{fill(T.used, { n: n(s.used) })}</span>
            <span>{fill(T.reserved, { n: n(Math.min(s.reserved, Math.max(0, s.limit - s.used))) })}</span>
            <span>{fill(T.free, { n: n(searchFree) })}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">{T.api}</span>
            <span className="text-xs tabular-nums">
              {fill(T.ofLimit, { used: n(a.used), limit: n(a.limit), unit: T.apiUnit })}
            </span>
          </div>
          <StackedBar limit={a.limit} used={a.used} />
          <div className="text-muted-foreground flex flex-wrap gap-x-3 text-[11px] tabular-nums">
            <span>{fill(T.used, { n: n(a.used) })}</span>
            <span>{fill(T.free, { n: n(Math.max(0, a.limit - a.used)) })}</span>
          </div>
        </div>
        <p className="text-muted-foreground text-[11px]">{T.reservedHint}</p>
        <p className="text-muted-foreground text-[11px]">
          {fill(T.channels, {
            club: n(youtube.channels.club),
            competition: n(youtube.channels.competition),
            broadcaster: n(youtube.channels.broadcaster),
          })}
        </p>
      </FramePanel>
    </Frame>
  );
}

/** Rendimento por competição (14 dias) e jogos pulados por cota no dia (aba Conteúdo relacionado). */
export function YoutubeYieldPanel({ youtube, timeZone }: { youtube: YoutubeSnapshot; timeZone: string }) {
  const { t } = useI18n();
  const T = t.ops.youtube;
  const f = useFormatters(timeZone);
  const C = T.yieldColumns;
  const S = T.skippedColumns;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{T.yieldTitle}</FrameTitle>
          </FrameHeader>
          {youtube.yields.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{C.competition}</TableHead>
                  <TableHead className="text-right">{C.games}</TableHead>
                  <TableHead className="text-right">{C.searches}</TableHead>
                  <TableHead className="text-right">{C.units}</TableHead>
                  <TableHead className="text-right">{C.searchVideos}</TableHead>
                  <TableHead className="text-right">{C.channelVideos}</TableHead>
                  <TableHead className="text-right">{C.perSearch}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {youtube.yields.map((r) => {
                  const zero =
                    r.searches >= ZERO_YIELD_MIN_SEARCHES && r.searchVideos === 0 && r.channelVideos === 0;
                  return (
                    <TableRow key={r.slug}>
                      <TableCell className="font-mono text-xs">
                        {r.slug}
                        {zero ? (
                          <Badge variant="warning-light" className="ml-2">
                            {T.zero}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{f.number(r.games)}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.number(r.searches)}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.number(r.apiUnits)}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.number(r.searchVideos)}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.number(r.channelVideos)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.searches ? f.number(Math.round((r.searchVideos / r.searches) * 10) / 10) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <FrameDescription className="px-4 pb-4">{T.yieldNone}</FrameDescription>
          )}
        </FramePanel>
      </Frame>
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="px-4 pt-4">
            <FrameTitle>{T.skippedTitle}</FrameTitle>
          </FrameHeader>
          {youtube.skipped.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{S.match}</TableHead>
                  <TableHead>{S.competition}</TableHead>
                  <TableHead className="text-right">{S.score}</TableHead>
                  <TableHead>{S.reason}</TableHead>
                  <TableHead className="text-right">{S.at}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {youtube.skipped.map((g) => (
                  <TableRow key={g.eventId}>
                    <TableCell className="text-sm">{g.label}</TableCell>
                    <TableCell className="font-mono text-xs">{g.competition ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.number(g.score)}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{g.reason}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{f.time(g.at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <FrameDescription className="px-4 pb-4">{T.skippedNone}</FrameDescription>
          )}
        </FramePanel>
      </Frame>
    </div>
  );
}
