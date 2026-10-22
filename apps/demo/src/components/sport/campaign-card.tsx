import type { TeamCompetition } from '@galaxie/contracts';
import { Medal, Trophy } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/reui/badge';
import { Crest } from '@/components/sport/crest';
import { Card, CardContent } from '@/components/ui/card';
import type { Locale } from '@/lib/i18n/config';
import { getI18n } from '@/lib/i18n/server';
import { fill, localized, ordinal } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

/** Fases de pontos corridos: a posição e os pontos continuam visíveis como informação secundária. */
const TABLE_STAGES = new Set(['regular', 'group', 'league_phase']);

/** Selo da campanha: troféu para o campeão, medalha para vice e 3º, selo de fase nos demais. */
function CampaignMark({
  campaign,
  locale,
  pointsLabel,
}: {
  campaign: TeamCompetition['campaign'];
  locale: Locale;
  pointsLabel: string;
}) {
  const label = localized(campaign.label, locale);
  switch (campaign.status) {
    case 'champion':
      return (
        <div className="text-warning flex flex-col items-center gap-1">
          <Trophy className="size-7" aria-hidden />
          <span className="text-xs font-semibold">{label}</span>
        </div>
      );
    case 'runner_up':
    case 'third_place':
      return (
        <div
          className={cn(
            'flex flex-col items-center gap-1',
            campaign.status === 'runner_up' ? 'text-zinc-300' : 'text-orange-400',
          )}
        >
          <Medal className="size-7" aria-hidden />
          <span className="text-xs font-semibold">{label}</span>
        </div>
      );
    case 'league':
    case 'finished_league':
      return campaign.rank != null ? (
        <div className="flex flex-col items-end">
          <span
            className={cn(
              'text-2xl font-semibold tabular-nums',
              campaign.status === 'finished_league' && 'text-muted-foreground',
            )}
          >
            {ordinal(locale, campaign.rank)}
          </span>
          <span className="text-muted-foreground text-xs">
            {campaign.points != null ? fill(pointsLabel, { count: campaign.points }) : label}
          </span>
        </div>
      ) : (
        <Badge variant="outline" radius="full">
          {label}
        </Badge>
      );
    case 'in_progress':
      return (
        <Badge variant={campaign.stage_kind === 'final' ? 'default' : 'primary-light'} radius="full">
          {campaign.stage_kind === 'final' ? (
            <span className="bg-primary-foreground size-1.5 animate-pulse rounded-full" aria-hidden />
          ) : null}
          {label}
        </Badge>
      );
    case 'eliminated':
      return (
        <Badge variant="outline" radius="full" className="text-muted-foreground">
          {label}
        </Badge>
      );
  }
}

/** Card de "Nas competições": campanha do time na temporada (campeão, na final, eliminado, posição...). */
export async function CampaignCard({ entry }: { entry: TeamCompetition }) {
  const { locale, t } = await getI18n();
  const { competition, season, group, campaign } = entry;
  const champion = campaign.status === 'champion';
  const tableInfo =
    campaign.status !== 'league' &&
    campaign.status !== 'finished_league' &&
    campaign.rank != null &&
    campaign.stage_kind != null &&
    TABLE_STAGES.has(campaign.stage_kind)
      ? `${ordinal(locale, campaign.rank)}${campaign.points != null ? ` · ${fill(t.sport.points, { count: campaign.points })}` : ''}`
      : null;
  // liga em andamento: a posição já está no selo; liga encerrada: "Terminou em 2º"
  const detail =
    campaign.status === 'league'
      ? ''
      : campaign.status === 'finished_league'
        ? localized(campaign.label, locale)
        : localized(campaign.detail, locale);
  return (
    <Link href={`/competicoes/${competition.slug}?temporada=${season.year}`} className="group/entry">
      <Card
        size="sm"
        className={cn(
          'group-hover/entry:bg-accent h-full transition-colors',
          champion && 'ring-warning/40 bg-warning/5',
          campaign.status === 'eliminated' && 'opacity-80',
        )}
      >
        <CardContent className="flex items-center gap-3">
          <Crest src={competition.logo} name={competition.name} size="md" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{competition.name}</span>
            <span className="text-muted-foreground truncate text-xs">
              {season.label}
              {group && group !== competition.name ? ` · ${group}` : ''}
              {tableInfo ? ` · ${tableInfo}` : ''}
            </span>
            {detail ? (
              <span className="text-muted-foreground line-clamp-2 text-xs" title={detail}>
                {detail}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <CampaignMark campaign={campaign} locale={locale} pointsLabel={t.sport.points} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
