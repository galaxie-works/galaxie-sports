import type { PersonOverview } from '@galaxie/contracts';
import { UserRound } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { exampleIds } from '@/lib/example/pages';
import { snapshotSource } from '@/lib/example/snapshot';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import { MARKETS, showcase } from '@/lib/showcase';
import { cn } from '@/lib/utils';

import { ExampleDialog } from './example-dialog';
import { Flag } from './parts';

type Text = Dictionary['landing']['bento']['profile'];
type AppText = Dictionary['landing']['app'];

/** Países com bandeira servida pela página (`/public/flags`). */
const FLAGS = new Set<string>(MARKETS.map((m) => m.code));

/** Base das barras de nota (a escala vai daqui até 10). */
const FORM_FLOOR = 5;

/**
 * Perfil em destaque: o jogador do exemplo (Marlon Freitas; T. Palacios em espanhol) com foto, time,
 * números da temporada e últimos jogos com nota, lidos da cópia gravada do exemplo (sem a API). O botão
 * abre o perfil completo, navegável, no modal.
 */
export async function FeaturedProfile({
  t,
  app,
  positions,
  locale,
}: {
  t: Text;
  app: AppText;
  positions: Record<string, string>;
  locale: Locale;
}) {
  const o = (await snapshotSource.getPersonOverview(exampleIds(locale).jogador, locale)) as PersonOverview;
  const { timeZone } = showcase(locale);
  const nf = new Intl.NumberFormat(locale);
  const rating = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone });
  const team = o.current_team;
  const nationality = o.nationality_ref?.code;
  // sem números na temporada (jogador sem jogos), os cartões mostram zero
  const totals = o.totals ?? { appearances: 0, goals: 0, assists: 0, rating: null };
  const kpis = [
    { label: t.appearances, value: nf.format(totals.appearances) },
    { label: t.goals, value: nf.format(totals.goals) },
    { label: t.assists, value: nf.format(totals.assists) },
    { label: t.rating, value: totals.rating == null ? '—' : rating.format(totals.rating) },
  ];
  // jogos com nota, do mais antigo ao mais recente; o adversário é o outro time do jogo
  const form = o.recent_matches
    .filter((m) => m.rating != null)
    .map((m) => ({
      id: m.event.id,
      value: m.rating as number,
      opponent: m.event.participants.find((p) => p.id !== m.team_id),
    }))
    .reverse();

  return (
    <div className="flex flex-1 flex-col gap-5">
      <div className="flex items-center gap-4">
        {o.person.photo ? (
          <img
            src={o.person.photo}
            alt=""
            width={80}
            height={80}
            loading="lazy"
            className="size-20 shrink-0 rounded-full object-cover ring-2 ring-white/15"
          />
        ) : (
          <span className="bg-background/60 grid size-20 shrink-0 place-items-center rounded-full">
            <UserRound className="text-muted-foreground size-8" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold tracking-tight">{o.person.name}</p>
          <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {team?.logo ? (
              <img src={team.logo} alt="" width={20} height={20} className="size-5 object-contain" />
            ) : null}
            <span>{team?.name}</span>
            {o.position ? <span>· {positions[o.position] ?? o.position}</span> : null}
            {o.number ? <span>· {fill(t.number, { n: nf.format(o.number) })}</span> : null}
            {nationality && FLAGS.has(nationality) ? <Flag code={nationality} /> : null}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-background/50 flex flex-col-reverse gap-0.5 rounded-xl p-3 ring-1 ring-white/10"
          >
            <dt className="text-muted-foreground text-xs">{k.label}</dt>
            <dd className="text-2xl font-semibold tracking-tight tabular-nums">{k.value}</dd>
          </div>
        ))}
      </dl>

      {form.length > 1 ? (
        <figure>
          <figcaption className="text-muted-foreground text-xs font-medium">
            {fill(t.form, { n: nf.format(form.length) })}
          </figcaption>
          {/* Nota de cada jogo, do mais antigo ao mais recente, com o escudo do adversário embaixo. */}
          <ol className="mt-2 grid h-32 grid-flow-col items-end gap-1.5" style={{ gridAutoColumns: '1fr' }}>
            {form.map(({ id, value, opponent }) => (
              <li key={id} className="flex h-full min-w-0 flex-col items-center justify-end gap-1">
                <span className="text-muted-foreground text-[10px] tabular-nums">{rating.format(value)}</span>
                <span
                  className={cn(
                    'w-full max-w-9 rounded-t-md',
                    value >= 7 ? 'bg-emerald-400/70' : 'bg-amber-400/60',
                  )}
                  style={{ height: `${Math.max(8, ((value - FORM_FLOOR) / (10 - FORM_FLOOR)) * 100)}%` }}
                />
                <span className="sr-only">{opponent?.name}</span>
                <Crest logo={opponent?.logo} />
              </li>
            ))}
          </ol>
        </figure>
      ) : null}

      <div>
        <p className="text-muted-foreground text-xs font-medium">{t.recent}</p>
        <ul className="mt-2 grid gap-2 md:grid-cols-3">
          {o.recent_matches.slice(0, 3).map((m) => {
            const [home, away] = [
              m.event.participants.find((p) => p.side === 'home'),
              m.event.participants.find((p) => p.side === 'away'),
            ];
            return (
              <li
                key={m.event.id}
                className="bg-background/50 flex flex-col gap-1.5 rounded-xl px-3 py-2.5 ring-1 ring-white/10"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums">
                    <span className="sr-only">
                      {home?.name} {m.event.score.home ?? '–'}–{m.event.score.away ?? '–'} {away?.name}
                    </span>
                    <Crest logo={home?.logo} />
                    <span aria-hidden>
                      {m.event.score.home ?? '–'}–{m.event.score.away ?? '–'}
                    </span>
                    <Crest logo={away?.logo} />
                  </span>
                  {m.rating != null ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                        m.rating >= 7
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/15 text-amber-200',
                      )}
                    >
                      {rating.format(m.rating)}
                    </span>
                  ) : null}
                </span>
                <span className="text-muted-foreground truncate text-xs">
                  {date.format(new Date(m.event.starts_at))} · {m.event.competition?.name}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <ExampleDialog
        src="/exemplo/jogador"
        title={o.person.name}
        description={app.pages.player.body}
        closeLabel={app.close}
        fullScreenLabel={app.fullScreen}
        triggerClassName={cn(
          buttonVariants({ variant: 'outline', size: 'lg' }),
          'h-11 w-full text-base md:mt-auto md:w-auto md:self-start',
        )}
      >
        <UserRound className="size-4" aria-hidden />
        {t.open}
      </ExampleDialog>
    </div>
  );
}

/** Escudo pequeno dos últimos jogos (o nome vai em texto para leitores de tela). */
function Crest({ logo }: { logo?: string | null }) {
  return logo ? (
    <img src={logo} alt="" width={22} height={22} loading="lazy" className="size-5.5 object-contain" />
  ) : (
    <span className="bg-muted size-5.5 rounded-full" aria-hidden />
  );
}
