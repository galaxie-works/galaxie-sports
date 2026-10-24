/**
 * Números do piloto de F1, no formato da página oficial de piloto: a temporada atual (campeonato, GPs e o bloco da
 * sprint, com o link para os resultados do ano), os números da carreira ("melhor resultado: 1 (x8)") e a biografia
 * (nascimento e o texto curto da base semântica). Tudo vem de `/v1/teams/{id}/career`, calculado na API.
 */
import type { CareerSeason, DriverProfile, RaceCareer } from '@galaxie/contracts';
import { ArrowRight, Quote } from 'lucide-react';
import Link from 'next/link';

import { ApiCodeButton } from '@/components/docs/api-code-button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { heroColor } from '@/lib/driver-hero';
import type { ApiRequest } from '@/lib/galaxie/request';
import { calendarDate } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';
import { countryHref, participantHref } from '@/lib/navigation';
import { cn } from '@/lib/utils';

import { CountryFlag } from './country-flag';

function Tile({
  label,
  value,
  detail,
  size = 'md',
}: {
  label: string;
  value: React.ReactNode;
  /** Complemento ao lado do número ("(x8)"). */
  detail?: string;
  size?: 'md' | 'sm';
}) {
  return (
    <div className="bg-muted/40 flex min-w-0 flex-col justify-between gap-1 rounded-lg border px-3 py-2.5">
      <span className="text-muted-foreground line-clamp-2 text-xs leading-tight">{label}</span>
      <span
        className={cn(
          'font-bold tracking-tight tabular-nums',
          size === 'md' ? 'text-2xl md:text-3xl' : 'text-xl',
        )}
      >
        {value}
        {detail ? <span className="text-muted-foreground ml-1 text-sm font-medium">{detail}</span> : null}
      </span>
    </div>
  );
}

/** Domínio da fonte, sem o `www.` (a URL inteira fica no link). */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-primary inline-flex items-center gap-1 self-start text-sm font-medium hover:underline"
    >
      {children}
      <ArrowRight className="size-3.5" aria-hidden />
    </Link>
  );
}

/** Temporada atual: só de quem correu nela (lenda não tem o bloco). */
export async function SeasonStatsCard({ career, api }: { career: RaceCareer; api?: ApiRequest }) {
  const year = career.current_season;
  const s: CareerSeason | undefined = year == null ? undefined : career.seasons.find((x) => x.year === year);
  if (!s) return null;
  const { t } = await getI18n();
  const tx = t.race.season;
  const team = s.teams[0];
  const color = heroColor(s);
  const results = career.competition ? `/competicoes/${career.competition.slug}?temporada=${s.year}` : null;
  return (
    <Card className="overflow-hidden pt-0">
      {/* faixa na cor da equipe do ano */}
      <div aria-hidden className="h-1.5" style={{ background: color ?? 'var(--primary)' }} />
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-x-2">
          {fill(tx.title, { year: s.year })}
          {team ? <span className="text-muted-foreground text-sm font-normal">{team.name}</span> : null}
        </CardTitle>
        {api ? (
          <CardAction>
            <ApiCodeButton request={api} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <Tile label={tx.position} value={s.position != null ? fill(tx.rank, { rank: s.position }) : '–'} />
          <Tile label={tx.points} value={s.points ?? 0} />
          <Tile label={tx.races} value={s.races} />
          <Tile label={tx.wins} value={s.wins} />
          <Tile label={tx.podiums} value={s.podiums} />
          <Tile label={tx.poles} value={s.poles} />
          <Tile label={tx.top10} value={s.top10} />
          <Tile label={tx.fastestLaps} value={s.fastest_laps} />
          <Tile label={tx.dnfs} value={s.dnfs} />
        </div>
        {s.sprint.races ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{tx.sprint}</span>
            <div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
              <Tile size="sm" label={tx.sprintRaces} value={s.sprint.races} />
              <Tile size="sm" label={tx.points} value={s.sprint.points} />
              <Tile size="sm" label={tx.wins} value={s.sprint.wins} />
              <Tile size="sm" label={tx.podiums} value={s.sprint.podiums} />
              <Tile size="sm" label={tx.poles} value={s.sprint.poles} />
              <Tile size="sm" label={tx.top10} value={s.sprint.top10} />
            </div>
          </div>
        ) : null}
        {results ? <MoreLink href={results}>{fill(tx.results, { year: s.year })}</MoreLink> : null}
      </CardContent>
    </Card>
  );
}

/** Números da carreira; o link leva à tabela temporada a temporada (`#temporadas`, na seção da carreira). */
export async function CareerStatsCard({ career, api }: { career: RaceCareer; api?: ApiRequest }) {
  if (!career.totals.races) return null;
  const { t } = await getI18n();
  const tx = t.race.stats;
  const { totals } = career;
  const best = (b: { position: number; count: number } | null) =>
    b ? { value: b.position, detail: `(x${b.count})` } : { value: '–', detail: undefined };
  const finish = best(totals.best_finish);
  const grid = best(totals.best_grid);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx.title}</CardTitle>
        {api ? (
          <CardAction>
            <ApiCodeButton request={api} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground -mt-2 text-xs">{tx.description}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label={tx.races} value={totals.races} />
          <Tile label={tx.points} value={totals.points} />
          <Tile label={tx.bestFinish} value={finish.value} detail={finish.detail} />
          <Tile label={tx.podiums} value={totals.podiums} />
          <Tile label={tx.bestGrid} value={grid.value} detail={grid.detail} />
          <Tile label={tx.poles} value={totals.poles} />
          <Tile label={tx.titles} value={totals.titles} />
          <Tile label={tx.dnfs} value={totals.dnfs} />
        </div>
        <MoreLink href="#temporadas">{tx.archive}</MoreLink>
      </CardContent>
    </Card>
  );
}

/**
 * Biografia: nome completo, nascimento, morte (com o GP do acidente fatal, quando o F1DB o marca), número permanente,
 * apelidos, família no automobilismo e vitórias fora da F1 — fatos do F1DB e do Wikidata, com as fontes no rodapé — e
 * o texto da base semântica: a bio do perfil editorial aprovado (`/v1/teams/{id}/editorial`) ou, sem ela, as frases
 * de identidade. Só aparece o que existe.
 */
export async function DriverBioCard({
  profile,
  identity,
  bio = null,
}: {
  profile: DriverProfile | null;
  /** Frases de identidade da base semântica (`/v1/teams/{id}/semantic`). */
  identity: string[];
  /** Bio do perfil editorial aprovado, com as fontes. */
  bio?: { text: string; sources: string[] } | null;
}) {
  const born = profile?.birth_date;
  const place = [profile?.birth_place, profile?.birth_country?.name].filter(Boolean).join(', ');
  const death = profile?.death ?? null;
  const family = profile?.family ?? [];
  const nicknames = profile?.nicknames ?? [];
  const wins = profile?.other_wins ?? [];
  // nome completo só quando diz mais que o nome da página ("Emerson Fittipaldi" não repete)
  const shownName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  const fullName =
    profile?.full_name && profile.full_name.trim().toLowerCase() !== shownName.toLowerCase()
      ? profile.full_name
      : null;
  if (!born && !place && !identity.length && !bio && !death && !family.length && !fullName) return null;
  const { locale, t } = await getI18n();
  const tx = t.race.bio;
  const country = profile?.birth_country ? countryHref(profile.birth_country.code) : null;
  const race = death?.race ?? null;
  // a corrida do acidente leva o ano quando a morte veio em outro ano (Bianchi: Suzuka 2014, morte em 2015)
  const raceYear = race ? new Date(race.date).getUTCFullYear() : null;
  const raceSentence =
    race && death
      ? fill(tx.deathRace[race.session], {
          gp: '\u0000',
          year: raceYear !== Number(death.date.slice(0, 4)) ? fill(tx.raceYear, { year: raceYear! }) : '',
          city: race.city ?? race.circuit ?? '',
        }).split('\u0000')
      : null;
  const deathPlace = death?.place
    ? [death.place.name, death.place.country?.name].filter(Boolean).join(', ')
    : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {fullName ? (
            <div>
              <dt className="text-muted-foreground text-xs">{tx.fullName}</dt>
              <dd className="font-medium">{fullName}</dd>
            </div>
          ) : null}
          {born ? (
            <div>
              <dt className="text-muted-foreground text-xs">{tx.born}</dt>
              <dd className="font-medium">{calendarDate(locale, born)}</dd>
            </div>
          ) : null}
          {place ? (
            <div>
              <dt className="text-muted-foreground text-xs">{tx.birthplace}</dt>
              <dd className="flex items-center gap-1.5 font-medium">
                {profile?.birth_country ? <CountryFlag code={profile.birth_country.code} /> : null}
                {country ? (
                  <Link href={country} className="hover:underline">
                    {place}
                  </Link>
                ) : (
                  place
                )}
              </dd>
            </div>
          ) : null}
          {death ? (
            <div className="sm:col-span-2 lg:col-span-1">
              <dt className="text-muted-foreground text-xs">{tx.died}</dt>
              <dd className="flex flex-col gap-1">
                <span className="font-medium">
                  {death.age != null
                    ? fill(tx.diedAge, { date: calendarDate(locale, death.date), age: death.age })
                    : calendarDate(locale, death.date)}
                </span>
                {race && raceSentence ? (
                  <span className="text-muted-foreground">
                    {raceSentence[0]}
                    <Link href={`/eventos/${race.event_id}`} className="hover:underline">
                      {race.name}
                    </Link>
                    {raceSentence[1]}
                  </span>
                ) : (
                  <>
                    {deathPlace ? (
                      <span className="text-muted-foreground">
                        {tx.deathPlace}: {deathPlace}
                      </span>
                    ) : null}
                    {death.accident ? (
                      <span className="text-muted-foreground">{tx.accident}</span>
                    ) : death.cause ? (
                      <span className="text-muted-foreground">
                        {tx.deathCause}: {death.cause}
                      </span>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
          ) : null}
          {profile?.number != null ? (
            <div>
              <dt className="text-muted-foreground text-xs">{tx.number}</dt>
              <dd className="font-medium tabular-nums">{profile.number}</dd>
            </div>
          ) : null}
          {nicknames.length ? (
            <div>
              <dt className="text-muted-foreground text-xs">{tx.nicknames}</dt>
              <dd className="font-medium">{nicknames.join(' · ')}</dd>
            </div>
          ) : null}
          {family.length ? (
            <div className="sm:col-span-2 lg:col-span-1">
              <dt className="text-muted-foreground text-xs">{tx.family}</dt>
              <dd>
                <ul className="flex flex-col gap-0.5">
                  {family.map((f) => (
                    <li key={`${f.relation}-${f.driver.f1db_id}`}>
                      <span className="text-muted-foreground">
                        {tx.relations[f.relation]?.[f.gender ?? 'male'] ?? f.relation}:
                      </span>{' '}
                      {f.driver.id ? (
                        <Link
                          href={participantHref({ id: f.driver.id, name: f.driver.name }, 'driver')}
                          className="font-medium hover:underline"
                        >
                          {f.driver.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{f.driver.name}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {wins.length ? (
            <div className="sm:col-span-2 lg:col-span-1">
              <dt className="text-muted-foreground text-xs">{tx.otherWins}</dt>
              <dd>
                <ul className="flex flex-col gap-0.5">
                  {wins.map((w) => (
                    <li key={`${w.race}-${w.year}`}>
                      <a
                        href={w.source}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline"
                      >
                        {tx.wins[w.race] ?? w.race} {w.year}
                      </a>
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
        {bio ? (
          <div className="flex flex-col gap-3">
            {bio.text.split(/\n\s*\n/).map((p) => (
              <p key={p} className="text-muted-foreground leading-relaxed">
                {p}
              </p>
            ))}
            <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {bio.sources.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="hover:underline">
                  {hostOf(url)}
                </a>
              ))}
            </p>
          </div>
        ) : identity.length ? (
          <ul className="flex flex-col gap-2">
            {identity.map((fact) => (
              <li key={fact} className="text-muted-foreground flex gap-2">
                <Quote className="text-primary mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {profile?.sources ? (
          <p className="text-muted-foreground flex flex-wrap gap-x-3 text-xs">
            <span>{tx.sources}:</span>
            <a href={profile.sources.f1db} target="_blank" rel="noreferrer" className="hover:underline">
              F1DB
            </a>
            {profile.sources.wikidata ? (
              <a href={profile.sources.wikidata} target="_blank" rel="noreferrer" className="hover:underline">
                Wikidata
              </a>
            ) : null}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
