import { WIDGET_CATALOG } from '@galaxie/widgets';
import { describe, expect, it } from 'vitest';

import { OFFERED_WIDGET_KINDS } from './config';
import {
  catalogTabs,
  defaultSport,
  pickTab,
  searchSport,
  sportChoices,
  sportForNewWidget,
  sportOnKindChange,
  widgetFamily,
} from './sports';

describe('abas de esporte do catálogo', () => {
  it('Futebol primeiro, com todos os tipos; nos outros esportes, só os tipos já prontos para eles', () => {
    const tabs = catalogTabs(OFFERED_WIDGET_KINDS, []);
    expect(tabs[0]?.family.id).toBe('futebol');
    expect(tabs[0]?.kinds).toEqual(
      OFFERED_WIDGET_KINDS.filter(
        (k) => WIDGET_CATALOG[k].sports.length === 0 || WIDGET_CATALOG[k].sports.includes('football'),
      ),
    );
    const basquete = tabs.find((t) => t.family.id === 'basquete');
    // IA, "o que está em jogo" e vídeos ainda são só do futebol
    expect(basquete?.kinds).toEqual([
      'match_card',
      'live_list',
      'standings',
      'where_to_watch',
      'head_to_head',
      'team_schedule',
      'team_card',
    ]);
    expect(tabs.find((t) => t.family.id === 'automobilismo')?.kinds).toEqual([
      'live_list',
      'standings',
      'where_to_watch',
      'race_result',
      'race_weekend',
      'season_calendar',
      'athlete_profile',
    ]);
    expect(tabs.find((t) => t.family.id === 'lutas')?.kinds).toContain('fight_card');
    // Hipismo e Olimpíadas e Pan: abas do catálogo fora do menu de esportes, no fim
    expect(tabs.find((t) => t.family.id === 'hipismo')?.kinds).toEqual([
      'equestrian_results',
      'equestrian_ranking',
      'equestrian_calendar',
      'rider_profile',
      'horse_profile',
    ]);
    expect(tabs.at(-1)?.family.id).toBe('multiesporte');
    expect(tabs.at(-1)?.kinds).toEqual([
      'medal_table',
      'country_today',
      'games_schedule',
      'country_athletes',
      'medal_history',
    ]);
  });

  it('só as famílias com esporte do plano', () => {
    const tabs = catalogTabs(OFFERED_WIDGET_KINDS, ['football', 'nba']);
    expect(tabs.map((t) => t.family.id)).toEqual(['futebol', 'basquete']);
  });

  it('aba sem tipo de widget pronto não aparece', () => {
    expect(catalogTabs(['ai_context'], [])).toHaveLength(1);
    expect(catalogTabs(['match_card'], []).map((t) => t.family.id)).not.toContain('automobilismo');
    expect(catalogTabs(['fight_card'], []).map((t) => t.family.id)).toEqual(['lutas']);
  });

  it('aba da URL, ou a primeira quando não existe', () => {
    const tabs = catalogTabs(OFFERED_WIDGET_KINDS, []);
    expect(pickTab(tabs, 'volei')?.family.id).toBe('volei');
    expect(pickTab(tabs, 'xadrez')?.family.id).toBe('futebol');
    expect(pickTab(tabs, undefined)?.family.id).toBe('futebol');
  });
});

describe('esporte do widget', () => {
  it('widget novo da aba grava o primeiro esporte da família que o tipo aceita', () => {
    expect(sportForNewWidget('live_list', 'basquete')).toBe('basketball');
    expect(sportForNewWidget('live_list', 'futebol')).toBe('football');
    expect(sportForNewWidget('live_list', undefined)).toBeNull();
    expect(sportForNewWidget('match_card', 'basquete')).toBe('basketball');
    expect(sportForNewWidget('match_card', undefined)).toBe('football');
    expect(sportForNewWidget('ai_context', 'futebol')).toBeNull();
  });

  it('trocar o tipo mantém o esporte quando o novo aceita', () => {
    expect(sportOnKindChange('standings', 'nba')).toBe('nba');
    expect(sportOnKindChange('live_list', null)).toBeNull();
    expect(sportOnKindChange('standings', null)).toBe('football');
    expect(sportOnKindChange('standings', 'mma')).toBe('football');
    expect(sportOnKindChange('athlete_profile', 'formula-1')).toBe('formula-1');
    expect(sportOnKindChange('ai_context', 'nba')).toBeNull();
    expect(defaultSport('live_list')).toBeNull();
  });

  it('coluna Esporte: o esporte gravado, o único do tipo ou todos', () => {
    expect(widgetFamily('live_list', { sport: 'nba' })?.id).toBe('basquete');
    expect(widgetFamily('live_list', {})).toBeNull();
    expect(widgetFamily('standings', { competitionId: 'x' })?.id).toBe('futebol');
    expect(widgetFamily('standings', { sport: 'volleyball' })?.id).toBe('volei');
    expect(widgetFamily('ai_context', {})?.id).toBe('futebol');
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

  it('busca de entidade: o esporte escolhido nos tipos de vários esportes, o do tipo nos outros', () => {
    expect(searchSport('live_list', 'nba')).toBe('nba');
    expect(searchSport('live_list', null)).toBeNull();
    expect(searchSport('match_card', 'volleyball')).toBe('volleyball');
    expect(searchSport('ai_context', null)).toBe('football');
  });

  it('seletor do tipo: só os esportes que ele aceita', () => {
    const sports = sportChoices([], 'standings').map((c) => c.sport);
    expect(sports).toContain('afl');
    expect(sports).toContain('formula-1');
    expect(sports).not.toContain('mma');
  });
});
