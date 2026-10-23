import type { PersonMatch, PersonOverview, PersonSeasonStats } from '@galaxie/contracts';
import {
  Activity,
  ArrowRight,
  Calendar,
  Flag,
  History,
  ImageIcon,
  MapPin,
  Ruler,
  Trophy,
  UserRound,
  Weight,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { CountryFlag } from '@/components/sport/country-flag';
import { Crest } from '@/components/sport/crest';
import { FormChips } from '@/components/sport/form-chips';
import { SeasonSelect, type SeasonOption } from '@/components/sport/season-select';
import { Section } from '@/components/sport/section';
import { TeamBand } from '@/components/sport/team-band';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiCodeButton } from '@/components/docs/api-code-button';
import { initials } from '@/lib/format';
import { personOverviewRequest } from '@/lib/galaxie/api';
import type { ApiRequest } from '@/lib/galaxie/request';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

type T = Dictionary['pages']['person'];

/** Título da aba do navegador (e do histórico): o nome da página, não só "Galaxie Sports". */
export async function personMetadata(id: string, source: DataSource): Promise<Metadata> {
  const { locale } = await getI18n();
  try {
    return { title: (await source.getPersonOverview(id, locale)).person.name };
  } catch {
    return {};
  }
}

/** `?temporada=2025` da URL (o primeiro valor, se repetido); fora de um ano inteiro, nada. */
function seasonParam(raw: string | string[] | undefined): number | undefined {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return raw !== undefined && Number.isInteger(n) ? n : undefined;
}

/** Faixa da nota do fornecedor (0 a 10): verde a partir de 7,5, neutra até 6,5, alerta abaixo. */
import type { DataSource } from '@/lib/galaxie/source';
import type { PageContentProps } from './types';

const ratingTone = (r: number) =>
  r >= 7.5
    ? 'bg-success/15 text-success'
    : r >= 6.5
      ? 'bg-primary/10 text-primary'
      : 'bg-warning/15 text-warning';

function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Flag;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="bg-background/50 flex size-8 shrink-0 items-center justify-center rounded-md border backdrop-blur">
        <Icon className="text-muted-foreground size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-muted-foreground text-[11px] leading-tight">{label}</span>
        <span className="truncate text-sm font-medium">{children}</span>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string | null;
  accent?: string;
}) {
  return (
    <Card size="sm" className="gap-1">
      <CardContent className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className={cn('text-2xl font-semibold tracking-tight tabular-nums', accent)}>{value}</span>
        {hint ? <span className="text-muted-foreground truncate text-xs">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}

function CardsValue({ yellow, red }: { yellow: number; red: number }) {
  return (
    <span className="flex items-center gap-3">
      <span className="flex items-center gap-1.5">
        <span className="h-4 w-3 rounded-[2px] bg-yellow-400" aria-hidden />
        {yellow}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-4 w-3 rounded-[2px] bg-red-500" aria-hidden />
        {red}
      </span>
    </span>
  );
}

function Kpis({ o, t, locale, f }: { o: PersonOverview; t: T; locale: Locale; f: Formatters }) {
  const s = o.totals;
  if (!s) return null;
  if (o.role === 'coach') {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t.kpi.coached} value={f.number(s.appearances)} />
        <Kpi label={t.kpi.competitions} value={f.number(o.stats.length)} />
      </div>
    );
  }
  const perGoal = s.goals ? Math.round(s.minutes / s.goals) : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Kpi
        label={t.kpi.appearances}
        value={f.number(s.appearances)}
        hint={plural(locale, s.starts, t.starts)}
      />
      <Kpi
        label={t.kpi.goals}
        value={f.number(s.goals)}
        accent={s.goals ? 'text-primary' : undefined}
        hint={perGoal ? fill(t.minutesPerGoal, { minutes: f.number(perGoal) }) : null}
      />
      <Kpi label={t.kpi.assists} value={f.number(s.assists)} />
      <Kpi
        label={t.kpi.minutes}
        value={f.number(s.minutes)}
        hint={
          s.appearances ? fill(t.perMatch, { value: f.number(Math.round(s.minutes / s.appearances)) }) : null
        }
      />
      <Kpi
        label={t.kpi.rating}
        value={
          s.rating !== null ? (
            <span className={cn('rounded-md px-1.5', ratingTone(s.rating))}>{s.rating.toFixed(2)}</span>
          ) : (
            '–'
          )
        }
      />
      <Kpi label={t.kpi.cards} value={<CardsValue yellow={s.yellow_cards} red={s.red_cards} />} />
    </div>
  );
}

const COLUMNS = ['apps', 'starts', 'minutes', 'goals', 'assists', 'yellow', 'red', 'rating'] as const;
type Column = (typeof COLUMNS)[number];
const value = (s: PersonSeasonStats | NonNullable<PersonOverview['totals']>, c: Column) =>
  ({
    apps: s.appearances,
    starts: s.starts,
    minutes: s.minutes,
    goals: s.goals,
    assists: s.assists,
    yellow: s.yellow_cards,
    red: s.red_cards,
    rating: s.rating,
  })[c];

function StatsTable({
  o,
  t,
  f,
  api,
  season,
}: {
  o: PersonOverview;
  t: T;
  f: Formatters;
  api: ApiRequest;
  season: string;
}) {
  const coach = o.role === 'coach';
  const columns: readonly Column[] = coach ? ['apps'] : COLUMNS;
  const teams = new Set(o.stats.map((s) => s.team.id));
  // destaque: o maior valor de cada coluna (com mais de uma competição)
  const best = new Map<Column, number>();
  if (o.stats.length > 1)
    for (const c of columns) {
      const values = o.stats.map((s) => value(s, c) ?? -1);
      best.set(c, Math.max(...values));
    }
  const cell = (s: PersonSeasonStats | NonNullable<PersonOverview['totals']>, c: Column, total = false) => {
    const v = value(s, c);
    if (v === null) return <span className="text-muted-foreground">–</span>;
    if (c === 'rating')
      return (
        <span className={cn('rounded px-1.5 py-0.5 text-xs font-semibold', ratingTone(v))}>
          {v.toFixed(2)}
        </span>
      );
    const top = !total && v > 0 && best.get(c) === v && (c === 'goals' || c === 'assists' || c === 'apps');
    return <span className={cn(top && 'text-primary font-semibold')}>{f.number(v)}</span>;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.statsTitle}</CardTitle>
        <CardDescription>{fill(t.statsDescription, { season })}</CardDescription>
        <CardAction>
          <ApiCodeButton request={api} />
        </CardAction>
      </CardHeader>
      <CardContent className="-mx-2 overflow-x-auto px-2">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-xs">
              <th className="py-2 pr-2 text-left font-medium">{t.table.competition}</th>
              {columns.map((c) => (
                <th key={c} className="px-1.5 py-2 text-right font-medium" title={t.tableHints[c]}>
                  {t.table[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {o.stats.map((s) => (
              <tr key={`${s.competition.id}-${s.team.id}`} className="border-b last:border-0">
                <td className="py-2 pr-2">
                  <Link
                    href={`/competicoes/${s.competition.id}`}
                    className="flex min-w-0 items-center gap-2 hover:underline"
                  >
                    <Crest src={s.competition.logo} name={s.competition.name} size="xs" />
                    <span className="truncate font-medium">{s.competition.name}</span>
                    {s.source === 'matches' ? (
                      <Badge variant="outline" radius="full" size="sm" title={t.sourceMatchesHint}>
                        {t.sourceMatches}
                      </Badge>
                    ) : null}
                    {teams.size > 1 ? (
                      <span className="text-muted-foreground flex items-center gap-1 text-xs">
                        <Crest src={s.team.logo} name={s.team.name} size="xs" />
                        {s.team.short_name ?? s.team.name}
                      </span>
                    ) : null}
                  </Link>
                </td>
                {columns.map((c) => (
                  <td key={c} className="px-1.5 py-2 text-right tabular-nums">
                    {cell(s, c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {o.totals && o.stats.length > 1 ? (
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="py-2 pr-2">{t.total}</td>
                {columns.map((c) => (
                  <td key={c} className="px-1.5 py-2 text-right tabular-nums">
                    {cell(o.totals!, c, true)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </CardContent>
    </Card>
  );
}

/** Resultado do time da pessoa no jogo (V/E/D), pelo placar e pelo vencedor. */
function resultOf(m: PersonMatch): { result: string; score: string } | null {
  const e = m.event;
  const mine = e.participants.find((p) => p.id === m.team_id);
  const other = e.participants.find((p) => p.id !== m.team_id);
  if (!mine || !other || e.score.home == null || e.score.away == null) return null;
  const gf = mine.side === 'home' ? e.score.home : e.score.away;
  const ga = mine.side === 'home' ? e.score.away : e.score.home;
  const result =
    gf > ga ? 'W' : gf < ga ? 'L' : mine.winner === true ? 'W' : other.winner === true ? 'L' : 'D';
  return { result, score: `${gf}-${ga}` };
}

function MatchRow({ m, t, f, coach }: { m: PersonMatch; t: T; f: Formatters; coach: boolean }) {
  const e = m.event;
  const home = e.participants.find((p) => p.side === 'home') ?? e.participants[0];
  const away = e.participants.find((p) => p.side === 'away') ?? e.participants[1];
  const side = (p: typeof home, align: 'left' | 'right') =>
    p ? (
      <span
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2',
          align === 'right' && 'flex-row-reverse text-right',
          p.id === m.team_id && 'font-semibold',
        )}
      >
        <Crest src={p.logo} name={p.name} size="xs" />
        <span className="truncate">{p.short_name ?? p.name}</span>
      </span>
    ) : (
      <span className="flex-1" />
    );
  return (
    <Link
      href={`/eventos/${e.id}`}
      className="hover:bg-accent -mx-2 flex flex-col gap-1.5 rounded-md px-2 py-2.5 transition-colors sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 items-center gap-2 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start sm:gap-0.5">
        <span className="text-muted-foreground text-xs tabular-nums">{f.date(e.starts_at)}</span>
        {e.competition ? (
          <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
            <Crest src={e.competition.logo} name={e.competition.name} size="xs" />
            <span className="truncate">{e.competition.name}</span>
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        {side(home, 'left')}
        <span className="bg-muted shrink-0 rounded px-2 py-0.5 font-mono text-xs font-semibold tabular-nums">
          {e.score.home ?? '–'} - {e.score.away ?? '–'}
        </span>
        {side(away, 'right')}
      </div>
      {coach ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs sm:w-56 sm:justify-end">
          <Badge variant="outline" radius="full">
            {m.started ? t.starter : t.bench}
            {m.minutes !== null ? ` · ${m.minutes}'` : ''}
          </Badge>
          {m.goals ? (
            <Badge variant="primary-light" radius="full">
              {m.goals} {t.table.goals}
            </Badge>
          ) : null}
          {m.assists ? (
            <Badge variant="info-light" radius="full">
              {m.assists} {t.table.assists}
            </Badge>
          ) : null}
          {m.yellow_cards ? (
            <span className="h-3.5 w-2.5 rounded-[2px] bg-yellow-400" title={t.tableHints.yellow} />
          ) : null}
          {m.red_cards ? (
            <span className="h-3.5 w-2.5 rounded-[2px] bg-red-500" title={t.tableHints.red} />
          ) : null}
          {m.rating !== null ? (
            <span className={cn('rounded px-1.5 py-0.5 font-semibold tabular-nums', ratingTone(m.rating))}>
              {m.rating.toFixed(1)}
            </span>
          ) : null}
        </div>
      )}
    </Link>
  );
}

function CareerCard({ o, t, locale }: { o: PersonOverview; t: T; locale: Locale }) {
  if (!o.career.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.careerTitle}</CardTitle>
        <CardDescription>{t.careerDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="relative flex flex-col gap-4 border-l pl-5">
          {o.career.map((c) => (
            <li key={c.team.id} className="relative">
              <span
                className={cn(
                  'border-background absolute top-2.5 -left-[1.6rem] size-3 rounded-full border-2',
                  c.current ? 'bg-primary' : 'bg-muted-foreground/40',
                )}
                aria-hidden
              />
              <Link href={`/times/${c.team.id}`} className="group flex items-center gap-3">
                <Crest src={c.team.logo} name={c.team.name} size="md" />
                <div className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium group-hover:underline">{c.team.name}</span>
                    {c.current ? (
                      <Badge variant="primary-light" radius="full" size="sm">
                        {t.currentClub}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {c.from === c.to ? c.from : `${c.from}–${c.to}`}
                    {c.appearances
                      ? ` · ${plural(locale, c.appearances, t.apps)}${c.goals ? ` · ${plural(locale, c.goals, t.goals)}` : ''}`
                      : ''}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function TransfersCard({ o, t, f }: { o: PersonOverview; t: T; f: Formatters }) {
  if (!o.transfers.length) return null;
  const club = (c: PersonOverview['transfers'][number]['from']) => {
    const body = (
      <>
        <Crest src={c.logo} name={c.name} size="xs" />
        <span className="truncate">{c.name}</span>
      </>
    );
    return c.id ? (
      <Link href={`/times/${c.id}`} className="flex min-w-0 items-center gap-1.5 hover:underline">
        {body}
      </Link>
    ) : (
      <span className="flex min-w-0 items-center gap-1.5">{body}</span>
    );
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.transfersTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {o.transfers.map((tr) => (
          <div key={`${tr.date}-${tr.from.name}-${tr.to.name}`} className="flex flex-col gap-1">
            <span className="text-muted-foreground flex items-center gap-2 text-xs">
              {tr.date ? f.calendarDate(tr.date) : null}
              {tr.type ? (
                <Badge variant="outline" radius="full" size="sm">
                  {t.transferTypes[tr.type] ?? tr.type}
                </Badge>
              ) : null}
            </span>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              {club(tr.from)}
              <ArrowRight className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
              {club(tr.to)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SeasonsCard({
  o,
  t,
  locale,
  basePath,
  latest,
}: {
  o: PersonOverview;
  t: T;
  locale: Locale;
  basePath: string;
  latest: number | null;
}) {
  const rows = o.seasons.filter((s) => s.appearances > 0);
  if (rows.length < 2) return null;
  const max = Math.max(...rows.map((s) => s.appearances));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.seasonsTitle}</CardTitle>
        <CardDescription>{t.seasonsDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {rows.map((s) => (
          <Link
            key={s.year}
            href={s.year === latest ? basePath : `${basePath}?temporada=${s.year}`}
            scroll={false}
            className={cn(
              'hover:bg-accent -mx-2 flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors',
              s.year === o.season && 'bg-accent',
            )}
          >
            <span className="w-10 shrink-0 font-medium tabular-nums">{s.year}</span>
            <span className="bg-muted relative h-2 flex-1 overflow-hidden rounded-full">
              <span
                className="bg-primary/70 absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${Math.max(4, (s.appearances / max) * 100)}%` }}
              />
            </span>
            <span className="text-muted-foreground w-24 shrink-0 text-right text-xs tabular-nums">
              {plural(locale, s.appearances, t.apps)}
              {o.role === 'coach' ? '' : ` · ${s.goals}`}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

/** Títulos mostrados antes do "e mais N". */
const TROPHIES = 12;

function TrophiesCard({ o, t, locale }: { o: PersonOverview; t: T; locale: Locale }) {
  // API anterior aos perfis completos: sem `trophies`
  const trophies = o.trophies ?? [];
  if (!trophies.length) return null;
  const wins = trophies.filter((x) => x.place === 'Winner').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.trophiesTitle}</CardTitle>
        <CardDescription>{wins ? plural(locale, wins, t.wins) : t.trophiesDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {trophies.slice(0, TROPHIES).map((x) => (
          <div
            key={`${x.league}-${x.country}-${x.season}-${x.place}`}
            className="flex items-center gap-2.5 text-sm"
          >
            <Trophy
              className={cn(
                'size-4 shrink-0',
                x.place === 'Winner' ? 'text-yellow-400' : 'text-muted-foreground',
              )}
              aria-hidden
            />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{x.league}</span>
              <span className="text-muted-foreground text-xs">
                {[x.season, x.country].filter(Boolean).join(' · ')}
              </span>
            </div>
            {x.place ? (
              <Badge variant={x.place === 'Winner' ? 'warning-light' : 'outline'} radius="full" size="sm">
                {t.places[x.place] ?? x.place}
              </Badge>
            ) : null}
          </div>
        ))}
        {trophies.length > TROPHIES ? (
          <p className="text-muted-foreground text-xs">
            {fill(t.showMore, { count: trophies.length - TROPHIES })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SidelinedCard({ o, t, f }: { o: PersonOverview; t: T; f: Formatters }) {
  const list = o.sidelined ?? [];
  if (!list.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.sidelinedTitle}</CardTitle>
        <CardDescription>{t.sidelinedDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {list.map((x) => (
          <div key={`${x.type}-${x.start}`} className="flex items-start gap-2.5 text-sm">
            <Activity className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{x.type}</span>
              {x.start ? (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {x.end
                    ? fill(t.sidelinedRange, { from: f.calendarDate(x.start), to: f.calendarDate(x.end) })
                    : fill(t.sidelinedOngoing, { from: f.calendarDate(x.start) })}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MediaCard({ o, t }: { o: PersonOverview; t: T }) {
  const photo = o.media.find((m) => m.kind === 'photo');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.mediaTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {photo ? (
          <>
            <img
              src={photo.url}
              alt={o.person.name}
              className="bg-muted aspect-square w-full max-w-60 rounded-lg object-cover"
            />
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <ImageIcon className="size-3.5" aria-hidden />
              {photo.mirrored ? t.mediaMirrored : t.mediaOrigin}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t.mediaEmpty}</p>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UserRound aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export async function PersonContent({ params, searchParams, source }: PageContentProps) {
  const [{ id }, query, { locale, t: dict }, f] = await Promise.all([
    params,
    searchParams,
    getI18n(),
    getFormatters(),
  ]);
  const t = dict.pages.person;
  const latest = await source.getPersonOverview(id, locale);
  // a temporada padrão é a mais recente com jogos (sem `?temporada`); outro ano só se tiver dado
  const wanted = seasonParam(query.temporada);
  const year =
    wanted !== undefined && wanted !== latest.season && latest.seasons.some((s) => s.year === wanted)
      ? wanted
      : undefined;
  const o = year === undefined ? latest : await source.getPersonOverview(id, locale, year);
  const { person } = o;
  const api = personOverviewRequest(id, locale, year);
  const basePath = `/pessoas/${id}`;
  const coach = o.role === 'coach';
  const seasonLabel = o.season !== null ? String(o.season) : '';
  const position = o.position
    ? (t.positions[o.position] ?? dict.sport.positions[o.position] ?? o.position)
    : null;
  const fullName = [person.first_name, person.last_name].filter(Boolean).join(' ');
  const age = person.age ? plural(locale, person.age, t.years) : null;
  const options: SeasonOption[] = o.seasons.map((s) => ({
    year: s.year,
    label: String(s.year),
    hint: s.appearances
      ? [plural(locale, s.appearances, t.season.hint), coach ? null : plural(locale, s.goals, t.goals)]
          .filter(Boolean)
          .join(' · ')
      : t.season.noMatches,
    current: s.year === latest.season,
  }));
  const form = o.recent_matches
    .map((m) => ({ m, r: resultOf(m) }))
    .filter((x) => x.r !== null)
    .slice(0, 5)
    .map(({ m, r }) => ({ result: r!.result, eventId: m.event.id, score: r!.score }));
  const nothing = !o.seasons.length && !o.career.length;
  // API anterior aos perfis completos: sem `birth_place`
  const birthPlace = [person.birth_place, person.birth_country].filter(Boolean).join(', ');

  return (
    <>
      <PageHeader
        title={person.name}
        label={year !== undefined ? `${person.name} · ${year}` : undefined}
        kind="pessoa"
        parents={
          o.current_team
            ? [{ path: `/times/${o.current_team.id}`, label: o.current_team.name, kind: 'time' }]
            : undefined
        }
        api={api}
      />
      <div className="relative isolate flex flex-col gap-8 p-4 md:p-6">
        {o.current_team?.colors ? (
          <TeamBand colors={o.current_team.colors}>
            {o.number ? (
              <span className="absolute -top-6 right-2 text-[10rem] leading-none font-black tracking-tighter text-white/10 tabular-nums select-none sm:right-8 sm:text-[14rem]">
                {o.number}
              </span>
            ) : null}
          </TeamBand>
        ) : null}

        <header className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="relative w-fit">
            <Avatar className="ring-background/70 size-28 shadow-xl ring-4 sm:size-36">
              {person.photo ? (
                <AvatarImage src={person.photo} alt={person.name} className="object-cover" />
              ) : null}
              <AvatarFallback className="text-2xl">{initials(person.name)}</AvatarFallback>
            </Avatar>
            {o.number ? (
              <span
                className="bg-background absolute -right-1 -bottom-1 rounded-full border px-2.5 py-0.5 font-mono text-sm font-bold shadow"
                title={fill(t.number, { number: o.number })}
              >
                #{o.number}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {o.role && (coach || !position) ? (
                <Badge variant="secondary" radius="full">
                  {t.roles[o.role] ?? o.role}
                </Badge>
              ) : null}
              {position ? (
                <Badge variant="primary-light" radius="full">
                  {position}
                </Badge>
              ) : null}
              {o.current_team ? (
                <Link
                  href={`/times/${o.current_team.id}`}
                  className="bg-background/60 hover:bg-accent flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-1 text-xs font-medium backdrop-blur transition-colors"
                  title={t.currentTeam}
                >
                  <Crest src={o.current_team.logo} name={o.current_team.name} size="xs" />
                  {o.current_team.name}
                </Link>
              ) : null}
            </div>
            <div className="flex flex-col gap-0.5">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{person.name}</h1>
              {fullName && fullName !== person.name ? (
                <span className="text-muted-foreground text-sm">{fullName}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {options.length && o.season !== null ? (
                <SeasonSelect
                  options={options}
                  value={o.season}
                  basePath={basePath}
                  texts={{
                    label: t.season.label,
                    search: t.season.search,
                    empty: t.season.empty,
                    current: t.season.current,
                  }}
                />
              ) : null}
              {year !== undefined ? (
                <span className="flex items-center gap-2">
                  <Badge variant="warning-light" size="lg" radius="full">
                    <History aria-hidden />
                    {fill(t.season.badge, { season: String(year) })}
                  </Badge>
                  <Link
                    href={basePath}
                    scroll={false}
                    className="text-muted-foreground text-xs hover:underline"
                  >
                    {t.season.backToLatest}
                  </Link>
                </span>
              ) : null}
            </div>
          </div>
        </header>

        {person.birth_date ||
        age ||
        birthPlace ||
        o.nationality_ref ||
        person.nationality ||
        person.height_cm ||
        person.weight_kg ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
            {person.birth_date || age ? (
              <Fact icon={Calendar} label={person.birth_date ? t.birth : t.age}>
                {person.birth_date
                  ? age
                    ? fill(t.birthWithAge, { date: f.calendarDate(person.birth_date), age })
                    : f.calendarDate(person.birth_date)
                  : age}
              </Fact>
            ) : null}
            {birthPlace ? (
              <Fact icon={MapPin} label={t.birthPlace}>
                {birthPlace}
              </Fact>
            ) : null}
            {o.nationality_ref || person.nationality ? (
              <Fact icon={Flag} label={t.nationality}>
                <span className="flex items-center gap-1.5">
                  {o.nationality_ref ? <CountryFlag code={o.nationality_ref.code} /> : null}
                  {o.nationality_ref?.name ?? person.nationality}
                </span>
              </Fact>
            ) : null}
            {person.height_cm ? (
              <Fact icon={Ruler} label={t.height}>
                {f.number(person.height_cm)} cm
              </Fact>
            ) : null}
            {person.weight_kg ? (
              <Fact icon={Weight} label={t.weight}>
                {f.number(person.weight_kg)} kg
              </Fact>
            ) : null}
          </div>
        ) : null}

        {nothing ? (
          <EmptyState title={t.emptyProfile.title} description={t.emptyProfile.description} />
        ) : (
          <>
            <Kpis o={o} t={t} locale={locale} f={f} />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
                {o.stats.length ? (
                  <StatsTable o={o} t={t} f={f} api={api} season={seasonLabel} />
                ) : (
                  <EmptyState
                    title={fill(t.emptyStats.title, { season: seasonLabel })}
                    description={t.emptyStats.description}
                  />
                )}
                {o.recent_matches.length ? (
                  <Section
                    title={t.matchesTitle}
                    description={fill(coach ? t.coachMatchesDescription : t.matchesDescription, {
                      season: seasonLabel,
                    })}
                    api={api}
                    action={form.length ? <FormChips items={form} /> : undefined}
                  >
                    <Card size="sm">
                      <CardContent className="flex flex-col divide-y">
                        {o.recent_matches.map((m) => (
                          <MatchRow key={m.event.id} m={m} t={t} f={f} coach={coach} />
                        ))}
                      </CardContent>
                    </Card>
                  </Section>
                ) : null}
              </div>
              <div className="flex min-w-0 flex-col gap-6">
                <CareerCard o={o} t={t} locale={locale} />
                <SeasonsCard o={o} t={t} locale={locale} basePath={basePath} latest={latest.season} />
                <TrophiesCard o={o} t={t} locale={locale} />
                <TransfersCard o={o} t={t} f={f} />
                <SidelinedCard o={o} t={t} f={f} />
                <MediaCard o={o} t={t} />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function PersonFallback() {
  return (
    <>
      <PageHeader title={<Skeleton className="h-4 w-32" />} />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div className="flex items-center gap-5">
          <Skeleton className="size-28 rounded-full sm:size-36" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-8 w-44" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    </>
  );
}
