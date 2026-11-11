import { describe, expect, it } from 'vitest';
import { llmSettingsFromEnv, reviewLlmEnv, rightsLlmEnv } from './config.js';
import { createLlmClient } from './factory.js';

describe('provedor da pesquisa de direitos (AI_RIGHTS_PROVIDER)', () => {
  it('gemini com GEMINI_API_KEY e o modelo de pesquisa padrão; os AI_MODEL_* do outro provedor não valem', () => {
    const env = {
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'o',
      GEMINI_API_KEY: 'g',
      AI_MODEL_RESEARCH: 'gpt-6.1-sol',
      AI_RIGHTS_PROVIDER: 'gemini',
    };
    const s = llmSettingsFromEnv(rightsLlmEnv(env));
    expect(s).toMatchObject({ provider: 'gemini', apiKey: 'g' });
    expect(s.models.research).toBe('gemini-3.8-flash');
    expect(
      llmSettingsFromEnv(rightsLlmEnv({ ...env, AI_RIGHTS_MODEL: 'gemini-4-argon' })).models.research,
    ).toBe('gemini-4-argon');
    expect(createLlmClient({ env: rightsLlmEnv(env) }).settings.provider).toBe('gemini');
  });

  it('sem AI_RIGHTS_PROVIDER: o mesmo provedor e modelos dos demais agentes', () => {
    const env = { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'a', AI_MODEL_RESEARCH: 'claude-opus-5-5' };
    expect(rightsLlmEnv(env)).toBe(env);
    expect(llmSettingsFromEnv(rightsLlmEnv(env)).models.research).toBe('claude-opus-5-5');
  });
});

describe('AI_PROVIDER=deepseek (#1088)', () => {
  it('chave DEEPSEEK_API_KEY e os modelos padrão; o cliente sai com orçamento', () => {
    const env = { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd' };
    expect(llmSettingsFromEnv(env)).toMatchObject({
      provider: 'deepseek',
      apiKey: 'd',
      models: { light: 'deepseek-flash', standard: 'deepseek-flash', research: 'deepseek-v4-pro' },
    });
    expect(createLlmClient({ env, bands: false }).settings.provider).toBe('deepseek');
  });

  it('agente com provedor próprio pode escolher deepseek (revisão de sugestões)', () => {
    const env = {
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'o',
      DEEPSEEK_API_KEY: 'd',
      AI_REVIEW_PROVIDER: 'deepseek',
    };
    expect(llmSettingsFromEnv(reviewLlmEnv(env))).toMatchObject({ provider: 'deepseek', apiKey: 'd' });
  });

  it('sem a chave: erro de configuração ao montar o cliente', () => {
    expect(() => createLlmClient({ env: { AI_PROVIDER: 'deepseek' }, bands: false })).toThrow(
      /DEEPSEEK_API_KEY/,
    );
  });
});
