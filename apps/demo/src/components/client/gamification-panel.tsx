'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import {
  activateProgramAction,
  setAchievementEnabledAction,
  type GamificationActionResult,
} from '@/app/[locale]/(app)/client/gamification/actions';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { GamificationOverview } from '@/lib/client/gamification';
import { useFormatters, useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';

/** Idioma dos textos do Catálogo (gravados em pt, es e en). */
const CATALOG_LANG: Record<string, 'pt' | 'es' | 'en'> = { 'pt-BR': 'pt', en: 'en', 'es-AR': 'es' };

/**
 * Cliente → Engajamento → Gamificação (#917): os programas por país-alvo, o resumo do programa aberto e as Conquistas
 * do Catálogo da Galaxie, que o cliente liga ou desliga no programa. O servidor confere tudo de novo ao gravar.
 */
export function GamificationPanel({ data }: { data: GamificationOverview }) {
  const { t, locale } = useI18n();
  const T = t.gamification;
  const f = useFormatters('UTC');
  const router = useRouter();
  const [pending, start] = useTransition();
  const lang = CATALOG_LANG[locale] ?? 'pt';
  const countryName = (code: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  function run(action: () => Promise<GamificationActionResult>, ok: string) {
    start(async () => {
      const r = await action();
      if (!r.ok) {
        toast.error(r.error ?? T.errors.generic);
        return;
      }
      toast.success(ok);
      router.refresh();
    });
  }

  const report = data.report;
  const metrics: [string, number][] = report
    ? [
        [T.report.fans, report.fans],
        [T.report.predictions, report.predictions],
        [T.report.predictionsFinal, report.predictionsFinal],
        [T.report.steps, report.steps],
        [T.report.cards, report.cards],
        [T.report.points, report.pointsIssued],
      ]
    : [];
  const catalog = [...data.catalog].sort((a, b) =>
    (a.name[lang] ?? a.id).localeCompare(b.name[lang] ?? b.id, locale, { sensitivity: 'base' }),
  );
  const selected = data.selected;

  return (
    <div className="flex flex-col gap-4">
      <Frame>
        <FramePanel className="p-0">
          <FrameHeader className="flex flex-col gap-1 p-4">
            <FrameTitle>{T.programs.title}</FrameTitle>
            <FrameDescription>{T.programs.description}</FrameDescription>
          </FrameHeader>
          {data.programs.length === 0 ? (
            <p className="text-muted-foreground border-t p-4 text-sm">{T.programs.empty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.programs.country}</TableHead>
                  <TableHead>{T.programs.state}</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.programs.map((p) => (
                  <TableRow key={p.country} data-state={p.country === selected ? 'selected' : undefined}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {countryName(p.country)}
                        {p.primary ? <Badge variant="secondary">{T.programs.primary}</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      {p.active ? (
                        <Badge variant={p.status === 'paused' ? 'warning-light' : 'success-light'}>
                          {p.status === 'paused' ? T.programs.paused : T.programs.active}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">{T.programs.none}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {p.active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={p.country === selected}
                          onClick={() => router.push(`?country=${p.country}`)}
                        >
                          {T.programs.open}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(() => activateProgramAction({ country: p.country }), T.programs.activated)
                          }
                        >
                          {T.programs.activate}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </FramePanel>
      </Frame>

      {selected && report ? (
        <Frame>
          <FramePanel className="p-0">
            <FrameHeader className="p-4">
              <FrameTitle>{fill(T.report.title, { country: countryName(selected) })}</FrameTitle>
            </FrameHeader>
            <dl className="grid grid-cols-2 gap-4 border-t p-4 md:grid-cols-3">
              {metrics.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="text-xl font-semibold tabular-nums">{f.number(value)}</dd>
                </div>
              ))}
            </dl>
          </FramePanel>
        </Frame>
      ) : null}

      {selected ? (
        <Frame>
          <FramePanel className="p-0">
            <FrameHeader className="flex flex-col gap-1 p-4">
              <FrameTitle>{fill(T.catalog.title, { country: countryName(selected) })}</FrameTitle>
              <FrameDescription>{T.catalog.description}</FrameDescription>
            </FrameHeader>
            {catalog.length === 0 ? (
              <p className="text-muted-foreground border-t p-4 text-sm">{T.catalog.empty}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{T.catalog.name}</TableHead>
                    <TableHead>{T.catalog.family}</TableHead>
                    <TableHead>{T.catalog.steps}</TableHead>
                    <TableHead className="text-right">{T.catalog.holders}</TableHead>
                    <TableHead className="w-32 text-right">{T.catalog.enabled}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {catalog.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium">{a.name[lang] ?? a.id}</span>
                          <span className="text-muted-foreground text-xs">
                            {a.available ? (a.description[lang] ?? '') : T.catalog.unavailableHint}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {T.catalog.families[a.family as keyof typeof T.catalog.families] ?? a.family}
                      </TableCell>
                      <TableCell className="tabular-nums">{a.thresholds.join(' · ')}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.number(a.holders)}</TableCell>
                      <TableCell className="text-right">
                        {a.available ? (
                          <Switch
                            checked={a.enabled}
                            disabled={pending}
                            aria-label={a.name[lang] ?? a.id}
                            onCheckedChange={(enabled) =>
                              run(
                                () =>
                                  setAchievementEnabledAction({
                                    country: selected,
                                    achievementId: a.id,
                                    enabled,
                                  }),
                                T.catalog.saved,
                              )
                            }
                          />
                        ) : (
                          <Badge variant="secondary">{T.catalog.unavailable}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </FramePanel>
        </Frame>
      ) : null}
    </div>
  );
}
