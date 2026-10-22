'use client';

import type { RelatedItem } from '@galaxie/contracts';
import { BadgeCheck, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

// ─── fonte do player por plataforma ──────────────────────────────────────────────────────────────

/**
 * Como tocar cada item. Hoje só há YouTube, que por termos da API precisa do player oficial
 * (embed; nada de extrair stream). A marca e parte dos controles do YouTube não podem ser removidas.
 *
 * TODO(docs/12 §11): vídeo próprio do parceiro (HLS/MP4 licenciado) poderá entrar como
 * `{ kind: 'stream', src, mime }` e usar um player nosso (ex.: Limeplay) — não adicionado agora.
 */
export type PlayerSource = { kind: 'youtube'; videoId: string };

export function playerSource(item: RelatedItem): PlayerSource | null {
  switch (item.provider) {
    case 'youtube':
      return { kind: 'youtube', videoId: item.external_id };
    default:
      return null;
  }
}

// ─── player oficial do YouTube (IFrame Player API, domínio sem cookies) ─────────────────────────

interface YtPlayer {
  destroy(): void;
}
interface YtNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      host: string;
      videoId: string;
      width: string;
      height: string;
      playerVars: Record<string, number | string>;
      events: { onStateChange?: (e: { data: number }) => void };
    },
  ) => YtPlayer;
}
declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YtNamespace> | null = null;

/** Carrega a IFrame Player API só quando o painel abre (nada do YouTube antes do clique). */
function loadYoutubeApi(): Promise<YtNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT!);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  });
  return apiPromise;
}

const YT_ENDED = 0;

function YoutubeEmbed({ videoId, title, onEnded }: { videoId: string; title: string; onEnded?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    let player: YtPlayer | undefined;
    let cancelled = false;
    void loadYoutubeApi().then((YT) => {
      if (cancelled || !host.current) return;
      const el = document.createElement('div');
      host.current.replaceChildren(el);
      player = new YT.Player(el, {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: { onStateChange: (e) => e.data === YT_ENDED && ended.current?.() },
      });
      const iframe = host.current.querySelector('iframe');
      iframe?.setAttribute('title', title);
      iframe?.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
    });
    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [videoId, title]);

  return <div ref={host} className="size-full [&_iframe]:size-full" />;
}

// ─── painel ──────────────────────────────────────────────────────────────────────────────────────

function duration(sec: number | null): string | null {
  if (sec === null) return null;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const TIER_LABEL: Record<string, string> = {
  official: 'Oficial',
  rights_holder: 'Detentor de direitos',
  media: 'Imprensa',
};

/**
 * Painel lateral 9:16 que toca o vídeo no player oficial da plataforma. Shorts ocupam o quadro;
 * vídeos horizontais ficam centralizados com faixa. Anterior/próximo percorrem a lista filtrada e o
 * fim do vídeo avança sozinho. Esc fecha e o foco fica preso no painel (Dialog do Base UI).
 */
export function RelatedPlayerSheet({
  items,
  index,
  onIndexChange,
}: {
  items: RelatedItem[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}) {
  const item = index !== null ? items[index] : undefined;
  const source = item ? playerSource(item) : null;
  const hasPrev = index !== null && index > 0;
  const hasNext = index !== null && index < items.length - 1;
  const go = (delta: number) => {
    if (index === null) return;
    const next = index + delta;
    if (next >= 0 && next < items.length) onIndexChange(next);
  };

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onIndexChange(null)}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-[26rem] gap-0 overflow-y-auto"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') go(1);
          if (e.key === 'ArrowLeft') go(-1);
        }}
      >
        {item ? (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle className="line-clamp-2 leading-snug">{item.title}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="flex items-center gap-1">
                  {item.channel.title}
                  {TIER_LABEL[item.channel.source_tier] ? (
                    <BadgeCheck
                      className="text-primary size-3.5"
                      aria-label={TIER_LABEL[item.channel.source_tier]}
                    />
                  ) : null}
                </span>
                {duration(item.duration_seconds) ? <span>· {duration(item.duration_seconds)}</span> : null}
              </SheetDescription>
              <div className="flex flex-wrap gap-1 pt-1">
                <Badge variant="primary-light" size="sm">
                  {item.content_type_label}
                </Badge>
                {item.format === 'short' ? (
                  <Badge variant="outline" size="sm">
                    Short
                  </Badge>
                ) : null}
                {TIER_LABEL[item.channel.source_tier] ? (
                  <Badge variant="outline" size="sm">
                    {TIER_LABEL[item.channel.source_tier]}
                  </Badge>
                ) : null}
              </div>
            </SheetHeader>

            {/* Quadro 9:16: short ocupa tudo; vídeo horizontal fica centralizado com faixa. */}
            <div className="flex justify-center bg-black px-0">
              <div
                className="relative flex aspect-[9/16] max-h-[calc(100dvh-13rem)] w-full max-w-[calc((100dvh-13rem)*9/16)] items-center justify-center"
                data-format={item.format}
              >
                {source?.kind === 'youtube' ? (
                  <div className={cn('w-full', item.format === 'short' ? 'h-full' : 'aspect-video')}>
                    <YoutubeEmbed
                      key={source.videoId}
                      videoId={source.videoId}
                      title={item.title}
                      onEnded={hasNext ? () => go(1) : undefined}
                    />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2 p-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => go(-1)}
                disabled={!hasPrev}
                aria-label="Vídeo anterior"
              >
                <ChevronLeft aria-hidden /> Anterior
              </Button>
              <span className="text-muted-foreground flex-1 text-center text-xs tabular-nums">
                {index! + 1} de {items.length}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => go(1)}
                disabled={!hasNext}
                aria-label="Próximo vídeo"
              >
                Próximo <ChevronRight aria-hidden />
              </Button>
            </div>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 pb-4 text-xs"
            >
              <ExternalLink className="size-3" aria-hidden /> Abrir na plataforma
            </a>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
