/**
 * Perfil do piloto de F1 além dos números da carreira: "Estilo e pistas" (os traços calculados do F1DB em
 * `/v1/teams/{id}/traits` — sábado × domingo, pistas preferidas, duelo com os companheiros e sequências — com o modo
 * de pilotagem e os pontos fortes do perfil editorial aprovado) e "Momentos" (as corridas marcantes e as
 * rivalidades das lendas, de `/v1/teams/{id}/editorial`, cada item com a fonte).
 */
import type { DriverEditorial, DriverTraits } from '@galaxie/contracts';
import { CloudRain, ExternalLink } from 'lucide-react';
import Link from 'next/link';

import { ApiCodeButton } from '@/components/docs/api-code-button';
import { Badge } from '@/components/reui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiRequest } from '@/lib/galaxie/request';
import { getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { participantHref } from '@/lib/navigation';

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/40 flex min-w-0 flex-col justify-between gap-1 rounded-lg border px-3 py-2.5">
      <span className="text-muted-foreground line-clamp-2 text-xs leading-tight">{label}</span>
      <span className="text-xl font-bold tracking-tight tabular-nums">{value}</span>
    </div>
  );
}

/** Link discreto para a fonte do item (o domínio, sem o `www.`). */
function SourceLink({ url, label }: { url: string; label: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // URL estranha: mostra como veio
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={`${label}: ${url}`}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs hover:underline"
    >
      <ExternalLink className="size-3" aria-hidden />
      {host}
    </a>
  );
}

const duelText = (d: { won: number; lost: number }) => `${d.won}–${d.lost}`;
const years = (list: number[]) =>
  list.length ? (list[0] === list.at(-1) ? `${list[0]}` : `${list[0]}–${list.at(-1)}`) : '–';

export async function DriverStyleCard({
  traits,
  editorial,
  api,
}: {
  traits: DriverTraits;
  /** Perfil editorial aprovado (estilo e pontos fortes), quando houver. */
  editorial: DriverEditorial | null;
  api?: ApiRequest;
}) {
  const q = traits.qualifying_vs_race;
  if (!q.races) return null;
  const { locale, t } = await getI18n();
  const tx = t.race.profile;
  const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const dec = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const signed = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const dash = (v: number | null, f: Intl.NumberFormat) => (v == null ? '–' : f.format(v));
  const favorites = traits.circuits.favorites;
  const mates = traits.teammates.by_teammate.slice(0, 6);
  const { streaks } = traits.consistency;
  const streakChips = [
    streaks.wins.length > 1 ? { s: streaks.wins, forms: tx.streakWins } : null,
    streaks.podiums.length > 1 ? { s: streaks.podiums, forms: tx.streakPodiums } : null,
    streaks.points.length > 1 ? { s: streaks.points, forms: tx.streakPoints } : null,
  ].filter((x) => x !== null);
  const style = editorial?.style ?? null;
  const strengths = editorial?.strengths ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx.title}</CardTitle>
        <CardDescription>{tx.description}</CardDescription>
        {api ? (
          <CardAction>
            <ApiCodeButton request={api} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {q.label || style ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {q.label ? (
                <Badge variant="primary-light" size="lg" radius="full">
                  {tx[q.label]}
                </Badge>
              ) : null}
              {style ? (
                <Badge variant="info-light" size="lg" radius="full">
                  {tx.style}: {tx.styles[style.kind] ?? style.kind}
                </Badge>
              ) : null}
            </div>
            {q.label && q.grid_duel_rate != null && q.race_duel_rate != null ? (
              <p className="text-muted-foreground text-xs">
                {fill(tx.labelHint, {
                  grid: pct.format(q.grid_duel_rate),
                  race: pct.format(q.race_duel_rate),
                })}
              </p>
            ) : null}
            {style ? (
              <p className="text-sm">
                {style.text}{' '}
                {style.sources[0] ? <SourceLink url={style.sources[0]} label={tx.source} /> : null}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile label={tx.poleRate} value={pct.format(q.pole_rate)} />
          <Tile label={tx.avgGrid} value={dash(q.avg_grid, dec)} />
          <Tile label={tx.avgFinish} value={dash(q.avg_finish, dec)} />
          <Tile label={tx.gained} value={dash(q.avg_positions_gained, signed)} />
          <Tile label={tx.dnfRate} value={pct.format(traits.consistency.dnf_rate)} />
          <Tile label={tx.pointsPerStart} value={dec.format(traits.consistency.points_per_start)} />
        </div>

        {strengths.length ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{tx.strengths}</span>
            <ul className="flex flex-col gap-2">
              {strengths.map((s) => (
                <li key={s.key} className="flex flex-col gap-0.5 text-sm">
                  <span className="font-medium">{tx.strengthLabels[s.key] ?? s.key}</span>
                  <span className="text-muted-foreground">
                    {s.text} {s.source ? <SourceLink url={s.source} label={tx.source} /> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {favorites.length ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">{tx.favorites}</span>
              <ol className="flex flex-col gap-2">
                {favorites.map((c, i) => (
                  <li key={c.circuit.venue_id ?? c.circuit.name} className="flex gap-3">
                    <span className="text-primary w-4 shrink-0 text-lg leading-6 font-bold tabular-nums">
                      {i + 1}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      {c.circuit.venue_id ? (
                        <Link
                          href={`/locais/${c.circuit.venue_id}`}
                          className="truncate font-medium hover:underline"
                        >
                          {c.circuit.name}
                        </Link>
                      ) : (
                        <span className="truncate font-medium">{c.circuit.name}</span>
                      )}
                      <span className="text-muted-foreground text-xs">
                        {[
                          c.wins ? plural(locale, c.wins, tx.wins) : null,
                          c.poles ? plural(locale, c.poles, tx.poles) : null,
                          c.podiums ? plural(locale, c.podiums, tx.podiums) : null,
                          !c.podiums && c.avg_finish != null
                            ? fill(tx.avgFinishShort, { value: dec.format(c.avg_finish) })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}{' '}
                        {plural(locale, c.races, tx.races)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="text-muted-foreground text-xs">
                {fill(tx.favoritesHint, { min: traits.circuits.criterion.min_races })}
              </p>
            </div>
          ) : null}

          {mates.length ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">{tx.duel}</span>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="pb-1 font-medium">{tx.teammate}</th>
                    <th className="pb-1 font-medium">{tx.seasons}</th>
                    <th className="pb-1 text-right font-medium">{tx.grid}</th>
                    <th className="pb-1 text-right font-medium">{tx.race}</th>
                  </tr>
                </thead>
                <tbody>
                  {mates.map((m) => (
                    <tr key={m.teammate.id} className="border-t">
                      <td className="py-1.5 pr-2 leading-tight">
                        <Link href={participantHref(m.teammate, 'driver')} className="hover:underline">
                          {m.teammate.name}
                        </Link>
                      </td>
                      <td className="text-muted-foreground py-1.5 pr-2 text-xs tabular-nums">
                        {years(m.seasons)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{duelText(m.grid)}</td>
                      <td className="py-1.5 text-right tabular-nums">{duelText(m.race)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-semibold">
                    <td className="py-1.5">{tx.career}</td>
                    <td />
                    <td className="py-1.5 text-right tabular-nums">
                      {duelText(traits.teammates.career.grid)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {duelText(traits.teammates.career.race)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-muted-foreground text-xs">{tx.duelHint}</p>
            </div>
          ) : null}
        </div>

        {streakChips.length ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{tx.streaks}</span>
            <div className="flex flex-wrap gap-2">
              {streakChips.map(({ s, forms }) => (
                <Badge key={forms.other} variant="outline" size="lg" radius="full">
                  {plural(locale, s.length, forms)}
                  {s.from ? (
                    <span className="text-muted-foreground ml-1 tabular-nums">
                      ({years([s.from.year, s.to?.year ?? s.from.year])})
                    </span>
                  ) : null}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Momentos marcantes e rivalidades: só lenda com perfil editorial aprovado. */
export async function DriverMomentsCard({
  editorial,
  api,
}: {
  editorial: DriverEditorial;
  api?: ApiRequest;
}) {
  if (editorial.tier !== 'legend' || editorial.review_status !== 'approved' || !editorial.moments.length)
    return null;
  const { t } = await getI18n();
  const tx = t.race.profile;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx.moments}</CardTitle>
        <CardDescription>{tx.momentsDescription}</CardDescription>
        {api ? (
          <CardAction>
            <ApiCodeButton request={api} />
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <ol className="relative flex flex-col gap-5 border-l pl-5">
          {editorial.moments.map((m) => (
            <li key={`${m.year ?? ''}-${m.race}`} className="relative flex flex-col gap-1">
              <span
                aria-hidden
                className="bg-primary ring-background absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4"
              />
              <span className="flex flex-wrap items-center gap-2">
                {m.year != null ? <span className="text-lg font-bold tabular-nums">{m.year}</span> : null}
                {m.event_id ? (
                  <Link href={`/eventos/${m.event_id}`} className="font-medium hover:underline">
                    {m.race}
                  </Link>
                ) : (
                  <span className="font-medium">{m.race}</span>
                )}
                {m.wet ? (
                  <Badge variant="info-light" radius="full">
                    <CloudRain aria-hidden />
                    {tx.wet}
                  </Badge>
                ) : null}
              </span>
              <p className="text-sm">{m.text}</p>
              {m.source ? <SourceLink url={m.source} label={tx.source} /> : null}
            </li>
          ))}
        </ol>

        {editorial.rivalries.length ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{tx.rivalries}</span>
            <ul className="flex flex-col gap-3">
              {editorial.rivalries.map((r) => (
                <li key={r.driver.f1db_id ?? r.driver.name} className="flex flex-col gap-0.5 text-sm">
                  {r.driver.id ? (
                    <Link
                      href={participantHref({ id: r.driver.id, name: r.driver.name }, 'driver')}
                      className="font-medium hover:underline"
                    >
                      {r.driver.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.driver.name}</span>
                  )}
                  <span className="text-muted-foreground">
                    {r.text} {r.source ? <SourceLink url={r.source} label={tx.source} /> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
