// Gerado por packages/ai-ledger/scripts/gen-prices.mjs a partir de config/ai-pricing.yaml. Não edite à mão.
import type { PricingData } from './pricing-data.js';

export const PRICING_DATA: PricingData = {
  schema_version: 1,
  providers: {
    openai: {
      checked_at: '2026-10-21',
      source: 'https://developers.openai.com/api/docs/pricing',
    },
    anthropic: {
      checked_at: '2026-10-25',
      source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    },
    gemini: {
      checked_at: '2026-11-19',
      source: 'https://aistudio.google.com/docs/pricing',
    },
    deepseek: {
      checked_at: '2026-11-11',
      source: 'https://api-docs.deepseek.com/quick_start/pricing',
    },
  },
  search: {
    web_search_usd_per_call: 0.01,
    gemini_grounding_usd_per_query: 0.014,
  },
  anthropic_cache_write_multiplier: 1.25,
  models: [
    {
      model: 'gpt-6-astra',
      input: 10,
      cached_input: 1,
      output: 50,
    },
    {
      model: 'gpt-6.1-sol',
      input: 2,
      cached_input: 0.1,
      output: 10,
    },
    {
      model: 'gpt-6-sol',
      input: 2,
      cached_input: 0.2,
      output: 10,
    },
    {
      model: 'gpt-6-luna',
      input: 0.1,
      cached_input: 0.01,
      output: 0.5,
    },
    {
      model: 'gpt-5.6-sol',
      input: 4,
      cached_input: 0.4,
      output: 20,
    },
    {
      model: 'gpt-5.6-terra',
      input: 2,
      cached_input: 0.2,
      output: 12,
    },
    {
      model: 'gpt-5.6-luna',
      input: 0.2,
      cached_input: 0.02,
      output: 1.2,
    },
    {
      model: 'gpt-5.5',
      input: 5,
      cached_input: 0.5,
      output: 30,
    },
    {
      model: 'gpt-5.4',
      input: 2.5,
      cached_input: 0.25,
      output: 15,
    },
    {
      model: 'gpt-5.4-mini',
      input: 0.75,
      cached_input: 0.075,
      output: 4.5,
    },
    {
      model: 'gpt-5.4-nano',
      input: 0.2,
      cached_input: 0.02,
      output: 1.25,
    },
    {
      model: 'gpt-5-mini',
      input: 0.25,
      cached_input: 0.025,
      output: 2,
    },
    {
      model: 'gpt-4.1-mini',
      input: 0.4,
      cached_input: 0.1,
      output: 1.6,
    },
    {
      model: 'claude-fable-5-1',
      input: 10,
      cached_input: 0.25,
      output: 50,
    },
    {
      model: 'claude-mythos-5-1',
      input: 10,
      cached_input: 0.25,
      output: 50,
    },
    {
      model: 'claude-fable-5',
      input: 10,
      cached_input: 1,
      output: 50,
    },
    {
      model: 'claude-opus-5-5',
      input: 4,
      cached_input: 0.2,
      output: 20,
    },
    {
      model: 'claude-sonnet-5-5',
      input: 2,
      cached_input: 0.2,
      output: 10,
    },
    {
      model: 'claude-haiku-5-5',
      input: 0.1,
      cached_input: 0.01,
      output: 0.5,
    },
    {
      model: 'claude-opus-5',
      input: 5,
      cached_input: 0.5,
      output: 25,
    },
    {
      model: 'claude-opus-4-8',
      input: 5,
      cached_input: 0.5,
      output: 25,
    },
    {
      model: 'claude-opus-4-7',
      input: 5,
      cached_input: 0.5,
      output: 25,
    },
    {
      model: 'claude-opus-4-6',
      input: 5,
      cached_input: 0.5,
      output: 25,
    },
    {
      model: 'claude-sonnet-5',
      input: 2,
      cached_input: 0.2,
      output: 10,
    },
    {
      model: 'claude-sonnet-4-6',
      input: 3,
      cached_input: 0.3,
      output: 15,
    },
    {
      model: 'claude-haiku-4-5',
      input: 1,
      cached_input: 0.1,
      output: 5,
    },
    {
      model: 'gemini-4-argon',
      input: 2,
      output: 10,
    },
    {
      model: 'gemini-4-argon',
      from: '2026-12-01',
      input: 4,
      output: 20,
    },
    {
      model: 'gemini-3.8-flash',
      input: 0.75,
      output: 3.75,
    },
    {
      model: 'gemini-3.8-flash',
      from: '2027-01-01',
      input: 1.5,
      output: 7.5,
    },
    {
      model: 'gemini-3.6-flash',
      input: 0.75,
      output: 3.75,
    },
    {
      model: 'gemini-3.6-flash',
      from: '2027-01-01',
      input: 1.5,
      output: 7.5,
    },
    {
      model: 'gemini-3.5-flash-lite',
      input: 0.3,
      output: 2.5,
    },
    {
      model: 'gemini-3.1-pro-preview',
      input: 2,
      output: 12,
    },
    {
      model: 'gemini-3.1-flash-lite',
      input: 0.25,
      output: 1.5,
    },
    {
      model: 'deepseek-flash',
      input: 0.3,
      cached_input: 0.006,
      output: 1.2,
    },
    {
      model: 'deepseek-v4-pro',
      input: 1.32,
      cached_input: 0.044,
      output: 3.96,
    },
  ],
};
