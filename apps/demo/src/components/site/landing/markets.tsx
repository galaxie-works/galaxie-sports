import { Languages, Tv } from 'lucide-react';

import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import { HEADLINE, MARKETS } from '@/lib/showcase';

import { Chip, Flag } from './parts';

type Text = Dictionary['landing']['markets'];

/**
 * Os 11 mercados com bandeira, nome no idioma da tela, a voz do conteúdo (português ou a variante local
 * do espanhol) e se há "onde assistir" no país. Um cartão-resumo fecha a grade.
 */
export function MarketsGrid({ t, locale }: { t: Text; locale: Locale }) {
  const regions = new Intl.DisplayNames([locale], { type: 'region' });
  const languages = new Intl.DisplayNames([locale], { type: 'language' });
  const nf = new Intl.NumberFormat(locale);
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {MARKETS.map((m) => (
        <li
          key={m.code}
          className="bg-card/60 flex items-center gap-4 rounded-2xl border p-4 backdrop-blur-sm"
        >
          <Flag code={m.code} size="lg" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate font-medium">{regions.of(m.code)}</span>
            <span className="text-muted-foreground truncate text-xs">
              {m.voice === 'es' ? t.spanish : languages.of(m.voice)}
            </span>
            {m.watch ? (
              <Chip className="mt-1 self-start px-2 text-[11px]">
                <Tv className="size-3" aria-hidden />
                {t.whereToWatch}
              </Chip>
            ) : null}
          </span>
        </li>
      ))}
      <li className="explore-card flex flex-col justify-center gap-2 rounded-2xl border p-4">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Tv className="text-primary size-4" aria-hidden />
          {fill(t.summaryWatch, { n: nf.format(HEADLINE.watch) })}
        </span>
        <span className="flex items-center gap-2 text-sm font-medium">
          <Languages className="text-primary size-4" aria-hidden />
          {fill(t.summaryVoices, { n: nf.format(HEADLINE.voices) })}
        </span>
      </li>
    </ul>
  );
}
