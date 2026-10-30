'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useMemo } from 'react';

import { Crest } from '@/components/sport/crest';
import { Section } from '@/components/sport/section';
import { useHydrated } from '@/hooks/use-hydrated';
import { countryLiveKey, fetchCountryLiveEvents } from '@/lib/galaxie/live';
import type { ApiRequest } from '@/lib/galaxie/request';
import type { ContentLocale } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';
import { plural } from '@/lib/i18n/text';
import { SPORTS } from '@/lib/navigation';

import { groupLive, LiveCard } from './live-board';
import { LiveDot } from './live-nav-item';
import { useLiveRefresh } from './use-live-refresh';

/**
 * "Ao vivo agora" na página do país: os jogos em andamento com competição ou participante do país (a mesma
 * conta do card em Países), por competição, com placar e relógio atualizados como na página Ao vivo. Sem
 * jogo, carregando ou com erro, a seção não aparece.
 */
export function CountryLive({
  code,
  content,
  api,
}: {
  code: string;
  /** Idioma do conteúdo da página (`contentLocale`), para os nomes baterem com o resto dela. */
  content: ContentLocale;
  api: ApiRequest;
}) {
  const { locale, t } = useI18n();
  const hydrated = useHydrated();
  const queryKey = countryLiveKey(code, content);
  const q = useQuery({
    queryKey,
    queryFn: () => fetchCountryLiveEvents(locale, content, code),
    staleTime: 10_000,
  });
  const data = hydrated ? q.data : undefined;
  const events = useMemo(() => data ?? [], [data]);
  useLiveRefresh({
    queryKey,
    eventIds: events.map((e) => e.id),
    enabled: true,
    dataUpdatedAt: q.dataUpdatedAt,
    errorUpdatedAt: q.errorUpdatedAt,
  });
  const sportLabel = useCallback(
    (slug: string) => {
      const nav = SPORTS.find((s) => s.slug === slug);
      return nav ? t.nav.sports[nav.slug] : slug;
    },
    [t],
  );
  const groups = useMemo(() => groupLive(events, sportLabel), [events, sportLabel]);
  if (!events.length) return null;
  // um esporte só (o caso comum): sem o título do esporte, direto nas competições
  const multiSport = groups.length > 1;

  return (
    <Section
      title={t.live.board.liveGames}
      icon={<LiveDot on />}
      description={plural(locale, events.length, t.live.nav.count)}
      api={api}
    >
      <div className="flex flex-col gap-6">
        {groups.map((g) => {
          const Icon = g.icon;
          return (
            <section key={g.sport} className="flex flex-col gap-4" aria-label={g.label}>
              {multiSport ? (
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  {Icon ? <Icon className="size-4" aria-hidden /> : null}
                  {g.label}
                </h3>
              ) : null}
              {g.competitions.map((c) => (
                <div key={c.key} className="flex flex-col gap-2">
                  <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    {c.competition ? (
                      <Link
                        href={`/competicoes/${c.competition.slug}`}
                        className="text-foreground flex items-center gap-2 font-medium hover:underline"
                      >
                        <Crest src={c.competition.logo} name={c.competition.name} size="xs" />
                        {c.competition.name}
                      </Link>
                    ) : (
                      <span>{t.live.board.noCompetition}</span>
                    )}
                    <span className="tabular-nums">· {c.events.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {c.events.map((e) => (
                      <LiveCard key={e.id} event={e} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </Section>
  );
}
