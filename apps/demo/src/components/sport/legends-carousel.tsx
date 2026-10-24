/**
 * Carrossel "Legendary" da página da F1: os campeões mundiais e os maiores em vitórias e GPs, no mesmo nível do
 * heading do piloto. Cada card tem a cor da equipe da temporada marcante, o carro dela ao fundo (só CC BY, CC0 ou
 * domínio público: o card recorta a foto), o número do carro em contorno, o retrato e o nome em duas linhas, e leva
 * à página do piloto. Sem foto compatível, fica a cor da equipe e o número grande. Os créditos das fotos vêm logo
 * abaixo do carrossel, com os links que a licença pede.
 */
import type { RaceLegend } from '@galaxie/contracts';
import { Trophy } from 'lucide-react';
import Image, { getImageProps } from 'next/image';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getRaceLegends, raceLegendsRequest } from '@/lib/galaxie/api';
import { initials } from '@/lib/format';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { legendBackdrop, legendColor, legendPhotos, yearRanges } from '@/lib/legends';
import { participantHref } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { CountryFlag } from './country-flag';
import { PhotoCredit } from './race-career';
import { ScrollRow } from './scroll-row';
import { Section } from './section';

/** Cards visíveis de saída no desktop: as fotos deles não esperam a rolagem. */
const EAGER = 4;

export async function LegendsCarousel() {
  const { locale, t } = await getI18n();
  const tx = t.race.legends;
  // sem a API, a página do esporte segue sem o carrossel
  const legends = await getRaceLegends(locale).catch(() => []);
  if (!legends.length) return null;
  const regions = new Intl.DisplayNames([locale], { type: 'region' });
  const countryName = (c: NonNullable<RaceLegend['country']>) => {
    try {
      return regions.of(c.code) ?? c.name;
    } catch {
      return c.name;
    }
  };
  const credits = legendPhotos(legends);

  return (
    <Section
      title={tx.title}
      icon={<Trophy className="size-4 text-amber-500" aria-hidden />}
      description={tx.description}
      api={raceLegendsRequest(locale)}
    >
      <ScrollRow
        label={tx.label}
        previous={tx.previous}
        next={tx.next}
        className="snap-x snap-mandatory scroll-px-1 gap-3 px-1 pb-2"
      >
        {legends.map((l, i) => (
          <LegendCard
            key={l.id}
            legend={l}
            eager={i < EAGER}
            country={l.country ? countryName(l.country) : null}
            locale={locale}
            tx={tx}
          />
        ))}
      </ScrollRow>
      {credits.length ? (
        <details className="group/credits text-xs">
          <summary className="text-muted-foreground hover:text-foreground w-fit cursor-pointer select-none">
            {tx.credits}
          </summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
            {credits.map(({ photo, names }) => (
              <li key={photo.url} className="flex min-w-0 gap-1.5">
                <span className="shrink-0 font-medium">{names.join(', ')}</span>
                <PhotoCredit photo={photo} maxAuthor={40} className="truncate" />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  );
}

function LegendCard({
  legend: l,
  eager,
  country,
  locale,
  tx,
}: {
  legend: RaceLegend;
  eager: boolean;
  country: string | null;
  locale: Locale;
  tx: Dictionary['race']['legends'];
}) {
  const car = l.highlight?.car ?? null;
  const number = l.highlight?.number ?? null;
  const team = l.highlight?.team ?? null;
  // retrato pelo otimizador de imagens (o Avatar troca pelas iniciais se a foto falhar)
  const portrait = l.portrait?.url
    ? getImageProps({ src: l.portrait.url, alt: l.name, width: 64, height: 64 }).props
    : null;

  return (
    <Link
      href={participantHref(l, 'driver')}
      className="group/legend focus-visible:ring-ring relative isolate flex h-[25rem] w-[78vw] max-w-72 shrink-0 snap-start flex-col justify-end overflow-hidden rounded-xl border text-white shadow-sm transition-shadow outline-none hover:shadow-lg focus-visible:ring-2 sm:w-72"
      style={{ background: legendBackdrop(legendColor(l)) }}
    >
      {car?.url ? (
        <div className="absolute inset-x-0 top-0 -z-20 h-52 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]">
          <Image
            src={car.url}
            alt=""
            fill
            sizes="(min-width: 640px) 288px, 78vw"
            loading={eager ? 'eager' : 'lazy'}
            className="object-cover object-[50%_65%] transition-transform duration-500 group-hover/legend:scale-105 motion-reduce:transition-none"
          />
        </div>
      ) : null}
      {/* número do carro gigante, em contorno; sem o carro ao fundo, ele é o protagonista */}
      {number != null ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute right-2 -z-10 leading-none font-black tracking-tighter text-transparent select-none',
            car ? '-top-3 text-[7rem]' : 'top-2 text-[10rem]',
          )}
          style={{ WebkitTextStroke: car ? '2px rgb(255 255 255 / 0.4)' : '3px rgb(255 255 255 / 0.55)' }}
        >
          {number}
        </span>
      ) : null}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/30 to-transparent"
      />
      {l.active ? (
        <span className="absolute top-3 left-3 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm">
          {tx.active}
        </span>
      ) : null}

      <div className="flex flex-col gap-2.5 p-4 [text-shadow:0_1px_12px_rgb(0_0_0/0.35)]">
        <Avatar className="size-16 shadow-lg ring-4 ring-white/25">
          {portrait ? <AvatarImage {...portrait} className="object-cover object-[50%_20%]" /> : null}
          <AvatarFallback className="bg-white/15 text-xl font-semibold text-white">
            {initials(l.name)}
          </AvatarFallback>
        </Avatar>
        <h3 className="flex flex-col leading-[0.95]">
          {l.first_name ? <span className="text-lg font-light">{l.first_name}</span> : null}
          <span className="text-[1.7rem] font-black tracking-tight uppercase [overflow-wrap:anywhere]">
            {l.last_name}
          </span>
        </h3>
        {country && l.country ? (
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <CountryFlag code={l.country.code} />
            {country}
          </span>
        ) : null}
        {/* duas linhas sempre (com ou sem título): os números ficam na mesma altura em todos os cards */}
        <div className="flex min-h-10 flex-col justify-center gap-0.5 text-sm">
          {l.titles.length ? (
            <>
              <span className="flex items-center gap-1.5 font-medium">
                <Trophy className="size-4 shrink-0 text-amber-300" aria-hidden />
                {plural(locale, l.titles.length, tx.titles)}
              </span>
              <span className="text-xs text-white/85">{yearRanges(l.titles)}</span>
            </>
          ) : (
            <span className="text-white/85">{l.criteria.includes('wins') ? tx.topWins : tx.topRaces}</span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-2 border-t border-white/20 pt-2.5">
          <Stat label={tx.wins} value={l.wins} />
          <Stat label={tx.races} value={l.races} />
        </dl>
        {team && l.highlight ? (
          <span className="truncate text-xs text-white/75">
            {fill(tx.season, { team: team.constructor_name, year: l.highlight.season })}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs text-white/75">{label}</dt>
      <dd className="text-2xl leading-none font-bold tabular-nums">{value}</dd>
    </div>
  );
}
