import { ArrowRight } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { fill } from '@/lib/i18n/text';
import { HEADLINE, showcase } from '@/lib/showcase';
import { CONTACT_EMAIL } from '@/lib/site';
import { cn } from '@/lib/utils';

import { Chip, Flag, TeamMark } from './parts';

type Text = Dictionary['landing'];

/** Cartão do próximo jogo (amostra real): times, horário no Brasil e as tags do torcedor. */
function MatchPreview({ t, locale }: { t: Text['bento']; locale: Locale }) {
  const { round: ROUND, semi: SEMI, timeZone, market, finalist } = showcase(locale);
  const when = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: locale === 'en' ? 'h12' : 'h23',
  }).format(new Date(ROUND.startsAt));
  const score = SEMI.relevance.find((r) => r.market === market)?.score ?? 0;
  return (
    <div className="relative mx-auto w-full max-w-md lg:mx-0">
      <div className="bg-card/80 relative rounded-3xl border p-5 shadow-[0_30px_80px_-30px_oklch(0.55_0.2_279/0.6)] backdrop-blur-md sm:p-6">
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-primary font-semibold tracking-wide uppercase">{t.stakes.kickoff}</span>
          <span className="text-muted-foreground tabular-nums">{when}</span>
        </div>
        <p className="text-muted-foreground mt-1 text-xs">
          {fill(t.stakes.stage, { competition: ROUND.competition })}
        </p>
        <div className="mt-5 flex flex-col gap-4">
          {[ROUND.home, ROUND.away].map((team) => (
            <div key={team.name} className="flex items-center gap-3">
              <TeamMark team={team} size="lg" />
              <span className="min-w-0">
                <span className="block truncate text-lg font-semibold">{team.name}</span>
                <span className="text-muted-foreground block truncate text-sm">{team.nickname}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-muted-foreground text-xs">{t.stakes.tag}</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {Object.values(t.stakes.tags).map((tag) => (
              <li key={tag}>
                <Chip tone="brand">{tag}</Chip>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Selos flutuantes: relevância no mercado da página e o finalista da Libertadores. */}
      <div className="bg-card/90 absolute -top-5 right-4 flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm shadow-lg backdrop-blur-md sm:-right-6">
        <Flag code={market} />
        <span className="text-muted-foreground text-xs">{t.relevance.tag}</span>
        <span className="font-semibold tabular-nums">{new Intl.NumberFormat(locale).format(score)}</span>
      </div>
      <div className="bg-card/90 absolute -bottom-6 left-4 flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm shadow-lg backdrop-blur-md sm:-left-8">
        <TeamMark team={finalist} size="sm" />
        <span className="font-medium">{t.h2h.badge}</span>
      </div>
    </div>
  );
}

/**
 * Herói da apresentação: a camada Galaxie como proposta, a conversa comercial como chamada principal (a demo é
 * por convite; o botão de entrar fica no cabeçalho) e um jogo real da base ao lado.
 */
export function Hero({ t, locale }: { t: Text; locale: Locale }) {
  return (
    <section className="grid items-center gap-14 pt-10 pb-16 sm:pt-16 lg:grid-cols-[1.15fr_1fr] lg:gap-10 lg:pb-24">
      <div className="landing-rise">
        <Chip tone="brand" className="px-3 py-1">
          <span className="bg-primary size-1.5 rounded-full" aria-hidden />
          {t.hero.eyebrow}
        </Chip>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          {t.hero.title}
        </h1>
        <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-relaxed text-pretty">
          {t.hero.lead}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-5 text-base')}
          >
            {t.hero.cta}
          </a>
          <a
            href="#camada"
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 px-5 text-base')}
          >
            {t.hero.secondary}
            <ArrowRight className="size-4" aria-hidden />
          </a>
        </div>
        <p className="text-muted-foreground mt-4 text-sm">{t.hero.invite}</p>
      </div>
      <div className="landing-rise [animation-delay:120ms]">
        <MatchPreview t={t.bento} locale={locale} />
      </div>
    </section>
  );
}

/** Faixa com os números fixos do produto, a começar pelo que é da camada (onde assistir e idiomas). */
export function Numbers({ t, locale }: { t: Text['stats']; locale: Locale }) {
  const nf = new Intl.NumberFormat(locale);
  const items = [
    { value: HEADLINE.watch, label: t.watch },
    { value: HEADLINE.voices + 1, label: t.locales },
    { value: HEADLINE.markets, label: t.markets },
    { value: HEADLINE.sports, label: t.sports },
  ];
  return (
    <section aria-label={t.label}>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-white/10 lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="bg-background/80 flex flex-col-reverse justify-end gap-1 p-6 backdrop-blur-sm"
          >
            <dt className="text-muted-foreground text-sm">{item.label}</dt>
            <dd className="text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
              {nf.format(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
