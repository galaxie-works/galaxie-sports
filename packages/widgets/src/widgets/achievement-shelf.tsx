'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GS_STEP_COLORS,
  achievementShareSvg,
  buildShelf,
  fillText,
  gameText,
  newlyReached,
  rarityPercent,
  shelfEarned,
  shelfProgress,
  shelfSeasons,
  stepName,
  type GsAchievementCatalogEntry,
  type GsAchievementEarners,
  type GsFanAchievement,
  type GsMyRanking,
  type GsRanking,
  type GsShelfItem,
} from '../core/model.js';
import {
  ErrorState,
  FanGate,
  LoadingState,
  WidgetFrame,
  useFanJson,
  useFanSession,
  useFormatters,
  useGalaxieWidget,
} from '../core/react.js';

export interface AchievementShelfProps {
  /** O que mostrar: a estante, o Ranking ou os dois em abas (padrão). */
  view?: 'both' | 'shelf' | 'ranking' | undefined;
  /** Só as Conquistas deste esporte e as comuns a todos (padrão: o Catálogo inteiro do programa). */
  sport?: string | undefined;
  /** Mostra também as que o torcedor ainda não ganhou (padrão: sim). */
  showLocked?: boolean | undefined;
  /** Período do Ranking: o mês ou o ano corrente (padrão: o mês). */
  rankingPeriod?: 'month' | 'year' | undefined;
  /** Quantos aparecem no Ranking (padrão 10). */
  rankingSize?: number | undefined;
}

const enc = encodeURIComponent;
/**
 * Releitura da estante (aviso de Degrau novo) e do Ranking: a cada 5 min com a aba visível, e quando a aba volta a
 * ficar visível. A Conquista só conta no resultado definitivo do jogo, então não há o que ganhar mais rápido que isso.
 */
const SHELF_REFRESH_MS = 5 * 60_000;
/** Quanto o aviso de Degrau novo fica na tela. */
const TOAST_MS = 6_000;

/**
 * Estante de Conquistas e Ranking do torcedor (#919): as Conquistas ganhas e bloqueadas por família, o Degrau em
 * metal (Bronze a Lendário), a barra até o próximo, a raridade e "quem já ganhou"; o Ranking do programa com o
 * torcedor destacado. Precisa do token do torcedor; a faixa etária segue a da API (13 anos ou mais lê).
 */
export function AchievementShelf(props: AchievementShelfProps) {
  const { texts } = useGalaxieWidget();
  const T = texts.achievements;
  return (
    <WidgetFrame kind="fan_achievements">
      <div className="gs-header">
        <h3 className="gs-title gs-grow">{T.title}</h3>
      </div>
      <FanGate need="read">
        <ShelfBody {...props} />
      </FanGate>
    </WidgetFrame>
  );
}

function ShelfBody({
  view = 'both',
  sport,
  showLocked = true,
  rankingPeriod = 'month',
  rankingSize = 10,
}: AchievementShelfProps) {
  const { texts } = useGalaxieWidget();
  const T = texts.achievements;
  const [tab, setTab] = useState<'shelf' | 'ranking'>(view === 'ranking' ? 'ranking' : 'shelf');
  useEffect(() => {
    if (view !== 'both') setTab(view);
  }, [view]);
  const show = view === 'both' ? tab : view;
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div className="gs-group">
      <div aria-live="polite" role="status">
        {toast ? <div className="gs-ach-toast">{toast}</div> : null}
      </div>
      {view === 'both' ? (
        <span className="gs-seg" role="group" aria-label={T.title}>
          {(['shelf', 'ranking'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
              {k === 'shelf' ? T.tabShelf : T.tabRanking}
            </button>
          ))}
        </span>
      ) : null}
      {/* com as duas abas, a estante fica montada na do Ranking para o aviso de Degrau novo continuar valendo;
          só o Ranking, a estante nem monta (nada de reler Conquistas que ninguém vê) */}
      {view === 'ranking' ? null : (
        <div hidden={show !== 'shelf'}>
          <Shelf sport={sport} showLocked={showLocked} onReached={setToast} />
        </div>
      )}
      {show === 'ranking' ? <Ranking period={rankingPeriod} size={rankingSize} /> : null}
    </div>
  );
}

function Shelf({
  sport,
  showLocked,
  onReached,
}: {
  sport: string | undefined;
  showLocked: boolean;
  onReached: (message: string) => void;
}) {
  const { texts, locale } = useGalaxieWidget();
  const T = texts.achievements;
  const fmt = useFormatters();
  const catalog = useFanJson<{ achievements: GsAchievementCatalogEntry[] }>(
    `/v1/achievements${sport ? `?sport=${enc(sport)}` : ''}`,
  );
  const mine = useFanJson<{ achievements: GsFanAchievement[] }>('/v1/fans/me/achievements', SHELF_REFRESH_MS);
  const [season, setSeason] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const lastOpen = useRef<string | null>(null);
  // fechar o detalhe devolve o foco à Conquista que o abriu
  useEffect(() => {
    if (open) {
      lastOpen.current = open;
      return;
    }
    const id = lastOpen.current;
    if (!id) return;
    lastOpen.current = null;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-gs-ach="${CSS.escape(id)}"]`)?.focus();
  }, [open]);

  const rows = mine.data?.achievements;
  const entries = catalog.data?.achievements;
  const byId = useMemo(() => new Map((entries ?? []).map((a) => [a.id, a])), [entries]);

  // Degrau novo entre duas leituras: aviso na tela (e para o leitor de tela), uma Conquista por vez
  const previous = useRef<GsFanAchievement[] | null>(null);
  useEffect(() => {
    // sem o Catálogo ainda, a leitura não vira base: o Degrau novo é comparado quando os nomes chegarem
    if (!rows || !entries) return;
    const before = previous.current;
    previous.current = rows;
    if (!before) return;
    const reached = newlyReached(before, rows).find((r) => byId.has(r.achievementId));
    if (!reached) return;
    const name = gameText(byId.get(reached.achievementId)?.name, locale);
    const step = stepName(reached.step);
    onReached(fillText(T.reached, { step: step ? T.steps[step] : String(reached.step), name }));
  }, [rows, entries, byId, locale, T, onReached]);

  if (catalog.loading || mine.loading) return <LoadingState lines={4} />;
  if (catalog.error || mine.error || !entries || !rows)
    return (
      <ErrorState
        error={null}
        onRetry={() => {
          catalog.reload();
          mine.reload();
        }}
      />
    );

  const seasons = shelfSeasons(rows);
  const groups = buildShelf(entries, rows, season, { showLocked, locale });
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const earned = shelfEarned(groups);
  const selected = open ? groups.flatMap((g) => g.items).find((i) => i.achievement.id === open) : undefined;

  return (
    <div className="gs-group" ref={gridRef}>
      <div className="gs-ach-top">
        <span className="gs-small gs-muted">
          {fillText(T.earned, { n: fmt.integer(earned), total: fmt.integer(total) })}
        </span>
        {seasons.length > 1 ? (
          <label className="gs-small gs-muted">
            {T.seasonLabel}{' '}
            <select value={season} onChange={(e) => setSeason(e.target.value)}>
              {seasons.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? T.lifetime : fillText(T.season, { season: s })}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {earned === 0 && season === 'all' ? <p className="gs-chat-note">{T.empty}</p> : null}
      {selected ? (
        <Detail item={selected} season={season} onClose={() => setOpen(null)} />
      ) : (
        groups.map((g) => (
          <section key={g.family} aria-label={familyLabel(g.family, T)}>
            <h4 className="gs-ach-family">{familyLabel(g.family, T)}</h4>
            <ul className="gs-ach-grid">
              {g.items.map((item) => (
                <li key={item.achievement.id}>
                  <ShelfTile item={item} onOpen={() => setOpen(item.achievement.id)} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function familyLabel(family: string, T: { families: Record<string, string>; otherFamily: string }): string {
  return T.families[family] ?? T.otherFamily;
}

function stepColor(steps: number): string | undefined {
  const name = stepName(steps);
  return name ? GS_STEP_COLORS[name] : undefined;
}

function ShelfTile({ item, onOpen }: { item: GsShelfItem; onOpen: () => void }) {
  const { texts, locale } = useGalaxieWidget();
  const T = texts.achievements;
  const fmt = useFormatters();
  const name = gameText(item.achievement.name, locale);
  const metal = stepName(item.steps);
  const status = metal ? T.steps[metal] : T.locked;
  const pct = rarityPercent(item.rarity);
  const color = stepColor(item.steps) ?? stepColor(1);
  const progress =
    item.next !== null && item.achievement.stepped
      ? fillText(T.progress, { count: fmt.integer(item.count), next: fmt.integer(item.next) })
      : item.next === null
        ? T.complete
        : null;
  const rarity = pct && item.steps > 0 ? fillText(T.rarity, { pct }) : null;
  return (
    <button
      type="button"
      className="gs-ach-item"
      data-locked={item.steps === 0 || undefined}
      style={{ ['--gs-ach-color' as string]: color }}
      onClick={onOpen}
      data-gs-ach={item.achievement.id}
      aria-label={[name, status, progress, rarity].filter(Boolean).join(', ')}
    >
      <span className="gs-ach-medal" aria-hidden="true">
        {item.steps > 0 ? item.steps : '?'}
      </span>
      <span className="gs-ach-name">{name}</span>
      <span className="gs-small gs-muted">{status}</span>
      {item.next !== null && item.achievement.stepped ? (
        <>
          <span className="gs-ach-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(shelfProgress(item) * 100)}%` }} />
          </span>
          <span className="gs-small gs-muted">
            {fillText(T.progress, { count: fmt.integer(item.count), next: fmt.integer(item.next) })}
          </span>
        </>
      ) : item.next === null ? (
        <span className="gs-small">{T.complete}</span>
      ) : null}
      {pct && item.steps > 0 ? (
        <span className="gs-small gs-muted">{fillText(T.rarity, { pct })}</span>
      ) : null}
    </button>
  );
}

function Detail({ item, season, onClose }: { item: GsShelfItem; season: string; onClose: () => void }) {
  const { texts, locale } = useGalaxieWidget();
  const fan = useFanSession();
  const T = texts.achievements;
  const fmt = useFormatters();
  const a = item.achievement;
  const name = gameText(a.name, locale);
  const description = gameText(a.description, locale);
  const earners = useFanJson<GsAchievementEarners>(
    `/v1/achievements/${enc(a.id)}/earners?season=${enc(season)}&limit=12`,
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  const metal = stepName(item.steps);

  const share = async () => {
    const svg = achievementShareSvg({
      name,
      stepLabel: metal ? T.steps[metal] : T.locked,
      step: item.steps,
      nickname: fan.me?.nickname ?? null,
      caption: T.shareCaption,
    });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const fileName = `${a.id.replace(/\./g, '-')}.svg`;
    try {
      const file = new File([blob], fileName, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch {
      // compartilhar recusado ou indisponível: cai no download
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <div
      className="gs-ach-detail"
      role="region"
      aria-label={name}
      style={{ ['--gs-ach-color' as string]: stepColor(item.steps) ?? stepColor(1) }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="gs-header">
        <span className="gs-ach-medal" aria-hidden="true">
          {item.steps > 0 ? item.steps : '?'}
        </span>
        <h4 className="gs-title gs-grow">{name}</h4>
        <button ref={closeRef} type="button" className="gs-button" onClick={onClose}>
          {T.close}
        </button>
      </div>
      {description ? <p className="gs-small">{description}</p> : null}
      {a.stepped ? (
        <ol className="gs-ach-steps">
          {a.steps.map((s) => {
            const n = stepName(s.step);
            return (
              <li key={s.step} data-done={s.step <= item.steps || undefined}>
                {fillText(T.stepLine, {
                  step: n ? T.steps[n] : String(s.step),
                  threshold: fmt.integer(s.threshold),
                })}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="gs-small gs-muted">{T.unique}</p>
      )}
      <div className="gs-group">
        <strong className="gs-small">{T.earners}</strong>
        {earners.loading ? (
          <LoadingState lines={1} />
        ) : earners.data ? (
          earners.data.total === 0 ? (
            <p className="gs-small gs-muted">{T.earnersNone}</p>
          ) : (
            <>
              <p className="gs-small gs-muted">
                {fillText(T.earnersTotal, { n: fmt.integer(earners.data.total) })}
              </p>
              {earners.data.earners.length ? (
                <ul className="gs-ach-earners">
                  {earners.data.earners.map((e) => (
                    <li key={e.profile_id} className="gs-chip">
                      {e.nickname ?? T.anonymous}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )
        ) : null}
      </div>
      {item.steps > 0 ? (
        <div>
          <button type="button" className="gs-button" onClick={() => void share()}>
            {T.share}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Ranking({ period, size }: { period: 'month' | 'year'; size: number }) {
  const { texts } = useGalaxieWidget();
  const fan = useFanSession();
  const T = texts.achievements;
  const fmt = useFormatters();
  const [kind, setKind] = useState(period);
  useEffect(() => setKind(period), [period]);
  // o período corrente é resolvido pela API no fuso do programa (a virada do mês vale lá, não no navegador)
  const key = kind === 'year' ? 'current-year' : 'current-month';
  const limit = Math.min(Math.max(Math.round(size) || 10, 3), 100);
  const list = useFanJson<GsRanking>(`/v1/rankings/${enc(key)}?limit=${limit}`, SHELF_REFRESH_MS);
  const me = useFanJson<GsMyRanking>(`/v1/rankings/${enc(key)}/me`, SHELF_REFRESH_MS);
  const myId = fan.me?.profile_id;

  const segment = (
    <span className="gs-seg" role="group" aria-label={T.tabRanking}>
      {(['month', 'year'] as const).map((k) => (
        <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
          {k === 'month' ? T.rankingMonth : T.rankingYear}
        </button>
      ))}
    </span>
  );

  if (list.loading) return <LoadingState lines={5} />;
  if (list.error || !list.data) return <ErrorState error={null} onRetry={list.reload} />;
  const entries = list.data.entries;
  const isMe = (e: GsRanking['entries'][number]) => e.is_me ?? e.profile_id === myId;
  const inList = entries.some(isMe);

  return (
    <div className="gs-group">
      {segment}
      {entries.length === 0 ? (
        <p className="gs-chat-note">{T.rankingEmpty}</p>
      ) : (
        <ol className="gs-list" aria-label={T.tabRanking}>
          {entries.map((e) => (
            <li key={`${e.position}-${e.profile_id}`} className="gs-rank-row" data-me={isMe(e) || undefined}>
              <span className="gs-rank-pos">{e.position}</span>
              <span>
                {e.nickname ?? T.anonymous}
                {isMe(e) ? <span className="gs-small gs-muted"> ({T.you})</span> : null}
              </span>
              <span>{fillText(T.points, { n: fmt.integer(e.points) })}</span>
            </li>
          ))}
        </ol>
      )}
      {!inList && me.data ? (
        me.data.position === null ? (
          <p className="gs-small gs-muted">{T.noPosition}</p>
        ) : (
          <div className="gs-rank-row" data-me>
            <span className="gs-rank-pos">{me.data.position}</span>
            <span>{fillText(T.yourPosition, { position: fmt.integer(me.data.position) })}</span>
            <span>{fillText(T.points, { n: fmt.integer(me.data.points) })}</span>
          </div>
        )
      ) : null}
    </div>
  );
}
