import { SETTINGS } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';

import { settingsNavGroups } from '@/components/admin/settings-nav';
import { LOCALES } from '@/lib/i18n/config';
import { clientDictionary } from '@/lib/i18n/dictionary';

import {
  buildSettingsIndex,
  currentSettingsTabs,
  fallbackSettingPage,
  searchSettings,
  searchSettingsPages,
  settingScore,
  settingsSearchPages,
  type SettingPageResolver,
} from './settings-search';

function setup(locale: (typeof LOCALES)[number] = 'pt-BR', resolve?: SettingPageResolver) {
  const t = clientDictionary(locale);
  const pages = settingsSearchPages(settingsNavGroups(t.ops.nav), currentSettingsTabs(t));
  return { t, pages, index: buildSettingsIndex({ t: t.ops, pages, ...(resolve ? { resolve } : {}) }) };
}

const keys = (list: { key: string }[]) => list.map((e) => e.key);

describe('índice da busca de ajustes', () => {
  it.each(LOCALES)('tem todo ajuste do registro, com rótulo, caminho e âncora (%s)', (locale) => {
    const { index } = setup(locale);
    expect(keys(index).sort()).toEqual(SETTINGS.map((s) => s.key).sort());
    for (const e of index) {
      expect(e.label, e.key).not.toBe('');
      expect(e.crumbs.length, e.key).toBeGreaterThanOrEqual(2);
      expect(e.href, e.key).toMatch(new RegExp(`^/ajustes/[^#]+#${e.key}$`));
    }
  });

  it('usa o resolvedor recebido (o settingPage do #1070)', () => {
    const { index } = setup('pt-BR', (key) =>
      key === 'AI_DAILY_USD_BUDGET' ? { item: 'ai', href: '/ajustes/ia', group: 'platform' } : undefined,
    );
    expect(keys(index)).toEqual(['AI_DAILY_USD_BUDGET']);
    expect(index[0]!.crumbs).toEqual(['Plataforma', 'IA interna']);
    expect(index[0]!.href).toBe('/ajustes/ia#AI_DAILY_USD_BUDGET');
  });

  it('o resolvedor provisório leva cada seção à página de hoje', () => {
    expect(fallbackSettingPage('LIVE_FEATURED')).toMatchObject({
      href: '/ajustes/operacao',
      section: 'live',
    });
    expect(fallbackSettingPage('NAO_EXISTE')).toBeUndefined();
  });
});

describe('busca de ajustes', () => {
  const { index, pages } = setup();

  it('"teto ia" acha o teto diário da IA', () => {
    const top = keys(searchSettings(index, 'teto ia', 3));
    expect(top[0]).toBe('AI_DAILY_USD_BUDGET');
    expect(top).toContain('AI_AGENT_USD_BUDGETS');
  });

  it('"AI_DAILY" acha pela chave técnica, antes do resto', () => {
    const hits = keys(searchSettings(index, 'AI_DAILY'));
    expect(hits.slice(0, 2).sort()).toEqual(['AI_DAILY_TOKEN_BUDGET', 'AI_DAILY_USD_BUDGET']);
  });

  it('a chave exata vem primeiro', () => {
    expect(keys(searchSettings(index, 'ai_daily_usd_budget'))[0]).toBe('AI_DAILY_USD_BUDGET');
  });

  it('"minutos pos jogo" acha os intervalos do pós-jogo', () => {
    // 11 esportes (a Fórmula 1 não tem fechamento): os intervalos vêm antes de qualquer outro ajuste
    const hits = searchSettings(index, 'minutos pos jogo', 11);
    expect(hits).toHaveLength(11);
    expect(hits.every((e) => /^POSTGAME_.+_MIN$/.test(e.key))).toBe(true);
  });

  it('"youtube" acha a chave e a cota do YouTube', () => {
    const hits = keys(searchSettings(index, 'youtube', 20));
    expect(hits).toContain('YOUTUBE_API_KEY');
    expect(hits.length).toBeGreaterThan(1);
  });

  it('não diferencia acento nem maiúscula', () => {
    const a = keys(searchSettings(index, 'orçamento'));
    expect(a).toContain('AI_DAILY_USD_BUDGET');
    expect(keys(searchSettings(index, 'ORCAMENTO'))).toEqual(a);
    expect(keys(searchSettings(index, 'Pós-Jogo', 50))).toEqual(keys(searchSettings(index, 'pos jogo', 50)));
  });

  it('casa no começo das palavras ("ia" não casa dentro de "diária")', () => {
    const entry = index.find((e) => e.key === 'POSTGAME_MAX_CALLS_DAY')!;
    expect(settingScore(entry, 'ia')).toBeNull();
  });

  it('busca no idioma da tela', () => {
    const en = setup('en').index;
    expect(keys(searchSettings(en, 'budget'))).toContain('AI_DAILY_USD_BUDGET');
    expect(searchSettings(en, 'orçamento')).toEqual([]);
  });

  it('Páginas acha itens do menu e abas internas', () => {
    expect(searchSettingsPages(pages, 'pedidos').map((p) => p.id)).toContain('lineup:pedidos');
    expect(searchSettingsPages(pages, 'ia')[0]!.id).toBe('ai');
    expect(searchSettingsPages(pages, '')).toEqual([]);
  });
});
