import Link from 'next/link';

import { cn } from '@/lib/utils';

const STYLE: Record<string, string> = {
  W: 'bg-success/15 text-success',
  D: 'bg-muted text-muted-foreground',
  L: 'bg-destructive/15 text-destructive',
};
const LABEL: Record<string, string> = { W: 'V', D: 'E', L: 'D' };
const TITLE: Record<string, string> = { W: 'Vitória', D: 'Empate', L: 'Derrota' };

/** Sequência de resultados (V/E/D). Com `eventId`, cada resultado abre a partida. */
export function FormChips({ items }: { items: { result: string; eventId?: string; score?: string }[] }) {
  return (
    <div className="flex gap-1">
      {items.map((it, i) => {
        const chip = (
          <span
            title={[TITLE[it.result], it.score].filter(Boolean).join(' · ')}
            className={cn(
              'flex size-5 items-center justify-center rounded-sm text-xs font-semibold',
              STYLE[it.result] ?? STYLE.D,
            )}
          >
            {LABEL[it.result] ?? it.result}
          </span>
        );
        return it.eventId ? (
          <Link key={i} href={`/eventos/${it.eventId}`} className="transition-opacity hover:opacity-80">
            {chip}
          </Link>
        ) : (
          <span key={i}>{chip}</span>
        );
      })}
    </div>
  );
}

/** A forma da API vem como texto ("WWDLW"). */
export const formFromString = (form: string | null | undefined) =>
  (form ?? '').split('').map((result) => ({ result }));
