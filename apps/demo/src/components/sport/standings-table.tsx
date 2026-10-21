import type { Standings } from '@galaxie/contracts';
import Link from 'next/link';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

export function StandingsTable({ rows, highlightTeamId }: { rows: Row[]; highlightTeamId?: string }) {
  const zones = [...new Map(rows.filter((r) => r.description).map((r) => [r.description!, r])).keys()];

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">#</TableHead>
            <TableHead>Time</TableHead>
            <TableHead className="text-right">P</TableHead>
            <TableHead className="text-right">J</TableHead>
            <TableHead className="hidden text-right sm:table-cell">V</TableHead>
            <TableHead className="hidden text-right sm:table-cell">E</TableHead>
            <TableHead className="hidden text-right sm:table-cell">D</TableHead>
            <TableHead className="hidden text-right md:table-cell">GP</TableHead>
            <TableHead className="hidden text-right md:table-cell">GC</TableHead>
            <TableHead className="text-right">SG</TableHead>
            <TableHead className="hidden lg:table-cell">Últimos</TableHead>
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
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{r.drawn}</TableCell>
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
