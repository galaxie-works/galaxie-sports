import {
  ArrowLeftRight,
  Check,
  Goal,
  Maximize2,
  MonitorPlay,
  Play,
  RectangleVertical,
  Sparkles,
  Target,
  TriangleAlert,
  Tv,
  TvMinimal,
  type LucideIcon,
} from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import type { Locale } from '@/lib/i18n/config';
import { apiLocale } from '@/lib/i18n/config';
import { getDictionary, type Dictionary } from '@/lib/i18n/dictionary';
import { fill, plural } from '@/lib/i18n/text';
import { showcase, ZONES, type TimelineEntry } from '@/lib/showcase';
import { cn } from '@/lib/utils';

import { ExampleDialog } from './example-dialog';
import { Cell, Chip, Flag, TeamMark } from './parts';

type Text = Dictionary['landing']['bento'];
type AppText = Dictionary['landing']['app'];

const regionName = (locale: Locale) => new Intl.DisplayNames([locale], { type: 'region' });

/** Placar e minuto a minuto da semifinal, com o resumo gerado por IA. */
function TimelineWidget({ t, app, locale }: { t: Text['timeline']; app: AppText; locale: Locale }) {
  const SEMI = showcase(locale).semi;
  const nf = new Intl.NumberFormat(locale);
  const icon: Record<TimelineEntry['kind'], LucideIcon> = {
    goal: Goal,
    yellow: RectangleVertical,
    red: RectangleVertical,
    sub: ArrowLeftRight,
    decisive: Target,
    decisiveMiss: Target,
  };
  const team = (side: 'home' | 'away') => (side === 'home' ? SEMI.home : SEMI.away);
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-background/50 rounded-xl p-4 ring-1 ring-white/10">
        <p className="text-muted-foreground text-center text-xs">
          {fill(t.stage, { competition: SEMI.competition })}
        </p>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
            <TeamMark team={SEMI.home} size="lg" />
            <span className="truncate text-sm font-medium">{SEMI.home.name}</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
              {nf.format(SEMI.score.home)}
              <span className="text-muted-foreground mx-2 font-normal">–</span>
              {nf.format(SEMI.score.away)}
            </span>
            <Chip>{t.status}</Chip>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
            <TeamMark team={SEMI.away} size="lg" />
            <span className="truncate text-sm font-medium">{SEMI.away.name}</span>
          </div>
        </div>
        <p className="mt-3 text-center text-sm font-medium">
          {fill(t.shootout, { home: nf.format(SEMI.shootout.home), away: nf.format(SEMI.shootout.away) })}
        </p>
      </div>

      <ol className="flex flex-col">
        {SEMI.timeline.map((entry, i) => {
          const Icon = icon[entry.kind];
          const label = t[entry.kind];
          const who =
            entry.kind === 'sub'
              ? fill(t.subDetail, { in: entry.in, out: entry.out })
              : entry.kind === 'goal'
                ? `${entry.player}, ${fill(t.assist, { name: entry.assist })}`
                : entry.player;
          return (
            <li key={i} className="flex items-start gap-3 border-b border-white/5 py-2.5 last:border-0">
              <span className="text-muted-foreground w-9 shrink-0 pt-0.5 text-right text-sm tabular-nums">
                {entry.minute === null ? '—' : `${nf.format(entry.minute)}’`}
              </span>
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full ring-1 ring-white/10',
                  entry.kind === 'goal' || entry.kind === 'decisive'
                    ? 'bg-primary/20 text-primary'
                    : entry.kind === 'decisiveMiss'
                      ? 'bg-live/15 text-live'
                      : 'bg-background/60',
                )}
              >
                <Icon
                  className={cn(
                    'size-3.5',
                    entry.kind === 'yellow' && 'fill-amber-300 text-amber-300',
                    entry.kind === 'red' && 'fill-red-500 text-red-500',
                  )}
                  aria-hidden
                />
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground"> · {team(entry.side).name}</span>
                <span className="text-muted-foreground block truncate">{who}</span>
              </span>
            </li>
          );
        })}
      </ol>

      <div className="bg-primary/10 border-primary/25 rounded-xl border p-4">
        <p className="text-primary flex items-center gap-1.5 text-xs font-semibold">
          <Sparkles className="size-3.5" aria-hidden />
          {t.recapLabel}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-pretty">{t.recap}</p>
      </div>

      <ExampleDialog
        src="/exemplo/jogo"
        title={fill(app.title, { home: SEMI.home.name, away: SEMI.away.name })}
        description={app.description}
        closeLabel={app.close}
        fullScreenLabel={app.fullScreen}
        triggerClassName={cn(buttonVariants({ size: 'lg' }), 'h-11 w-full text-base')}
      >
        <Maximize2 className="size-4" aria-hidden />
        {app.open}
      </ExampleDialog>
    </div>
  );
}

/** O que está em jogo para cada time (e para os dois) no próximo jogo. */
function StakesWidget({ t, locale }: { t: Text['stakes']; locale: Locale }) {
  const ROUND = showcase(locale).round;
  const groups = (['home', 'away', 'both'] as const)
    .map((side) => {
      const rows = ROUND.stakes.filter((s) => s.team === side);
      return {
        side,
        team: side === 'both' ? null : ROUND[side],
        items: rows.filter((s) => !s.warn).map((s) => t.list[s.key]),
        warn: rows.filter((s) => s.warn).map((s) => t.list[s.key]),
      };
    })
    .filter((g) => g.items.length || g.warn.length);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">{fill(t.stage, { competition: ROUND.competition })}</p>
      {groups.map(({ side, team, items, warn }) => (
        <div key={side} className="bg-background/50 rounded-xl p-3 ring-1 ring-white/10">
          <p className="flex items-center gap-2 text-sm font-medium">
            {team ? (
              <>
                <TeamMark team={team} size="sm" />
                <span className="truncate">{team.name}</span>
              </>
            ) : (
              <>
                <span className="flex -space-x-2">
                  <TeamMark team={ROUND.home} size="sm" />
                  <TeamMark team={ROUND.away} size="sm" />
                </span>
                <span className="truncate">{t.both}</span>
              </>
            )}
          </p>
          <ul className="mt-2.5 flex flex-col gap-1.5 text-sm">
            {items.map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
            {warn.map((item) => (
              <li key={item} className="flex gap-2 text-amber-200">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Confronto direto: retrospecto, gols e os duelos mais recentes entre os dois times. */
function H2HWidget({ t, locale }: { t: Text['h2h']; locale: Locale }) {
  const H2H = showcase(locale).h2h;
  const nf = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const segments = [
    { key: 'home', value: H2H.home.wins, color: H2H.home.color },
    { key: 'draws', value: H2H.draws, color: 'oklch(0.45 0.02 280)' },
    { key: 'away', value: H2H.away.wins, color: H2H.away.color },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        {[H2H.home, H2H.away].map((team, i) => (
          <div
            key={team.name}
            className={cn('flex min-w-0 items-center gap-2.5', i === 1 && 'flex-row-reverse text-right')}
          >
            <TeamMark team={team} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{team.name}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {fill(t.goals, { n: nf.format(team.goals) })}
              </span>
            </span>
          </div>
        ))}
      </div>
      <div>
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {segments.map((s) => (
            <span key={s.key} style={{ width: `${(s.value / H2H.played) * 100}%`, background: s.color }} />
          ))}
        </div>
        <div className="text-muted-foreground mt-2 flex justify-between gap-2 text-xs tabular-nums">
          <span>{plural(locale, H2H.home.wins, t.wins)}</span>
          <span>{fill(t.record, { matches: nf.format(H2H.played), draws: nf.format(H2H.draws) })}</span>
          <span>{plural(locale, H2H.away.wins, t.wins)}</span>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {H2H.meetings.map((m) => {
          const home = m.home === 'home' ? H2H.home : H2H.away;
          const away = m.home === 'home' ? H2H.away : H2H.home;
          const stage =
            m.stage === 'round' || m.stage === 'groupRound'
              ? fill(t[m.stage], { n: nf.format(m.round ?? 0) })
              : t[m.stage];
          return (
            <li
              key={m.date}
              className="bg-background/50 flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-white/5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{stage}</span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {m.competition} · {date.format(new Date(m.date))}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                <TeamMark team={home} size="sm" />
                {nf.format(m.score[0])}–{nf.format(m.score[1])}
                <TeamMark team={away} size="sm" />
              </span>
            </li>
          );
        })}
      </ul>
      {H2H.meetings[0]?.penalties ? (
        <p className="text-muted-foreground -mt-2 text-[11px]">
          {fill(t.penalties, {
            score: `${nf.format(H2H.meetings[0].penalties[0])}–${nf.format(H2H.meetings[0].penalties[1])}`,
          })}
          {' · '}
          {H2H.meetings[0].competition}
        </p>
      ) : null}
    </div>
  );
}

/** Nota de relevância do jogo em cada mercado, com o motivo. */
function RelevanceWidget({ t, locale }: { t: Text['relevance']; locale: Locale }) {
  const SEMI = showcase(locale).semi;
  const nf = new Intl.NumberFormat(locale);
  const regions = regionName(locale);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        {SEMI.home.name} × {SEMI.away.name} · {SEMI.competition}
      </p>
      <ul className="flex flex-col gap-2.5">
        {SEMI.relevance.map((row) => (
          <li key={row.market}>
            <div className="flex items-center gap-2.5 text-sm">
              <Flag code={row.market} />
              <span className="w-24 shrink-0 truncate sm:w-28">{regions.of(row.market)}</span>
              <span className="bg-background/60 h-2 flex-1 overflow-hidden rounded-full ring-1 ring-white/5">
                <span className="bg-primary block h-full rounded-full" style={{ width: `${row.score}%` }} />
              </span>
              <span className="w-8 text-right font-medium tabular-nums">{nf.format(row.score)}</span>
            </div>
            {row.reason ? (
              <p className="text-muted-foreground mt-1 pl-[1.875rem] text-xs">{t[row.reason]}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Estatísticas lado a lado, com barras nas cores dos times. */
function StatsWidget({ t, locale }: { t: Text['stats']; locale: Locale }) {
  const SEMI = showcase(locale).semi;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm font-medium">
        <span className="flex items-center gap-2">
          <TeamMark team={SEMI.home} size="sm" />
          {SEMI.home.name}
        </span>
        <span className="flex items-center gap-2">
          {SEMI.away.name}
          <TeamMark team={SEMI.away} size="sm" />
        </span>
      </div>
      <dl className="flex flex-col gap-3">
        {SEMI.stats.map((s) => {
          const share = (s.home / (s.home + s.away)) * 100;
          return (
            <div key={s.key}>
              <div className="flex items-baseline justify-between text-sm tabular-nums">
                <dd className="font-medium">
                  {nf.format(s.home)}
                  {s.unit}
                </dd>
                <dt className="text-muted-foreground text-xs">{t[s.key]}</dt>
                <dd className="font-medium">
                  {nf.format(s.away)}
                  {s.unit}
                </dd>
              </div>
              <div className="mt-1.5 flex h-1.5 gap-1" aria-hidden>
                <span className="rounded-full" style={{ width: `${share}%`, background: SEMI.home.color }} />
                <span className="flex-1 rounded-full" style={{ background: SEMI.away.color }} />
              </div>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

const MEDIUM_ICONS: Record<ReturnType<typeof showcase>['round']['watch'][number]['medium'], LucideIcon> = {
  free_tv: Tv,
  pay_tv: TvMinimal,
  streaming: MonitorPlay,
  youtube: Play,
};

/** Onde assistir no Brasil, por tipo de mídia (sem nomes de canais na página pública). */
function WatchWidget({ t, locale }: { t: Text['watch']; locale: Locale }) {
  const { round: ROUND, market } = showcase(locale);
  const nf = new Intl.NumberFormat(locale);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground flex items-center gap-2 text-xs">
        <Flag code={market} />
        {regionName(locale).of(market)} · {ROUND.home.name} × {ROUND.away.name}
      </p>
      <ul className="grid grid-cols-2 gap-2">
        {ROUND.watch.map(({ medium, count }) => {
          const Icon = MEDIUM_ICONS[medium];
          return (
            <li
              key={medium}
              className="bg-background/50 flex flex-col gap-2 rounded-xl p-3 ring-1 ring-white/10"
            >
              <span className="flex items-center justify-between">
                <Icon className="text-primary size-4" aria-hidden />
                <span className="text-lg font-semibold tabular-nums">{nf.format(count)}</span>
              </span>
              <span className="text-sm font-medium">{t[medium]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** O mesmo jogo no horário de cada mercado. */
function ScheduleWidget({ locale }: { locale: Locale }) {
  const ROUND = showcase(locale).round;
  const start = new Date(ROUND.startsAt);
  return (
    <ul className="flex flex-col gap-2">
      {ZONES.map((z) => {
        const time = new Intl.DateTimeFormat(locale, {
          timeZone: z.timeZone,
          hour: 'numeric',
          minute: '2-digit',
          hourCycle: locale === 'en' ? 'h12' : 'h23',
        }).format(start);
        const day = new Intl.DateTimeFormat(locale, {
          timeZone: z.timeZone,
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(start);
        return (
          <li
            key={z.timeZone}
            className={cn(
              'flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-white/10',
              z.market === showcase(locale).market ? 'bg-primary/15 ring-primary/30' : 'bg-background/50',
            )}
          >
            <Flag code={z.market} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{z.city}</span>
              <span className="text-muted-foreground block text-xs">{day}</span>
            </span>
            <span className="text-lg font-semibold tabular-nums">{time}</span>
          </li>
        );
      })}
    </ul>
  );
}

const METHOD = 'GET';

/** JSON numa linha, com espaço depois de `:` e `,` (`{ "a": 1, "b": [2, 3] }`). */
function inlineJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inlineJson).join(', ')}]`;
  if (value && typeof value === 'object')
    return `{ ${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`)
      .join(', ')} }`;
  return JSON.stringify(value);
}

/** Indenta só o necessário: o que cabe em `width` colunas fica numa linha. */
function compactJson(value: unknown, indent = '', width = 80): string {
  const flat = inlineJson(value);
  if (indent.length + flat.length <= width || !value || typeof value !== 'object') return flat;
  const next = `${indent}  `;
  if (Array.isArray(value))
    return `[\n${value.map((v) => next + compactJson(v, next, width)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value)
    .map(([k, v]) => `${next}${JSON.stringify(k)}: ${compactJson(v, next, width)}`)
    .join(',\n')}\n${indent}}`;
}

/** Colore o JSON do exemplo (chaves, textos e números), sem biblioteca. */
function JsonView({ value }: { value: unknown }) {
  const json = compactJson(value);
  // índices ímpares: os trechos capturados (textos entre aspas e números)
  const parts = json.split(/("(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b)/g);
  return (
    <code>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const isKey = part.startsWith('"') && (parts[i + 1] ?? '').startsWith(':');
        const cls = isKey ? 'text-sky-300' : part.startsWith('"') ? 'text-emerald-300' : 'text-amber-300';
        return (
          <span key={i} className={cls}>
            {part}
          </span>
        );
      })}
    </code>
  );
}

/** Trecho real da resposta de `/v1/events/{id}` (tags do torcedor e o que está em jogo). */
function ApiWidget({ locale }: { locale: Locale }) {
  const ROUND = showcase(locale).round;
  const content = apiLocale(locale);
  const s = getDictionary(content === 'pt-BR' ? 'pt-BR' : 'es-AR').landing.bento.stakes;
  const sample = {
    competition: { name: ROUND.competition },
    participants: [
      {
        name: ROUND.home.name,
        nickname: ROUND.home.nickname,
        fan_tags: [{ code: ROUND.api.tagCode, text: { [content]: s.tags.a } }],
      },
    ],
    stakes: [
      {
        team: ROUND.api.stakeTeam,
        code: ROUND.api.stakeCode,
        text: { [content]: s.list[ROUND.api.stakeKey] },
      },
    ],
  };
  return (
    <div className="overflow-hidden rounded-xl bg-[#07070c] ring-1 ring-white/10">
      <p className="border-b border-white/10 px-4 py-2 font-mono text-xs">
        <span className="text-emerald-300">{METHOD}</span>{' '}
        <span className="text-muted-foreground">{`/v1/events/{id}?locale=${content}`}</span>
      </p>
      <pre translate="no" className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-relaxed">
        <JsonView value={sample} />
      </pre>
    </div>
  );
}

/**
 * Grade do que a API entrega: exemplos reais (amostra em `lib/showcase.ts`) desenhados no estilo do
 * app. Estática: nada aqui chama a API.
 */
export function Bento({ t, app, locale }: { t: Text; app: AppText; locale: Locale }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
      <Cell
        tag={t.timeline.tag}
        title={t.timeline.title}
        body={t.timeline.body}
        hue={279}
        className="md:col-span-2 lg:col-span-4 lg:row-span-2"
      >
        <TimelineWidget t={t.timeline} app={app} locale={locale} />
      </Cell>
      <Cell
        tag={t.stakes.tag}
        title={t.stakes.title}
        body={t.stakes.body}
        hue={300}
        className="lg:col-span-2"
      >
        <StakesWidget t={t.stakes} locale={locale} />
      </Cell>
      <Cell tag={t.h2h.tag} title={t.h2h.title} body={t.h2h.body} hue={20} className="lg:col-span-2">
        <H2HWidget t={t.h2h} locale={locale} />
      </Cell>
      <Cell
        tag={t.relevance.tag}
        title={t.relevance.title}
        body={t.relevance.body}
        hue={248}
        className="lg:col-span-3"
      >
        <RelevanceWidget t={t.relevance} locale={locale} />
      </Cell>
      <Cell tag={t.stats.tag} title={t.stats.title} hue={262} className="lg:col-span-3">
        <StatsWidget t={t.stats} locale={locale} />
      </Cell>
      <Cell tag={t.watch.tag} title={t.watch.title} body={t.watch.body} hue={292} className="lg:col-span-3">
        <WatchWidget t={t.watch} locale={locale} />
      </Cell>
      <Cell
        tag={t.schedule.tag}
        title={t.schedule.title}
        body={t.schedule.body}
        hue={238}
        className="lg:col-span-3"
      >
        <ScheduleWidget locale={locale} />
      </Cell>
      <Cell
        tag={t.api.tag}
        title={t.api.title}
        body={t.api.body}
        hue={268}
        className="md:col-span-2 lg:col-span-6 lg:grid lg:grid-cols-[1fr_1.6fr] lg:items-center lg:gap-10"
      >
        <ApiWidget locale={locale} />
      </Cell>
    </div>
  );
}
