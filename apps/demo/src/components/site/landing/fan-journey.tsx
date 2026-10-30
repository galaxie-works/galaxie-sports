'use client';

import {
  ArrowDownRight,
  ArrowRight,
  Check,
  CirclePlay,
  Radio,
  Sparkles,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import { showcase, type TimelineEntry } from '@/lib/showcase';

import { Chip, Flag, TeamMark } from './parts';

type JourneyText = Dictionary['landing']['journey'];
type JourneyContext = Pick<Dictionary['landing'], 'bento' | 'layer'>;
type StepKey = keyof JourneyText['steps'];

const STEPS = [
  { key: 'watch', icon: Tv },
  { key: 'stakes', icon: Sparkles },
  { key: 'live', icon: Radio },
  { key: 'after', icon: CirclePlay },
] as const satisfies readonly { key: StepKey; icon: LucideIcon }[];

function JourneyPanel({
  active,
  t,
  context,
  locale,
}: {
  active: StepKey;
  t: JourneyText;
  context: JourneyContext;
  locale: Locale;
}) {
  const data = showcase(locale);
  const { round, semi } = data;
  const marketName = new Intl.DisplayNames([locale], { type: 'region' }).of(data.market) ?? data.market;

  if (active === 'watch') {
    const mediaLabels: Record<(typeof round.watch)[number]['medium'], string> = {
      free_tv: context.bento.watch.free_tv,
      pay_tv: context.bento.watch.pay_tv,
      streaming: context.bento.watch.streaming,
      youtube: context.bento.watch.youtube,
    };

    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs font-medium">{t.panel.where}</p>
          <Chip tone="brand">
            <Flag code={data.market} />
            {marketName}
          </Chip>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
          <p className="text-primary text-xs font-semibold tracking-wide uppercase">{round.competition}</p>
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <TeamMark team={round.home} size="md" />
              <span className="truncate text-sm font-semibold sm:text-base">{round.home.name}</span>
            </div>
            <span className="text-muted-foreground shrink-0 text-xs">×</span>
            <div className="flex min-w-0 items-center gap-2">
              <TeamMark team={round.away} size="md" />
              <span className="truncate text-sm font-semibold sm:text-base">{round.away.name}</span>
            </div>
          </div>
          <ul className="mt-5 grid grid-cols-2 gap-2">
            {round.watch.map(({ medium, count }) => (
              <li
                key={medium}
                className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5"
              >
                <span className="text-muted-foreground text-xs sm:text-sm">{mediaLabels[medium]}</span>
                <span className="font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      </>
    );
  }

  if (active === 'stakes') {
    const groups = [
      {
        team: round.home,
        items: round.stakes.filter((item) => item.team === 'home' || item.team === 'both'),
      },
      {
        team: round.away,
        items: round.stakes.filter((item) => item.team === 'away' || item.team === 'both'),
      },
    ];

    return (
      <>
        <p className="text-muted-foreground text-xs font-medium">{t.panel.stakes}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {groups.map(({ team, items }) => (
            <div key={team.name} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2">
                <TeamMark team={team} size="sm" />
                <span className="truncate text-sm font-semibold">{team.name}</span>
              </div>
              <ul className="mt-3 space-y-2">
                {items.map(({ key, warn }) => (
                  <li key={key} className="flex gap-2 text-xs leading-relaxed sm:text-sm">
                    <Check
                      className={
                        warn ? 'mt-0.5 size-4 shrink-0 text-amber-300' : 'text-primary mt-0.5 size-4 shrink-0'
                      }
                      aria-hidden
                    />
                    <span>{context.bento.stakes.list[key]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </>
    );
  }

  if (active === 'live') {
    const moment =
      semi.timeline.find(
        (entry): entry is Extract<TimelineEntry, { kind: 'goal' }> => entry.kind === 'goal',
      ) ??
      semi.timeline.find(
        (entry): entry is Extract<TimelineEntry, { kind: 'decisive' | 'decisiveMiss' }> =>
          entry.kind === 'decisive' || entry.kind === 'decisiveMiss',
      );

    if (!moment) return null;

    const isGoal = moment.kind === 'goal';
    const momentLabel = isGoal ? context.bento.timeline.goal : context.bento.timeline[moment.kind];
    const momentDetail =
      moment.kind === 'goal'
        ? `${moment.player} · ${fill(context.bento.timeline.assist, { name: moment.assist })}`
        : moment.player;
    const score = new Intl.NumberFormat(locale);
    const clock = moment.minute === null ? '—' : `${score.format(moment.minute)}’`;

    return (
      <>
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs font-medium">{t.panel.live}</p>
          <Chip tone="live">
            <span className="journey-live-dot size-1.5 rounded-full bg-current" aria-hidden />
            {context.bento.timeline.tag}
          </Chip>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
          <p className="text-muted-foreground text-center text-xs">{semi.competition}</p>
          <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
            <div className="flex flex-col items-center gap-2">
              <TeamMark team={semi.home} size="md" />
              <span className="text-xs font-medium sm:text-sm">{semi.home.name}</span>
            </div>
            <p className="text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">
              {score.format(semi.score.home)}
              <span className="text-muted-foreground px-2">–</span>
              {score.format(semi.score.away)}
            </p>
            <div className="flex flex-col items-center gap-2">
              <TeamMark team={semi.away} size="md" />
              <span className="text-xs font-medium sm:text-sm">{semi.away.name}</span>
            </div>
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/10 p-3">
            <span className="text-primary mt-0.5 text-sm font-semibold tabular-nums">{clock}</span>
            <span>
              <span className="block text-sm font-semibold">{momentLabel}</span>
              <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
                {momentDetail}
              </span>
            </span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="text-muted-foreground text-xs font-medium">{t.panel.after}</p>
      <div className="explore-card mt-4 rounded-2xl border p-5 sm:p-6">
        <span className="bg-primary/15 text-primary grid size-11 place-items-center rounded-xl">
          <ArrowDownRight className="size-5" aria-hidden />
        </span>
        <h3 className="mt-4 text-lg font-semibold tracking-tight">{context.layer.pillars.related.title}</h3>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {context.layer.pillars.related.body}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {[t.panel.highlights, t.panel.goals, t.panel.press].map((item) => (
            <Chip key={item}>{item}</Chip>
          ))}
        </div>
      </div>
    </>
  );
}

/** Jornada interativa: muda a demonstração conforme o visitante percorre os momentos do torcedor. */
export function FanJourney({
  t,
  context,
  locale,
}: {
  t: JourneyText;
  context: JourneyContext;
  locale: Locale;
}) {
  const [active, setActive] = useState<StepKey>('watch');
  const progress = (STEPS.findIndex((step) => step.key === active) / (STEPS.length - 1)) * 100;

  return (
    <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-10">
      <div className="relative">
        <div className="absolute top-5 bottom-5 left-[19px] w-px bg-white/10" aria-hidden>
          <span
            className="journey-progress absolute top-0 left-0 w-px bg-primary"
            style={{ height: `${progress}%` }}
          />
        </div>
        <ol className="relative flex flex-col gap-2">
          {STEPS.map(({ key, icon: Icon }, index) => {
            const step = t.steps[key];
            const selected = active === key;

            return (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setActive(key)}
                  className="group flex w-full items-start gap-4 rounded-2xl p-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none sm:p-4"
                >
                  <span
                    className={
                      selected
                        ? 'bg-primary text-primary-foreground z-10 grid size-10 shrink-0 place-items-center rounded-full ring-4 ring-background transition-colors'
                        : 'bg-card text-muted-foreground z-10 grid size-10 shrink-0 place-items-center rounded-full border border-white/10 ring-4 ring-background transition-colors group-hover:text-foreground'
                    }
                  >
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 pt-0.5">
                    <span className="text-primary text-[11px] font-semibold tracking-wide uppercase">
                      {step.label}
                    </span>
                    <span className="mt-1 block text-lg font-semibold tracking-tight sm:text-xl">
                      {step.title}
                    </span>
                    <span className="text-muted-foreground mt-1 block text-sm leading-relaxed">
                      {step.body}
                    </span>
                  </span>
                  {selected ? (
                    <ArrowRight className="text-primary mt-2 ml-auto size-4 shrink-0" aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="journey-stage relative min-h-[360px] overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(100%_80%_at_100%_0%,oklch(0.598_0.2_279.4/0.18),transparent_70%),linear-gradient(145deg,oklch(0.21_0.018_250),oklch(0.16_0.012_250))] p-4 sm:min-h-[390px] sm:p-6">
        <div
          className="pointer-events-none absolute -right-16 -bottom-20 size-56 rounded-full bg-primary/10 blur-3xl"
          aria-hidden
        />
        <div className="journey-panel-in relative" key={active} aria-live="polite">
          <div className="mb-5 flex items-center justify-between gap-3 border-b border-white/10 pb-4">
            <span className="text-muted-foreground text-xs font-medium">{t.panel.sample}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {String(STEPS.findIndex((step) => step.key === active) + 1).padStart(2, '0')} / 04
            </span>
          </div>
          <JourneyPanel active={active} t={t} context={context} locale={locale} />
        </div>
      </div>
    </div>
  );
}
