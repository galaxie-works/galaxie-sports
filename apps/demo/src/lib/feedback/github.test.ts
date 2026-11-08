import { describe, expect, it } from 'vitest';

import { FeedbackGithub, FeedbackGithubError, feedbackGithubConfig } from './github';

type Call = { method: string; url: string; body: unknown };

/** fetch falso: responde pela rota, guarda as chamadas. */
function fakeFetch(routes: Record<string, (body: unknown) => Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    const method = init.method ?? 'GET';
    calls.push({ method, url, body });
    const path = url.replace('https://api.github.com/repos/o/r', '');
    const handler = routes[`${method} ${path}`];
    return handler ? handler(body) : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('configuração', () => {
  it('exige token e repo (sem padrão: nunca cai na repo pública)', () => {
    expect(feedbackGithubConfig({})).toBeNull();
    expect(feedbackGithubConfig({ FEEDBACK_GITHUB_TOKEN: 't' })).toBeNull();
    expect(feedbackGithubConfig({ FEEDBACK_GITHUB_TOKEN: 't', FEEDBACK_GITHUB_REPO: '../x' })).toBeNull();
    expect(feedbackGithubConfig({ FEEDBACK_GITHUB_TOKEN: 't', FEEDBACK_GITHUB_REPO: 'o/r' })).toEqual({
      token: 't',
      repo: 'o/r',
    });
  });
});

describe('repo privada', () => {
  it('recusa repo pública', async () => {
    const { impl } = fakeFetch({ 'GET ': () => json({ private: false }) });
    const gh = new FeedbackGithub({ token: 't', repo: 'o/r' }, impl);
    await expect(gh.ensurePrivate()).rejects.toMatchObject({ code: 'not_private' });
  });

  it('recusa quando não dá para ler a repo', async () => {
    const { impl } = fakeFetch({ 'GET ': () => json({ message: 'Bad credentials' }, 401) });
    const gh = new FeedbackGithub({ token: 't', repo: 'o/r' }, impl);
    await expect(gh.ensurePrivate()).rejects.toBeInstanceOf(FeedbackGithubError);
  });

  it('confere de novo depois de 10 minutos', async () => {
    let now = 0;
    const { impl, calls } = fakeFetch({ 'GET ': () => json({ private: true }) });
    const gh = new FeedbackGithub({ token: 't', repo: 'o/r' }, impl, () => now);
    now = 1_000_000;
    await gh.ensurePrivate();
    await gh.ensurePrivate();
    expect(calls).toHaveLength(1);
    now += 11 * 60_000;
    await gh.ensurePrivate();
    expect(calls).toHaveLength(2);
  });
});

describe('issue e rótulo', () => {
  it('cria o rótulo que falta e abre a issue com o rótulo', async () => {
    const { impl, calls } = fakeFetch({
      'POST /labels': () => json({}, 201),
      'POST /issues': () => json({ number: 7 }, 201),
    });
    const gh = new FeedbackGithub({ token: 'tok', repo: 'o/r' }, impl);
    const label = await gh.ensureLabel('bug');
    expect(label).toBe('Reportar um problema');
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/labels'))?.body).toMatchObject({
      name: 'Reportar um problema',
    });
    expect(await gh.createIssue('t', 'b', label)).toBe(7);
    expect(calls.at(-1)!.body).toEqual({ title: 't', body: 'b', labels: ['Reportar um problema'] });
  });

  it('rótulo existente não é recriado', async () => {
    const { impl, calls } = fakeFetch({
      [`GET /labels/${encodeURIComponent('Sugerir um recurso')}`]: () => json({}),
    });
    const gh = new FeedbackGithub({ token: 't', repo: 'o/r' }, impl);
    await gh.ensureLabel('feature');
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });
});
