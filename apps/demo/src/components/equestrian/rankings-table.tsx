import type { EqOverview } from '@galaxie/contracts';
import Link from 'next/link';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';

import { Flag } from './parts';

type T = Dictionary['equestrian'];

/** Posições observadas em rankings (sem edição inferida). */
export function RankingsTable({ rows, t, f }: { rows: EqOverview['rankings']; t: T; f: Formatters }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t.table.ranking}</TableHead>
            <TableHead className="text-center">{t.table.pos}</TableHead>
            <TableHead>{t.table.athlete}</TableHead>
            <TableHead className="text-right">{t.rankings.points.replace('{n} ', '')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{r.ranking}</span>
                  <span className="text-muted-foreground text-xs">{r.edition ?? t.rankings.noEdition}</span>
                </div>
              </TableCell>
              <TableCell className="text-center tabular-nums">{r.rank_raw ?? '—'}</TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  {r.athlete ? (
                    <Link
                      href={`/hipismo/atletas/${r.athlete.id}`}
                      className="flex items-center gap-1.5 hover:underline"
                    >
                      <Flag country={r.athlete.country} />
                      {r.athlete.name}
                    </Link>
                  ) : null}
                  {r.horse ? (
                    <Link
                      href={`/hipismo/cavalos/${r.horse.id}`}
                      className="text-muted-foreground text-xs hover:underline"
                    >
                      🐴 {r.horse.name}
                    </Link>
                  ) : r.horse_name_as_published ? (
                    <span className="text-muted-foreground text-xs">🐴 {r.horse_name_as_published}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.points !== null ? f.number(r.points) : t.missing}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
