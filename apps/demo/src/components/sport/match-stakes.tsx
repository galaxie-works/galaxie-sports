import type { Event } from '@galaxie/contracts';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import type { Locale } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { fill, localized } from '@/lib/i18n/text';

type Participant = Event['participants'][number];
type Stake = Event['stakes'][number];

/** Texto do stake; em "busca o tetra", com as edições já vencidas ("Busca o tetracampeonato (1999, 2020, 2021)"). */
function sentenceOf(s: Stake, locale: Locale): string {
  const text = localized(s.text, locale);
  const seasons = s.titles?.seasons ?? [];
  return text && seasons.length ? `${text} (${seasons.join(', ')})` : text;
}

/** Frases dos stakes sem repetição (o mesmo texto pode vir de códigos diferentes). */
function uniqueSentences(stakes: Stake[], locale: Locale): string[] {
  return [...new Set(stakes.map((s) => sentenceOf(s, locale)).filter(Boolean))];
}

/** Stake do participante: pelo `team_id`; em respostas antigas, pelo lado. */
const belongsTo = (s: Stake, p: Participant) => (s.team_id ? s.team_id === p.id : s.team === p.side);

function Sentences({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((text) => (
        <li key={text} className="flex gap-2">
          <Sparkles className="text-primary mt-0.5 size-3.5 shrink-0" aria-hidden />
          {text}
        </li>
      ))}
    </ul>
  );
}

function TeamStakes({
  p,
  stakes,
  locale,
  fanTagsLabel,
}: {
  p: Participant;
  stakes: Stake[];
  locale: Locale;
  fanTagsLabel: string;
}) {
  const tags = p.fan_tags ?? [];
  const sentences = uniqueSentences(stakes, locale);
  if (!tags.length && !sentences.length && !p.cheer) return null;
  return (
    <div className="flex flex-col gap-2">
      <Link href={`/times/${p.id}`} className="flex w-fit items-center gap-2 font-medium hover:underline">
        <Crest src={p.logo} name={p.name} size="xs" />
        {p.name}
      </Link>
      {tags.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label={fill(fanTagsLabel, { team: p.name })}>
          {tags.map((t) => (
            <Badge key={t.code} variant="primary-light">
              {localized(t.text, locale)}
            </Badge>
          ))}
        </div>
      ) : null}
      <Sentences items={sentences} />
      {p.cheer ? <p className="text-muted-foreground text-xs italic">“{p.cheer.text}”</p> : null}
    </div>
  );
}

/**
 * "O que está em jogo" agrupado por time: escudo e nome, tags do torcedor (`fan_tags`), as frases dos
 * stakes daquele time e o grito da torcida, quando a base semântica tem. Stakes que valem para os dois
 * (`team: both`) aparecem uma vez só, ao final.
 */
export async function MatchStakes({ event }: { event: Event }) {
  const { locale, t } = await getI18n();
  const sides = event.participants.filter((p) => p.side === 'home' || p.side === 'away');
  const shared = uniqueSentences(
    event.stakes.filter((s) => s.team === 'both'),
    locale,
  );
  const groups = sides.map((p) => ({
    p,
    stakes: event.stakes.filter((s) => s.team !== 'both' && belongsTo(s, p)),
  }));
  const hasAny = shared.length || groups.some((g) => g.stakes.length || g.p.fan_tags?.length || g.p.cheer);
  if (!hasAny) return null;
  return (
    <div className="flex flex-col gap-4 [&>*+*]:border-t [&>*+*]:pt-4">
      {groups.map(({ p, stakes }) => (
        <TeamStakes key={p.id} p={p} stakes={stakes} locale={locale} fanTagsLabel={t.sport.fanTagsOf} />
      ))}
      {shared.length ? (
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs font-medium">{t.sport.bothTeams}</span>
          <Sentences items={shared} />
        </div>
      ) : null}
    </div>
  );
}
