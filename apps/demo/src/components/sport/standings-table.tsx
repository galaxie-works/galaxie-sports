import type { Standings } from '@galaxie/contracts';
import Link from 'next/link';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getT } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

import { Crest } from './crest';
import { FormChips, formFromString } from './form-chips';

type Row = Standings['groups'][number]['rows'][number];

/** Cor da faixa de classificação a partir da descrição do fornecedor (vaga, rebaixamento…). */
function zoneClass(description: string | null | undefined) {
  const d = (description ?? '').toLowerCase();
  if (!d) return 'bg-transparent';
  if (d.includes('relegation') || d.includes('rebaix')) return 'bg-destructive';
  if (d.includes('libertadores') || d.includes('champions') || d.includes('promotion')) return 'bg-primary';
  if (d.includes('sudamericana') || d.includes('sul-americana') || d.includes('europa')) return 'bg-info';
  return 'bg-muted-foreground';
}

/** Esportes em que a tabela conta sets (pró/contra/saldo) e não há empate. */
const SET_SPORTS = new Set(['volleyball']);
/** Esportes sem empate e com placar em pontos: a tabela troca gols por pontos e esconde a coluna E. */
const POINT_SPORTS = new Set(['basketball', 'nba']);

export async function StandingsTable({
  rows,
  highlightTeamId,
  sport,
}: {
  rows: Row[];
  highlightTeamId?: string;
  sport?: string;
}) {
  const standings = (await getT()).sport.standings;
  const sets = sport != null && SET_SPORTS.has(sport);
  const byPoints = sport != null && POINT_SPORTS.has(sport);
  const t = sets
    ? { ...standings, ...standings.sets }
    : byPoints
      ? { ...standings, ...standings.byPoints }
      : standings;
  const zones = [...new Map(rows.filter((r) => r.description).map((r) => [r.description!, r])).keys()];

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">#</TableHead>
            <TableHead>{t.team}</TableHead>
            <TableHead className="text-right">
              <abbr title={t.pointsTitle} className="no-underline">
                {t.points}
              </abbr>
            </TableHead>
            <TableHead className="text-right">
              <abbr title={t.playedTitle} className="no-underline">
                {t.played}
              </abbr>
            </TableHead>
            <TableHead className="hidden text-right sm:table-cell">
              <abbr title={t.wonTitle} className="no-underline">
                {t.won}
              </abbr>
            </TableHead>
            {sets || byPoints ? null : (
              <TableHead className="hidden text-right sm:table-cell">
                <abbr title={t.drawnTitle} className="no-underline">
                  {t.drawn}
                </abbr>
              </TableHead>
            )}
            <TableHead className="hidden text-right sm:table-cell">
              <abbr title={t.lostTitle} className="no-underline">
                {t.lost}
              </abbr>
            </TableHead>
            <TableHead className="hidden text-right md:table-cell">
              <abbr title={t.goalsForTitle} className="no-underline">
                {t.goalsFor}
              </abbr>
            </TableHead>
            <TableHead className="hidden text-right md:table-cell">
              <abbr title={t.goalsAgainstTitle} className="no-underline">
                {t.goalsAgainst}
              </abbr>
            </TableHead>
            <TableHead className="text-right">
              <abbr title={t.goalDiffTitle} className="no-underline">
                {t.goalDiff}
              </abbr>
            </TableHead>
            <TableHead className="hidden lg:table-cell">{t.form}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.participant.id}
              className={cn(r.participant.id === highlightTeamId && 'bg-primary/10 hover:bg-primary/15')}
            >
              <TableCell className="relative text-right tabular-nums">
                <span
                  className={cn('absolute inset-y-1 left-0 w-0.5 rounded-full', zoneClass(r.description))}
                  title={r.description ?? undefined}
                />
                {r.rank}
              </TableCell>
              <TableCell>
                <Link
                  href={`/times/${r.participant.id}`}
                  className="flex items-center gap-2 font-medium hover:underline"
                >
                  <Crest src={r.participant.logo} name={r.participant.name} size="xs" />
                  <span className="truncate">{r.participant.name}</span>
                </Link>
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{r.points}</TableCell>
              <TableCell className="text-right tabular-nums">{r.played}</TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.won}</TableCell>
              {sets || byPoints ? null : (
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.drawn}</TableCell>
              )}
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.lost}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{r.goals_for}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">
                {r.goals_against}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.goal_diff > 0 ? `+${r.goal_diff}` : r.goal_diff}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <FormChips items={formFromString(r.form)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {zones.length ? (
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {zones.map((z) => (
            <li key={z} className="flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', zoneClass(z))} />
              {z}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
