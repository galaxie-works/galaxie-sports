import type { Squad, TeamColors, TeamSeason, TeamSemantic } from '@galaxie/contracts';
import { Calendar, History, MapPin, Megaphone, Quote, Users } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { PageHeader } from '@/components/app-shell/page-header';
import { Badge } from '@/components/reui/badge';
import { CampaignCard } from '@/components/sport/campaign-card';
import { CopyButton } from '@/components/sport/copy-button';
import { Crest } from '@/components/sport/crest';
import { EventCard } from '@/components/sport/event-card';
import { FormChips } from '@/components/sport/form-chips';
import { Intensity } from '@/components/sport/intensity';
import { SeasonSelect, type SeasonOption } from '@/components/sport/season-select';
import { Section } from '@/components/sport/section';
import { ApiCodeButton } from '@/components/docs/api-code-button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getSquad,
  getTeamOverview,
  getTeamSemantic,
  squadRequest,
  teamOverviewRequest,
  teamSemanticRequest,
} from '@/lib/galaxie/api';
import type { ApiRequest } from '@/lib/galaxie/request';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { calendarDate } from '@/lib/i18n/format';
import { getI18n } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';

/** `?temporada=2025` da URL (o primeiro valor, se repetido); fora de um ano inteiro, nada. */
function seasonParam(raw: string | string[] | undefined): number | undefined {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return raw !== undefined && Number.isInteger(n) ? n : undefined;
}

/**
 * Rótulo da temporada: o do fornecedor; num ano com rótulos diferentes (Paulista 2020 e Brasileirão
 * 2020/21), o que cruza o ano, que cobre o período inteiro.
 */
const seasonLabel = (s: TeamSeason) =>
  s.labels.reduce((a, b) => (b.length > a.length ? b : a), s.labels[0] ?? String(s.year));

/** Cores do clube como vêm da base semântica (nomes em pt-BR, sem acento: ver `colorKey`). */
const COLOR_HEX: Record<string, string> = {
  verde: '#16a34a',
  branco: '#ffffff',
  preto: '#0a0a0a',
  vermelho: '#dc2626',
  azul: '#2563eb',
  'azul-celeste': '#7dd3fc',
  celeste: '#7dd3fc',
  amarelo: '#facc15',
  dourado: '#d4a017',
  grena: '#7f1d1d',
  vinho: '#7f1d1d',
  laranja: '#f97316',
  roxo: '#7c3aed',
  cinza: '#9ca3af',
  'azul-marinho': '#1e3a8a',
  rosa: '#ec4899',
  prata: '#c0c0c0',
  creme: '#f5f0dc',
};

/** Nomes em espanhol (times hispânicos na base) → nome em pt-BR, a chave do mapa acima e do dicionário. */
const COLOR_ALIAS: Record<string, string> = {
  blanco: 'branco',
  negro: 'preto',
  rojo: 'vermelho',
  amarillo: 'amarelo',
  oro: 'dourado',
  dorado: 'dourado',
  grana: 'grena',
  granate: 'grena',
  bordo: 'vinho',
  vinotinto: 'vinho',
  naranja: 'laranja',
  violeta: 'roxo',
  morado: 'roxo',
  gris: 'cinza',
  'azul marino': 'azul-marinho',
  plata: 'prata',
  crema: 'creme',
};

/** Chave da cor: minúscula e sem acento ("Grená" → "grena"), com os nomes em espanhol levados ao pt-BR. */
const colorKey = (raw: string) => {
  const plain = raw.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  return COLOR_ALIAS[plain] ?? plain;
};

function Fact({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}

/**
 * Faixa no topo da página com o gradiente sugerido do time (API `colors.gradient`), esmaecendo para o
 * fundo escuro. Fica atrás do hero (o contêiner tem `isolate`); um véu escuro mantém o texto legível.
 */
function TeamBand({ colors }: { colors: TeamColors }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80"
      style={{
        maskImage: 'linear-gradient(to bottom, #000 35%, transparent)',
        WebkitMaskImage: 'linear-gradient(to bottom, #000 35%, transparent)',
      }}
    >
      <div className="absolute inset-0" style={{ background: colors.gradient }} />
      <div className="absolute inset-0 bg-black/25" />
    </div>
  );
}

/** Gradiente sugerido (cores do escudo). `withLabel` quando aparece sozinho, fora da grade de dados. */
function SuggestedGradient({
  colors,
  t,
  withLabel = true,
}: {
  colors: TeamColors;
  t: Dictionary;
  withLabel?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {withLabel ? (
        <span className="text-muted-foreground text-xs">{t.team.identity.suggestedGradient}</span>
      ) : null}
      <div className="flex items-center gap-3">
        <span
          className="border-border size-6 shrink-0 rounded-full border"
          style={{ background: colors.gradient }}
        />
        <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
          {[colors.primary, colors.secondary]
            .filter((c) => c !== null)
            .map((c) => (
              <span key={c} className="flex items-center gap-1">
                <span className="border-border size-3 rounded-full border" style={{ background: c }} />
                {c}
              </span>
            ))}
          {colors.monochrome ? (
            <Badge variant="outline" radius="full">
              {t.team.identity.monochrome}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <code className="bg-muted text-muted-foreground min-w-0 flex-1 truncate rounded-md px-2 py-1 font-mono text-xs">
          {colors.gradient}
        </code>
        <CopyButton value={colors.gradient} label={t.team.identity.copyGradient} />
      </div>
    </div>
  );
}

function IdentityCard({
  s,
  colors,
  api,
  t,
  locale,
}: {
  s: TeamSemantic | null;
  colors: TeamColors | null;
  api: ApiRequest;
  t: Dictionary;
  locale: Locale;
}) {
  if (!s && !colors) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.team.identity.title}</CardTitle>
        <CardAction>
          <ApiCodeButton request={api} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {s ? (
          <SemanticIdentity s={s} colors={colors} t={t} locale={locale} />
        ) : colors ? (
          <SuggestedGradient colors={colors} t={t} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SemanticIdentity({
  s,
  colors,
  t,
  locale,
}: {
  s: TeamSemantic;
  colors: TeamColors | null;
  t: Dictionary;
  locale: Locale;
}) {
  const tx = t.team.identity;
  return (
    <>
      {s.rallying_cries.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <Megaphone className="size-3.5" aria-hidden /> {tx.rallyingCry}
          </span>
          {s.rallying_cries.map((c) => (
            <p key={c} className="text-primary text-xl font-semibold tracking-tight">
              {c}
            </p>
          ))}
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {s.mascot ? (
          <div>
            <dt className="text-muted-foreground text-xs">{tx.mascot}</dt>
            <dd>{s.mascot}</dd>
          </div>
        ) : null}
        {s.fans.demonym ? (
          <div>
            <dt className="text-muted-foreground text-xs">{tx.demonym}</dt>
            <dd>{s.fans.demonym}</dd>
          </div>
        ) : null}
        {s.fans.group_nicknames.length ? (
          <div>
            <dt className="text-muted-foreground text-xs">{tx.fanGroups}</dt>
            <dd>{s.fans.group_nicknames.join(', ')}</dd>
          </div>
        ) : null}
        {s.stadium ? (
          <div>
            <dt className="text-muted-foreground text-xs">{tx.stadium}</dt>
            <dd>
              {s.stadium.name}
              {s.stadium.nicknames.length ? (
                <span className="text-muted-foreground"> ({s.stadium.nicknames.join(', ')})</span>
              ) : null}
              {s.stadium.former_names?.length ? (
                <span className="text-muted-foreground block text-xs">
                  {fill(t.team.formerNames, {
                    names: s.stadium.former_names
                      .map((n) =>
                        fill(t.team.formerName, { name: n.name, until: calendarDate(locale, n.until) }),
                      )
                      .join(', '),
                  })}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {s.colors.length ? (
          <div>
            <dt className="text-muted-foreground text-xs">{tx.colors}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {s.colors.map((c) => {
                const key = colorKey(c);
                return (
                  <span key={c} className="flex items-center gap-1">
                    <span
                      className="border-border size-3 rounded-full border"
                      style={{ background: COLOR_HEX[key] ?? 'transparent' }}
                    />
                    {/* nome exibido no idioma da demo; cor fora do dicionário aparece como veio */}
                    {t.team.colors[key] ?? c}
                  </span>
                );
              })}
            </dd>
          </div>
        ) : null}
        {colors ? (
          // ao lado das cores do clube: as cores do escudo e o gradiente pronto para uso
          <div className="min-w-0">
            <dt className="text-muted-foreground mb-1 text-xs">{tx.suggestedGradient}</dt>
            <dd>
              <SuggestedGradient colors={colors} t={t} withLabel={false} />
            </dd>
          </div>
        ) : null}
        {s.world_cup_titles ? (
          <div>
            <dt className="text-muted-foreground text-xs">{tx.worldCups}</dt>
            <dd>{s.world_cup_titles}</dd>
          </div>
        ) : null}
      </dl>
      {s.identity.length ? (
        <ul className="flex flex-col gap-2">
          {s.identity.map((fact) => (
            <li key={fact} className="text-muted-foreground flex gap-2">
              <Quote className="text-primary mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{fact}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {fill(tx.source, { status: tx.reviewStatus[s.review_status] ?? s.review_status })}
      </p>
    </>
  );
}

function RivalsCard({ s, t }: { s: TeamSemantic; t: Dictionary }) {
  if (!s.rivals.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.team.rivals.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {s.rivals.map((r) => {
          const body = (
            <>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{r.team.name}</span>
                {r.derby ? (
                  <span className="text-muted-foreground truncate text-xs">{r.derby.name}</span>
                ) : null}
              </div>
              <Intensity value={r.intensity ?? r.derby?.intensity} className="ml-auto" />
            </>
          );
          return r.team.participant_id ? (
            <Link
              key={r.team.slug}
              href={`/times/${r.team.participant_id}`}
              className="hover:bg-accent -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors"
            >
              {body}
            </Link>
          ) : (
            <div key={r.team.slug} className="flex items-center gap-3 py-2">
              {body}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SquadSection({
  squad,
  api,
  locale,
  t,
  season,
}: {
  squad: Squad;
  api: ApiRequest;
  locale: Locale;
  t: Dictionary;
  /** Rótulo da temporada anterior escolhida (sem ela, o elenco atual). */
  season?: string;
}) {
  const tx = t.team.squad;
  // agrupa pela posição do fornecedor (chave em inglês); o rótulo sai do dicionário
  const byPosition = new Map<string, Squad['players']>();
  for (const p of squad.players) {
    const key = p.position ?? '';
    byPosition.set(key, [...(byPosition.get(key) ?? []), p]);
  }
  const people = [
    ...[...byPosition].map(
      ([position, members]) =>
        [
          position || 'others',
          position ? (t.sport.positions[position] ?? position) : tx.others,
          members,
        ] as const,
    ),
    ...(squad.coaches.length ? [['staff', tx.staff, squad.coaches] as const] : []),
  ];
  if (!people.length) {
    // temporada anterior sem elenco na base: avisa em vez de sumir com a seção
    return season ? (
      <Section title={tx.title} api={api}>
        <p className="text-muted-foreground text-sm">{fill(tx.unavailable, { season })}</p>
      </Section>
    ) : null;
  }

  return (
    <Section
      title={tx.title}
      api={api}
      description={`${plural(locale, squad.players.length, tx.players)}${season ? ` · ${season}` : ''}`}
    >
      <div className="flex flex-col gap-5">
        {people.map(([key, label, members]) => (
          <div key={key} className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {members.map((m) => (
                <Link
                  key={m.person.id}
                  href={`/pessoas/${m.person.id}`}
                  className="hover:bg-accent flex items-center gap-2 rounded-md border p-2 transition-colors"
                >
                  <Crest src={m.person.photo} name={m.person.name} size="md" round />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{m.person.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {m.number ? `#${m.number}` : ''}
                      {m.person.age ? ` · ${plural(locale, m.person.age, tx.age)}` : ''}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

async function Content({
  params,
  searchParams,
}: Pick<PageProps<'/[locale]/times/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, query, { locale, t }] = await Promise.all([params, searchParams, getI18n()]);
  const [latest, semantic] = await Promise.all([getTeamOverview(id, locale), getTeamSemantic(id, locale)]);
  // API anterior ao seletor (sem `seasons`): só a temporada atual, sem combobox
  const seasons = latest.seasons ?? [];
  // só anos com jogos do time; a temporada corrente é a visão padrão (sem `?temporada`)
  const past = seasons.find((s) => s.year === seasonParam(query.temporada) && !s.current);
  const year = past?.year;
  const [overview, squad] = await Promise.all([
    year === undefined ? latest : getTeamOverview(id, locale, year),
    getSquad(id, locale, year),
  ]);
  const { team } = overview;
  const tsx = t.team.season;
  const label = past ? seasonLabel(past) : undefined;
  const nicknames = semantic?.nicknames.length ? semantic.nicknames : team.nicknames;
  const upcoming = [overview.live_event, overview.next_event].filter((e) => e !== null);
  // API anterior à campanha (sem `competitions`): a seção some em vez de quebrar a página
  const competitions = overview.competitions ?? [];
  const overviewApi = teamOverviewRequest(id, locale, year);
  const basePath = `/times/${id}`;
  const options: SeasonOption[] = seasons.map((s) => ({
    year: s.year,
    label: seasonLabel(s),
    hint: [plural(locale, s.events, tsx.events), s.has_incidents ? null : tsx.noIncidents]
      .filter(Boolean)
      .join(' · '),
    current: s.current,
  }));
  const shownYear = year ?? seasons.find((s) => s.current)?.year;

  // só nomes anteriores confirmados pela curadoria; os derivados do fornecedor são pistas e ficam fora da tela
  // API anterior aos nomes curados (sem `former_names`): nada a mostrar em vez de quebrar a página
  const formerNames = (team.former_names ?? []).filter((f) => f.origin === 'curated');

  return (
    <>
      <PageHeader
        title={team.name}
        label={label ? `${team.name} · ${label}` : undefined}
        kind="time"
        api={overviewApi}
      />
      <div className="relative isolate flex flex-col gap-8 p-4 md:p-6">
        {team.colors ? <TeamBand colors={team.colors} /> : null}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Crest src={team.logo} name={team.name} size="xl" />
          <div className="flex flex-col gap-2">
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
                {options.length && shownYear !== undefined ? (
                  <SeasonSelect
                    options={options}
                    value={shownYear}
                    basePath={basePath}
                    texts={{ label: tsx.label, search: tsx.search, empty: tsx.empty, current: tsx.current }}
                  />
                ) : null}
                {label ? (
                  <span className="flex items-center gap-2">
                    <Badge variant="warning-light" size="lg" radius="full">
                      <History aria-hidden />
                      {fill(tsx.badge, { season: label })}
                    </Badge>
                    <Link
                      href={basePath}
                      scroll={false}
                      className="text-muted-foreground text-xs hover:underline"
                    >
                      {tsx.backToCurrent}
                    </Link>
                  </span>
                ) : null}
              </div>
              {semantic?.official_name && semantic.official_name !== team.name ? (
                <span className="text-muted-foreground text-sm">{semantic.official_name}</span>
              ) : null}
              {formerNames.length ? (
                <span className="text-muted-foreground text-xs">
                  {fill(t.team.formerNames, {
                    names: formerNames
                      .map((n) => fill(t.team.formerName, { name: n.name, until: n.until.slice(0, 4) }))
                      .join(', '),
                  })}
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {team.country_ref ? (
                <Link href={`/paises/${team.country_ref.code.toLowerCase()}`} className="hover:underline">
                  <Fact icon={MapPin}>
                    {[semantic?.city, semantic?.region, team.country_ref.name].filter(Boolean).join(', ')}
                  </Fact>
                </Link>
              ) : null}
              {team.founded ? (
                <Fact icon={Calendar}>{fill(t.team.founded, { year: team.founded })}</Fact>
              ) : null}
              {team.venue ? (
                <Link href={`/locais/${team.venue.id}`} className="hover:underline">
                  <Fact icon={Users}>{team.venue.name}</Fact>
                </Link>
              ) : null}
            </div>
            {nicknames.length ? (
              <div className="flex flex-wrap gap-1.5">
                {nicknames.map((n) => (
                  <Badge key={n} variant="primary-light" radius="full">
                    {n}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            {overview.form.length ? (
              <Section
                title={t.team.form.title}
                description={
                  label ? fill(t.team.form.descriptionSeason, { season: label }) : t.team.form.description
                }
                api={overviewApi}
              >
                <FormChips
                  items={overview.form.map((f) => ({
                    result: f.result,
                    eventId: f.event_id,
                    score: f.score,
                  }))}
                />
              </Section>
            ) : null}

            {competitions.length ? (
              <Section
                title={t.team.competitions.title}
                description={
                  label
                    ? fill(t.team.competitions.descriptionSeason, { season: label })
                    : t.team.competitions.description
                }
                api={overviewApi}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {competitions.map((c) => (
                    <CampaignCard key={`${c.competition.id}-${c.season.year}`} entry={c} />
                  ))}
                </div>
              </Section>
            ) : null}

            {upcoming.length ? (
              <Section title={t.team.nextMatch} api={overviewApi}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {upcoming.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              </Section>
            ) : null}

            {overview.last_events.length ? (
              <Section
                title={t.team.lastMatches}
                description={label ? fill(t.team.lastMatchesSeason, { season: label }) : undefined}
                api={overviewApi}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {overview.last_events.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              </Section>
            ) : null}
          </div>

          <div className="flex flex-col gap-6">
            <IdentityCard
              s={semantic}
              colors={team.colors}
              api={teamSemanticRequest(id, locale)}
              t={t}
              locale={locale}
            />
            {semantic ? <RivalsCard s={semantic} t={t} /> : null}
          </div>
        </div>

        {squad ? (
          <SquadSection
            squad={squad}
            api={squadRequest(id, locale, year)}
            locale={locale}
            t={t}
            season={label}
          />
        ) : null}
      </div>
    </>
  );
}

function Fallback() {
  return (
    <>
      <PageHeader title={<Skeleton className="h-4 w-32" />} />
      <div className="flex flex-col gap-6 p-4 md:p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-24" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-2" />
          <Skeleton className="h-80" />
        </div>
      </div>
    </>
  );
}

export default function TeamPage({ params, searchParams }: PageProps<'/[locale]/times/[id]'>) {
  return (
    <Suspense fallback={<Fallback />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}
