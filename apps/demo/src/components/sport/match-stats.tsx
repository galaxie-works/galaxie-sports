import type { EventStats } from '@galaxie/contracts';

import { Crest } from '@/components/sport/crest';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { statRows, type StatRow } from '@/lib/match-stats';
import { contrastText } from '@/lib/team-colors';
import { cn } from '@/lib/utils';

const PERCENT = new Set(['possession_pct', 'pass_accuracy_pct']);

function Value({
  row,
  side,
  color,
  format,
}: {
  row: StatRow;
  side: 'home' | 'away';
  color: string;
  format: (n: number) => string;
}) {
  const v = row[side];
  const text = v == null ? '—' : `${format(v)}${PERCENT.has(row.code) ? '%' : ''}`;
  const best = row.best === side;
  return (
    <span className="flex justify-center">
      <span
        className={cn(
          'min-w-10 rounded-full px-2 py-0.5 text-center text-sm tabular-nums',
          best && 'font-semibold',
          v == null && 'text-muted-foreground',
        )}
        style={best ? { backgroundColor: color, color: contrastText(color) } : undefined}
      >
        {text}
      </span>
    </span>
  );
}

/**
 * Estatísticas do jogo no estilo do painel do Google: mandante | rótulo | visitante, o melhor valor de
 * cada linha em pílula com a cor do time (o menor em faltas, impedimentos e cartões — regra em
 * `lib/match-stats.ts`) e uma barra fina com a proporção. Aba "Estatísticas" dos detalhes da partida;
 * sem estatística, não renderiza nada (use `statRows` para saber antes).
 */
export function MatchStats({
  stats,
  colors,
  locale,
  t,
}: {
  stats: EventStats;
  /** Cor de cada time [mandante, visitante] (`versusColors`). */
  colors: [string, string];
  locale: Locale;
  t: Dictionary;
}) {
  const tx = t.event.stats;
  const rows = statRows(stats);
  if (!rows.length) return null;
  const home = stats.teams.find((x) => x.team.side === 'home') ?? stats.teams[0]!;
  const away = stats.teams.find((x) => x.team.side === 'away') ?? stats.teams[1]!;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const [homeColor, awayColor] = colors;
  // Em tela larga, duas colunas ocupam a área toda sem afastar demais o número do rótulo; a segunda
  // coluna repete o cabeçalho dos escudos só quando fica ao lado da primeira.
  const half = Math.ceil(rows.length / 2);
  const columns = rows.length > 4 ? [rows.slice(0, half), rows.slice(half)] : [rows];
  return (
    <div className={cn('grid w-full gap-x-12 gap-y-1', columns.length > 1 && 'lg:grid-cols-2')}>
      {columns.map((column, i) => (
        <div key={i} className="flex flex-col gap-1">
          <div
            className={cn('grid grid-cols-[4.5rem_1fr_4.5rem] items-center pb-2', i > 0 && 'hidden lg:grid')}
          >
            <span className="flex justify-center" title={home.team.name ?? ''}>
              <Crest src={home.team.logo} name={home.team.name ?? ''} size="sm" />
            </span>
            <span className="text-muted-foreground text-center text-xs font-medium tracking-wide uppercase">
              {tx.teams}
            </span>
            <span className="flex justify-center" title={away.team.name ?? ''}>
              <Crest src={away.team.logo} name={away.team.name ?? ''} size="sm" />
            </span>
          </div>
          {column.map((row) => (
            <div key={row.code} className="flex flex-col gap-1.5 py-1.5">
              <div className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center">
                <Value row={row} side="home" color={homeColor} format={nf.format} />
                <span className="text-center text-sm">{tx.labels[row.code] ?? row.label}</span>
                <Value row={row} side="away" color={awayColor} format={nf.format} />
              </div>
              {row.share != null ? (
                <div className="mx-4 flex h-1 gap-0.5 overflow-hidden rounded-full opacity-70" aria-hidden>
                  <div style={{ width: `${row.share * 100}%`, backgroundColor: homeColor }} />
                  <div className="flex-1" style={{ backgroundColor: awayColor }} />
                </div>
              ) : (
                <div className="bg-muted mx-4 h-1 rounded-full" aria-hidden />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
