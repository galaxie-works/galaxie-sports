import type { Event } from '@galaxie/contracts';

import { goalsBehinds } from '@/lib/afl';
import { getT } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

type Period = NonNullable<Event['score']['periods']>[number];

/** "s3" → "3"; prorrogação e shootout pelo dicionário ("ot" → "Pr"). */
function shortLabel(code: string, extra: Record<string, string>): string {
  return extra[code] ?? code.replace(/^[a-z]+/, '');
}

/**
 * Parciais do jogo (sets do vôlei, quartos, tempos, períodos) numa tabela compacta: uma coluna por período,
 * uma linha por lado, com o vencedor de cada parcial em destaque.
 */
export async function PeriodScores({
  periods,
  home,
  away,
  sport,
}: {
  periods: Period[];
  home: string;
  away: string;
  /**
   * Rótulo por esporte quando o mesmo tipo de parcial muda de nome (tempos: gols no handebol, pontos no rúgbi;
   * quartos da AFL com gols.behinds).
   */
  sport?: string;
}) {
  const tx = (await getT()).event.scoreboard.periods;
  const kind = /^[a-z]+/.exec(periods[0]!.code)?.[0] ?? '';
  const title = tx.title[`${sport}.${kind}`] ?? tx.title[kind] ?? tx.title.default!;
  const cell = (p: Period, side: 'home' | 'away') => {
    const mine = p[side];
    const other = p[side === 'home' ? 'away' : 'home'];
    return (
      <td
        key={p.code}
        className={cn(
          'px-2 py-0.5 text-center tabular-nums',
          mine != null && other != null && mine > other
            ? 'text-foreground font-semibold'
            : 'text-muted-foreground',
        )}
      >
        {mine ?? '–'}
        {p.goals_behinds && goalsBehinds(p.goals_behinds[side]) ? (
          <span className="text-muted-foreground ml-1 font-normal">
            ({goalsBehinds(p.goals_behinds[side])})
          </span>
        ) : null}
      </td>
    );
  };

  return (
    <table className="text-xs" aria-label={title}>
      <thead>
        <tr className="text-muted-foreground">
          <th scope="col" className="pr-3 text-left font-medium">
            {title}
          </th>
          {periods.map((p) => (
            <th key={p.code} scope="col" className="px-2 text-center font-medium tabular-nums">
              {shortLabel(p.code, tx.short)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row" className="max-w-40 truncate pr-3 text-left font-normal">
            {home}
          </th>
          {periods.map((p) => cell(p, 'home'))}
        </tr>
        <tr>
          <th scope="row" className="max-w-40 truncate pr-3 text-left font-normal">
            {away}
          </th>
          {periods.map((p) => cell(p, 'away'))}
        </tr>
      </tbody>
    </table>
  );
}
