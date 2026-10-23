import type { Squad, SquadMember } from '@galaxie/contracts';
import Link from 'next/link';

import { ApiCodeButton } from '@/components/docs/api-code-button';
import { CountryFlag } from '@/components/sport/country-flag';
import { Crest } from '@/components/sport/crest';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiRequest } from '@/lib/galaxie/request';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill, plural } from '@/lib/i18n/text';

/** Ordem dos grupos: as posições do fornecedor (chave em inglês), depois quem veio sem posição. */
const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'];

function MemberRow({ m, href, locale, t }: { m: SquadMember; href: string; locale: Locale; t: Dictionary }) {
  const tx = t.team.squad;
  const played = (m.stats?.appearances ?? 0) > 0;
  return (
    <Link
      href={href}
      className="hover:bg-accent -mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors"
    >
      <span
        className="text-muted-foreground w-5 shrink-0 text-right font-mono text-xs tabular-nums"
        title={m.number ? fill(tx.number, { number: m.number }) : undefined}
      >
        {m.number ?? ''}
      </span>
      <Crest src={m.person.photo} name={m.person.name} size="sm" round />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{m.person.name}</span>
        {m.person.nationality_ref || m.person.age ? (
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {m.person.nationality_ref ? (
              <CountryFlag code={m.person.nationality_ref.code} className="h-3 w-4" />
            ) : null}
            {[m.person.nationality_ref?.name, m.person.age ? plural(locale, m.person.age, tx.age) : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        ) : null}
      </div>
      {m.stats ? (
        <span className={`shrink-0 text-right text-xs tabular-nums ${played ? '' : 'text-muted-foreground'}`}>
          {played ? (
            <>
              <span className="block">{plural(locale, m.stats.appearances, tx.apps)}</span>
              {m.stats.goals ? (
                <span className="text-primary block font-medium">
                  {plural(locale, m.stats.goals, tx.goals)}
                </span>
              ) : null}
            </>
          ) : (
            tx.noApps
          )}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Elenco do time na temporada escolhida, agrupado por posição e depois os técnicos. Cada pessoa leva
 * ao perfil (na mesma temporada, quando ela não é a corrente).
 */
export function SquadCard({
  squad,
  api,
  locale,
  t,
  season,
  seasonYear,
}: {
  squad: Squad;
  api: ApiRequest;
  locale: Locale;
  t: Dictionary;
  /** Rótulo da temporada exibida. */
  season?: string;
  /** Ano de uma temporada anterior (vai no link do perfil); a corrente fica sem. */
  seasonYear?: number;
}) {
  const tx = t.team.squad;
  const groups = new Map<string, SquadMember[]>();
  for (const p of squad.players) {
    const key = p.position && POSITIONS.includes(p.position) ? p.position : '';
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const sections = [
    ...[...POSITIONS, '']
      .filter((k) => groups.has(k))
      .map((k) => ({
        key: k || 'others',
        label: k ? (t.sport.positions[k] ?? k) : tx.others,
        members: groups.get(k)!,
      })),
    ...(squad.coaches.length ? [{ key: 'coaches', label: tx.coaches, members: squad.coaches }] : []),
    ...(squad.staff.length ? [{ key: 'staff', label: tx.staff, members: squad.staff }] : []),
  ];
  const href = (id: string) => `/pessoas/${id}${seasonYear ? `?temporada=${seasonYear}` : ''}`;
  const hasStats = [...squad.players, ...squad.coaches].some((m) => m.stats !== null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx.title}</CardTitle>
        <CardDescription>
          {[squad.players.length ? plural(locale, squad.players.length, tx.players) : null, season]
            .filter(Boolean)
            .join(' · ')}
        </CardDescription>
        <CardAction>
          <ApiCodeButton request={api} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sections.length ? (
          sections.map((s) => (
            <div key={s.key} className="flex flex-col gap-0.5">
              <h3 className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
                {s.label}
              </h3>
              {s.members.map((m) => (
                <MemberRow key={m.person.id} m={m} href={href(m.person.id)} locale={locale} t={t} />
              ))}
            </div>
          ))
        ) : (
          <p className="text-muted-foreground text-sm">{fill(tx.unavailable, { season: season ?? '' })}</p>
        )}
        {sections.length && hasStats ? <p className="text-muted-foreground text-xs">{tx.statsNote}</p> : null}
      </CardContent>
    </Card>
  );
}
