import { SETTINGS, isSecret } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';

import { settingText } from '@/components/ops/format';
import { LOCALES } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionary';

import { SETTINGS_VIEWS } from './panel-tabs';
import { settingHref, settingPage } from './setting-page';

describe('cada ajuste em um lugar só (#1070)', () => {
  it('todo ajuste do registro tem exatamente uma página, num bloco que ela mostra', () => {
    expect(SETTINGS.length).toBeGreaterThanOrEqual(167);
    for (const def of SETTINGS) {
      const page = settingPage(def.key);
      expect(page, def.key).toBeDefined();
      expect(SETTINGS_VIEWS[page!.item] as readonly string[], def.key).toContain(page!.block);
    }
    expect(settingPage('NAO_EXISTE')).toBeUndefined();
  });

  it.each(LOCALES)('%s: todo ajuste tem rótulo próprio (não a chave técnica)', (locale) => {
    const T = getDictionary(locale).ops;
    for (const def of SETTINGS) {
      const { label } = settingText(T, def);
      expect.soft(label.trim(), def.key).not.toBe('');
      expect.soft(label, `${locale} ${def.key}`).not.toBe(def.key);
    }
  });

  it('A3: os modelos de IA moram em IA interna', () => {
    for (const key of [
      'AI_MATCH_CHANNEL_MODEL',
      'AI_MATCH_CHANNEL_PROVIDER',
      'AI_RIGHTS_MODEL',
      'AI_RIGHTS_PROVIDER',
    ]) {
      expect(settingPage(key), key).toEqual({ item: 'ai', block: 'ai' });
    }
    for (const def of SETTINGS.filter((d) => /^AI_.*(MODEL|PROVIDER)/.test(d.key))) {
      expect(settingPage(def.key)?.item, def.key).toBe('ai');
    }
  });

  it('A4: as chaves ficam em Credenciais (menos as que o cartão da feature grava)', () => {
    for (const key of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
      'YOUTUBE_API_KEY',
      'APISPORTS_KEY',
      'DEEPSEEK_API_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'COSMOS_OPENAI_API_KEY',
      'SETTINGS_KEK',
    ]) {
      expect(settingPage(key), key).toEqual({ item: 'credentials', block: 'credentials' });
    }
    const elsewhere = SETTINGS.filter((d) => isSecret(d) && settingPage(d.key)?.item !== 'credentials').map(
      (d) => d.key,
    );
    expect(elsewhere).toEqual(['FEEDBACK_GITHUB_TOKEN']);
  });

  it('LINEUP_* em Grades e ofertas; Ao vivo e Pós-jogo separados; plano de cada esporte no Fornecedor', () => {
    for (const def of SETTINGS.filter((d) => d.key.startsWith('LINEUP_'))) {
      expect(settingPage(def.key), def.key).toEqual({
        item: 'lineup',
        block: 'lineup',
        query: 'aba=ajustes',
      });
    }
    const live = SETTINGS.filter((d) => d.section === 'live');
    expect(live.filter((d) => settingPage(d.key)?.item === 'live')).toHaveLength(6);
    expect(live.filter((d) => settingPage(d.key)?.item === 'postgame')).toHaveLength(23);
    expect(settingPage('APISPORTS_PLAN_NBA')).toEqual({ item: 'provider', block: 'sports' });
    expect(settingPage('APISPORTS_PLAN')).toEqual({ item: 'provider', block: 'provider' });
  });

  it('o link "ver em…" abre a página já na linha', () => {
    expect(settingHref('AI_RIGHTS_MODEL')).toBe('/ajustes/ia#AI_RIGHTS_MODEL');
    expect(settingHref('YOUTUBE_API_KEY')).toBe('/ajustes/credenciais#YOUTUBE_API_KEY');
    expect(settingHref('POSTGAME_NBA_MIN')).toBe('/ajustes/pos-jogo#POSTGAME_NBA_MIN');
    expect(settingHref('NAO_EXISTE')).toBeNull();
  });

  it('LINEUP_*: o link abre Grades e ofertas na aba Ajustes, onde a linha está', () => {
    const lineup = SETTINGS.filter((d) => d.key.startsWith('LINEUP_'));
    expect(lineup.length).toBeGreaterThan(0);
    for (const def of lineup) {
      expect(settingHref(def.key), def.key).toBe(`/ajustes/grades?aba=ajustes#${def.key}`);
    }
  });
});
