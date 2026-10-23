/**
 * Heading do piloto de F1: o carro da temporada mais marcante ao fundo (esmaecido para o texto ler nos dois
 * temas), o retrato em destaque, nome, nacionalidade, anos de carreira e títulos. Sem foto do carro, o fundo é a
 * cor da equipe daquele ano; sem retrato, as iniciais. O crédito das duas fotos fica na galeria da página
 * (`heroPhotos` garante que elas estejam lá).
 */
import type { RaceCareer } from '@galaxie/contracts';
import { Calendar, Trophy } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { careerSpan, heroPhotos } from '@/lib/driver-hero';
import { initials } from '@/lib/format';
import { getI18n } from '@/lib/i18n/server';
import { plural } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

import { CountryFlag } from './country-flag';

export async function DriverHero({
  name,
  country,
  career,
  children,
}: {
  name: string;
  country: { code: string; name: string; href: string | null } | null;
  career: RaceCareer;
  /** Seletor de temporada e avisos da página, abaixo do nome. */
  children?: React.ReactNode;
}) {
  const { locale, t } = await getI18n();
  const tx = t.race.hero;
  const { season, car, portrait } = heroPhotos(career);
  const team = season?.teams[0] ?? null;
  const span = careerSpan(career);
  const titles = career.titles;
  const colors = car ? null : (team?.colors ?? null);
  // sem foto e sem cor da equipe não há fundo a mostrar: o heading fica compacto
  const backdrop = !!car || !!colors;

  return (
    <section
      className={cn(
        'bg-muted relative isolate flex flex-col justify-end overflow-hidden rounded-xl border',
        backdrop && 'min-h-64 md:min-h-80',
      )}
    >
      {car ? (
        <img
          src={car.url!}
          alt=""
          className="motion-safe:animate-in motion-safe:fade-in absolute inset-x-0 top-0 -z-20 h-64 w-full object-cover object-[50%_65%] md:inset-0 md:h-full motion-safe:duration-700"
        />
      ) : colors ? (
        <div aria-hidden className="absolute inset-0 -z-20" style={{ background: colors.gradient }} />
      ) : null}
      {/* esmaecido: de baixo para cima no celular (o carro numa faixa no topo, o texto embaixo), da esquerda para a
          direita no desktop */}
      <div
        aria-hidden
        className="from-background via-background/85 to-background/10 md:from-background md:via-background/70 md:to-background/0 absolute inset-0 -z-10 bg-gradient-to-t from-35% via-55% md:bg-gradient-to-r md:from-15% md:via-40% md:to-75%"
      />

      <div
        className={cn(
          'flex flex-col gap-4 p-4 sm:flex-row sm:items-end md:p-6',
          car && 'pt-44',
          colors && 'pt-16',
        )}
      >
        <Avatar className="ring-background size-24 shrink-0 shadow-lg ring-4 md:size-32">
          {portrait ? (
            <AvatarImage src={portrait.url!} alt={name} className="object-cover object-[50%_20%]" />
          ) : null}
          <AvatarFallback className="text-3xl font-semibold md:text-4xl">{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">{name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {country ? (
              <CountryLink country={country}>
                <CountryFlag code={country.code} />
                {country.name}
              </CountryLink>
            ) : null}
            {span ? (
              <span className="text-foreground/80 flex items-center gap-1.5">
                <Calendar className="size-4" aria-hidden />
                {span.from === span.to ? span.from : `${span.from}–${span.to}`}
              </span>
            ) : null}
            {titles.length ? (
              <span className="flex items-center gap-1.5 font-medium">
                <Trophy className="size-4 text-amber-500" aria-hidden />
                {plural(locale, titles.length, tx.titles)}
                <span className="text-foreground/80 font-normal">· {titles.join(', ')}</span>
              </span>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

function CountryLink({ country, children }: { country: { href: string | null }; children: React.ReactNode }) {
  const className = 'text-foreground/80 flex items-center gap-1.5';
  return country.href ? (
    <Link href={country.href} className={`${className} hover:underline`}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}
