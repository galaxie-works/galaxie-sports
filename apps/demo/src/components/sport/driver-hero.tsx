/**
 * Heading do piloto de F1, na cor da equipe da temporada em destaque (a atual de quem está no grid; nas lendas, a
 * mais marcante): gradiente da pintura daquela época, o número do carro gigante em contorno como marca d'água, o
 * carro ao fundo (só CC BY, CC0 ou domínio público), o retrato, o primeiro nome leve e o sobrenome grande, e a
 * linha de meta (bandeira e país | equipe | número). O crédito das duas fotos fica na galeria da página
 * (`heroPhotos` garante que elas estejam lá).
 */
import type { RaceCareer } from '@galaxie/contracts';
import { Calendar, Trophy } from 'lucide-react';
import Link from 'next/link';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { careerSpan, heroColor, heroNumber, heroPhotos, nameParts } from '@/lib/driver-hero';
import { initials } from '@/lib/format';
import { getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

import { CountryFlag } from './country-flag';

/**
 * Fundo do heading: a cor da equipe, escurecida do lado do nome (o texto branco lê em qualquer pintura) e pura do
 * lado do número.
 */
function backdrop(color: string | null): string {
  if (!color) return 'linear-gradient(100deg, #18181b 0%, #27272a 55%, #3f3f46 100%)';
  return `linear-gradient(100deg, color-mix(in oklab, ${color} 50%, #050505) 0%, color-mix(in oklab, ${color} 78%, #050505) 50%, ${color} 100%)`;
}

export async function DriverHero({
  name,
  country,
  career,
  year,
  children,
}: {
  name: string;
  country: { code: string; name: string; href: string | null } | null;
  career: RaceCareer;
  /** Temporada escolhida no seletor (passada); sem ela, a atual ou, na lenda, a mais marcante. */
  year?: number | undefined;
  /** Seletor de temporada e avisos da página, abaixo do nome. */
  children?: React.ReactNode;
}) {
  const { locale, t } = await getI18n();
  const tx = t.race.hero;
  const { season, car, portrait } = heroPhotos(career, year);
  const team = season?.teams[0] ?? null;
  const number = heroNumber(career, season);
  const { first, last } = nameParts(career, name);
  const span = careerSpan(career);
  const titles = career.titles;

  return (
    <section
      className="relative isolate flex min-h-72 flex-col justify-end overflow-hidden rounded-xl text-white ring-1 ring-foreground/10 md:min-h-80"
      style={{ background: backdrop(heroColor(season)) }}
    >
      {car ? (
        <img
          src={car.url!}
          alt=""
          className="motion-safe:animate-in motion-safe:fade-in absolute inset-x-0 top-0 -z-20 h-52 w-full object-cover object-[50%_65%] [mask-image:linear-gradient(to_bottom,black_55%,transparent)] md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[70%] md:[mask-image:linear-gradient(to_right,transparent,black_40%)] motion-safe:duration-700"
        />
      ) : null}
      {/* número do carro gigante, só o contorno, como marca d'água */}
      {number != null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-4 right-3 -z-10 text-[9rem] leading-none font-black tracking-tighter text-transparent select-none md:top-1/2 md:right-10 md:-translate-y-1/2 md:text-[17rem]"
          style={{ WebkitTextStroke: '2px rgb(255 255 255 / 0.4)' }}
        >
          {number}
        </span>
      ) : null}
      {/* véu do lado do texto: de baixo para cima no celular, da esquerda para a direita no desktop */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-t from-black/70 via-black/25 to-transparent md:bg-gradient-to-r md:from-black/45 md:via-black/10 md:to-transparent"
      />

      <div
        className={cn(
          'flex flex-col gap-4 p-5 sm:flex-row sm:items-end md:p-8',
          car ? 'pt-36 md:pt-24' : 'pt-20',
        )}
      >
        <Avatar className="size-24 shrink-0 shadow-md ring-2 ring-white/20 md:size-32">
          {portrait ? (
            <AvatarImage src={portrait.url!} alt={name} className="object-cover object-[50%_20%]" />
          ) : null}
          <AvatarFallback className="bg-white/15 text-3xl font-semibold text-white md:text-4xl">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-2.5 [text-shadow:0_1px_12px_rgb(0_0_0/0.35)]">
          <h1 className="flex flex-col leading-[0.95]">
            {first ? <span className="text-2xl font-light md:text-4xl">{first}</span> : null}
            <span className="text-4xl font-black tracking-tight text-balance uppercase md:text-6xl">
              {last}
            </span>
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium md:text-base">
            {country ? (
              <MetaLink href={country.href}>
                <CountryFlag code={country.code} />
                {country.name}
              </MetaLink>
            ) : null}
            {team ? (
              <>
                <Divider />
                <MetaLink href={`/times/${team.id}`}>{team.name}</MetaLink>
              </>
            ) : null}
            {number != null ? (
              <>
                <Divider />
                <span aria-label={fill(tx.number, { number })} className="tabular-nums">
                  {number}
                </span>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
            {span ? (
              <span className="flex items-center gap-1.5">
                <Calendar className="size-4" aria-hidden />
                {span.from === span.to ? span.from : `${span.from}–${span.to}`}
              </span>
            ) : null}
            {titles.length ? (
              <span className="flex items-center gap-1.5 font-medium text-white">
                <Trophy className="size-4 text-amber-300" aria-hidden />
                {plural(locale, titles.length, tx.titles)}
                <span className="font-normal text-white/85">· {titles.join(', ')}</span>
              </span>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

function Divider() {
  return <span aria-hidden className="h-4 w-px bg-white/45" />;
}

function MetaLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  const className = 'flex items-center gap-1.5';
  return href ? (
    <Link href={href} className={`${className} hover:underline`}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}
