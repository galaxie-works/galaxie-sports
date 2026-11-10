import { validateSettingKey } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';

import { ceilCredits, creditsFor } from './credits.js';
import { parseCosmosSettings } from './settings.js';
import { ledgerCsv, toClientEntry, type LedgerEntry } from './statement.js';
import { toClientWallet, utcDayStart } from './wallet.js';

describe('creditsFor', () => {
  const base = { multiplier: 1, creditUsd: 0.01, minCredits: 1 };

  it('converte custo × multiplicador ÷ valor do crédito, arredondando para cima', () => {
    expect(creditsFor({ ...base, costUsd: 0.05 })).toBe(5);
    expect(creditsFor({ ...base, costUsd: 0.050001 })).toBe(5.001);
    expect(creditsFor({ ...base, costUsd: 0.05, multiplier: 2 })).toBe(10);
  });

  it('nunca fica abaixo do mínimo da função', () => {
    expect(creditsFor({ ...base, costUsd: 0.001 })).toBe(1);
    expect(creditsFor({ ...base, costUsd: 0.001, minCredits: 1.7 })).toBe(1.7);
  });

  it('sem custo ou sem valor do crédito configurado, cobra o mínimo', () => {
    expect(creditsFor({ ...base, costUsd: null })).toBe(1);
    expect(creditsFor({ ...base, costUsd: 0.5, creditUsd: null })).toBe(1);
    expect(creditsFor({ ...base, costUsd: 0 })).toBe(1);
  });

  it('ceilCredits não cobra milésimo a mais por erro de ponto flutuante', () => {
    expect(ceilCredits(0.1 + 0.2)).toBe(0.3);
    expect(ceilCredits(1.0001)).toBe(1.001);
  });
});

describe('flags da Cosmos', () => {
  it('o painel aceita o teto e o valor do crédito, e recusa 0', () => {
    expect(validateSettingKey('COSMOS_DAILY_USD_CEILING', '40')).toMatchObject({ ok: true });
    expect(validateSettingKey('COSMOS_DAILY_USD_CEILING', 'unlimited')).toMatchObject({ ok: true });
    expect(validateSettingKey('COSMOS_DAILY_USD_CEILING', '0').ok).toBe(false);
    expect(validateSettingKey('COSMOS_CREDIT_USD', '0.00014')).toMatchObject({ ok: true });
    expect(validateSettingKey('COSMOS_CREDIT_USD', '').ok).toBe(true);
    expect(validateSettingKey('COSMOS_CREDIT_USD', '0').ok).toBe(false);
  });

  it('interpreta unlimited e vazio', () => {
    expect(parseCosmosSettings({ ceiling: '25', creditUsd: null })).toEqual({
      dailyUsdCeiling: 25,
      creditUsd: null,
    });
    expect(parseCosmosSettings({ ceiling: 'unlimited', creditUsd: '0.0002' })).toEqual({
      dailyUsdCeiling: null,
      creditUsd: 0.0002,
    });
  });
});

describe('visão do cliente', () => {
  const entry: LedgerEntry = {
    id: '01900000-0000-7000-8000-000000000001',
    kind: 'usage',
    credits: -1.7,
    balanceBefore: 10,
    balanceAfter: 8.3,
    functionName: 'moderation.batch',
    scope: 'chat:abc',
    userId: null,
    note: '=HYPERLINK("x")',
    createdAt: new Date('2026-11-10T12:00:00Z'),
    tokensIn: 2000,
    tokensCached: 0,
    tokensOut: 300,
    costUsd: 0.0012,
    model: 'modelo-x',
  };

  it('tira tokens, custo e modelo do lançamento e o multiplicador da carteira', () => {
    const client = toClientEntry(entry);
    expect(client).not.toHaveProperty('costUsd');
    expect(client).not.toHaveProperty('tokensIn');
    expect(client).not.toHaveProperty('model');
    expect(
      toClientWallet({
        tenantId: 't',
        available: 1,
        reserved: 0,
        receivedTotal: 1,
        status: 'active',
        trialGranted: false,
        multiplier: 3,
      }),
    ).not.toHaveProperty('multiplier');
  });

  it('CSV do cliente sem custo; o da Galaxie com custo; texto não vira fórmula', () => {
    const client = ledgerCsv([entry]);
    expect(client.split('\n')[0]).toBe(
      'created_at,kind,scope,function,user,credits,balance_before,balance_after,note',
    );
    expect(client).not.toContain('0.0012');
    expect(client).toContain(
      `2026-11-10T12:00:00.000Z,usage,chat:abc,moderation.batch,,-1.7,10,8.3,"'=HYPERLINK(""x"")"`,
    );
    const staff = ledgerCsv([entry], { staff: true });
    expect(staff.split('\n')[0]).toContain('cost_usd,model');
    expect(staff).toContain('2000,0,300,0.0012,modelo-x');
  });
});

it('o dia do teto vira à meia-noite UTC', () => {
  expect(utcDayStart(new Date('2026-11-10T02:30:00-03:00')).toISOString()).toBe('2026-11-10T00:00:00.000Z');
  expect(utcDayStart(new Date('2026-11-10T22:30:00-03:00')).toISOString()).toBe('2026-11-11T00:00:00.000Z');
});
