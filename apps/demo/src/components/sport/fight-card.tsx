import type { Event, EventFight, EventFightCard, SupportedLocale } from '@galaxie/contracts';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Section } from '@/components/sport/section';
import { Card, CardContent } from '@/components/ui/card';
import { eventCardRequest } from '@/lib/galaxie/api';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import type { Formatters } from '@/lib/i18n/format';
import { fill, plural } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

const SEGMENTS = ['main_card', 'prelims', 'early_prelims'] as const;

/** "Nocaute (Punches) · 2º round, 3:29" — o desfecho da luta numa linha. */
export function fightResultText(result: NonNullable<EventFight['result']>, t: Dictionary): string {
  const tx = t.event.fight;
  const method = result.detail ? `${result.method_name} (${result.detail})` : result.method_name;
  const when =
    result.round != null
      ? result.time
        ? fill(tx.roundTime, { round: result.round, time: result.time })
        : fill(tx.round, { round: result.round })
      : null;
  return [method, when].filter(Boolean).join(' · ');
}

function Fighter({ p, align }: { p: Event['participants'][number] | undefined; align: 'left' | 'right' }) {
  if (!p) return <span className="flex-1" />;
  return (
    <span
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2',
        align === 'right' && 'flex-row-reverse text-right',
        p.winner === false && 'text-muted-foreground',
      )}
    >
      <Crest src={p.logo} name={p.name} size="sm" round />
      <span className={cn('truncate', p.winner === true && 'font-semibold')}>{p.name}</span>
    </span>
  );
}

function FightRow({ e, current, t }: { e: Event; current: boolean; t: Dictionary }) {
  const tx = t.event.fight;
  const [red, blue] = e.participants;
  const fight = e.fight;
  return (
    <Link
      href={`/eventos/${e.id}`}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'hover:bg-accent flex flex-col gap-1 rounded-md px-2 py-2 text-sm transition-colors',
        current && 'bg-accent',
      )}
    >
      <span className="flex items-center gap-3">
        <Fighter p={red} align="left" />
        <span className="text-muted-foreground shrink-0 text-xs">{t.sport.versus}</span>
        <Fighter p={blue} align="right" />
      </span>
      <span className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs">
        {fight?.main_event ? <Badge variant="primary-light">{tx.mainEvent}</Badge> : null}
        {current ? <Badge variant="outline">{tx.thisFight}</Badge> : null}
        {fight?.weight_class ? <span>{fight.weight_class.name}</span> : null}
        {e.status === 'cancelled' ? (
          <Badge variant="secondary">{tx.cancelled}</Badge>
        ) : fight?.result ? (
          <span>· {fightResultText(fight.result, t)}</span>
        ) : null}
      </span>
    </Link>
  );
}

/** Card de lutas (a noite de MMA) com a luta da página destacada, do card principal às preliminares iniciais. */
export function FightCardSection({
  card,
  currentId,
  locale,
  content,
  t,
  f,
}: {
  card: EventFightCard;
  currentId: string;
  locale: Locale;
  content: SupportedLocale;
  t: Dictionary;
  f: Formatters;
}) {
  const tx = t.event.fight;
  const groups = SEGMENTS.map((segment) => ({
    segment,
    fights: card.fights.filter((e) => (e.fight?.segment ?? 'main_card') === segment),
  })).filter((g) => g.fights.length);
  return (
    <Section
      title={`${tx.title} · ${card.card.name}`}
      description={`${f.dateLong(card.card.starts_at)} · ${plural(locale, card.fights.length, tx.fights)}`}
      api={eventCardRequest(currentId, locale, content)}
    >
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <Card key={g.segment} size="sm">
            <CardContent className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-2 pb-1">
                <span className="text-sm font-medium">{tx.segments[g.segment]}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {f.time(
                    g.fights.reduce((a, e) => (e.starts_at < a ? e.starts_at : a), g.fights[0]!.starts_at),
                  )}
                </span>
              </div>
              {g.fights.map((e) => (
                <FightRow key={e.id} e={e} current={e.id === currentId} t={t} />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </Section>
  );
}
