import {
  APISPORTS_APIS,
  POSTGAME_APIS,
  SETTINGS,
  isSecret,
  planKey,
  postgameIntervalKey,
  postgameModeKey,
  settingDef,
} from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';

import { clientDictionary } from '@/lib/i18n/dictionary';
import { settingPage } from '@/lib/ops/setting-page';
import type { OpsSetting } from '@/lib/ops/types';

import {
  AI_MODEL_KEYS,
  CREDENTIALS_HREF,
  PLAN_SPORT_KEYS,
  POSTGAME_SPORT_KEYS,
  bulkPostgameChanges,
  canReset,
  capPercent,
  changedFilterRows,
  controlKind,
  credentialGroup,
  draftChanges,
  githubIntegrationState,
  groupCredentials,
  historyHref,
  isChanged,
  isRequired,
  aiProviderKey,
  maskSecret,
  secretSource,
  planSaveOps,
  postgameOnValue,
  resettableKeys,
  rulerMarks,
  spendParts,
  sportsByLabel,
} from './logic';

const setting = (key: string, over: Partial<OpsSetting> = {}): OpsSetting => ({
  key,
  section: settingDef(key)!.section,
  value: settingDef(key)!.default,
  source: 'default',
  defaultValue: settingDef(key)!.default,
  envValue: null,
  override: null,
  overrideInvalid: false,
  updatedBy: null,
  updatedAt: null,
  configured: false,
  reportedAt: null,
  nextRuns: [],
  ...over,
});

describe('selo "alterado" e "Voltar ao padrão"', () => {
  it('alterado só quando o valor efetivo vem do painel', () => {
    expect(isChanged({ source: 'db', overrideInvalid: false })).toBe(true);
    expect(isChanged({ source: 'env', overrideInvalid: false })).toBe(false);
    expect(isChanged({ source: 'default', overrideInvalid: false })).toBe(false);
    // sobrescrita inválida é ignorada pelo serviço: não conta como alterado
    expect(isChanged({ source: 'default', overrideInvalid: true })).toBe(false);
  });

  it('voltar ao padrão com sobrescrita gravada, válida ou não', () => {
    expect(canReset({ source: 'db', overrideInvalid: false })).toBe(true);
    expect(canReset({ source: 'env', overrideInvalid: true })).toBe(true);
    expect(canReset({ source: 'env', overrideInvalid: false })).toBe(false);
  });

  it('obrigatório só sem padrão e sem aceitar vazio', () => {
    expect(isRequired(settingDef('FEEDBACK_GITHUB_REPO')!)).toBe(false); // aceita vazio
    expect(isRequired(settingDef('APISPORTS_PLAN')!)).toBe(false); // tem padrão
    expect(isRequired(settingDef('APISPORTS_KEY')!)).toBe(false); // segredo: fica em Credenciais
  });
});

describe('controle pelo tipo do registro', () => {
  it('off/on vira switch, poucas opções toggle, listas e "herdar" select', () => {
    expect(controlKind(settingDef('FEEDBACK_ENABLED')!)).toBe('switch');
    expect(controlKind(settingDef(postgameModeKey('football'))!)).toBe('toggle');
    expect(controlKind(settingDef('APISPORTS_PLAN')!)).toBe('select');
    expect(controlKind(settingDef('APISPORTS_PLAN_NBA')!)).toBe('select');
  });

  it('número com unidade vira campo com unidade; agenda e texto ficam no campo simples', () => {
    expect(controlKind(settingDef('POSTGAME_FOOTBALL_MIN')!, 'min')).toBe('unit');
    expect(controlKind(settingDef('POSTGAME_FOOTBALL_MIN')!)).toBe('input');
    expect(controlKind(settingDef('SCHEDULE_QUOTA_STATUS')!)).toBe('cron');
    expect(controlKind(settingDef('FEEDBACK_GITHUB_REPO')!)).toBe('input');
  });
});

describe('pós-jogo: Desligar todos / Ligar todos', () => {
  const all = POSTGAME_APIS.map((api) => setting(postgameModeKey(api)));

  it('desligar grava off só nas chaves ligadas', () => {
    const settings = all.map((s, i) => (i < 3 ? { ...s, value: 'off' } : s));
    const changes = bulkPostgameChanges(settings, {}, false);
    expect(Object.keys(changes)).toHaveLength(POSTGAME_APIS.length - 3);
    expect(Object.values(changes).every((v) => v === 'off')).toBe(true);
    expect(changes[postgameModeKey(POSTGAME_APIS[0]!)]).toBeUndefined();
  });

  it('ligar volta ao modo do .env (ou ao fechamento) só nas desligadas', () => {
    const settings = [
      setting(postgameModeKey('football'), { value: 'off', envValue: 'tempo-real' }),
      setting(postgameModeKey('nba'), { value: 'off', envValue: 'off', defaultValue: 'off' }),
      setting(postgameModeKey('rugby'), { value: 'fechamento' }),
    ];
    expect(bulkPostgameChanges(settings, {}, true)).toEqual({
      [postgameModeKey('football')]: 'tempo-real',
      [postgameModeKey('nba')]: 'fechamento',
    });
  });

  it('o rascunho conta como o estado atual', () => {
    const settings = [setting(postgameModeKey('football'), { value: 'fechamento' })];
    expect(bulkPostgameChanges(settings, { [postgameModeKey('football')]: 'off' }, false)).toEqual({});
  });

  it('nenhuma chave nova: o pós-jogo cobre 11 esportes, sem a Fórmula 1', () => {
    expect(POSTGAME_APIS).toHaveLength(11);
    expect(Object.keys(bulkPostgameChanges(all, {}, false))).toHaveLength(11);
    expect(postgameOnValue({ envValue: null, defaultValue: 'fechamento' })).toBe('fechamento');
  });

  it('o "Salvar" grava só o que difere do efetivo', () => {
    const settings = [
      setting('POSTGAME_FOOTBALL_MIN', { value: '15' }),
      setting('POSTGAME_NBA_MIN', { value: '15' }),
    ];
    expect(
      draftChanges(settings, { POSTGAME_FOOTBALL_MIN: '15', POSTGAME_NBA_MIN: '20', NOPE: '1' }),
    ).toEqual({
      POSTGAME_NBA_MIN: '20',
    });
  });
});

describe('linha do esporte: voltar ao padrão e "herda o padrão"', () => {
  const [a, b, c] = APISPORTS_APIS.map((api) => planKey(api));

  it('o "Voltar ao padrão do .env" da linha apaga só as chaves com sobrescrita (válida ou não)', () => {
    expect(
      resettableKeys([
        setting(a!, { source: 'db', value: 'pro' }),
        setting(b!, { overrideInvalid: true, override: 'x' }),
        setting(c!, { source: 'env', value: 'free' }),
      ]),
    ).toEqual([a, b]);
  });

  it('"herda o padrão" apaga a sobrescrita em vez de gravar vazio; o resto é gravado', () => {
    const settings = [
      setting(a!, { source: 'db', value: 'pro' }),
      setting(b!, { source: 'db', value: 'pro' }),
      setting(c!, { source: 'db', value: 'pro', envValue: 'free' }),
    ];
    expect(planSaveOps(settings, { [a!]: '', [b!]: 'mega', [c!]: '' })).toEqual({
      reset: [a],
      // com valor no .env, apagar voltaria a ele: herdar exige gravar o vazio
      save: { [b!]: 'mega', [c!]: '' },
    });
  });
});

describe('filtro "Alterados no painel": uma linha por esporte no pós-jogo', () => {
  const api = POSTGAME_APIS[0]!;
  const mode = postgameModeKey(api);
  const minutes = postgameIntervalKey(api);
  const row = (modeSource: OpsSetting['source'], minSource: OpsSetting['source']) =>
    changedFilterRows([
      setting('APISPORTS_PLAN'),
      setting(mode, { source: modeSource }),
      setting(minutes, { source: minSource }),
    ]);

  it('modo e intervalo viram uma linha com o id do modo, alterada se qualquer um foi alterado', () => {
    expect(row('default', 'db')).toEqual([
      { key: 'APISPORTS_PLAN', source: 'default' },
      { key: mode, source: 'db' },
    ]);
    expect(row('db', 'env')).toEqual([
      { key: 'APISPORTS_PLAN', source: 'default' },
      { key: mode, source: 'db' },
    ]);
    expect(row('env', 'default')).toEqual([
      { key: 'APISPORTS_PLAN', source: 'default' },
      { key: mode, source: 'env' },
    ]);
  });

  it('sem o modo na página, a linha leva o id do intervalo', () => {
    expect(changedFilterRows([setting(minutes, { source: 'db' })])).toEqual([{ key: minutes, source: 'db' }]);
  });
});

describe('esportes em ordem alfabética do idioma', () => {
  const order = (locale: 'pt-BR' | 'en' | 'es-AR') =>
    sportsByLabel(APISPORTS_APIS, clientDictionary(locale).ops.apis).map((s) => s.label);

  it('pt-BR', () => {
    expect(order('pt-BR')).toEqual([
      'Basquete',
      'Beisebol',
      'Fórmula 1',
      'Futebol',
      'Futebol americano',
      'Futebol australiano',
      'Handebol',
      'Hóquei',
      'MMA',
      'NBA',
      'Rúgbi',
      'Vôlei',
    ]);
  });

  it('en', () => {
    expect(order('en')).toEqual([
      'American football',
      'Australian football',
      'Baseball',
      'Basketball',
      'Football',
      'Formula 1',
      'Handball',
      'Hockey',
      'MMA',
      'NBA',
      'Rugby',
      'Volleyball',
    ]);
  });

  it('es', () => {
    expect(order('es-AR')).toEqual([
      'Básquet',
      'Béisbol',
      'Fórmula 1',
      'Fútbol',
      'Fútbol americano',
      'Fútbol australiano',
      'Handball',
      'Hockey',
      'MMA',
      'NBA',
      'Rugby',
      'Vóley',
    ]);
  });
});

describe('segredos e credenciais', () => {
  it('nunca mais que os 4 últimos caracteres', () => {
    expect(maskSecret('sk-live-abcdef1234')).toBe('•••• 1234');
    expect(maskSecret('1234')).toBe('•••• 1234');
    expect(maskSecret(null)).toBe('••••');
    expect(maskSecret('  ')).toBe('••••');
    expect(maskSecret('sk-live-abcdef1234')).not.toContain('abcdef');
  });

  it('seções na ordem fixa e, dentro delas, por rótulo', () => {
    expect(credentialGroup('APISPORTS_KEY')).toBe('sports');
    expect(credentialGroup('GEMINI_API_KEY')).toBe('ai');
    expect(credentialGroup('STRIPE_SECRET_KEY')).toBe('payments');
    expect(credentialGroup('SMTP_HOST')).toBe('infra');
    const groups = groupCredentials([
      { key: 'SMTP_HOST', label: 'SMTP' },
      { key: 'OPENAI_API_KEY', label: 'OpenAI' },
      { key: 'ANTHROPIC_API_KEY', label: 'Anthropic' },
      { key: 'APISPORTS_KEY', label: 'api-sports' },
    ]);
    expect(groups.map((g) => g.group)).toEqual(['sports', 'ai', 'infra']);
    expect(groups[1]!.items.map((i) => i.label)).toEqual(['Anthropic', 'OpenAI']);
  });
});

describe('IA interna', () => {
  it('marcas da régua com as pontas', () => {
    expect(rulerMarks(0, 10)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(rulerMarks(0, 50, 3)).toEqual([0, 25, 50]);
    expect(rulerMarks(5, 5)).toEqual([5]);
  });

  it('parte do teto e os agentes que mais gastaram', () => {
    expect(capPercent(2.29, 3)).toBe(76);
    expect(capPercent(5, 3)).toBe(100);
    expect(capPercent(1, null)).toBeNull();
    const { parts, others } = spendParts([
      { agent: 'context', costUsd: 1.12 },
      { agent: 'wtw', costUsd: 0.74 },
      { agent: 'review', costUsd: 0.31 },
      { agent: 'related', costUsd: 0.12 },
      { agent: 'idle', costUsd: 0 },
    ]);
    expect(parts.map((p) => p.agent)).toEqual(['context', 'wtw', 'review']);
    expect(others).toBe(0.12);
  });
});

describe('Credenciais: "Testar" só no provedor ativo', () => {
  it('a chave de API do provedor de AI_PROVIDER', () => {
    expect(aiProviderKey('openai')).toBe('OPENAI_API_KEY');
    expect(aiProviderKey('anthropic')).toBe('ANTHROPIC_API_KEY');
    expect(aiProviderKey('gemini')).toBe('GEMINI_API_KEY');
    expect(aiProviderKey(null)).toBeNull();
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'])
      expect(settingDef(key)).toBeTruthy();
  });
});

describe('cartão do GitHub', () => {
  const token = { tokenInPanel: false, tokenUnreadable: false, envTokenConfigured: false };
  it('conectado, atenção ou desconectado', () => {
    expect(githubIntegrationState('org/repo', { ...token, tokenInPanel: true })).toBe('connected');
    expect(githubIntegrationState('org/repo', { ...token, envTokenConfigured: true })).toBe('connected');
    expect(githubIntegrationState('org/repo', { ...token, tokenInPanel: true, tokenUnreadable: true })).toBe(
      'attention',
    );
    expect(githubIntegrationState('org/repo', token)).toBe('attention');
    expect(githubIntegrationState(null, token)).toBe('disconnected');
  });
});

describe('cada bloco na página do PR 1 (#1070)', () => {
  it('modelos de IA só em IA interna (A3), pós-jogo no Pós-jogo, plano de cada esporte no Fornecedor', () => {
    for (const key of AI_MODEL_KEYS) expect(settingPage(key), key).toEqual({ item: 'ai', block: 'ai' });
    for (const key of POSTGAME_SPORT_KEYS) {
      expect(settingPage(key), key).toEqual({ item: 'postgame', block: 'postgame' });
    }
    for (const key of PLAN_SPORT_KEYS)
      expect(settingPage(key), key).toEqual({ item: 'provider', block: 'sports' });
  });

  it('a lista de credenciais é a de Credenciais (A4), menos o token gravado no cartão das sugestões', () => {
    const outside = SETTINGS.filter((d) => isSecret(d) && settingPage(d.key)?.block !== 'credentials');
    expect(outside.map((d) => d.key)).toEqual(['FEEDBACK_GITHUB_TOKEN']);
  });

  it('de onde vem a chave secreta (#1087)', () => {
    const s = (configured: boolean, inPanel = false, unreadable = false) =>
      secretSource({ configured, secret: { inPanel, unreadable } });
    expect(s(true, true)).toBe('panel');
    expect(s(false, true)).toBe('panel');
    expect(s(true)).toBe('env');
    expect(s(true, true, true)).toBe('unreadable');
    expect(s(false)).toBe('none');
    expect(secretSource({ configured: true })).toBe('env');
  });

  it('os links vão para as rotas novas', () => {
    expect(historyHref('AI_RIGHTS_MODEL')).toBe('/ajustes/historico?chave=AI_RIGHTS_MODEL');
    expect(CREDENTIALS_HREF).toBe('/ajustes/credenciais');
  });
});
