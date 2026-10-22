'use client';

import type { RelatedItem } from '@galaxie/contracts';
import { BadgeCheck, ChevronLeft, ChevronRight, ExternalLink, VolumeX, XIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
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
  playVideo(): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getPlayerState(): number;
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
      events: {
        onReady?: (e: { target: YtPlayer }) => void;
        onStateChange?: (e: { data: number; target: YtPlayer }) => void;
      };
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
const YT_PLAYING = 1;
const YT_BUFFERING = 3;
/** Tempo para o vídeo começar com som antes de cair no autoplay mudo. */
export const AUTOPLAY_FALLBACK_MS = 1_500;

function YoutubeEmbed({ videoId, title, onEnded }: { videoId: string; title: string; onEnded?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const ended = useRef(onEnded);
  /** Autoplay com som bloqueado (ex.: Safari do iPhone): tocando mudo, à espera de um toque. */
  const [mutedFallback, setMutedFallback] = useState(false);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    let player: YtPlayer | undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
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
        events: {
          onReady: ({ target }) => {
            target.playVideo();
            // O navegador pode recusar o autoplay com som (a política de autoplay não é nossa):
            // sem reprodução — ou se o próprio player silenciou — toca mudo e oferece ativar o som.
            timer = setTimeout(() => {
              if (cancelled) return;
              const state = target.getPlayerState();
              const started = state === YT_PLAYING || state === YT_BUFFERING;
              if (!started || target.isMuted()) {
                target.mute();
                target.playVideo();
                setMutedFallback(true);
                // os comandos chegam ao iframe de forma assíncrona: se o play saiu antes do mute valer,
                // tenta de novo (mudo, o autoplay é sempre permitido)
                timer = setTimeout(() => {
                  const s = target.getPlayerState();
                  if (!cancelled && s !== YT_PLAYING && s !== YT_BUFFERING) target.playVideo();
                }, 500);
              }
            }, AUTOPLAY_FALLBACK_MS);
          },
          onStateChange: ({ data }) => {
            if (data === YT_ENDED) ended.current?.();
          },
        },
      });
      playerRef.current = player;
      host.current.querySelector('iframe')?.setAttribute('title', title);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      player?.destroy();
      playerRef.current = null;
    };
  }, [videoId, title]);

  // som ativado pelos controles do próprio player (o isMuted() do YouTube atualiza com atraso): some o aviso
  useEffect(() => {
    if (!mutedFallback) return;
    const id = setInterval(() => {
      if (playerRef.current && !playerRef.current.isMuted()) setMutedFallback(false);
    }, 1_000);
    return () => clearInterval(id);
  }, [mutedFallback]);

  const unmute = () => {
    const p = playerRef.current;
    if (!p) return;
    p.unMute();
    p.playVideo();
    setMutedFallback(false);
  };

  return (
    <div className="relative size-full">
      <div ref={host} className="size-full [&_iframe]:size-full" />
      {mutedFallback ? (
        <button
          type="button"
          onClick={unmute}
          className="bg-background/90 text-foreground hover:bg-background absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg transition-colors"
        >
          <VolumeX className="size-3.5" aria-hidden /> Toque para ativar o som
        </button>
      ) : null}
    </div>
  );
}

// ─── estado do player (no layout: o painel sobrevive à navegação entre páginas) ──────────────────

interface PlayerState {
  items: RelatedItem[];
  index: number;
}

interface PlayerApi {
  /** Vídeo tocando agora (null = painel fechado). */
  current: RelatedItem | null;
  /** Abre o painel no vídeo `index` da lista (a lista já filtrada pelo tipo ativo). */
  open: (items: RelatedItem[], index: number) => void;
  close: () => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

export function useRelatedPlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('useRelatedPlayer precisa de <RelatedPlayerProvider> (layout do app).');
  return ctx;
}

/**
 * Provider + painel acoplado. Fica no layout do app como irmão do conteúdo: no desktop o painel ocupa
 * uma coluna à direita (o conteúdo encolhe e continua clicável — nada de overlay); no mobile ocupa a
 * tela. Trocar de página não fecha o painel nem interrompe o vídeo.
 */
export function RelatedPlayerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PlayerState | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((items: RelatedItem[], index: number) => {
    if (document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
    setState({ items, index });
  }, []);
  const close = useCallback(() => {
    setState(null);
    // devolve o foco a quem abriu (se ainda estiver na página)
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) requestAnimationFrame(() => el.focus());
  }, []);
  const setIndex = useCallback((index: number) => setState((s) => (s ? { ...s, index } : s)), []);

  const api = useMemo<PlayerApi>(
    () => ({ current: state ? (state.items[state.index] ?? null) : null, open, close }),
    [state, open, close],
  );

  return (
    <PlayerContext value={api}>
      {children}
      {state ? (
        <RelatedPlayerPanel
          items={state.items}
          index={state.index}
          onIndexChange={setIndex}
          onClose={close}
        />
      ) : null}
    </PlayerContext>
  );
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
 * Painel lateral 9:16 que toca o vídeo no player oficial da plataforma. Vídeo vertical ocupa o quadro;
 * horizontal fica centralizado com faixa. Anterior/próximo (e as setas) percorrem a lista filtrada e o
 * fim do vídeo avança sozinho. Esc fecha. Não é modal: o resto do app segue clicável.
 */
function RelatedPlayerPanel({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: RelatedItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[index]!;
  const source = playerSource(item);
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;
  const go = (delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < items.length) onIndexChange(next);
  };
  const closeButton = useRef<HTMLButtonElement>(null);
  // foco no painel ao abrir (sem prender: Tab sai do painel normalmente)
  useEffect(() => closeButton.current?.focus(), []);
  const vertical = item.aspect_ratio === '9:16';
  const tier = TIER_LABEL[item.channel.source_tier];
  const time = duration(item.duration_seconds);

  return (
    <aside
      aria-label="Player de conteúdo relacionado"
      className="bg-popover text-popover-foreground fixed inset-0 z-50 flex flex-col overflow-y-auto text-sm md:sticky md:top-0 md:z-10 md:h-svh md:w-[26rem] md:shrink-0 md:self-start md:border-l"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowRight') go(1);
        if (e.key === 'ArrowLeft') go(-1);
      }}
    >
      <header className="flex items-start gap-2 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="line-clamp-2 text-base leading-snug font-medium">{item.title}</h2>
          <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
            <span className="flex items-center gap-1">
              {item.channel.title}
              {tier ? <BadgeCheck className="text-primary size-3.5" aria-label={tier} /> : null}
            </span>
            {time ? <span>· {time}</span> : null}
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="primary-light" size="sm">
              {item.content_type_label}
            </Badge>
            <Badge variant="outline" size="sm">
              {item.aspect_ratio}
            </Badge>
            {item.format === 'short' ? (
              <Badge variant="outline" size="sm">
                Short
              </Badge>
            ) : null}
            {tier ? (
              <Badge variant="outline" size="sm">
                {tier}
              </Badge>
            ) : null}
          </div>
        </div>
        <Button
          ref={closeButton}
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Fechar o player"
        >
          <XIcon aria-hidden />
        </Button>
      </header>

      {/* Quadro 9:16: vídeo vertical ocupa tudo; horizontal fica centralizado com faixa. */}
      <div className="flex justify-center bg-black">
        <div
          className="relative flex aspect-[9/16] max-h-[calc(100dvh-13rem)] w-full max-w-[calc((100dvh-13rem)*9/16)] items-center justify-center"
          data-aspect={item.aspect_ratio}
        >
          {source?.kind === 'youtube' ? (
            <div className={cn('w-full', vertical ? 'h-full' : 'aspect-video')}>
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
          {index + 1} de {items.length}
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
    </aside>
  );
}
