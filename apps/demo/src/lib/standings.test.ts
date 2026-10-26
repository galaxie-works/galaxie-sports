import { describe, expect, it } from 'vitest';

import sport from './i18n/messages/sport';
import { winPct, zoneClass, zoneLabel } from './standings';

describe('winPct', () => {
  it('formata como a NFL: três casas, sem o zero à esquerda; empate vale meia vitória', () => {
    expect(winPct(13, 0, 17)).toBe('.765');
    expect(winPct(8, 1, 17)).toBe('.500');
    expect(winPct(17, 0, 17)).toBe('1.000');
    expect(winPct(0, 0, 17)).toBe('.000');
    expect(winPct(0, 0, 0)).toBe('—');
  });
});

describe('zoneClass', () => {
  it('dá uma cor a cada degrau do Brasileirão', () => {
    const tones = ['libertadores_group_stage', 'libertadores_qualifying', 'sudamericana', 'relegation'].map(
      zoneClass,
    );
    expect(tones).toEqual(['bg-primary', 'bg-sky-400', 'bg-orange-500', 'bg-destructive']);
  });

  it('não repete cor entre as zonas de uma mesma liga europeia', () => {
    const ligue1 = [
      'champions_league',
      'champions_league_qualifying',
      'europa_league',
      'conference_league',
      'relegation_playoff',
      'relegation',
    ].map(zoneClass);
    expect(new Set(ligue1).size).toBe(ligue1.length);
  });

  it('lê o texto livre do fornecedor', () => {
    expect(zoneClass('Promotion - CONMEBOL Libertadores (Group Stage: )')).toBe('bg-primary');
    expect(zoneClass('Promotion - Copa Sudamericana (Group Stage: )')).toBe('bg-orange-500');
    expect(zoneClass('Promotion - Champions League (Qualification: )')).toBe('bg-sky-400');
    expect(zoneClass('Relegation')).toBe('bg-destructive');
    // uma palavra só, sem ser código da regra: ainda é o texto do fornecedor
    expect(zoneClass('Rebaixamento')).toBe('bg-destructive');
    expect(zoneClass('Descenso')).toBe('bg-destructive');
  });

  it('sem descrição não pinta; zona desconhecida fica neutra', () => {
    expect(zoneClass(null)).toBe('bg-transparent');
    expect(zoneClass('')).toBe('bg-transparent');
    expect(zoneClass('mystery_zone')).toBe('bg-muted-foreground');
  });
});

describe('zoneLabel', () => {
  const pt = sport['pt-BR'].standings.zones;
  const es = sport['es-AR'].standings.zones;

  it('traduz o código da zona', () => {
    expect(zoneLabel('libertadores_group_stage', pt)).toBe('Libertadores (fase de grupos)');
    expect(zoneLabel('libertadores_qualifying', pt)).toBe('Libertadores (pré-Libertadores)');
    expect(zoneLabel('sudamericana', pt)).toBe('Sul-Americana');
    expect(zoneLabel('relegation', pt)).toBe('Rebaixamento');
    expect(zoneLabel('libertadores_qualifying', es)).toBe('Libertadores (fase previa)');
    expect(zoneLabel('relegation', es)).toBe('Descenso');
    expect(zoneLabel('relegation', sport.en.standings.zones)).toBe('Relegation');
  });

  it('cobre nos três idiomas todos os códigos de zona das regras', () => {
    const codes = [
      'champions_league',
      'champions_league_qualifying',
      'conference_league',
      'elimination',
      'europa_league',
      'europa_league_knockout_playoff',
      'knockout_playoff',
      'libertadores_group_stage',
      'libertadores_qualifying',
      'relegation',
      'relegation_playoff',
      'round_of_16',
      'sudamericana',
      'sudamericana_knockout_playoff',
    ];
    for (const locale of ['pt-BR', 'en', 'es-AR'] as const)
      for (const code of codes) expect(sport[locale].standings.zones[code], `${locale} ${code}`).toBeTruthy();
  });

  it('código desconhecido vira texto, nunca snake_case; texto do fornecedor passa igual', () => {
    expect(zoneLabel('knockout_round_playoff', pt)).toBe('Knockout round playoff');
    expect(zoneLabel('Promotion - CONMEBOL Libertadores', pt)).toBe('Promotion - CONMEBOL Libertadores');
  });
});
