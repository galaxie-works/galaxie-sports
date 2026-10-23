import type { EqResult } from '@galaxie/contracts';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';

import { Combination, PositionCell, PrizeCell, ScoreCell, SourceLink } from './parts';

type T = Dictionary['equestrian'];

/** Conjuntos da América do Sul ganham destaque discreto nas classificações. */
const SOUTH_AMERICA = new Set(['ARG', 'BRA', 'CHI', 'URU', 'PAR', 'BOL', 'PER', 'ECU', 'COL', 'VEN']);

/**
 * Classificações gerais (nunca rodadas). Colunas opcionais: na página do atleta o conjunto mostra só o
 * cavalo; na da prova, a coluna "Prova" some.
 */
export function ResultsTable({
  rows,
  t,
  f,
  showCompetition = true,
  showAthlete = true,
  showHorse = true,
}: {
  rows: EqResult[];
  t: T;
  f: Formatters;
  showCompetition?: boolean;
  showAthlete?: boolean;
  showHorse?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14 text-center">{t.table.pos}</TableHead>
            {showCompetition ? <TableHead>{t.table.competition}</TableHead> : null}
            <TableHead>{showAthlete ? t.table.athlete : t.table.horse}</TableHead>
            <TableHead>{t.table.score}</TableHead>
            <TableHead className="text-right">{t.table.prize}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow
              key={r.id}
              className={showAthlete && SOUTH_AMERICA.has(r.country?.code ?? '') ? 'bg-primary/5' : undefined}
            >
              <TableCell className="text-center align-top">
                <PositionCell r={r} t={t} />
              </TableCell>
              {showCompetition ? (
                <TableCell className="max-w-72 align-top">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {r.competition ? (
                      <Link
                        href={`/hipismo/provas/${r.competition.id}`}
                        className="truncate font-medium hover:underline"
                      >
                        {r.competition.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    <span className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
                      {r.date ? <span>{f.calendarDate(r.date)}</span> : null}
                      {r.competition?.venue ? <span>· {r.competition.venue}</span> : null}
                      {r.competition?.level ? (
                        <Badge variant="outline" size="sm">
                          {r.competition.level}
                        </Badge>
                      ) : null}
                      {r.competition?.height_cm ? <span>{r.competition.height_cm} cm</span> : null}
                    </span>
                  </div>
                </TableCell>
              ) : null}
              <TableCell className="max-w-72 align-top">
                <Combination r={r} t={t} showAthlete={showAthlete} showHorse={showHorse} />
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-col gap-1">
                  <ScoreCell r={r} t={t} />
                  <SourceLink url={r.source.url} t={t} f={f} />
                </div>
              </TableCell>
              <TableCell className="text-right align-top">
                <PrizeCell r={r} f={f} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
