/**
 * Ações das chaves trocadas no painel (#1087): só admin, só segredos do painel, formato do provedor antes de cifrar,
 * nunca texto puro, e o valor nunca aparece no banco em claro, no histórico, na resposta nem no log.
 */
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdmin = vi.fn();
const query = vi.fn();
const settingsSecrets = vi.fn();
const refreshPanelSecrets = vi.fn(async () => []);
const fetchMock = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: () => requireAdmin() }));
vi.mock('@/lib/auth/db', () => ({
  pool: {
    query: (...a: unknown[]) => query(...a),
    connect: async () => ({ query: (...a: unknown[]) => query(...a), release: () => {} }),
  },
}));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));
vi.mock('@/lib/ops/panel-secrets', async () => {
  const real = await vi.importActual<typeof import('@/lib/ops/panel-secrets')>('@/lib/ops/panel-secrets');
  return {
    ...real,
    settingsSecrets: () => settingsSecrets(),
    refreshPanelSecrets: () => refreshPanelSecrets(),
  };
});

const { resealSecrets, resetSecret, saveSecret, testSecret } = await import('./secret-actions');

const KEK = 'k'.repeat(40);
const box = new SettingsSecretBox([KEK]);
const API_KEY = 'a1b2c3d4'.repeat(4);
const OPENAI = 'sk-proj-chaveNovaDoPainel1234567890';

/** O banco: `rows` responde às leituras de linhas cifradas e do relato de KEK; as gravações ficam em `query`. */
function db(
  opts: {
    sealed?: { key: string; value: string }[];
    kek?: { service: string; configured: boolean; value?: string | null }[];
  } = {},
) {
  query.mockImplementation(async (sql: string) => {
    if (/like '%\\_SEALED'/.test(sql)) return { rows: opts.sealed ?? [] };
    if (/key = 'SETTINGS_KEK'/.test(sql)) return { rows: opts.kek ?? [] };
    return { rows: [] };
  });
}
const calls = (re: RegExp) =>
  query.mock.calls.filter(([sql]) => re.test(sql as string)).map(([, params]) => params as unknown[]);
const settingWrites = () => calls(/insert into ops\.runtime_setting \(/);
const logWrites = () => calls(/insert into ops\.runtime_setting_log/);
const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  [requireAdmin, query, settingsSecrets, fetchMock, refreshPanelSecrets].forEach((m) => m.mockReset());
  refreshPanelSecrets.mockResolvedValue([]);
  requireAdmin.mockResolvedValue({ email: 'teste.admin@galaxie.test' });
  settingsSecrets.mockReturnValue(box);
  vi.stubGlobal('fetch', fetchMock);
  errorLog.mockClear();
  db();
});
afterEach(() => vi.unstubAllGlobals());

/** Nada do valor em lugar nenhum fora do cifrado. */
function expectNoLeak(value: string, result: unknown) {
  expect(JSON.stringify(query.mock.calls)).not.toContain(value);
  expect(JSON.stringify(result)).not.toContain(value);
  expect(JSON.stringify(errorLog.mock.calls)).not.toContain(value);
}

describe('só admin e só segredos do painel', () => {
  it('sem sessão de admin nada é lido, testado nem gravado', async () => {
    requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(saveSecret('APISPORTS_KEY', API_KEY)).rejects.toThrow('NEXT_REDIRECT');
    await expect(resetSecret('APISPORTS_KEY')).rejects.toThrow('NEXT_REDIRECT');
    await expect(testSecret('APISPORTS_KEY', API_KEY)).rejects.toThrow('NEXT_REDIRECT');
    await expect(resealSecrets()).rejects.toThrow('NEXT_REDIRECT');
    expect(query).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'SETTINGS_KEK',
    'BETTER_AUTH_SECRET',
    'ADMIN_KEY_HASHES',
    'GALAXIE_DEMO_KEY',
    'WEBHOOK_SIGNING_SECRET',
    'METRICS_TOKEN',
    'AI_STATUS',
    'NODE_OPTIONS',
  ])('%s: recusada (só no .env ou não é segredo)', async (key) => {
    const res = await saveSecret(key, 'x'.repeat(40));
    expect(res.ok).toBe(false);
    expect((await resetSecret(key)).ok).toBe(false);
    expect(settingWrites()).toEqual([]);
  });
});

describe('gravar', () => {
  it('cifra com a SETTINGS_KEK na linha <CHAVE>_SEALED; histórico só com quem e quando', async () => {
    const res = await saveSecret('OPENAI_API_KEY', `  ${OPENAI}\n`);
    expect(res).toEqual({ ok: true });
    const [write] = settingWrites();
    expect(write![0]).toBe('OPENAI_API_KEY_SEALED');
    expect(write![1]).toMatch(/^enc:s1:/);
    expect(box.open('OPENAI_API_KEY', write![1] as string)).toBe(OPENAI);
    expect(logWrites()).toEqual([
      ['OPENAI_API_KEY_SEALED', 'set', null, '••••••••', 'teste.admin@galaxie.test'],
    ]);
    // nem o cifrado vai para o histórico
    expect(JSON.stringify(logWrites())).not.toContain('enc:s1:');
    expectNoLeak(OPENAI, res);
  });

  it('formato errado do provedor: recusa antes de cifrar, sem devolver o valor', async () => {
    const wrong = 'AIzaChaveDoGoogleNoLugarDaOpenAI123';
    const res = await saveSecret('OPENAI_API_KEY', wrong);
    expect(res.ok).toBe(false);
    expect(settingWrites()).toEqual([]);
    expectNoLeak(wrong, res);
  });

  it('sem a KEK no contêiner: não grava (nunca texto puro)', async () => {
    settingsSecrets.mockReturnValue(null);
    const res = await saveSecret('APISPORTS_KEY', API_KEY);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('SETTINGS_KEK');
    expect(settingWrites()).toEqual([]);
  });

  it('avisa quando um serviço que lê a chave não tem a KEK', async () => {
    db({
      kek: [
        { service: 'live', configured: false },
        { service: 'ingestor', configured: true },
      ],
    });
    const res = await saveSecret('APISPORTS_KEY', API_KEY);
    expect(res.ok).toBe(true);
    expect(res.warning).toContain('Ao vivo');
  });

  it('avisa quando a KEK de um serviço é outra (ou curta) e a chave gravada não vai abrir lá', async () => {
    const other = new SettingsSecretBox(['o'.repeat(40)]).kids;
    db({
      kek: [
        { service: 'live', configured: true, value: JSON.stringify({ kids: other, invalid: false }) },
        { service: 'ingestor', configured: true, value: JSON.stringify({ kids: box.kids, invalid: false }) },
      ],
    });
    const res = await saveSecret('APISPORTS_KEY', API_KEY);
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/não abre/);
    expect(res.warning).toContain('Ao vivo');
    expect(res.warning).not.toContain('Ingestor');
  });

  it('token das sugestões: só pelo cartão do GitHub (que confere a repo)', async () => {
    const token = 'github_pat_' + 'x'.repeat(30);
    const saved = await saveSecret('FEEDBACK_GITHUB_TOKEN', token);
    expect(saved.ok).toBe(false);
    expect((await testSecret('FEEDBACK_GITHUB_TOKEN', token)).ok).toBe(false);
    expect(settingWrites()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('chave lida na partida (API): avisa que vale ao reiniciar', async () => {
    const res = await saveSecret('STRIPE_WEBHOOK_SECRET', 'whsec_abcdefghijklmnop');
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/reiniciar/);
  });

  it('chave da demo: relê na hora', async () => {
    await saveSecret('STRIPE_SECRET_KEY', 'sk_' + 'test_51abcdefghijklmno');
    expect(refreshPanelSecrets).toHaveBeenCalled();
  });

  it('falha do banco: mensagem genérica e só o nome do erro no log', async () => {
    query.mockImplementation(async (sql: string) => {
      if (/insert into ops\.runtime_setting \(/.test(sql)) throw new Error(`falhou com ${API_KEY}`);
      return { rows: [] };
    });
    const res = await saveSecret('APISPORTS_KEY', API_KEY);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(API_KEY);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(API_KEY);
  });
});

describe('voltar ao .env', () => {
  it('apaga a linha cifrada e registra quem e quando', async () => {
    query.mockImplementation(async (sql: string) =>
      /select value from ops\.runtime_setting where key = \$1 for update/.test(sql)
        ? { rows: [{ value: box.seal('APISPORTS_KEY', API_KEY) }] }
        : { rows: [] },
    );
    // o ao vivo (contínuo) só volta ao .env ao reiniciar
    expect(await resetSecret('APISPORTS_KEY')).toEqual({
      ok: true,
      warning: expect.stringContaining('Ao vivo'),
    });
    expect(calls(/delete from ops\.runtime_setting where key/)).toEqual([['APISPORTS_KEY_SEALED']]);
    expect(logWrites()).toEqual([
      ['APISPORTS_KEY_SEALED', 'reset', '••••••••', null, 'teste.admin@galaxie.test'],
    ]);
  });
});

describe('testar antes de salvar', () => {
  it('chama o provedor com a chave candidata no cabeçalho e não grava nada', async () => {
    fetchMock.mockResolvedValue(new Response('{"data":[]}', { status: 200 }));
    const res = await testSecret('OPENAI_API_KEY', OPENAI);
    expect(res).toEqual({ ok: true, test: 'ok' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(url).not.toContain(OPENAI);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${OPENAI}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(settingWrites()).toEqual([]);
  });

  it('recusada ou fora do ar: erro sem o valor', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    const rejected = await testSecret('OPENAI_API_KEY', OPENAI);
    expect(rejected).toMatchObject({ ok: false, test: 'rejected' });
    fetchMock.mockRejectedValue(new Error(`timeout ${OPENAI}`));
    const down = await testSecret('OPENAI_API_KEY', OPENAI);
    expect(down).toMatchObject({ ok: false, test: 'unreachable' });
    expectNoLeak(OPENAI, [rejected, down]);
  });

  it('formato errado nem chega ao provedor; chave sem teste avisa', async () => {
    expect((await testSecret('OPENAI_API_KEY', 'errada')).ok).toBe(false);
    expect((await testSecret('SMTP_HOST', 'smtp.exemplo.test')).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('recifrar', () => {
  it('recifra só o que está com a KEK antiga (ou o legado) e deixa o que não abre', async () => {
    const OLD = 'o'.repeat(40);
    const rotating = new SettingsSecretBox([KEK, OLD]);
    settingsSecrets.mockReturnValue(rotating);
    const old = new SettingsSecretBox([OLD]).seal('APISPORTS_KEY', API_KEY);
    const current = box.seal('OPENAI_API_KEY', OPENAI);
    const lost = new SettingsSecretBox(['z'.repeat(40)]).seal('GEMINI_API_KEY', `AIza${'g'.repeat(35)}`);
    db({
      sealed: [
        { key: 'APISPORTS_KEY_SEALED', value: old },
        { key: 'OPENAI_API_KEY_SEALED', value: current },
        { key: 'GEMINI_API_KEY_SEALED', value: lost },
      ],
    });
    const res = await resealSecrets();
    expect(res.ok).toBe(true);
    const writes = settingWrites();
    expect(writes.map((w) => w[0])).toEqual(['APISPORTS_KEY_SEALED']);
    expect(box.open('APISPORTS_KEY', writes[0]![1] as string)).toBe(API_KEY);
    expectNoLeak(API_KEY, res);
  });
});
