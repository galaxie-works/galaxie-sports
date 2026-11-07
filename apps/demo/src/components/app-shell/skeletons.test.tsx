import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoadingStatus } from '@/components/app-shell/loading-status';
import { I18nProvider } from '@/lib/i18n/client';
import { LOCALES, type Locale } from '@/lib/i18n/config';
import { clientDictionary } from '@/lib/i18n/dictionary';

import * as S from './skeletons';

/** Cada esqueleto exportado, com o que precisa para renderizar (os que embrulham recebem um filho). */
const CASES: Record<string, () => React.ReactElement> = {
  AvatarInfoSkeleton: () => <S.AvatarInfoSkeleton />,
  MediaCardSkeleton: () => <S.MediaCardSkeleton />,
  MediaCardOnly: () => <S.MediaCardSkeleton header={false} mediaClassName="h-64" />,
  TextSkeleton: () => <S.TextSkeleton />,
  FormSkeleton: () => <S.FormSkeleton fields={4} columns={2} />,
  TableSkeleton: () => <S.TableSkeleton />,
  StatsSkeleton: () => <S.StatsSkeleton count={6} />,
  StatPairSkeleton: () => <S.StatPairSkeleton size="sm" />,
  StatPairsSkeleton: () => <S.StatPairsSkeleton />,
  ListSkeleton: () => <S.ListSkeleton />,
  CardGridSkeleton: () => <S.CardGridSkeleton />,
  CardGridBare: () => <S.CardGridSkeleton bare media={null} />,
  DetailsSkeleton: () => <S.DetailsSkeleton />,
  TimelineSkeleton: () => <S.TimelineSkeleton />,
  FramePanelSkeleton: () => (
    <S.FramePanelSkeleton action>
      <S.TableSkeleton />
    </S.FramePanelSkeleton>
  ),
  TablePanelSkeleton: () => <S.TablePanelSkeleton toolbar action />,
  EditorSkeleton: () => <S.EditorSkeleton />,
  EventCardSkeleton: () => <S.EventCardSkeleton />,
  EventCardsSkeleton: () => <S.EventCardsSkeleton />,
  EntryCardsSkeleton: () => <S.EntryCardsSkeleton />,
  SectionSkeleton: () => (
    <S.SectionSkeleton>
      <S.TextSkeleton />
    </S.SectionSkeleton>
  ),
  TableCardSkeleton: () => <S.TableCardSkeleton />,
  FormCardSkeleton: () => <S.FormCardSkeleton />,
  OpsPanelSkeleton: () => <S.OpsPanelSkeleton />,
  TenantOverviewSkeleton: () => <S.TenantOverviewSkeleton />,
  ScoreboardSkeleton: () => <S.ScoreboardSkeleton />,
  IndexCardsSkeleton: () => <S.IndexCardsSkeleton />,
  IndexCardsFamily: () => <S.IndexCardsSkeleton variant="family" />,
  ToolbarTableSkeleton: () => <S.ToolbarTableSkeleton />,
  ToolbarTableTabs: () => <S.ToolbarTableSkeleton toolbar="tabs" />,
  SearchListSkeleton: () => <S.SearchListSkeleton />,
};

const html = (node: React.ReactElement, locale: Locale = 'pt-BR') =>
  renderToString(
    <I18nProvider locale={locale} messages={clientDictionary(locale)}>
      <LoadingStatus>{node}</LoadingStatus>
    </I18nProvider>,
  );

afterEach(() => vi.restoreAllMocks());

describe('esqueletos de carregamento', () => {
  it('todo esqueleto exportado tem um caso aqui', () => {
    const exported = Object.keys(S).filter((k) => k.endsWith('Skeleton'));
    const covered = new Set(Object.values(CASES).map((c) => (c().type as { name: string }).name));
    expect(exported.filter((k) => !covered.has(k))).toEqual([]);
  });

  it.each(Object.keys(CASES))(
    '%s: o mesmo HTML a cada render (prerender = hidratação), sem Math.random',
    (name) => {
      const random = vi.spyOn(Math, 'random');
      const first = html(CASES[name]!());
      expect(html(CASES[name]!())).toBe(first);
      expect(random).not.toHaveBeenCalled();
      expect(first).toContain('data-slot="skeleton"');
    },
  );

  it('o aviso sai no idioma da página e os blocos ficam escondidos dos leitores de tela', () => {
    const expected: Record<Locale, string> = { 'pt-BR': 'Carregando…', en: 'Loading…', 'es-AR': 'Cargando…' };
    for (const locale of LOCALES) {
      const out = html(<S.TableSkeleton />, locale);
      expect(out).toContain(`role="status"`);
      expect(out).toContain(expected[locale]);
      expect(out).toMatch(/<div aria-hidden="true">/);
    }
  });
});
