/**
 * O painel de Operação mostra os padrões do registro (@galaxie/runtime-config) como "padrão do código":
 * eles têm de ser os mesmos dos agentes.
 */
import { WTW_COUNTRIES } from '@galaxie/where-to-watch';
import { AI_DEFAULT_MODELS, AI_PROVIDERS, settingDef, WTW_MARKET_CODES } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DAILY_TOKEN_BUDGET, DEFAULT_MODELS, LLM_PROVIDERS } from './llm/config.js';
import { DEFAULT_MARKET_WEIGHTS, parseMarketWeights } from './related/budget.js';
import { DEFAULT_CREATOR_MIN_SUBSCRIBERS } from './related/channels.js';
import { relatedPolicyFromEnv } from './related/priority.js';
import {
  DEFAULT_QUOTA_RESERVE_PERCENT,
  DEFAULT_RESEARCH_HOURS,
  DEFAULT_YOUTUBE_DAILY_QUOTA,
  DEFAULT_YOUTUBE_SEARCH_DAILY_QUOTA,
} from './related/run.js';
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
