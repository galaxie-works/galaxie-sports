import type { EventLineups } from '@galaxie/contracts';
import { ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { initials } from '@/lib/format';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import { pitchRows, shortName, type MarksLookup, type PlayerMarks } from '@/lib/lineup-marks';
import { cn } from '@/lib/utils';

type Lineup = EventLineups['lineups'][number];
type LineupPlayer = Lineup['start_xi'][number];
type Tx = Dictionary['event']['lineups'];

// ─── ícones dos lances ───────────────────────────────────────────────────────────────────────────

function CardIcon({ marks, tx }: { marks: PlayerMarks; tx: Tx }) {
  if (marks.red)
    return (
      <span
        className="block h-3 w-2 rounded-[2px] bg-red-600 shadow-sm"
        title={fill(tx.marks.red, { minute: marks.red })}
        role="img"
        aria-label={fill(tx.marks.red, { minute: marks.red })}
      />
    );
  if (marks.secondYellow)
    return (
      <span
        className="relative block h-3 w-2.5"
        title={fill(tx.marks.secondYellow, { minute: marks.secondYellow })}
        role="img"
        aria-label={fill(tx.marks.secondYellow, { minute: marks.secondYellow })}
      >
        <span className="absolute top-0 left-0 h-3 w-2 rounded-[2px] bg-yellow-400 shadow-sm" />
        <span className="absolute top-0.5 left-0.5 h-3 w-2 rounded-[2px] bg-red-600 shadow-sm" />
      </span>
    );
  if (marks.yellow)
    return (
      <span
        className="block h-3 w-2 rounded-[2px] bg-yellow-400 shadow-sm"
        title={fill(tx.marks.yellow, { minute: marks.yellow })}
        role="img"
        aria-label={fill(tx.marks.yellow, { minute: marks.yellow })}
      />
    );
  return null;
}

/** ⚽ por gol (contador se mais de um), gol contra em vermelho e 👟 para assistência. */
function ScoringIcons({ marks, tx }: { marks: PlayerMarks; tx: Tx }) {
  const items = [
    { key: 'goal', list: marks.goals, text: tx.marks.goal, icon: '⚽', className: 'bg-white' },
    { key: 'own', list: marks.ownGoals, text: tx.marks.ownGoal, icon: '⚽', className: 'bg-red-600' },
    { key: 'assist', list: marks.assists, text: tx.marks.assist, icon: '👟', className: 'bg-white' },
  ].filter((x) => x.list.length);
  if (!items.length) return null;
  return (
    <>
      {items.map((x) => {
        const label = x.list.map((minute) => fill(x.text, { minute })).join(' · ');
        return (
          <span
            key={x.key}
            title={label}
            role="img"
            aria-label={label}
            className={cn(
              'flex h-[1.125rem] min-w-[1.125rem] items-center justify-center gap-px rounded-full px-0.5 text-[0.7rem] leading-none text-black shadow-sm',
              x.className,
            )}
          >
            <span aria-hidden>{x.icon}</span>
            {x.list.length > 1 ? <span className="font-semibold tabular-nums">{x.list.length}</span> : null}
          </span>
        );
      })}
    </>
  );
}

/** Ícones em linha (lista e banco): cartão, gols, assistência e saída. */
function InlineMarks({
  marks,
  tx,
  showSubOut = true,
}: {
  marks: PlayerMarks | null;
  tx: Tx;
  showSubOut?: boolean;
}) {
  if (!marks) return null;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <CardIcon marks={marks} tx={tx} />
      <ScoringIcons marks={marks} tx={tx} />
      {showSubOut && marks.subOut ? (
        <span
          className="text-destructive inline-flex items-center text-[0.7rem] font-medium tabular-nums"
          title={fill(tx.marks.subOut, { minute: marks.subOut })}
        >
          <ArrowDown className="size-3" aria-label={fill(tx.marks.subOut, { minute: marks.subOut })} />
          {marks.subOut}
        </span>
      ) : null}
    </span>
  );
}

function PersonPhoto({
  name,
  photo,
  className,
}: {
  name: string;
  photo?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={className}>
      {photo ? <AvatarImage src={photo} alt="" /> : null}
      <AvatarFallback className="text-[0.65rem] font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** Link para a página da pessoa quando ela está no core; senão, só o conteúdo. */
function PersonLink({
  id,
  className,
  title,
  children,
}: {
  id: string | null;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  return id ? (
    <Link href={`/pessoas/${id}`} className={className} title={title}>
      {children}
    </Link>
  ) : (
    <span className={className} title={title}>
      {children}
    </span>
  );
}

// ─── campo ───────────────────────────────────────────────────────────────────────────────────────

/** Proporção do gramado desenhado (largura × comprimento). */
const PITCH_W = 68;
const PITCH_H = 100;

/**
 * Linhas do campo. O SVG estica com o gramado (no celular ele é mais comprido, para as fileiras caberem);
 * o círculo central é desenhado à parte (`CenterCircle`) para continuar redondo.
 */
function PitchLines() {
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 0.35 };
  const mid = PITCH_W / 2;
  return (
    <svg
      viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
      className="absolute inset-0 size-full text-white/20"
      aria-hidden
      preserveAspectRatio="none"
    >
      <rect x={1.5} y={1.5} width={PITCH_W - 3} height={PITCH_H - 3} rx={0.5} {...line} />
      <line x1={1.5} y1={PITCH_H / 2} x2={PITCH_W - 1.5} y2={PITCH_H / 2} {...line} />
      <circle cx={mid} cy={PITCH_H / 2} r={0.6} fill="currentColor" />
      {[1.5, PITCH_H - 1.5].map((y) => {
        const dir = y < PITCH_H / 2 ? 1 : -1;
        return (
          <g key={y}>
            {/* grande área, pequena área, marca do pênalti e meia-lua */}
            <rect x={mid - 20} y={dir > 0 ? y : y - 15} width={40} height={15} {...line} />
            <rect x={mid - 9} y={dir > 0 ? y : y - 5} width={18} height={5} {...line} />
            <circle cx={mid} cy={y + dir * 10.5} r={0.5} fill="currentColor" />
            <path
              d={`M ${mid - 6.5} ${y + dir * 15} A 8 8 0 0 ${dir > 0 ? 0 : 1} ${mid + 6.5} ${y + dir * 15}`}
              {...line}
            />
            <rect x={mid - 3.6} y={dir > 0 ? y - 1.2 : y} width={7.2} height={1.2} {...line} />
          </g>
        );
      })}
    </svg>
  );
}

function CenterCircle() {
  return (
    <div
      className="absolute top-1/2 left-1/2 aspect-square w-[23.5%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20"
      aria-hidden
    />
  );
}

function PitchPlayer({
  player,
  marks,
  color,
  x,
  y,
  tx,
}: {
  player: LineupPlayer;
  marks: PlayerMarks | null;
  color: string;
  /** Posição no gramado, em % da largura e do comprimento. */
  x: number;
  y: number;
  tx: Tx;
}) {
  const name = player.person.name;
  return (
    <div
      className="absolute flex w-[24%] -translate-x-1/2 -translate-y-1/2 justify-center"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <PersonLink
        id={player.person.id}
        title={name}
        className="group/player flex max-w-full flex-col items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <span className="sr-only">{name}</span>
        <span className="relative">
          <span
            className="block rounded-full border-2 p-px transition-transform group-hover/player:scale-110"
            style={{ borderColor: color }}
          >
            <PersonPhoto name={name} photo={player.person.photo} className="size-8 bg-black/30 sm:size-10" />
          </span>
          {marks ? (
            <>
              <span className="absolute -top-1 -right-1.5">
                <CardIcon marks={marks} tx={tx} />
              </span>
              <span className="absolute -right-2 -bottom-1 flex gap-0.5">
                <ScoringIcons marks={marks} tx={tx} />
              </span>
              {marks.subOut ? (
                <span
                  className="absolute -bottom-1 -left-3 flex items-center rounded-full bg-red-600 py-px pr-1 pl-0.5 text-[0.6rem] leading-none font-semibold text-white tabular-nums shadow-sm"
                  title={fill(tx.marks.subOut, { minute: marks.subOut })}
                >
                  <ArrowDown
                    className="size-2.5"
                    aria-label={fill(tx.marks.subOut, { minute: marks.subOut })}
                  />
                  {marks.subOut}
                </span>
              ) : null}
            </>
          ) : null}
        </span>
        <span
          className="flex max-w-full items-baseline gap-1 rounded bg-black/45 px-1 py-px text-[0.65rem] leading-tight text-white group-hover/player:underline sm:text-xs"
          aria-hidden
        >
          {player.number != null ? <span className="text-white/70 tabular-nums">{player.number}</span> : null}
          <span className="truncate">{shortName(name)}</span>
        </span>
      </PersonLink>
    </div>
  );
}

function PitchHeader({ lineup, color }: { lineup: Lineup; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-sm text-white">
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <Crest src={lineup.team.logo} name={lineup.team.name ?? ''} size="xs" />
      <span className="truncate font-medium">{lineup.team.name}</span>
      {lineup.formation ? (
        <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs tabular-nums">
          {lineup.formation}
        </span>
      ) : null}
    </div>
  );
}

/** Altura (em % do gramado) da primeira e da última linha de cada metade. */
const ROW_FIRST = 6;
const ROW_LAST = 44;

/**
 * Posições no gramado: cada linha do `grid` vira uma fileira e os jogadores se distribuem igualmente na
 * largura. O mandante ataca para baixo (goleiro em cima) e o visitante para cima. A coluna 1 do grid é o
 * lado esquerdo do time; como o mandante está de frente para quem olha, a ordem dele é invertida.
 */
function placed(lineup: Lineup, half: 'top' | 'bottom') {
  const rows = pitchRows(lineup.start_xi);
  const step = rows.length > 1 ? (ROW_LAST - ROW_FIRST) / (rows.length - 1) : 0;
  return rows.flatMap((row, r) => {
    const yHalf = ROW_FIRST + r * step;
    const ordered = half === 'top' ? [...row].reverse() : row;
    return ordered.map((player, c) => ({
      player,
      x: ((c + 0.5) / ordered.length) * 100,
      y: half === 'top' ? yHalf : 100 - yHalf,
    }));
  });
}

/** Tem `grid` para desenhar o campo: quase todos os titulares dos dois times. */
export function hasPitch(lineups: EventLineups): boolean {
  return (
    lineups.lineups.length === 2 &&
    lineups.lineups.every((l) => l.start_xi.filter((p) => /^\d+:\d+$/.test(p.grid ?? '')).length >= 10)
  );
}

function Pitch({
  home,
  away,
  colors,
  marks,
  tx,
}: {
  home: Lineup;
  away: Lineup;
  colors: [string, string];
  marks: MarksLookup;
  tx: Tx;
}) {
  const players = [
    ...placed(home, 'top').map((p) => ({ ...p, color: colors[0] })),
    ...placed(away, 'bottom').map((p) => ({ ...p, color: colors[1] })),
  ];
  return (
    <div
      className="mx-auto w-full max-w-[34rem] overflow-hidden rounded-xl border border-emerald-950 bg-emerald-950"
      role="group"
      aria-label={fill(tx.pitchLabel, { home: home.team.name ?? '', away: away.team.name ?? '' })}
    >
      <PitchHeader lineup={home} color={colors[0]} />
      <div
        // celular: gramado mais comprido que o real, para avatar e nome de fileiras vizinhas não se tocarem
        className="relative aspect-[68/125] w-full bg-emerald-900 sm:aspect-[68/100]"
        style={{
          // faixas do gramado
          backgroundImage:
            'repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.035) 0 6.25%, transparent 6.25% 12.5%)',
        }}
      >
        <PitchLines />
        <CenterCircle />
        {players.map(({ player, x, y, color }) => (
          <PitchPlayer
            key={`${player.person.id ?? player.person.name}-${player.number}`}
            player={player}
            marks={marks(player.person)}
            color={color}
            x={x}
            y={y}
            tx={tx}
          />
        ))}
      </div>
      <PitchHeader lineup={away} color={colors[1]} />
    </div>
  );
}

// ─── tabelas ─────────────────────────────────────────────────────────────────────────────────────

/** Minuto do relógio ("62'", "90+3'") como número, para ordenar. */
const minuteOf = (display: string | null | undefined) => (display ? Number.parseInt(display) : Infinity);

function TeamHeading({ lineup, color, formation }: { lineup: Lineup; color: string; formation?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-medium">
      <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <Crest src={lineup.team.logo} name={lineup.team.name ?? ''} size="xs" />
      <span className="truncate">{lineup.team.name}</span>
      {formation && lineup.formation ? (
        <Badge variant="outline" className="ml-auto font-mono tabular-nums">
          {lineup.formation}
        </Badge>
      ) : null}
    </div>
  );
}

/** Célula do jogador: foto (iniciais de reserva), nome com link e os ícones dos lances. */
function PlayerCell({
  player,
  marks,
  tx,
  showSubOut,
}: {
  player: LineupPlayer;
  marks: PlayerMarks | null;
  tx: Tx;
  showSubOut: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <PersonPhoto name={player.person.name} photo={player.person.photo} className="size-8 shrink-0" />
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <PersonLink id={player.person.id} className="font-medium break-words hover:underline">
          {player.person.name}
        </PersonLink>
        <InlineMarks marks={marks} tx={tx} showSubOut={showSubOut} />
      </span>
    </div>
  );
}

function PositionCell({ position, tx }: { position: string | null; tx: Tx }) {
  if (!position) return null;
  return (
    <span className="text-muted-foreground text-xs" title={tx.positionLong[position] ?? position}>
      {tx.position[position] ?? position}
    </span>
  );
}

function TeamTable({ children, heading }: { children: React.ReactNode; heading: React.ReactNode }) {
  return (
    <div className="bg-card min-w-0 overflow-hidden rounded-lg border">
      {heading}
      {children}
    </div>
  );
}

/** Titulares de cada time: número, foto, nome com cartões, gols, assistências e saída, posição; técnico no rodapé. */
export function LineupStarters({
  lineups,
  colors,
  marks,
  t,
}: {
  lineups: EventLineups;
  colors: [string, string];
  marks: MarksLookup;
  t: Dictionary;
}) {
  const tx = t.event.lineups;
  const cols = t.event.details.columns;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {lineups.lineups.map((l, i) => (
        <TeamTable
          key={l.team.id ?? l.team.name}
          heading={<TeamHeading lineup={l} color={colors[i] ?? colors[0]} formation />}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-right">{cols.number}</TableHead>
                <TableHead>{cols.player}</TableHead>
                <TableHead className="w-14 text-right">{cols.position}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {l.start_xi.map((p) => (
                <TableRow key={`${p.person.id ?? p.person.name}-${p.number}`}>
                  <TableCell className="text-muted-foreground text-right tabular-nums">{p.number}</TableCell>
                  <TableCell className="whitespace-normal">
                    <PlayerCell player={p} marks={marks(p.person)} tx={tx} showSubOut />
                  </TableCell>
                  <TableCell className="text-right">
                    <PositionCell position={p.position} tx={tx} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {l.coach ? (
            <div className="flex items-center gap-2.5 border-t px-3 py-2.5">
              <PersonPhoto name={l.coach.name} photo={l.coach.photo} className="size-8 shrink-0" />
              <span className="flex min-w-0 flex-col leading-tight">
                <PersonLink id={l.coach.id} className="truncate text-sm font-medium hover:underline">
                  {l.coach.name}
                </PersonLink>
                <span className="text-muted-foreground text-xs">{tx.coachRole}</span>
              </span>
            </div>
          ) : null}
        </TeamTable>
      ))}
    </div>
  );
}

/** Reservas de cada time: quem entrou primeiro (↑ verde com o minuto de entrada), depois quem ficou no banco. */
export function LineupBench({
  lineups,
  colors,
  marks,
  t,
}: {
  lineups: EventLineups;
  colors: [string, string];
  marks: MarksLookup;
  t: Dictionary;
}) {
  const tx = t.event.lineups;
  const cols = t.event.details.columns;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {lineups.lineups.map((l, i) => {
        const subs = l.substitutes
          .map((p, idx) => ({ p, idx, m: marks(p.person) }))
          .sort((a, b) => minuteOf(a.m?.subIn) - minuteOf(b.m?.subIn) || a.idx - b.idx);
        return (
          <TeamTable
            key={l.team.id ?? l.team.name}
            heading={<TeamHeading lineup={l} color={colors[i] ?? colors[0]} />}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-right">{cols.number}</TableHead>
                  <TableHead>{cols.player}</TableHead>
                  <TableHead className="w-14 text-right">{cols.position}</TableHead>
                  <TableHead className="w-16 text-right">{cols.cameOn}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subs.map(({ p, m }) => (
                  <TableRow key={`${p.person.id ?? p.person.name}-${p.number}`}>
                    <TableCell className="text-muted-foreground text-right tabular-nums">
                      {p.number}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <PlayerCell player={p} marks={m} tx={tx} showSubOut />
                    </TableCell>
                    <TableCell className="text-right">
                      <PositionCell position={p.position} tx={tx} />
                    </TableCell>
                    <TableCell className="text-right">
                      {m?.subIn ? (
                        <span className="text-success inline-flex items-center gap-0.5 text-xs font-medium tabular-nums">
                          <ArrowUp
                            className="size-3"
                            aria-label={fill(tx.marks.subIn, { minute: m.subIn })}
                          />
                          {m.subIn}
                        </span>
                      ) : (
                        <span
                          className="text-muted-foreground"
                          aria-label={tx.didNotPlay}
                          title={tx.didNotPlay}
                        >
                          –
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TeamTable>
        );
      })}
    </div>
  );
}

/** Titulares no gramado (`grid` da API), com os ícones dos lances. Só com `hasPitch`. */
export function LineupPitch({
  lineups,
  colors,
  marks,
  t,
}: {
  lineups: EventLineups;
  colors: [string, string];
  marks: MarksLookup;
  t: Dictionary;
}) {
  const [home, away] = lineups.lineups;
  if (!home || !away) return null;
  return <Pitch home={home} away={away} colors={colors} marks={marks} tx={t.event.lineups} />;
}
