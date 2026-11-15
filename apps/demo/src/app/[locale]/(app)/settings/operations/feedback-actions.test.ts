/**
 * Ações do cartão de sugestões: só admin, confere no GitHub antes de gravar, nunca grava sem cifra e o histórico
 * registra a mudança sem o valor.
 */
import { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdmin = vi.fn();
const query = vi.fn();
const settingsSecrets = vi.fn();
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
vi.mock('@/lib/ops/panel-secrets', () => ({
  settingsSecrets: () => settingsSecrets(),
  containerEnv: () => process.env,
  refreshPanelSecrets: async () => [],
}));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'pt-BR' }));

const { clearFeedbackToken, saveFeedbackGithub, saveSetting } = await import('./actions');

const TOKEN = 'github_pat_novo_1234567890abc';
const box = new SettingsSecretBox(['k'.repeat(40)]);
const REPO = 'galaxie-works/repo-privada';
const repoResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

/** O banco responde a cada consulta; as gravações ficam em `query.mock.calls`. */
function db(rows: { key: string; value: string }[] = []) {
  query.mockImplementation(async (sql: string) => (/where key = any/.test(sql) ? { rows } : { rows: [] }));
}
const calls = (re: RegExp) =>
  query.mock.calls.filter(([sql]) => re.test(sql as string)).map(([, params]) => params as unknown[]);
const settingWrites = () => calls(/insert into ops\.runtime_setting \(/);
const logWrites = () => calls(/insert into ops\.runtime_setting_log/);

beforeEach(() => {
  vi.unstubAllEnvs();
  [requireAdmin, query, settingsSecrets, fetchMock].forEach((m) => m.mockReset());
  requireAdmin.mockResolvedValue({ email: 'teste.admin@galaxie.test' });
  settingsSecrets.mockReturnValue(box);
  fetchMock.mockResolvedValue(repoResponse(200, { private: true }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('FEEDBACK_GITHUB_REPO', '');
  vi.stubEnv('FEEDBACK_GITHUB_TOKEN', '');
  db();
});

describe('só admin', () => {
  it('sem sessão de admin nada é lido nem gravado', async () => {
    requireAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(saveFeedbackGithub({ repo: REPO, token: TOKEN })).rejects.toThrow('NEXT_REDIRECT');
    await expect(clearFeedbackToken()).rejects.toThrow('NEXT_REDIRECT');
    expect(query).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('salvar o token', () => {
  it('confere no GitHub e grava cifrado, com o histórico sem o valor', async () => {
    expect(await saveFeedbackGithub({ repo: REPO, token: `  ${TOKEN}\n` })).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.github.com/repos/${REPO}`);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);

    const sealedWrite = settingWrites().find((p) => p[0] === 'FEEDBACK_GITHUB_TOKEN_SEALED')!;
    expect(sealedWrite[1]).toMatch(/^enc:s1:/);
    const everything = JSON.stringify(query.mock.calls);
    expect(everything).not.toContain(TOKEN);

    const log = logWrites().find((p) => p[0] === 'FEEDBACK_GITHUB_TOKEN_SEALED')!;
    expect(log).toEqual([
      'FEEDBACK_GITHUB_TOKEN_SEALED',
      'set',
      null,
      '••••••••',
      'teste.admin@galaxie.test',
    ]);
    expect(JSON.stringify(logWrites())).not.toContain('enc:s1:');
  });

  it.each([
    [200, { private: false }, 'não é privada'],
    [401, {}, 'recusou o token'],
    [404, {}, 'não enxerga'],
    [500, {}, 'confirmar com o GitHub'],
  ])('GitHub %i: recusa e não grava nada', async (status, body, text) => {
    fetchMock.mockResolvedValue(repoResponse(status, body));
    const res = await saveFeedbackGithub({ repo: REPO, token: TOKEN });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(text);
    expect(settingWrites()).toEqual([]);
    expect(logWrites()).toEqual([]);
  });

  it('sem KEK recusa antes de falar com o GitHub (nunca grava texto puro)', async () => {
    settingsSecrets.mockReturnValue(null);
    const res = await saveFeedbackGithub({ repo: REPO, token: TOKEN });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('SETTINGS_KEK');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(settingWrites()).toEqual([]);
  });

  it('token sem repo em lugar nenhum: pede a repo', async () => {
    const res = await saveFeedbackGithub({ repo: '', token: TOKEN });
    expect(res.error).toContain('repositório');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(settingWrites()).toEqual([]);
  });

  it('token em branco mantém o atual e confere a repo nova com ele', async () => {
    vi.stubEnv('FEEDBACK_GITHUB_TOKEN', 'github_pat_do_env_0987654321');
    expect(await saveFeedbackGithub({ repo: REPO, token: '' })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(settingWrites().map((p) => p[0])).toEqual(['FEEDBACK_GITHUB_REPO']);
  });

  it('repo fora do formato é recusada sem chamar o GitHub', async () => {
    const res = await saveFeedbackGithub({ repo: '../x', token: TOKEN });
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('o erro do GitHub ou do banco não vai para a tela', async () => {
    query.mockRejectedValue(new Error(`detalhe interno ${TOKEN}`));
    const res = await saveFeedbackGithub({ repo: REPO, token: TOKEN });
    expect(res.ok).toBe(false);
    expect(res.error).not.toContain('detalhe interno');
  });
});

describe('remover o token', () => {
  it('apaga a linha e registra sem o valor', async () => {
    query.mockImplementation(async (sql: string) =>
      /select value from ops\.runtime_setting/.test(sql)
        ? { rows: [{ value: 'enc:v1:antigo' }] }
        : { rows: [] },
    );
    expect(await clearFeedbackToken()).toEqual({ ok: true });
    expect(logWrites()).toEqual([
      ['FEEDBACK_GITHUB_TOKEN_SEALED', 'reset', '••••••••', null, 'teste.admin@galaxie.test'],
    ]);
  });
});

describe('as vias genéricas do painel não mexem no token', () => {
  it('saveSetting recusa a chave cifrada e o segredo do env', async () => {
    expect((await saveSetting('FEEDBACK_GITHUB_TOKEN_SEALED', TOKEN)).ok).toBe(false);
    expect((await saveSetting('FEEDBACK_GITHUB_TOKEN', TOKEN)).ok).toBe(false);
    expect(settingWrites()).toEqual([]);
  });

  it('o liga/desliga passa pela via normal, com histórico', async () => {
    expect((await saveSetting('FEEDBACK_ENABLED', 'off')).ok).toBe(true);
    expect(logWrites()[0]).toEqual(['FEEDBACK_ENABLED', 'set', null, 'off', 'teste.admin@galaxie.test']);
  });
});
