import type { EqCountry, EqDataNotice, EqResult } from '@galaxie/contracts';
import { ExternalLink, Info, ShieldAlert } from 'lucide-react';
import Link from 'next/link';

import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { Badge } from '@/components/reui/badge';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { fill } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

type T = Dictionary['equestrian'];

/** Bandeira vinda da API (código FEI/COI como texto alternativo); sem imagem, mostra o código. */
export function Flag({ country, className }: { country: EqCountry | null; className?: string }) {
  if (!country) return null;
  return country.flag_url ? (
    <img
      src={country.flag_url}
      alt={country.code}
      title={country.name ?? country.code}
      className={cn('h-3.5 w-5 shrink-0 rounded-[2px] object-cover shadow-xs', className)}
    />
  ) : (
    <span
      title={country.name ?? country.code}
      className={cn('bg-muted text-muted-foreground rounded-[2px] px-1 text-[10px] font-medium', className)}
    >
      {country.code}
    </span>
  );
}

/** Aviso fixo da categoria: licenciamento em andamento, fora da oferta comercial. */
export function NoticeBanner({ notice, t }: { notice: EqDataNotice; t: T }) {
  return (
    <Alert variant="warning">
      <ShieldAlert />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {t.notice.title}
        <Badge variant="warning-light">{t.notice.badge}</Badge>
      </AlertTitle>
      <AlertDescription>{notice.message}</AlertDescription>
    </Alert>
  );
}

export function HistoryBadge({ coverage, t }: { coverage: 'complete' | 'partial' | 'not_collected'; t: T }) {
  const variant =
    coverage === 'complete' ? 'success-light' : coverage === 'partial' ? 'warning-light' : 'outline';
  return <Badge variant={variant}>{t.history[coverage]}</Badge>;
}

/** Aviso de cobertura/completude (histórico parcial, classificação parcial). */
export function CoverageNote({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <Alert variant="info">
      <Info />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** Link discreto para a fonte da linha, com a data de leitura. */
export function SourceLink({
  url,
  observedAt,
  page,
  t,
  f,
}: {
  url: string | null;
  observedAt?: string | null;
  page?: number | null;
  t: T;
  f: Formatters;
}) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline"
    >
      <ExternalLink className="size-3" aria-hidden />
      {t.source.label}
      {page ? ` · ${fill(t.source.page, { page })}` : ''}
      {observedAt ? ` · ${fill(t.source.observedAt, { date: f.date(observedAt) })}` : ''}
    </a>
  );
}

/** Número publicado ou "não publicado" (ausente nunca vira zero). */
export function Published({ value, t, suffix }: { value: number | string | null; t: T; suffix?: string }) {
  if (value === null || value === '')
    return <span className="text-muted-foreground/70 italic">{t.missing}</span>;
  return (
    <span className="tabular-nums">
      {value}
      {suffix ?? ''}
    </span>
  );
}

/** Posição publicada ou o status (EL, RET...) com rótulo. */
export function PositionCell({ r, t }: { r: Pick<EqResult, 'position' | 'position_raw' | 'status'>; t: T }) {
  if (r.position !== null) {
    const podium = r.position <= 3;
    return (
      <span
        className={cn(
          'inline-flex min-w-7 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
          r.position === 1 && 'bg-amber-400/20 text-amber-600 dark:text-amber-300',
          r.position === 2 && 'bg-slate-400/20 text-slate-600 dark:text-slate-300',
          r.position === 3 && 'bg-orange-400/20 text-orange-700 dark:text-orange-300',
          !podium && 'text-muted-foreground',
        )}
      >
        {r.position_raw ?? r.position}
      </span>
    );
  }
  return (
    <Badge variant="outline" title={t.statuses[r.status as keyof T['statuses']] ?? r.status}>
      {r.position_raw ?? r.status}
    </Badge>
  );
}

/** Conjunto: bandeira + atleta (link) e cavalo (link) com raça e idade quando a ficha existe. */
export function Combination({
  r,
  t,
  showAthlete = true,
  showHorse = true,
}: {
  r: EqResult;
  t: T;
  showAthlete?: boolean;
  showHorse?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {showAthlete ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <Flag country={r.country ?? r.athlete?.country ?? null} />
          {r.athlete ? (
            <Link href={`/hipismo/atletas/${r.athlete.id}`} className="truncate font-medium hover:underline">
              {r.athlete.name}
            </Link>
          ) : (
            <span className="truncate font-medium">{r.athlete_name_as_published}</span>
          )}
        </span>
      ) : null}
      {showHorse ? (
        <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
          <span aria-hidden>🐴</span>
          {r.horse ? (
            <Link href={`/hipismo/cavalos/${r.horse.id}`} className="truncate hover:underline">
              {r.horse.name}
            </Link>
          ) : (
            <span className="truncate">{r.horse_name_as_published ?? t.missing}</span>
          )}
          {r.horse?.breed ? <span className="shrink-0">· {r.horse.breed}</span> : null}
          {r.horse?.age !== null && r.horse?.age !== undefined ? (
            <span className="shrink-0">· {fill(t.horse.age, { n: r.horse.age })}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** Placar: decomposição segura (faltas/tempo) quando existe; senão, o bruto como publicado. */
export function ScoreCell({ r, t }: { r: EqResult; t: T }) {
  const s = r.score;
  if (s.penalties !== null || s.time_seconds !== null) {
    return (
      <span className="flex flex-col gap-0.5">
        <span className="tabular-nums">
          {s.penalties !== null ? `${s.penalties} ${t.table.faults.toLowerCase()}` : t.missing}
          {s.time_seconds !== null ? ` · ${s.time_seconds.toFixed(2)} s` : ''}
        </span>
        {s.penalties_jumping !== null || s.penalties_time !== null ? (
          <span className="text-muted-foreground text-[11px] tabular-nums">{s.raw}</span>
        ) : null}
      </span>
    );
  }
  if (s.raw) return <code className="text-xs tabular-nums">{s.raw}</code>;
  if (r.rounds_raw?.length) {
    // células como renderizadas na lista completa da prova (sem semântica inventada)
    return (
      <span className="flex flex-col gap-0.5 text-xs tabular-nums">
        {r.rounds_raw.map((round, i) => {
          const label = round.header.replace(/\s+(Faults|Time|Obs|Total).*$/i, '').trim();
          const cells = (Array.isArray(round.cells) ? round.cells.flat() : [])
            .map((c) => String(c).replace(/\s+/g, ' ').trim())
            .filter(Boolean);
          return (
            <span key={i}>
              <span className="text-muted-foreground">{label}:</span> {cells.join(' · ') || t.missing}
            </span>
          );
        })}
      </span>
    );
  }
  if (r.published_breakdown?.length) {
    return (
      <span className="text-muted-foreground text-xs tabular-nums">
        {r.published_breakdown
          .filter((b) => b.value !== null)
          .map((b) => `${b.label} ${b.value}`)
          .join(' · ')}
      </span>
    );
  }
  return <Published value={null} t={t} />;
}

export function PrizeCell({ r, f }: { r: EqResult; f: Formatters }) {
  if (!r.prize) return <span className="text-muted-foreground">—</span>;
  if (r.prize.amount !== null && r.prize.currency)
    return (
      <span className="tabular-nums">
        {f.number(r.prize.amount)} {r.prize.currency}
      </span>
    );
  return <span className="tabular-nums">{r.prize.raw}</span>;
}
