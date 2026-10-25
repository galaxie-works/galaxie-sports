/**
 * Configuração literal da IA: AI_STATUS / AI_AGENT_STATUS (on|off) e tetos "unlimited" ou número,
 * com 0 inválido (não liga, não desliga, não tira o teto).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@galaxie/db';
import { loadLlmClient } from '../cli/common.js';
import { MemoryTokenBudgetStore, TokenBudget } from './budget.js';
import { describeAiState, llmSettingsFromEnv, parseAgentStatus, parseAgentUsdBudgets } from './config.js';
import { AiDisabledError, BudgetExceededError, LlmError } from './errors.js';
import { budgetPolicyFromSettings, withTokenBudget } from './factory.js';
import { FakeLlmClient } from './fake.js';
import { aiStatusLines } from './status.js';
import type { LlmJsonRequest } from './types.js';

const req = (purpose = 'wtw:event:1:BR'): LlmJsonRequest => ({
  tier: 'light',
  system: 'sistema',
  messages: [{ role: 'user', content: 'oi' }],
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer'],
    properties: { answer: { type: 'string' } },
  },
  schemaName: 'resposta',
  purpose,
});

afterEach(() => vi.restoreAllMocks());

describe('AI_STATUS e AI_AGENT_STATUS', () => {
  it('padrão ligado; on/off literal; valor desconhecido falha a configuração', () => {
    expect(llmSettingsFromEnv({})).toMatchObject({ status: 'on', agentStatus: {} });
    expect(llmSettingsFromEnv({ AI_STATUS: 'OFF' }).status).toBe('off');
    expect(llmSettingsFromEnv({ AI_AGENT_STATUS: 'Lineups=on, wtw=off' }).agentStatus).toEqual({
      lineups: 'on',
      wtw: 'off',
    });
    expect(() => llmSettingsFromEnv({ AI_STATUS: '0' })).toThrow(/AI_STATUS inválido: 0 \(use on ou off\)/);
    expect(() => llmSettingsFromEnv({ AI_AGENT_STATUS: 'wtw=0' })).toThrow(/AI_AGENT_STATUS inválido/);
    expect(parseAgentStatus('channels@v1=off')).toEqual({ channels: 'off' });
  });

  it('desligada: nenhuma chamada ao provedor, recusa explícita e aviso uma vez por dia', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = new FakeLlmClient([{ data: { answer: 'a' } }]);
    const client = withTokenBudget(fake, { env: { AI_STATUS: 'off' } });
    const err = await client.generateJson(req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiDisabledError);
    expect(err).toBeInstanceOf(BudgetExceededError); // os agentes tratam como orçamento esgotado
    expect((err as Error).message).toMatch(/IA desligada \(AI_STATUS=off\): nenhuma chamada ao LLM/);
    await expect(client.generateJson(req())).rejects.toBeInstanceOf(AiDisabledError);
    expect(fake.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('agente desligado: só ele fica sem IA; os outros seguem', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fake = new FakeLlmClient(() => ({ data: { answer: 'a' } }));
    const client = withTokenBudget(fake, { env: { AI_AGENT_STATUS: 'wtw=off,lineups=on' } });
    const err = await client.generateJson(req('wtw:event:1:BR')).catch((e: unknown) => e);
    expect(err).toMatchObject({ agent: 'wtw' });
    expect((err as Error).message).toMatch(/AI_AGENT_STATUS=wtw=off/);
    await client.generateJson(req('lineups:plans:op:BR'));
    expect(fake.calls).toHaveLength(1);
  });

  it('CLI com a IA desligada: o motivo é o estado (não a falta da chave)', () => {
    expect(loadLlmClient({} as Database, { AI_STATUS: 'off' })).toEqual({
      client: null,
      reason: 'IA desligada (AI_STATUS=off)',
    });
  });
});

describe('tetos: número ou "unlimited"; 0 é inválido', () => {
  it('0 recusado com a mensagem de como desligar', () => {
    for (const env of [
      { AI_DAILY_USD_BUDGET: '0' },
      { AI_DAILY_TOKEN_BUDGET: '0' },
      { AI_DAILY_USD_BUDGET: '0,0' },
    ])
      expect(() => llmSettingsFromEnv(env)).toThrow(/=0 não é válido: use AI_STATUS=off/);
    expect(() => llmSettingsFromEnv({ AI_AGENT_USD_BUDGETS: 'lineups=0,wtw=3' })).toThrow(
      /agente=0 não é válido: use AI_STATUS=off/,
    );
    expect(() => llmSettingsFromEnv({ AI_DAILY_TOKEN_BUDGET: '1.5' })).toThrow(LlmError);
    expect(() => llmSettingsFromEnv({ AI_DAILY_USD_BUDGET: '-1' })).toThrow(/> 0 ou "unlimited"/);
  });

  it('"unlimited" tira o teto, global e por agente', async () => {
    const s = llmSettingsFromEnv({
      AI_DAILY_USD_BUDGET: 'unlimited',
      AI_DAILY_TOKEN_BUDGET: 'Unlimited',
      AI_AGENT_USD_BUDGETS: 'lineups=2,wtw=unlimited',
    });
    expect(s).toMatchObject({ dailyUsdBudget: null, dailyTokenBudget: null });
    expect(s.agentUsdBudgets).toEqual({ lineups: 2, wtw: null });
    expect(parseAgentUsdBudgets('wtw=0')).toBeNull();
    // wtw sem teto próprio: passa mesmo com o gasto do dia acima do que seria o teto
    const store = new MemoryTokenBudgetStore();
    const budget = new TokenBudget(
      store,
      budgetPolicyFromSettings(s),
      () => new Date('2026-10-26T12:00:00Z'),
    );
    await store.record({
      agent: 'wtw',
      purpose: 'wtw:x',
      provider: 'fake',
      model: 'm',
      tier: 'light',
      inputTokens: 0,
      outputTokens: 0,
      webSearches: 0,
      costUsd: 50,
      outcome: 'ok',
      at: new Date('2026-10-26T10:00:00Z'),
    });
    await expect(budget.reserve('wtw', 100, 1)).resolves.toEqual([]);
  });
});

describe('estado literal (logs, CLI, painel)', () => {
  it('desligado · sem limite · limitado com os tetos que existem', () => {
    expect(describeAiState({ status: 'off', usdPerDay: 10 })).toBe('desligado');
    expect(describeAiState({ status: 'on' })).toBe('ligado · sem limite');
    expect(describeAiState({ status: 'on', usdPerDay: 10 })).toBe('ligado · limitado · US$ 10/dia');
    expect(describeAiState({ status: 'on', usdPerDay: 1.5, tokensPerDay: 2_000_000 })).toBe(
      'ligado · limitado · US$ 1,5/dia · 2.000.000 tokens/dia',
    );
  });

  it('relatório da CLI ai:status: global e os agentes configurados', async () => {
    const settings = llmSettingsFromEnv({
      AI_AGENT_STATUS: 'wtw=off',
      AI_AGENT_USD_BUDGETS: 'lineups=2,related=unlimited',
    });
    const budget = new TokenBudget(new MemoryTokenBudgetStore(), budgetPolicyFromSettings(settings));
    expect(await aiStatusLines(budget)).toEqual([
      'IA: ligado · limitado · US$ 10/dia · 2.000.000 tokens/dia (hoje: US$ 0,00)',
      '  lineups: ligado · limitado · US$ 2/dia (hoje: US$ 0,00)',
      '  related: ligado · sem limite (hoje: US$ 0,00)',
      '  wtw: desligado (hoje: US$ 0,00)',
    ]);
    const off = new TokenBudget(
      new MemoryTokenBudgetStore(),
      budgetPolicyFromSettings(llmSettingsFromEnv({ AI_STATUS: 'off' })),
    );
    expect((await aiStatusLines(off, false))[0]).toBe('IA: desligado');
  });

  it('aviso de teto esgotado traz o estado literal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const budget = new TokenBudget(new MemoryTokenBudgetStore(), {
      dailyLimit: null,
      dailyUsdLimit: 0.000001,
    });
    await expect(budget.reserve('wtw', 10, 1)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(String(warn.mock.calls[0]![0])).toMatch(/\(ligado · limitado · US\$ 0/);
  });
});
