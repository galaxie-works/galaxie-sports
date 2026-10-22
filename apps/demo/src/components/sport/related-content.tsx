'use client';

import type { RelatedContent, RelatedItem } from '@galaxie/contracts';
import { BadgeCheck, Eye, Play, Smartphone } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import { cn } from '@/lib/utils';

/** Rótulos dos tipos (a API também manda `content_type_label` no locale pedido). */
const TYPE_LABEL: Record<string, string> = {
  highlights: 'Melhores momentos',
  goal: 'Gols',
  penalties: 'Pênaltis',
  press_conference: 'Coletiva',
  interview: 'Entrevista',
  behind_the_scenes: 'Bastidores',
  fan_reaction: 'Reação da torcida',
  analysis: 'Análise',
  full_match: 'Jogo completo',
  other: 'Outros',
};

const TIER_LABEL: Record<string, string> = {
  official: 'Oficial',
  rights_holder: 'Detentor de direitos',
  media: 'Imprensa',
};

function duration(sec: number | null): string | null {
  if (sec === null) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

function VideoCard({ item }: { item: RelatedItem }) {
  const tier = TIER_LABEL[item.channel.source_tier];
  const time = duration(item.duration_seconds);
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="group/video hover:bg-accent/50 flex flex-col overflow-hidden rounded-lg border transition-colors"
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
            <Smartphone aria-hidden /> Short
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
          {tier ? (
            <Badge variant="outline" size="sm">
              {tier}
            </Badge>
          ) : null}
        </div>
      </div>
    </a>
  );
}

/** Vídeos relacionados ao evento com filtro por tipo (abas com a contagem de `counts`). */
export function RelatedContentGrid({ related }: { related: RelatedContent }) {
  const [type, setType] = useState<string | null>(null);
  const types = useMemo(
    () =>
      Object.entries(related.counts)
        .filter(([, n]) => (n ?? 0) > 0)
        .sort((a, b) => Object.keys(TYPE_LABEL).indexOf(a[0]) - Object.keys(TYPE_LABEL).indexOf(b[0])),
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
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar por tipo">
        <button
          type="button"
          role="tab"
          aria-selected={type === null}
          className={chip(type === null)}
          onClick={() => setType(null)}
        >
          Todos <span className="tabular-nums opacity-70">{related.data.length}</span>
        </button>
        {types.map(([t, n]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            className={chip(type === t)}
            onClick={() => setType(t)}
          >
            {TYPE_LABEL[t] ?? t} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((item) => (
          <VideoCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
