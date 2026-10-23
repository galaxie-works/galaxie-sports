/**
 * Perfil de F1 na página do piloto ou da equipe: carreira (números, títulos, temporada a temporada com a foto do
 * carro, equipes e companheiros) e galeria de fotos de licença livre. Toda foto sai com o crédito da licença
 * (autor, licença com link e página da Wikimedia Commons), nunca solta.
 */
import type { CareerSeason, Photo, RaceCareer } from '@galaxie/contracts';
import { Flag, Trophy } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ApiRequest } from '@/lib/galaxie/request';
import { getFormatters, getT } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { participantHref } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { Crest } from './crest';
import { Section } from './section';

/** "Foto: Autor / Wikimedia Commons · CC BY 2.0", com os links que a licença pede. */
export function PhotoCredit({
  photo,
  className,
  maxAuthor = 80,
}: {
  photo: Photo;
  className?: string;
  /** Tamanho máximo do autor na legenda (miniaturas usam menos). */
  maxAuthor?: number;
}) {
  const c = photo.credit;
  // o "Artist" da Commons às vezes traz um parágrafo inteiro: a legenda mostra o começo; o texto completo fica
  // no title e na página do arquivo (link "Wikimedia Commons")
  const author =
    c.author && c.author.length > maxAuthor ? `${c.author.slice(0, maxAuthor - 1).trimEnd()}…` : c.author;
  return (
    <span className={cn('text-muted-foreground text-[11px] leading-tight', className)} title={c.text}>
      Foto:{' '}
      {author ? (
        <>
          {c.author_url ? (
            <a href={c.author_url} target="_blank" rel="noreferrer" className="underline">
              {author}
            </a>
          ) : (
            author
          )}{' '}
          /{' '}
        </>
      ) : null}
      <a href={c.page_url} target="_blank" rel="noreferrer" className="underline">
        Wikimedia Commons
      </a>{' '}
      ·{' '}
      {c.license_url ? (
        <a href={c.license_url} target="_blank" rel="noreferrer license" className="underline">
          {c.license}
        </a>
      ) : (
        c.license
      )}
    </span>
  );
}

/** Foto com o crédito logo abaixo (a imagem nunca é recortada: só redimensionada pelo navegador). */
export function PhotoFigure({
  photo,
  caption,
  className,
  imgClassName,
}: {
  photo: Photo;
  caption?: string;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <figure className={cn('flex flex-col gap-1.5', className)}>
      <img
        src={photo.url ?? ''}
        alt={caption ?? photo.credit.title.replace(/^File:/, '').replace(/\.\w+$/, '')}
        width={photo.width ?? undefined}
        height={photo.height ?? undefined}
        loading="lazy"
        className={cn('bg-muted w-full rounded-md object-contain', imgClassName)}
      />
      <figcaption className="flex flex-col gap-0.5">
        {caption ? <span className="text-xs font-medium">{caption}</span> : null}
        <PhotoCredit photo={photo} />
      </figcaption>
    </figure>
  );
}

/**
 * Galeria do piloto ou da equipe (retrato, ação e carros), com crédito em cada foto. `pinned` são as fotos que a
 * página mostra sem crédito (o carro e o retrato do heading do piloto): entram primeiro, para a atribuição da
 * licença continuar na página.
 */
export async function PhotoGallery({
  photos,
  pinned = [],
  api,
}: {
  photos: Photo[];
  pinned?: Photo[];
  api?: ApiRequest;
}) {
  const tx = (await getT()).race.gallery;
  const pinnedUrls = new Set(pinned.map((p) => p.url));
  const shown = [
    ...pinned,
    ...photos.filter((p) => p.role !== 'portrait' && !pinnedUrls.has(p.url)).slice(0, 9 - pinned.length),
  ];
  if (!shown.length) return null;
  return (
    <Section title={tx.title!} description={tx.description} api={api}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((p) => (
          <PhotoFigure
            key={p.url}
            photo={p}
            caption={
              p.role === 'portrait'
                ? tx.portrait
                : p.role === 'car' && p.season
                  ? fill(tx.car!, { season: p.season })
                  : (p.season?.toString() ?? undefined)
            }
            imgClassName="aspect-[4/3]"
          />
        ))}
      </div>
    </Section>
  );
}

/** Retrato do piloto (card lateral), com o crédito. */
export async function PortraitCard({ photo }: { photo: Photo | null }) {
  if (!photo) return null;
  const tx = (await getT()).race.gallery;
  return (
    <Card>
      <CardContent>
        <PhotoFigure photo={photo} caption={tx.portrait} imgClassName="max-h-96" />
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={cn('flex flex-col rounded-md border px-3 py-2', highlight && 'border-amber-400/60')}>
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

function SeasonRow({ s, constructor }: { s: CareerSeason; constructor: boolean }) {
  return (
    <TableRow>
      <TableCell className="font-semibold tabular-nums">
        <span className="inline-flex items-center gap-1.5">
          {s.year}
          {s.final && s.position === 1 ? <Trophy className="size-3.5 text-amber-400" aria-hidden /> : null}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {s.teams.map((t) => (
            <Link key={t.id} href={`/times/${t.id}`} className="flex items-center gap-1.5 hover:underline">
              <Crest src={t.logo} name={t.name} size="xs" round={constructor} />
              <span className="truncate text-sm">{t.name}</span>
            </Link>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{s.position ?? '–'}</TableCell>
      <TableCell className="text-right tabular-nums">{s.points ?? '–'}</TableCell>
      <TableCell className="hidden text-right tabular-nums sm:table-cell">{s.races}</TableCell>
      <TableCell className="text-right tabular-nums">{s.wins}</TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">{s.poles}</TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">{s.podiums}</TableCell>
      <TableCell className="hidden w-28 lg:table-cell">
        {s.car?.url ? (
          <figure className="flex w-24 flex-col gap-0.5">
            <a href={s.car.credit.page_url} target="_blank" rel="noreferrer" title={s.car.credit.text}>
              <img src={s.car.url} alt="" loading="lazy" className="h-12 w-24 rounded object-cover" />
            </a>
            {/* crédito visível em toda foto (CC BY / CC BY-SA), também na miniatura */}
            <PhotoCredit photo={s.car} maxAuthor={24} className="text-[9px]" />
          </figure>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

/** Carreira na F1: números, títulos, marcos, temporada a temporada, equipes e companheiros. */
export async function CareerSection({ career, api }: { career: RaceCareer; api?: ApiRequest }) {
  const [t, f] = await Promise.all([getT(), getFormatters()]);
  const tx = t.race.career;
  const constructor = career.kind === 'constructor';
  if (!career.totals.races) return null;
  const milestones = [
    { label: tx.firstRace!, race: career.first_race },
    { label: tx.firstWin!, race: career.first_win },
    { label: tx.lastRace!, race: career.last_race },
  ].filter((m) => m.race);
  const seasonsWithCar = career.seasons.filter((s) => s.car);
  return (
    <Section title={tx.title!} description={tx.description} api={api}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={tx.titles!} value={career.totals.titles} highlight={career.totals.titles > 0} />
        <Stat label={tx.wins!} value={career.totals.wins} />
        <Stat label={tx.poles!} value={career.totals.poles} />
        <Stat label={tx.podiums!} value={career.totals.podiums} />
        <Stat label={tx.races!} value={career.totals.races} />
        <Stat label={tx.fastestLaps!} value={career.totals.fastest_laps} />
        <Stat label={tx.points!} value={career.totals.points} />
        <Stat label={tx.seasons!} value={career.totals.seasons} />
      </div>
      {career.titles.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {career.titles.map((y) => (
            <Badge key={y} variant="warning-light" radius="full">
              <Trophy aria-hidden />
              {fill(`${tx.champion} {year}`, { year: y })}
            </Badge>
          ))}
        </div>
      ) : null}
      {milestones.length ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {milestones.map((m) => (
            <Link
              key={m.label}
              href={`/eventos/${m.race!.event_id}`}
              className="hover:bg-accent flex flex-col rounded-md border px-3 py-2 transition-colors"
            >
              <span className="text-muted-foreground flex items-center gap-1 text-xs">
                <Flag className="size-3" aria-hidden />
                {m.label}
              </span>
              <span className="truncate text-sm font-medium">{m.race!.name}</span>
              <span className="text-muted-foreground text-xs">
                {f.date(m.race!.date)}
                {m.race!.position ? ` · P${m.race!.position}` : ''}
              </span>
            </Link>
          ))}
        </div>
      ) : null}
      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tx.season}</TableHead>
                <TableHead>{constructor ? tx.drivers : tx.team}</TableHead>
                <TableHead className="text-right">{tx.position}</TableHead>
                <TableHead className="text-right">{t.race.championship.pointsShort}</TableHead>
                <TableHead className="hidden text-right sm:table-cell">{tx.races}</TableHead>
                <TableHead className="text-right">{t.race.championship.winsShort}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{tx.poles}</TableHead>
                <TableHead className="hidden text-right md:table-cell">{tx.podiums}</TableHead>
                <TableHead className="hidden lg:table-cell">{seasonsWithCar.length ? tx.car : ''}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {career.seasons
                .filter((s) => s.races > 0 || s.position != null)
                .map((s) => (
                  <SeasonRow key={s.year} s={s} constructor={constructor} />
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {career.teammates.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">{tx.teammates}</span>
          <div className="flex flex-wrap gap-2">
            {career.teammates.slice(0, 16).map((m) => (
              <Link
                key={m.id}
                href={participantHref(m, 'driver')}
                className="hover:bg-accent flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 transition-colors"
                title={m.seasons.join(', ')}
              >
                <Crest src={m.logo} name={m.name} size="xs" round />
                <span className="text-sm">{m.name}</span>
                <span className="text-muted-foreground text-xs">
                  {fill(tx.racesTogether!, { count: m.races })}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </Section>
  );
}
