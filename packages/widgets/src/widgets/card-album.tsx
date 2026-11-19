'use client';

import { useEffect, useRef, useState } from 'react';
import {
  GS_STEP_COLORS,
  albumTotals,
  buildAlbum,
  fillText,
  gameText,
  stepName,
  type GsAchievementCatalogEntry,
  type GsAlbumCard,
  type GsFanCard,
} from '../core/model.js';
import {
  ErrorState,
  FanGate,
  LoadingState,
  WidgetFrame,
  useFanJson,
  useFormatters,
  useGalaxieWidget,
} from '../core/react.js';

export interface CardAlbumProps {
  /** Só as Cartas das Conquistas deste esporte e das comuns a todos (padrão: o Catálogo inteiro do programa). */
  sport?: string | undefined;
  /** O que mostrar ao abrir: todas, só as que o torcedor tem ou só as que faltam (padrão: todas). */
  show?: 'all' | 'owned' | 'missing' | undefined;
}

const enc = encodeURIComponent;
/** As Cartas saem com o Degrau, no resultado definitivo do jogo: reler a cada 5 min com a aba visível basta. */
const ALBUM_REFRESH_MS = 5 * 60_000;
const FILTERS = ['all', 'owned', 'missing'] as const;

/**
 * Álbum de Cartas do torcedor (#926): as Cartas do Catálogo ativo por família de Conquista (as Coleções chegam com
 * o importador), as que ele tem, as que faltam e como ganhar cada uma. Só mostra: nada consome Carta, sem sorteio,
 * compra ou troca (decisão de 19/11). Precisa do token do torcedor; 13 anos ou mais lê.
 */
export function CardAlbum(props: CardAlbumProps) {
  const { texts } = useGalaxieWidget();
  return (
    <WidgetFrame kind="fan_cards">
      <div className="gs-header">
        <h3 className="gs-title gs-grow">{texts.album.title}</h3>
      </div>
      <FanGate need="read">
        <AlbumBody {...props} />
      </FanGate>
    </WidgetFrame>
  );
}

function AlbumBody({ sport, show = 'all' }: CardAlbumProps) {
  const { texts, locale } = useGalaxieWidget();
  const T = texts.album;
  const fmt = useFormatters();
  const catalog = useFanJson<{ achievements: GsAchievementCatalogEntry[] }>(
    `/v1/achievements${sport ? `?sport=${enc(sport)}` : ''}`,
  );
  const cards = useFanJson<{ cards: GsFanCard[] }>('/v1/fans/me/cards', ALBUM_REFRESH_MS);
  const [filter, setFilter] = useState(show);
  useEffect(() => setFilter(show), [show]);
  const [open, setOpen] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const lastOpen = useRef<string | null>(null);
  // fechar o detalhe devolve o foco à Carta que o abriu
  useEffect(() => {
    if (open) {
      lastOpen.current = open;
      return;
    }
    const key = lastOpen.current;
    if (!key) return;
    lastOpen.current = null;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-gs-card="${CSS.escape(key)}"]`)?.focus();
  }, [open]);

  if (catalog.loading || cards.loading) return <LoadingState lines={4} />;
  const entries = catalog.data?.achievements;
  const mine = cards.data?.cards;
  if (catalog.error || cards.error || !entries || !mine)
    return (
      <ErrorState
        error={null}
        onRetry={() => {
          catalog.reload();
          cards.reload();
        }}
      />
    );

  const groups = buildAlbum(entries, mine, { show: filter, locale });
  const totals = albumTotals(entries, mine);
  const selected = open ? groups.flatMap((g) => g.cards).find((c) => c.cardKey === open) : undefined;

  return (
    <div className="gs-group" ref={gridRef}>
      <div className="gs-ach-top">
        <span className="gs-small gs-muted">
          {fillText(T.count, { n: fmt.integer(totals.owned), total: fmt.integer(totals.total) })}
        </span>
        <span className="gs-seg" role="group" aria-label={T.filterLabel}>
          {FILTERS.map((k) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {T.filters[k]}
            </button>
          ))}
        </span>
      </div>
      {selected ? (
        <CardDetail card={selected} onClose={() => setOpen(null)} />
      ) : groups.length === 0 ? (
        <p className="gs-chat-note">{T.empty}</p>
      ) : (
        groups.map((g) => {
          const family = texts.achievements.families[g.family as keyof typeof texts.achievements.families];
          const label = family ?? texts.achievements.otherFamily;
          const all = buildAlbum(
            entries.filter((a) => a.family === g.family),
            mine,
            { locale },
          )[0];
          return (
            <section key={g.family} aria-label={label}>
              <h4 className="gs-ach-family">
                {label}{' '}
                <span className="gs-muted">
                  ·{' '}
                  {fillText(T.familyCount, {
                    n: fmt.integer(g.owned),
                    total: fmt.integer(all?.cards.length ?? g.cards.length),
                  })}
                </span>
              </h4>
              <ul className="gs-album-grid">
                {g.cards.map((c) => (
                  <li key={c.cardKey}>
                    <CardTile card={c} onOpen={() => setOpen(c.cardKey)} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      <p className="gs-small gs-muted">{T.note}</p>
    </div>
  );
}

function cardColor(step: number): string {
  return GS_STEP_COLORS[stepName(step) ?? 'bronze'];
}

function CardTile({ card, onOpen }: { card: GsAlbumCard; onOpen: () => void }) {
  const { texts, locale } = useGalaxieWidget();
  const T = texts.album;
  const name = gameText(card.achievement.name, locale);
  const metal = stepName(card.step);
  const stepLabel =
    card.achievement.stepped && metal ? texts.achievements.steps[metal] : texts.achievements.unique;
  const owned = card.copies > 0;
  return (
    <button
      type="button"
      className="gs-album-card"
      data-gs-card={card.cardKey}
      data-missing={owned ? undefined : true}
      style={{ ['--gs-ach-color' as string]: cardColor(card.step) }}
      onClick={onOpen}
      aria-label={`${fillText(T.cardLabel, { name, step: stepLabel })}${owned ? '' : `, ${T.missing}`}`}
    >
      {card.copies > 1 ? (
        <span className="gs-album-copies" aria-hidden="true">
          {fillText(T.copies, { n: card.copies })}
        </span>
      ) : null}
      <strong>{name}</strong>
      <span>{owned ? stepLabel : T.missing}</span>
    </button>
  );
}

function CardDetail({ card, onClose }: { card: GsAlbumCard; onClose: () => void }) {
  const { texts, locale } = useGalaxieWidget();
  const T = texts.album;
  const fmt = useFormatters();
  const name = gameText(card.achievement.name, locale);
  const description = gameText(card.achievement.description, locale);
  const metal = stepName(card.step);
  const stepLabel =
    card.achievement.stepped && metal ? texts.achievements.steps[metal] : texts.achievements.unique;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  return (
    <div
      className="gs-ach-detail"
      role="region"
      aria-label={name}
      style={{ ['--gs-ach-color' as string]: cardColor(card.step) }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="gs-header">
        <span className="gs-ach-medal" aria-hidden="true">
          {card.step}
        </span>
        <h4 className="gs-title gs-grow">{name}</h4>
        <button ref={closeRef} type="button" className="gs-button" onClick={onClose}>
          {T.close}
        </button>
      </div>
      <p className="gs-small">{stepLabel}</p>
      {description ? <p className="gs-small gs-muted">{description}</p> : null}
      {card.firstAt ? (
        <p className="gs-small">
          {fillText(T.earnedOn, { date: fmt.date(card.firstAt) })}
          {card.copies > 1 ? ` · ${fillText(T.copies, { n: card.copies })}` : ''}
        </p>
      ) : (
        <p className="gs-small">
          {fillText(T.howTo, { step: stepLabel, name, threshold: fmt.integer(card.threshold) })}
        </p>
      )}
    </div>
  );
}
