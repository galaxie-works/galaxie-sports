'use client';

import type { RelatedContent, RelatedItem } from '@galaxie/contracts';
import { BadgeCheck, Eye, Play, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import { useRelatedPlayer } from '@/components/sport/related-player';
import { useI18n } from '@/lib/i18n/client';
import { fill } from '@/lib/i18n/text';
import { cn } from '@/lib/utils';

/** Ordem dos tipos nas abas (rótulos em `t.media.types`; a API também manda `content_type_label`). */
const TYPE_ORDER = [
  'highlights',
  'goal',
  'penalties',
  'press_conference',
  'interview',
  'behind_the_scenes',
  'fan_reaction',
  'analysis',
  'full_match',
  'other',
];

function duration(sec: number | null): string | null {
  if (sec === null) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function VideoCard({ item, playing, onPlay }: { item: RelatedItem; playing: boolean; onPlay: () => void }) {
  const { locale, t } = useI18n();
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  );
  const tier = t.media.tiers[item.channel.source_tier];
  const time = duration(item.duration_seconds);
  return (
    <button
      type="button"
      onClick={onPlay}
      aria-label={fill(t.media.watch, { title: item.title })}
      aria-current={playing || undefined}
      className={cn(
        'group/video hover:bg-accent/50 focus-visible:ring-ring flex flex-col overflow-hidden rounded-lg border text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
        playing && 'border-primary ring-primary/40 ring-2',
      )}
    >
      <div className="bg-muted relative aspect-video overflow-hidden">
        {item.thumbnail_url ? (
          // Miniatura servida pela própria plataforma (nunca rehospedada — docs/12 §2).
          <img
            src={item.thumbnail_url}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover/video:scale-105"
          />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/video:opacity-100">
          <span className="bg-background/80 flex size-10 items-center justify-center rounded-full">
            <Play className="size-4" aria-hidden />
          </span>
        </span>
        {item.format === 'short' ? (
          <Badge variant="invert" size="sm" className="absolute top-2 left-2">
            <Smartphone aria-hidden /> {t.media.short}
          </Badge>
        ) : null}
        {time ? (
          <span className="absolute right-2 bottom-2 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[0.65rem] text-white tabular-nums">
            {time}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm leading-snug font-medium">{item.title}</p>
        <div className="text-muted-foreground mt-auto flex items-center gap-1.5 text-xs">
          <span className="truncate">{item.channel.title}</span>
          {tier ? (
            <span title={tier} className="flex shrink-0 items-center">
              <BadgeCheck className="text-primary size-3.5" aria-label={tier} />
            </span>
          ) : null}
          {item.views !== null ? (
            <span className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
              <Eye className="size-3" aria-hidden />
              {compact.format(item.views)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="primary-light" size="sm">
            {item.content_type_label}
          </Badge>
          <Badge variant="outline" size="sm" title={t.media.aspectRatio}>
            {item.aspect_ratio}
          </Badge>
          {playing ? (
            <Badge variant="success-light" size="sm">
              <Play aria-hidden /> {t.media.playing}
            </Badge>
          ) : null}
          {tier ? (
            <Badge variant="outline" size="sm">
              {tier}
            </Badge>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/** Vídeos relacionados ao evento com filtro por tipo (abas com a contagem de `counts`). */
export function RelatedContentGrid({ related }: { related: RelatedContent }) {
  const { t } = useI18n();
  const [type, setType] = useState<string | null>(null);
  const player = useRelatedPlayer();
  const types = useMemo(
    () =>
      Object.entries(related.counts)
        .filter(([, n]) => (n ?? 0) > 0)
        .sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0])),
    [related.counts],
  );
  const items = type ? related.data.filter((d) => d.content_type === type) : related.data;
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
      active ? 'bg-foreground text-background border-transparent' : 'hover:bg-accent',
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t.media.filterByType}>
        <button
          type="button"
          role="tab"
          aria-selected={type === null}
          className={chip(type === null)}
          onClick={() => setType(null)}
        >
          {t.media.all} <span className="tabular-nums opacity-70">{related.data.length}</span>
        </button>
        {types.map(([key, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={type === key}
            className={chip(type === key)}
            onClick={() => setType(key)}
          >
            {t.media.types[key] ?? key} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((item, i) => (
          <VideoCard
            key={item.id}
            item={item}
            playing={player.current?.id === item.id}
            // o painel (no layout) só monta o player ao abrir: nada do YouTube carrega antes do clique
            onPlay={() => player.open(items, i)}
          />
        ))}
      </div>
    </div>
  );
}
