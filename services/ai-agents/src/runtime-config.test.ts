/**
 * O painel de Operação mostra os padrões do registro (@galaxie/runtime-config) como "padrão do código":
 * eles têm de ser os mesmos dos agentes.
 */
import { WTW_COUNTRIES } from '@galaxie/where-to-watch';
import {
  AI_DEFAULT_MODELS,
  AI_PROVIDERS,
  parseAgentUsdBudgets as parseAgentUsdBudgetsPanel,
  settingDef,
  validateSettingKey,
  WTW_MARKET_CODES,
} from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_USD_BUDGETS,
  DEFAULT_DAILY_TOKEN_BUDGET,
  DEFAULT_DAILY_USD_BUDGET,
  DEFAULT_MAX_SEARCHES_PER_CALL,
  DEFAULT_MODELS,
  LLM_PROVIDERS,
  parseAgentUsdBudgets,
} from './llm/config.js';
import { DEFAULT_MARKET_WEIGHTS, parseMarketWeights } from './related/budget.js';
import { DEFAULT_CREATOR_MIN_SUBSCRIBERS } from './related/channels.js';
import { relatedPolicyFromEnv } from './related/priority.js';
import {
  DEFAULT_QUOTA_RESERVE_PERCENT,
  DEFAULT_RESEARCH_HOURS,
  DEFAULT_YOUTUBE_DAILY_QUOTA,
  DEFAULT_YOUTUBE_SEARCH_DAILY_QUOTA,
} from './related/run.js';
import { LINEUP_PROMPT_LIMITS } from './lineups/prompt.js';
import { DEFAULT_DAILY_USD_PER_MARKET, DEFAULT_MIN_RELEVANCE } from './wtw/relevance.js';

const dflt = (key: string) => settingDef(key)?.default;

describe('registro do painel × padrões dos agentes', () => {
  it('provedores e modelos por nível', () => {
    expect([...AI_PROVIDERS]).toEqual([...LLM_PROVIDERS]);
    for (const tier of ['light', 'standard', 'research'] as const)
      for (const p of LLM_PROVIDERS) expect(AI_DEFAULT_MODELS[tier][p]).toBe(DEFAULT_MODELS[p][tier]);
  });

  it('orçamento, Onde Assistir e conteúdo relacionado', () => {
    expect(dflt('AI_DAILY_TOKEN_BUDGET')).toBe(String(DEFAULT_DAILY_TOKEN_BUDGET));
    expect(dflt('AI_DAILY_USD_BUDGET')).toBe(String(DEFAULT_DAILY_USD_BUDGET));
    expect(dflt('AI_AGENT_USD_BUDGETS')).toBe(DEFAULT_AGENT_USD_BUDGETS);
    expect(dflt('AI_MAX_SEARCHES_PER_CALL')).toBe(String(DEFAULT_MAX_SEARCHES_PER_CALL));
    expect(dflt('WTW_MIN_RELEVANCE')).toBe(String(DEFAULT_MIN_RELEVANCE));
    expect(dflt('WTW_DAILY_USD_PER_MARKET')).toBe(String(DEFAULT_DAILY_USD_PER_MARKET));
    expect([...WTW_MARKET_CODES]).toEqual([...WTW_COUNTRIES]);
    expect(dflt('YOUTUBE_DAILY_QUOTA')).toBe(String(DEFAULT_YOUTUBE_DAILY_QUOTA));
    expect(dflt('YOUTUBE_QUOTA_RESERVE_PERCENT')).toBe(String(DEFAULT_QUOTA_RESERVE_PERCENT));
    expect(dflt('RELATED_RESEARCH_HOURS')).toBe(String(DEFAULT_RESEARCH_HOURS));
    expect(dflt('RELATED_CREATOR_MIN_SUBSCRIBERS')).toBe(String(DEFAULT_CREATOR_MIN_SUBSCRIBERS));
    expect(dflt('YOUTUBE_SEARCH_DAILY_QUOTA')).toBe(String(DEFAULT_YOUTUBE_SEARCH_DAILY_QUOTA));
    const p = relatedPolicyFromEnv({});
    expect(dflt('RELATED_MIN_RELEVANCE')).toBe(String(p.minRelevance));
    expect(dflt('RELATED_MAX_VIDEOS')).toBe(String(p.maxVideos));
    expect(dflt('RELATED_MAX_SEARCHES_PER_EVENT')).toBe(String(p.maxSearchesPerEvent));
    expect(dflt('RELATED_MAX_SEARCHES_PER_RUN')).toBe(String(p.maxSearchesPerRun));
    expect(dflt('RELATED_CHANNEL_ENOUGH')).toBe(String(p.channelEnough));
    expect(dflt('RELATED_CHANNEL_REFRESH_MINUTES')).toBe(String(p.channelRefreshMinutes));
    expect(dflt('RELATED_REVALIDATE_MINUTES')).toBe(String(p.revalidateMinutes));
    expect(dflt('RELATED_RESERVE_MAX_PERCENT')).toBe(String(p.reserveMaxPercent));
    expect(dflt('RELATED_SEARCH_AFTER_KICKOFF_MINUTES')).toBe(String(p.searchAfterKickoffMinutes));
    expect(dflt('RELATED_LOOKBACK_HOURS')).toBe(String(p.lookbackHours));
    expect(dflt('RELATED_SECOND_SEARCH_MINUTES')).toBe(String(p.secondSearchMinutes));
    expect(parseMarketWeights(dflt('RELATED_MARKET_WEIGHTS'))).toEqual(DEFAULT_MARKET_WEIGHTS);
  });
});

describe('tetos por agente: o painel e os agentes leem o mesmo formato', () => {
  it('os dois parsers concordam e o padrão passa na validação do painel', () => {
    for (const raw of [
      DEFAULT_AGENT_USD_BUDGETS,
      'Lineups=2; wtw=0.5 channels@v1=1',
      '',
      'wtw',
      'a=-1',
      'a=1,,b=2',
    ])
      expect(parseAgentUsdBudgetsPanel(raw)).toEqual(parseAgentUsdBudgets(raw));
    expect(validateSettingKey('AI_AGENT_USD_BUDGETS', DEFAULT_AGENT_USD_BUDGETS)).toMatchObject({ ok: true });
    expect(validateSettingKey('AI_AGENT_USD_BUDGETS', 'lineups:2')).toMatchObject({ ok: false });
  });
});

describe('tetos do texto das páginas da grade (LINEUP_PROMPT_MAX_CHARS, LINEUP_PAGE_MAX_CHARS)', () => {
  it('o registro do painel tem o padrão e a faixa do código', () => {
    for (const lim of [LINEUP_PROMPT_LIMITS.total, LINEUP_PROMPT_LIMITS.page]) {
      expect(settingDef(lim.key)).toMatchObject({
        section: 'wtw',
        type: 'int',
        services: ['agents'],
        default: String(lim.default),
        min: lim.min,
        max: lim.max,
      });
      expect(validateSettingKey(lim.key, String(lim.min))).toMatchObject({ ok: true });
      expect(validateSettingKey(lim.key, String(lim.max + 1))).toMatchObject({ ok: false });
      expect(validateSettingKey(lim.key, 'muito')).toMatchObject({ ok: false });
    }
  });
});
