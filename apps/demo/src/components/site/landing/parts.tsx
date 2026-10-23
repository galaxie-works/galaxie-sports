import { initials } from '@/lib/format';
import type { ShowcaseTeam } from '@/lib/showcase';
import { cn } from '@/lib/utils';

const CREST_SIZES = { sm: 'size-7', md: 'size-10', lg: 'size-14' } as const;

/** Escudo do time; sem escudo, as iniciais sobre um degradê na cor do clube. */
export function TeamMark({
  team,
  size = 'md',
}: {
  team: Pick<ShowcaseTeam, 'name' | 'color' | 'crest'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  if (team.crest) {
    return (
      <img
        src={team.crest}
        alt=""
        width={56}
        height={56}
        loading="lazy"
        draggable={false}
        className={cn(CREST_SIZES[size], 'shrink-0 object-contain drop-shadow-[0_2px_6px_rgb(0_0_0/0.5)]')}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ background: `linear-gradient(140deg, ${team.color}, #0b0b12 135%)` }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white ring-1 ring-white/15',
        size === 'sm' && 'size-7 text-[10px]',
        size === 'md' && 'size-10 text-xs',
        size === 'lg' && 'size-14 text-base',
      )}
    >
      {initials(team.name)}
    </span>
  );
}

const FLAG_SIZES = { sm: 'h-3.5 w-5', md: 'h-5 w-7', lg: 'h-8 w-11' } as const;

/** Bandeira do país (SVG em /public/flags, fora do proxy): decorativa, o nome vem ao lado. */
export function Flag({
  code,
  size = 'sm',
  className,
}: {
  code: string;
  size?: keyof typeof FLAG_SIZES;
  className?: string;
}) {
  return (
    <img
      src={`/flags/${code.toLowerCase()}.svg`}
      alt=""
      width={40}
      height={30}
      loading="lazy"
      draggable={false}
      className={cn(FLAG_SIZES[size], 'shrink-0 rounded-[3px] object-cover ring-1 ring-white/15', className)}
    />
  );
}

/** Rótulo curto em pílula (tags do torcedor, recursos de cada esporte). */
export function Chip({
  children,
  tone = 'muted',
  className,
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'brand' | 'live' | 'warn';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs leading-5 font-medium whitespace-nowrap',
        tone === 'muted' && 'text-muted-foreground bg-background/40 border-white/10',
        tone === 'brand' && 'border-primary/40 bg-primary/15 text-foreground',
        tone === 'live' && 'border-live/40 bg-live/15 text-live',
        tone === 'warn' && 'border-amber-400/30 bg-amber-400/10 text-amber-200',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Cabeçalho de seção: sobretítulo, título e linha de apoio. */
export function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', className)}>
      <p className="text-primary text-sm font-medium">{eyebrow}</p>
      <h2
        id={id}
        className="mt-2 scroll-mt-28 text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
      >
        {title}
      </h2>
      {lead ? <p className="text-muted-foreground mt-3 text-lg leading-relaxed text-pretty">{lead}</p> : null}
    </div>
  );
}

/**
 * Célula do bento: o cartão com brilho na cor do matiz (o mesmo `explore-card` dos cards de esporte),
 * o rótulo do recurso, título, uma linha de apoio e o exemplo embaixo.
 */
export function Cell({
  tag,
  title,
  body,
  hue = 279,
  className,
  children,
}: {
  tag: string;
  title: string;
  body?: string;
  hue?: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      style={{ '--hue': hue } as React.CSSProperties}
      className={cn(
        'explore-card flex min-w-0 flex-col gap-4 overflow-hidden rounded-2xl border p-5 sm:p-6',
        className,
      )}
    >
      <header>
        <p className="text-primary text-xs font-semibold tracking-wide uppercase">{tag}</p>
        <h3 className="mt-2 text-xl font-semibold tracking-tight text-balance">{title}</h3>
        {body ? (
          <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed text-pretty">{body}</p>
        ) : null}
      </header>
      <div className="min-w-0">{children}</div>
    </article>
  );
}
