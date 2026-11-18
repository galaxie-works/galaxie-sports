import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THEMES,
  achievementShareSvg,
  buildShelf,
  gameText,
  newlyReached,
  rankingPeriodKey,
  rarityPercent,
  shelfProgress,
  shelfSeasons,
  stepName,
  textsFor,
  type GsAchievementCatalogEntry,
  type GsFanAchievement,
} from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { createPreviewFetch } from './fixtures.js';
import { PREVIEW_ACHIEVEMENT_CATALOG, PREVIEW_FAN, PREVIEW_FAN_TOKEN } from './fixtures-game.js';
import { AchievementShelf } from './widgets/achievement-shelf.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const T = textsFor('pt-BR').achievements;

const entry = (patch: Partial<GsAchievementCatalogEntry> & { id: string }): GsAchievementCatalogEntry => ({
  sport: null,
  category: 'participation',
  family: 'loyalty',
  stepped: true,
  seasonal: false,
  name: { pt: patch.id },
  description: {},
  steps: [1, 5, 15, 38, 100].map((threshold, i) => ({ step: i + 1, threshold, card_key: null })),
  ...patch,
});
const row = (achievement_id: string, count: number, steps: number, season = 'all'): GsFanAchievement => ({
  achievement_id,
  season,
  count,
  steps,
  next_threshold: null,
  rarity: 0.1,
});

describe('estante (contas)', () => {
  it('agrupa por família na ordem da estante, ganhas primeiro e bloqueadas no fim', () => {
    const catalog = [
      entry({
        id: 'a.moment',
        family: 'moments',
        stepped: false,
        steps: [{ step: 1, threshold: 1, card_key: null }],
      }),
      entry({ id: 'a.locked' }),
      entry({ id: 'a.gold' }),
      entry({ id: 'a.new', family: 'zzz_new' }),
    ];
    const groups = buildShelf(catalog, [row('a.gold', 20, 3), row('a.moment', 1, 1)], 'all');
    expect(groups.map((g) => g.family)).toEqual(['loyalty', 'moments', 'zzz_new']);
    expect(groups[0]!.items.map((i) => i.achievement.id)).toEqual(['a.gold', 'a.locked']);
    const gold = groups[0]!.items[0]!;
    expect(gold).toMatchObject({ steps: 3, from: 15, next: 38, count: 20 });
    expect(shelfProgress(gold)).toBeCloseTo(5 / 23);
    expect(groups[1]!.items[0]).toMatchObject({ steps: 1, next: null });
    expect(shelfProgress(groups[1]!.items[0]!)).toBe(1);
  });

  it('sem as bloqueadas, só as que têm Degrau; na temporada, só as sazonais', () => {
    const catalog = [entry({ id: 'a.1', seasonal: true }), entry({ id: 'a.2' })];
    const mine = [row('a.1', 6, 2, '2026'), row('a.1', 6, 2), row('a.2', 1, 1)];
    expect(buildShelf(catalog, [], 'all', { showLocked: false })).toEqual([]);
    const season = buildShelf(catalog, mine, '2026');
    expect(season.flatMap((g) => g.items.map((i) => i.achievement.id))).toEqual(['a.1']);
    expect(shelfSeasons(mine)).toEqual(['all', '2026']);
  });

  it('Degrau acima dos que o Catálogo tem não estoura a barra', () => {
    const [g] = buildShelf(
      [entry({ id: 'a', steps: [{ step: 1, threshold: 1, card_key: null }] })],
      [row('a', 9, 5)],
      'all',
    );
    expect(g!.items[0]).toMatchObject({ steps: 1, next: null });
  });

  it('aviso ao vivo: um por Conquista, a vitalícia antes da temporada', () => {
    const before = [row('a', 4, 1), row('a', 4, 1, '2026'), row('b', 1, 1)];
    const after = [row('a', 5, 2), row('a', 5, 2, '2026'), row('b', 2, 1), row('c', 1, 1)];
    expect(newlyReached(before, after)).toEqual([
      { achievementId: 'a', season: 'all', step: 2 },
      { achievementId: 'c', season: 'all', step: 1 },
    ]);
    expect(newlyReached(after, after)).toEqual([]);
  });

  it('textos, metal, raridade e período do Ranking', () => {
    expect(gameText({ pt: 'Fiel', en: 'Faithful' }, 'en')).toBe('Faithful');
    expect(gameText({ pt: 'Fiel' }, 'es')).toBe('Fiel');
    expect(gameText(undefined, 'pt-BR')).toBe('');
    expect(stepName(1)).toBe('bronze');
    expect(stepName(5)).toBe('legendary');
    expect(stepName(0)).toBeNull();
    expect(rarityPercent(0.031)).toBe('3%');
    expect(rarityPercent(0.004)).toBe('<1%');
    expect(rarityPercent(null)).toBeNull();
    // 23h de 31/12 em São Paulo ainda é dezembro, já é janeiro em UTC
    const now = new Date('2027-01-01T02:00:00Z');
    expect(rankingPeriodKey('month', now, 'America/Sao_Paulo')).toBe('2026-12');
    expect(rankingPeriodKey('year', now, 'America/Sao_Paulo')).toBe('2026');
    expect(rankingPeriodKey('month', now, 'UTC')).toBe('2027-01');
    expect(rankingPeriodKey('month', now, 'Fuso/Inexistente')).toMatch(/^\d{4}-\d{2}$/);
  });

  it('card compartilhável escapa o texto e não leva marca', () => {
    const svg = achievementShareSvg({
      name: '<script>Fiel</script>',
      stepLabel: 'Ouro',
      step: 3,
      nickname: 'Ana & Bia',
      caption: 'Conquista',
    });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&#60;script&#62;');
    expect(svg).toContain('Ana &#38; Bia');
    expect(svg.match(/<circle cx="\d+" cy="430"/g)).toHaveLength(5);
  });
});

function renderShelf(props: Parameters<typeof AchievementShelf>[0] = {}, fetchImpl = createPreviewFetch()) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.test"
      publishableKey="pk_test"
      theme={DEFAULT_THEMES.light}
      locale="pt-BR"
      fetch={fetchImpl}
      fanToken={PREVIEW_FAN_TOKEN}
    >
      <AchievementShelf {...props} />
    </GalaxieWidgetProvider>,
  );
}

describe('<AchievementShelf>', () => {
  it('sem torcedor, pede para entrar', async () => {
    render(
      <GalaxieWidgetProvider
        baseUrl="https://api.test"
        theme={DEFAULT_THEMES.light}
        locale="pt-BR"
        fetch={createPreviewFetch()}
      >
        <AchievementShelf />
      </GalaxieWidgetProvider>,
    );
    expect(await screen.findByText(textsFor('pt-BR').fan.signIn)).toBeTruthy();
  });

  it('mostra a estante com ganhas e bloqueadas, e o detalhe com quem já ganhou', async () => {
    renderShelf();
    const fiel = await screen.findByRole('button', { name: new RegExp(`^Fiel, ${T.steps.gold}`) });
    expect(screen.getByRole('button', { name: new RegExp(`^Explorador, ${T.locked}`) })).toBeTruthy();
    expect(screen.getByText('Fidelidade')).toBeTruthy();
    expect(screen.getByText('21 de 38')).toBeTruthy();
    fireEvent.click(fiel);
    expect(await screen.findByText('1.284 torcedores já ganharam')).toBeTruthy();
    expect(screen.getByRole('button', { name: T.share })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: T.close }));
    expect(await screen.findByRole('button', { name: new RegExp(`^Fiel, ${T.steps.gold}`) })).toBeTruthy();
  });

  it('o esporte filtra o Catálogo (as comuns ficam)', async () => {
    const seen: string[] = [];
    const base = createPreviewFetch();
    renderShelf({ sport: 'basketball', view: 'shelf' }, (input, init) => {
      seen.push(String(input));
      return base(input, init);
    });
    await screen.findByRole('button', { name: new RegExp(`^Fiel, ${T.steps.gold}`) });
    expect(seen.some((u) => u.endsWith('/v1/achievements?sport=basketball'))).toBe(true);
    expect(screen.queryByText('Gol nos acréscimos')).toBeNull();
    expect(screen.queryByRole('group', { name: T.title })).toBeNull();
  });

  it('o Ranking destaca o torcedor fora do topo pela posição dele', async () => {
    renderShelf({ view: 'ranking', rankingSize: 5 });
    expect(await screen.findByText('Ana_FC')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(await screen.findByText('Você está em 23º')).toBeTruthy();
  });

  it('avisa o Degrau novo quando a estante relê durante o jogo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let steps = 3;
    const base = createPreviewFetch();
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/fans/me/achievements'))
        return new Response(
          JSON.stringify({
            data: {
              program_country: 'BR',
              achievements: [
                {
                  achievement_id: 'loyalty.watched',
                  season: 'all',
                  count: 38,
                  steps,
                  next_threshold: 100,
                  rarity: 0.1,
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      return base(input, init);
    };
    renderShelf({ view: 'shelf' }, fetchImpl);
    await screen.findByRole('button', { name: new RegExp(`^Fiel, ${T.steps.gold}`) });
    steps = 4;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() => expect(screen.getByText(`Você chegou a ${T.steps.platinum} em Fiel!`)).toBeTruthy());
  });

  it('o Catálogo de exemplo e o torcedor de exemplo batem com os tipos', () => {
    expect(PREVIEW_FAN.capabilities).toContain('read');
    expect(PREVIEW_ACHIEVEMENT_CATALOG.every((a) => a.steps.length >= 1)).toBe(true);
  });
});

describe('<AchievementShelf> (revisão)', () => {
  it('só o Ranking: a estante nem lê as Conquistas', async () => {
    const seen: string[] = [];
    const base = createPreviewFetch();
    renderShelf({ view: 'ranking' }, (input, init) => {
      seen.push(String(input));
      return base(input, init);
    });
    await screen.findByText('Ana_FC');
    expect(seen.some((u) => u.includes('/v1/fans/me/achievements'))).toBe(false);
    expect(seen.some((u) => /\/v1\/achievements(\?|$)/.test(u))).toBe(false);
  });

  it('fechar o detalhe devolve o foco à Conquista', async () => {
    renderShelf({ view: 'shelf' });
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Fiel, ${T.steps.gold}`) }));
    fireEvent.click(await screen.findByRole('button', { name: T.close }));
    const tile = await screen.findByRole('button', { name: new RegExp(`^Fiel, ${T.steps.gold}`) });
    await waitFor(() => expect(document.activeElement).toBe(tile));
  });

  it('a prévia não inventa torcedor sem o token de exemplo', async () => {
    const res = await createPreviewFetch()('https://api.test/v1/fans/me');
    expect(res.status).not.toBe(200);
  });
});
