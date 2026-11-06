import { describe, expect, it } from 'vitest';

import { OFFERED_WIDGET_KINDS } from './config';
import { catalogTabs, pickTab, searchSport, sportChoices, sportForNewWidget, widgetFamily } from './sports';

describe('abas de esporte do catálogo', () => {
  it('Futebol primeiro, com todos os tipos; nos outros esportes, só os tipos já prontos para eles', () => {
    const tabs = catalogTabs(OFFERED_WIDGET_KINDS, []);
    expect(tabs[0]?.family.id).toBe('futebol');
    expect(tabs[0]?.kinds).toEqual(OFFERED_WIDGET_KINDS);
    const basquete = tabs.find((t) => t.family.id === 'basquete');
    expect(basquete?.kinds).toEqual(['live_list']);
  });

  it('só as famílias com esporte do plano', () => {
    const tabs = catalogTabs(OFFERED_WIDGET_KINDS, ['football', 'nba']);
    expect(tabs.map((t) => t.family.id)).toEqual(['futebol', 'basquete']);
  });

  it('aba sem tipo de widget pronto não aparece', () => {
    expect(catalogTabs(['match_card'], [])).toHaveLength(1);
  });

  it('aba da URL, ou a primeira quando não existe', () => {
    const tabs = catalogTabs(OFFERED_WIDGET_KINDS, []);
    expect(pickTab(tabs, 'volei')?.family.id).toBe('volei');
    expect(pickTab(tabs, 'xadrez')?.family.id).toBe('futebol');
    expect(pickTab(tabs, undefined)?.family.id).toBe('futebol');
  });
});

describe('esporte do widget', () => {
  it('widget novo da aba grava o primeiro esporte da família, só nos tipos de todos os esportes', () => {
    expect(sportForNewWidget('live_list', 'basquete')).toBe('basketball');
    expect(sportForNewWidget('live_list', 'futebol')).toBe('football');
    expect(sportForNewWidget('live_list', undefined)).toBeNull();
    expect(sportForNewWidget('match_card', 'basquete')).toBeNull();
  });

  it('coluna Esporte: o esporte gravado, o único do tipo ou todos', () => {
    expect(widgetFamily('live_list', { sport: 'nba' })?.id).toBe('basquete');
    expect(widgetFamily('live_list', {})).toBeNull();
    expect(widgetFamily('standings', { competitionId: 'x' })?.id).toBe('futebol');
  });

  it('seletor do editor: cada esporte da API (Basquete e NBA separados), só os do plano', () => {
    expect(sportChoices(['nba', 'volleyball'])).toEqual([
      expect.objectContaining({ sport: 'nba' }),
      expect.objectContaining({ sport: 'volleyball' }),
    ]);
    expect(
      sportChoices([])
        .map((c) => c.sport)
        .slice(0, 3),
    ).toEqual(['football', 'basketball', 'nba']);
  });

  it('busca de entidade: o esporte escolhido nos Jogos do dia, o do tipo nos outros', () => {
    expect(searchSport('live_list', 'nba')).toBe('nba');
    expect(searchSport('live_list', null)).toBeNull();
    expect(searchSport('match_card', null)).toBe('football');
  });
});
