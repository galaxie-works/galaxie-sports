import type { Metadata } from 'next';
import type { EqChampionship } from '@galaxie/contracts';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { CoverageNote, Flag, NoticeBanner, Published, SourceLink } from '@/components/equestrian/parts';
import { Badge } from '@/components/reui/badge';
import { Section } from '@/components/sport/section';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { equestrianChampionshipRequest, getEquestrianChampionship } from '@/lib/galaxie/equestrian';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { getFormatters, getI18n } from '@/lib/i18n/server';
import { equestrianParent } from '@/lib/navigation';
import { fill } from '@/lib/i18n/text';

/** Título da aba do navegador (e do histórico): o nome da página, não só "Galaxie Sports". */
export async function generateMetadata({
  params,
}: PageProps<'/[locale]/hipismo/campeonatos/[key]'>): Promise<Metadata> {
  const [{ key }, { locale }] = await Promise.all([params, getI18n()]);
  try {
    return { title: (await getEquestrianChampionship(key, locale)).name };
  } catch {
    return {};
  }
}

type Props = PageProps<'/[locale]/hipismo/campeonatos/[key]'>;
type T = Dictionary['equestrian'];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

function RoundsTable({ rows, t, f }: { rows: EqChampionship['rounds']; t: T; f: Formatters }) {
  const statuses = t.statuses as Record<string, string>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.table.athlete}</TableHead>
            <TableHead className="text-center">{t.table.pos}</TableHead>
            <TableHead>{t.table.status}</TableHead>
            <TableHead className="text-right">{t.table.faults}</TableHead>
            <TableHead className="text-right">{t.table.time}</TableHead>
            <TableHead className="text-right">{t.table.score}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <Flag country={r.country} />
                    {r.athlete ? (
                      <Link href={`/hipismo/atletas/${r.athlete.id}`} className="font-medium hover:underline">
                        {r.athlete.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.athlete_name_as_published}</span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    🐴{' '}
                    {r.horse ? (
                      <Link href={`/hipismo/cavalos/${r.horse.id}`} className="hover:underline">
                        {r.horse.name}
                      </Link>
                    ) : (
                      (r.horse_name_as_published ?? t.missing)
                    )}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-center tabular-nums">{r.rank_raw ?? '—'}</TableCell>
              <TableCell>
                <Badge variant={r.status === 'completed' ? 'outline' : 'warning-light'}>
                  {r.status ? (statuses[r.status] ?? r.status) : t.missing}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {r.penalties_jumping !== null || r.penalties_time !== null ? (
                  <span className="tabular-nums">
                    {r.penalties_jumping ?? '—'} + {r.penalties_time ?? '—'}
                  </span>
                ) : (
                  <Published value={null} t={t} />
                )}
              </TableCell>
              <TableCell className="text-right">
                <Published
                  value={r.time_seconds !== null ? r.time_seconds.toFixed(2) : null}
                  t={t}
                  suffix=" s"
                />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-col items-end gap-0.5">
                  <Published value={r.score} t={t} />
                  <SourceLink url={r.source.url} page={r.source.pdf_page ?? null} t={t} f={f} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

async function Content({ params, searchParams }: Props) {
  const { key } = await params;
  const athlete = one((await searchParams).atleta);
  const { locale, t } = await getI18n();
  const te = t.equestrian;
  const [c, f] = await Promise.all([getEquestrianChampionship(key, locale), getFormatters()]);
  const api = equestrianChampionshipRequest(key, locale);
  const stageNames = te.championship.stages as Record<string, string>;
  const semantics = te.championship.semantics as Record<string, string>;
  const rounds = athlete ? c.rounds.filter((r) => r.athlete?.id === athlete) : c.rounds;
  const focus = athlete ? c.rounds.find((r) => r.athlete?.id === athlete)?.athlete : null;
  const byStage = c.stages
    .map((s) => ({ ...s, rows: rounds.filter((r) => r.stage === s.stage) }))
    .filter((s) => s.rows.length);
  const imprecise = c.rounds.some((r) => r.date_precision && r.date_precision !== 'exact_stage_date');

  return (
    <>
      <PageHeader title={c.name} kind="competição" parents={[equestrianParent(t)]} api={api} />
      <div className="flex flex-col gap-8 p-4 md:p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <span className="text-muted-foreground text-sm">
            {c.start ? f.calendarDate(c.start) : ''} {c.end ? `– ${f.calendarDate(c.end)}` : ''}
          </span>
          <div className="flex flex-wrap gap-2">
            {c.competition_id ? (
              <Button
                variant="outline"
                nativeButton={false}
                render={<Link href={`/hipismo/provas/${c.competition_id}`} />}
              >
                {te.championship.finalClassification}
              </Button>
            ) : null}
            {focus ? (
              <Button
                variant="ghost"
                nativeButton={false}
                render={<Link href={`/hipismo/campeonatos/${key}`} />}
              >
                {focus.name} · {te.filters.clear}
              </Button>
            ) : null}
          </div>
        </div>

        <NoticeBanner notice={c.notice} t={te} />

        <Section title={te.championship.rounds} description={te.championship.roundsDescription} api={api}>
          {imprecise ? <CoverageNote>{te.championship.datePrecision}</CoverageNote> : null}
          {byStage.map((s) => {
            const sem = s.rows[0]?.score_semantics;
            return (
              <div key={s.stage} className="flex flex-col gap-2">
                <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {stageNames[s.stage] ?? s.stage}
                  {s.date ? (
                    <span className="text-muted-foreground font-normal">{f.calendarDate(s.date)}</span>
                  ) : null}
                  {sem ? <Badge variant="outline">{semantics[sem] ?? sem}</Badge> : null}
                </h3>
                <RoundsTable rows={s.rows} t={te} f={f} />
              </div>
            );
          })}
        </Section>

        {c.teams.length ? (
          <Section title={te.championship.teams} description={te.championship.teamsDescription} api={api}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {c.teams.map((team) => {
                const ar = team.arithmetic as {
                  published?: { total?: string | null; firstDay?: string | null };
                  firstDayLowestThreeRecomputed?: string | null;
                  firstDayArithmeticMatches?: boolean | null;
                } | null;
                return (
                  <Card key={team.id} size="sm">
                    <CardContent className="flex flex-col gap-2">
                      <span className="flex items-center gap-2 font-medium">
                        <span className="tabular-nums">{team.position_raw ?? '—'}º</span>
                        <Flag country={team.country} className="h-4 w-6" />
                        {team.country.name ?? team.country.code}
                        {ar?.published?.total ? (
                          <Badge variant="secondary">{ar.published.total}</Badge>
                        ) : null}
                      </span>
                      <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                        {team.members.map((m) => (
                          <li key={`${m.athlete_fei_id}-${m.horse_name}`}>
                            {m.athlete_name ?? '—'} · 🐴 {m.horse_name ?? '—'}
                            {m.individual_position_raw ? ` · ${m.individual_position_raw}º` : ''}
                            {m.scores
                              ? ` · ${Object.entries(m.scores)
                                  .map(([k, v]) => `${k} ${v ?? '—'}`)
                                  .join(' · ')}`
                              : ''}
                          </li>
                        ))}
                      </ul>
                      {ar && ar.firstDayArithmeticMatches === false ? (
                        <Badge variant="warning-light">
                          {te.championship.arithmetic}:{' '}
                          {fill(te.championship.arithmeticMismatch, {
                            published: ar.published?.firstDay ?? '—',
                            recomputed: ar.firstDayLowestThreeRecomputed ?? '—',
                          })}
                        </Badge>
                      ) : null}
                      <SourceLink url={team.source.url} observedAt={team.source.observed_at} t={te} f={f} />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </Section>
        ) : null}

        {c.disagreements.length ? (
          <Section
            title={te.athlete.disagreements}
            description={te.athlete.disagreementsDescription}
            api={api}
          >
            <div className="flex flex-col gap-2">
              {c.disagreements.map((d) => (
                <Card key={d.id} size="sm">
                  <CardContent className="flex flex-wrap items-center gap-3 text-sm">
                    {d.athlete ? (
                      <Link
                        href={`/hipismo/atletas/${d.athlete.id}`}
                        className="flex items-center gap-1.5 font-medium hover:underline"
                      >
                        <Flag country={d.athlete.country} />
                        {d.athlete.name}
                      </Link>
                    ) : null}
                    <code className="text-xs">{d.field}</code>
                    {d.values.map((v) => (
                      <span key={v.label} className="flex items-center gap-1">
                        <Badge variant="outline">
                          {(te.athlete.sources as Record<string, string>)[v.label] ?? v.label}
                        </Badge>
                        <span className="font-medium tabular-nums">{v.value ?? te.missing}</span>
                        {v.url ? <SourceLink url={v.url} page={v.page} t={te} f={f} /> : null}
                      </span>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </Section>
        ) : null}
      </div>
    </>
  );
}

export default function EquestrianChampionshipPage(props: Props) {
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={<Skeleton className="h-4 w-32" />} />
          <div className="p-4 md:p-6">
            <Skeleton className="h-7 w-64" />
          </div>
        </>
      }
    >
      <Content {...props} />
    </Suspense>
  );
}
