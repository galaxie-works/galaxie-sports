import Link from 'next/link';

import { getT } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';

const STYLE: Record<string, string> = {
  W: 'bg-success/15 text-success',
  D: 'bg-muted text-muted-foreground',
  L: 'bg-destructive/15 text-destructive',
};

/** Sequência de resultados (V/E/D no idioma). Com `eventId`, cada resultado abre a partida. */
export async function FormChips({
  items,
}: {
  items: { result: string; eventId?: string; score?: string }[];
}) {
  const { letter, title } = (await getT()).sport.form;
  return (
    <div className="flex gap-1">
      {items.map((it, i) => {
        const chip = (
          <span
            title={[title[it.result], it.score].filter(Boolean).join(' · ')}
            className={cn(
              'flex size-5 items-center justify-center rounded-sm text-xs font-semibold',
              STYLE[it.result] ?? STYLE.D,
            )}
          >
            {letter[it.result] ?? it.result}
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
