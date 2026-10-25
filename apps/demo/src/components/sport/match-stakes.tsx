import type { Event } from '@galaxie/contracts';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import type { Locale } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { fill, localized } from '@/lib/i18n/text';
import { phaseOf, splitStakes, type Phase, type Stake } from '@/lib/match-stakes';

type Participant = Event['participants'][number];

const PHASES: readonly Phase[] = ['pre_match', 'result'];

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

/**
 * Frases separadas por fase: num jogo encerrado (`phased`), "Antes do jogo" (o que estava em jogo) e
 * "Com o resultado" (o que o placar mudou); antes do jogo, só a lista.
 */
function PhasedSentences({
  stakes,
  locale,
  labels,
  phased,
}: {
  stakes: Stake[];
  locale: Locale;
  labels: Record<Phase, string>;
  phased: boolean;
}) {
  const groups = PHASES.map((phase) => ({
    phase,
    items: uniqueSentences(
      stakes.filter((s) => phaseOf(s) === phase),
      locale,
    ),
  })).filter((g) => g.items.length);
  if (!phased) return <Sentences items={groups.flatMap((g) => g.items)} />;
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.phase} className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">{labels[g.phase]}</span>
          <Sentences items={g.items} />
        </div>
      ))}
    </div>
  );
}

function TeamStakes({
  p,
  stakes,
  locale,
  fanTagsLabel,
  phaseLabels,
  phased,
}: {
  p: Participant;
  stakes: Stake[];
  locale: Locale;
  fanTagsLabel: string;
  phaseLabels: Record<Phase, string>;
  phased: boolean;
}) {
  const tags = p.fan_tags ?? [];
  if (!tags.length && !stakes.length && !p.cheer) return null;
  return (
    <section
      aria-label={p.name}
      className="border-border flex flex-col gap-2 border-l-4 pl-3"
      style={p.colors?.primary ? { borderLeftColor: p.colors.primary } : undefined}
    >
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
      <PhasedSentences stakes={stakes} locale={locale} labels={phaseLabels} phased={phased} />
      {p.cheer ? <p className="text-muted-foreground text-xs italic">“{p.cheer.text}”</p> : null}
    </section>
  );
}

/**
 * "O que está em jogo" agrupado por time: um bloco por participante (escudo, nome e a cor do clube na
 * borda), com as tags do torcedor (`fan_tags`), as frases dos stakes daquele time e o grito da torcida.
 * O mesmo código para os dois times (ex.: os dois "ainda correm risco de rebaixamento") e os stakes
 * `both` aparecem uma vez só, no bloco "Para os dois times" (`splitStakes`); o histórico de títulos de
 * cada um ("busca o tetra", com as edições) fica no bloco do time. Em jogo encerrado, cada bloco separa o
 * que estava em jogo do que o resultado mudou.
 */
export async function MatchStakes({ event }: { event: Event }) {
  const { locale, t } = await getI18n();
  const sides = event.participants.filter((p) => p.side === 'home' || p.side === 'away');
  // código repetido nos dois times, na mesma fase: vira um item só, para os dois (exceto histórico de títulos)
  const { shared, groups } = splitStakes(event.stakes, sides);
  const phaseLabels: Record<Phase, string> = {
    pre_match: t.sport.stakesBefore,
    result: t.sport.stakesResult,
  };
  // jogo encerrado com o que o resultado mudou: as frases ganham "Antes do jogo" / "Com o resultado"
  const phased = event.stakes.some((s) => phaseOf(s) === 'result');
  const hasAny = shared.length || groups.some((g) => g.stakes.length || g.p.fan_tags?.length || g.p.cheer);
  if (!hasAny) return null;
  const both = shared.length ? (
    <section
      aria-label={t.sport.bothTeams}
      className={`flex flex-col gap-2 ${phased ? 'border-b pb-4' : 'border-t pt-4'}`}
    >
      <span className="text-muted-foreground text-xs font-medium">{t.sport.bothTeams}</span>
      <PhasedSentences stakes={shared} locale={locale} labels={phaseLabels} phased={phased} />
    </section>
  ) : null;
  return (
    <div className="flex flex-col gap-4">
      {/* jogo encerrado: o contexto comum ("os dois fugiam do rebaixamento") vem antes do resultado de cada um */}
      {phased ? both : null}
      {groups.map(({ p, stakes }) => (
        <TeamStakes
          key={p.id}
          p={p}
          stakes={stakes}
          locale={locale}
          fanTagsLabel={t.sport.fanTagsOf}
          phaseLabels={phaseLabels}
          phased={phased}
        />
      ))}
      {phased ? null : both}
    </div>
  );
}
