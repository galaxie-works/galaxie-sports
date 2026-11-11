import { settingDef } from '@galaxie/runtime-config';
import {
  BellRing,
  Bot,
  ChevronRight,
  History,
  KeyRound,
  ListChecks,
  TriangleAlert,
  Tv,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { ListSkeleton } from '@/components/app-shell/skeletons';
import { settingText } from '@/components/ops/format';
import { Badge } from '@/components/reui/badge';
import { Frame, FrameDescription, FrameHeader, FramePanel, FrameTitle } from '@/components/reui/frame';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { requireAdmin } from '@/lib/auth/admin';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionary';
import { createFormatters } from '@/lib/i18n/format';
import { getLocale, getT, getTimeZone } from '@/lib/i18n/server';
import { fill, plural } from '@/lib/i18n/text';
import { resolveSettingPage, withSettingAnchor, type SettingPageResolver } from '@/lib/ops/settings-search';
import { settingsHref } from '@/lib/ops/settings-items';

import { readSettingsHome, type SettingsHomeData } from './data';
import { HOME_CARDS, HOME_LINKS, type HomeCard, type HomeCardId } from './home-cards';

const ICONS: Record<HomeCardId, LucideIcon> = {
  review: ListChecks,
  requests: Tv,
  failedJobs: TriangleAlert,
  alerts: BellRing,
  credentials: KeyRound,
  aiCeiling: Bot,
  signups: UserPlus,
};

type HomeTexts = Dictionary['ops']['home'];

/** Selo à direita do cartão: a contagem na cor do estado, ou o "Nada pendente" neutro. */
function CardStatus({ card, T, locale }: { card: HomeCard; T: HomeTexts; locale: Locale }) {
  if (card.state === 'soon') return <Badge variant="secondary">{T.soon}</Badge>;
  if (card.state === 'unavailable')
    return <span className="text-muted-foreground text-xs">{T.unavailable}</span>;
  if (card.state === 'clear') return <span className="text-muted-foreground text-xs">{T.nothing}</span>;
  const text =
    card.id === 'aiCeiling'
      ? fill(T.cards.aiCeiling.near, { percent: card.percent ?? 0 })
      : plural(locale, card.count, T.cards[card.id as Exclude<HomeCardId, 'aiCeiling' | 'signups'>].count);
  return (
    <Badge variant={`${card.tone}-light`} className="tabular-nums">
      {text}
    </Badge>
  );
}

function HomeCardItem({ card, T, locale }: { card: HomeCard; T: HomeTexts; locale: Locale }) {
  const Icon = ICONS[card.id];
  const text = T.cards[card.id];
  const body = (
    <>
      <ItemMedia variant="icon">
        <Icon className="text-muted-foreground" aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{text.title}</ItemTitle>
        <ItemDescription>{text.description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <CardStatus card={card} T={T} locale={locale} />
        {card.href ? <ChevronRight className="text-muted-foreground size-4" aria-hidden /> : null}
      </ItemActions>
    </>
  );
  return card.href ? (
    <Item variant="outline" render={<Link href={card.href} />}>
      {body}
    </Item>
  ) : (
    <Item variant="outline">{body}</Item>
  );
}

function RecentList({
  data,
  t,
  timeZone,
  locale,
  resolve,
  historyHref,
}: {
  data: SettingsHomeData;
  t: Dictionary;
  timeZone: string;
  locale: Locale;
  resolve: SettingPageResolver;
  historyHref: string;
}) {
  const T = t.ops.home.recent;
  const f = createFormatters(locale, timeZone);
  const now = data.generatedAt ? Date.parse(data.generatedAt) : undefined;
  return (
    <Frame>
      <FramePanel className="flex flex-col gap-3">
        <FrameHeader className="flex flex-row items-start justify-between gap-3 p-0">
          <div className="flex flex-col gap-0.5">
            <FrameTitle>{T.title}</FrameTitle>
            <FrameDescription>{T.description}</FrameDescription>
          </div>
          <Link
            href={historyHref}
            className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs transition-colors"
          >
            <History className="size-3.5" aria-hidden />
            {T.all}
          </Link>
        </FrameHeader>
        {data.recent.length ? (
          <ItemGroup className="gap-1">
            {data.recent.map((row) => {
              const def = settingDef(row.key);
              const label = def ? settingText(t.ops, def).label : row.key;
              const ref = resolve(row.key);
              const when = f.relative(row.changedAt, now);
              const body = (
                <ItemContent>
                  <ItemTitle className="flex-wrap">
                    {label}
                    <code className="text-muted-foreground font-mono text-xs font-normal">{row.key}</code>
                  </ItemTitle>
                  <ItemDescription>
                    {fill(row.action === 'reset' ? T.reset : T.set, { who: row.changedBy, when })}
                  </ItemDescription>
                </ItemContent>
              );
              return ref ? (
                <Item key={row.id} size="sm" render={<Link href={withSettingAnchor(ref.href, row.key)} />}>
                  {body}
                </Item>
              ) : (
                <Item key={row.id} size="sm">
                  {body}
                </Item>
              );
            })}
          </ItemGroup>
        ) : (
          <p className="text-muted-foreground text-sm">{T.empty}</p>
        )}
      </FramePanel>
    </Frame>
  );
}

async function HomeContent({
  resolve,
  links,
  historyHref,
}: {
  resolve: SettingPageResolver;
  links: Record<HomeCardId, string | null>;
  historyHref: string;
}) {
  // Sessão de admin (headers) e fuso (cookie): fica fora do shell estático, como as outras páginas de Ajustes.
  await requireAdmin();
  const [t, timeZone, locale] = await Promise.all([getT(), getTimeZone(), getLocale()]);
  const data = await readSettingsHome(t.review.summary, links);
  return (
    <>
      <Frame>
        <FramePanel>
          <ItemGroup className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {data.cards.map((card) => (
              <HomeCardItem key={card.id} card={card} T={t.ops.home} locale={locale} />
            ))}
          </ItemGroup>
        </FramePanel>
      </Frame>
      <RecentList
        data={data}
        t={t}
        timeZone={timeZone}
        locale={locale}
        resolve={resolve}
        historyHref={historyHref}
      />
    </>
  );
}

/** Esqueleto do Início: a grade dos sete cartões e a lista das mudanças, no layout real. */
export function SettingsHomeSkeleton() {
  return (
    <>
      <Frame>
        <FramePanel>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {HOME_CARDS.map((id) => (
              <div key={id} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Skeleton className="size-4 shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-32 max-w-full" />
                  <Skeleton className="h-3 w-48 max-w-full" />
                </div>
                <Skeleton className="h-5 w-20 shrink-0" />
              </div>
            ))}
          </div>
        </FramePanel>
      </Frame>
      <Frame>
        <FramePanel>
          <ListSkeleton rows={5} action={false} avatarClassName="hidden" />
        </FramePanel>
      </Frame>
    </>
  );
}

/**
 * Início de Ajustes (#1073), pronto para montar em `/ajustes`: título, frase e, sem segurar a página (Suspense com
 * esqueleto), os cartões do que pede ação e as últimas mudanças do painel. O título fica com quem monta
 * (`SettingsPageHeader` ou `PageHeader`); aqui só o conteúdo.
 */
export function SettingsHome({
  resolve = resolveSettingPage,
  links = HOME_LINKS,
  historyHref = settingsHref('history'),
}: {
  /** Lugar de cada ajuste (o `settingPage` do #1070), para o link das últimas mudanças. */
  resolve?: SettingPageResolver;
  /** Para onde cada cartão leva (rotas do #1068). */
  links?: Record<HomeCardId, string | null>;
  /** Histórico e auditoria. */
  historyHref?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Suspense
        fallback={
          <LoadingStatus>
            <SettingsHomeSkeleton />
          </LoadingStatus>
        }
      >
        <HomeContent resolve={resolve} links={links} historyHref={historyHref} />
      </Suspense>
    </div>
  );
}
