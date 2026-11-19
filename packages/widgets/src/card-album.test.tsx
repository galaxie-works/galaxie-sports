import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_THEMES,
  albumTotals,
  buildAlbum,
  textsFor,
  type GsAchievementCatalogEntry,
  type GsFanCard,
} from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { createPreviewFetch } from './fixtures.js';
import { PREVIEW_FAN_TOKEN } from './fixtures-game.js';
import { CardAlbum } from './widgets/card-album.js';

afterEach(cleanup);

const T = textsFor('pt-BR').album;
const A = textsFor('pt-BR').achievements;

const entry = (id: string, family: string, keys: (string | null)[]): GsAchievementCatalogEntry => ({
  id,
  sport: null,
  category: 'participation',
  family,
  stepped: keys.length > 1,
  seasonal: false,
  name: { pt: id },
  description: {},
  steps: keys.map((card_key, i) => ({ step: i + 1, threshold: (i + 1) * 5, card_key })),
});
const card = (card_key: string, granted_at: string, season = 'all'): GsFanCard => ({
  card_key,
  achievement_id: card_key.split('.').slice(0, -1).join('.'),
  season,
  step: Number(card_key.split('.').at(-1)),
  granted_at,
});

describe('álbum (contas)', () => {
  const catalog = [
    entry('b.loyal', 'loyalty', ['b.loyal.1', 'b.loyal.2', null]),
    entry('a.moment', 'moments', ['a.moment.1']),
    entry('z.new', 'zzz', ['z.new.1']),
  ];
  const mine = [
    card('b.loyal.1', '2026-09-01T00:00:00Z'),
    card('b.loyal.1', '2026-08-01T00:00:00Z', '2026'),
    card('a.moment.1', '2026-10-01T00:00:00Z'),
    card('fora.do.catalogo.1', '2026-10-01T00:00:00Z'),
  ];

  it('agrupa pela família, conta cópias e guarda a primeira vez', () => {
    const groups = buildAlbum(catalog, mine);
    expect(groups.map((g) => g.family)).toEqual(['loyalty', 'moments', 'zzz']);
    expect(groups[0]!.cards.map((c) => [c.cardKey, c.copies, c.firstAt])).toEqual([
      ['b.loyal.1', 2, '2026-08-01T00:00:00Z'],
      ['b.loyal.2', 0, null],
    ]);
    expect(groups[0]!.owned).toBe(1);
  });

  it('filtra o que tem e o que falta, e o total ignora Carta fora do Catálogo', () => {
    expect(
      buildAlbum(catalog, mine, { show: 'owned' }).flatMap((g) => g.cards.map((c) => c.cardKey)),
    ).toEqual(['b.loyal.1', 'a.moment.1']);
    expect(buildAlbum(catalog, mine, { show: 'missing' }).map((g) => g.family)).toEqual(['loyalty', 'zzz']);
    expect(albumTotals(catalog, mine)).toEqual({ owned: 2, total: 4 });
  });
});

function renderAlbum(props: Parameters<typeof CardAlbum>[0] = {}) {
  return render(
    <GalaxieWidgetProvider
      baseUrl="https://api.test"
      publishableKey="pk_test"
      theme={DEFAULT_THEMES.light}
      locale="pt-BR"
      fetch={createPreviewFetch()}
      fanToken={PREVIEW_FAN_TOKEN}
    >
      <CardAlbum {...props} />
    </GalaxieWidgetProvider>,
  );
}

describe('<CardAlbum>', () => {
  it('sem torcedor, pede para entrar', async () => {
    render(
      <GalaxieWidgetProvider
        baseUrl="https://api.test"
        theme={DEFAULT_THEMES.light}
        locale="pt-BR"
        fetch={createPreviewFetch()}
      >
        <CardAlbum />
      </GalaxieWidgetProvider>,
    );
    expect(await screen.findByText(textsFor('pt-BR').fan.signIn)).toBeTruthy();
  });

  it('mostra as que tem e as que faltam, com cópias e como ganhar', async () => {
    renderAlbum();
    expect(await screen.findByText('4 de 16 Cartas')).toBeTruthy();
    const owned = screen.getByRole('button', { name: `Fiel, ${A.steps.bronze}` });
    expect(owned.textContent).toContain('x2');
    const missing = screen.getByRole('button', { name: `Fiel, ${A.steps.platinum}, ${T.missing}` });
    fireEvent.click(missing);
    expect(await screen.findByText(`${A.steps.platinum} de Fiel: 38`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: T.close }));
    expect(
      await screen.findByRole('button', { name: `Fiel, ${A.steps.platinum}, ${T.missing}` }),
    ).toBeTruthy();
  });

  it('o filtro mostra só as que faltam', async () => {
    renderAlbum({ show: 'missing' });
    await screen.findByText('4 de 16 Cartas');
    expect(screen.queryByRole('button', { name: `Fiel, ${A.steps.bronze}` })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: T.filters.all }));
    expect(screen.getByRole('button', { name: `Fiel, ${A.steps.bronze}` })).toBeTruthy();
  });
});
