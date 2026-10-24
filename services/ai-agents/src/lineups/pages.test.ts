import { describe, expect, it } from 'vitest';
import {
  embeddedJsonText,
  htmlToLines,
  LINEUP_USER_AGENT,
  memoryPageStore,
  OfficialPageReader,
  parseRobots,
  robotsAllows,
  type PageRenderer,
} from './pages.js';

const PLATFORM = { website: 'https://plataforma.exemplo', officialDomains: ['grupo.exemplo/tv'] };
const NOW = new Date('2026-10-24T12:00:00Z');

type Route = { status?: number; body?: string; location?: string };

/** fetch falso: rotas por URL; guarda as chamadas (URL e cabeçalhos). */
function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
    const r = routes[url] ?? { status: 404, body: '' };
    return new Response(r.body ?? '', {
      status: r.status ?? (r.location ? 302 : 200),
      headers: r.location ? { location: r.location } : { 'content-type': 'text/html' },
    });
  };
  return { fn, calls };
}

const reader = (
  routes: Record<string, Route>,
  extra: Partial<ConstructorParameters<typeof OfficialPageReader>[0]> = {},
) => {
  const f = fakeFetch(routes);
  const sleeps: number[] = [];
  const store = memoryPageStore();
  const r = new OfficialPageReader({
    fetch: f.fn,
    store,
    now: () => NOW,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { r, calls: f.calls, sleeps, store };
};

const card = (n: number) =>
  `<html><body><h2>Plano Exemplo ${n}</h2><p>R$ 99,90 por mês</p>${'<p>texto do plano</p>'.repeat(60)}</body></html>`;

describe('robots.txt', () => {
  it('usa o grupo com o nosso nome; senão o *; a regra mais longa vence', () => {
    const txt =
      'User-agent: *\nDisallow: /privado\nAllow: /privado/planos\n\nUser-agent: OutroRobo\nDisallow: /';
    const rules = parseRobots(txt);
    expect(robotsAllows(rules, '/planos')).toBe(true);
    expect(robotsAllows(rules, '/privado/x')).toBe(false);
    expect(robotsAllows(rules, '/privado/planos/tv')).toBe(true);
    const ours = parseRobots(
      'User-agent: *\nDisallow:\n\nUser-agent: GalaxieSports\nDisallow: /planos\nCrawl-delay: 10',
    );
    expect(robotsAllows(ours, '/planos')).toBe(false);
    expect(ours.crawlDelay).toBe(10);
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /*.pdf$'), '/tabela.pdf')).toBe(false);
  });
});

describe('conteúdo da página', () => {
  it('HTML vira linhas (blocos), sem scripts; o JSON embutido vira texto', () => {
    expect(htmlToLines('<div>Plano A</div><p>R$ 1,00</p><script>x()</script><br>Canal&nbsp;Exemplo')).toBe(
      'Plano A\nR$ 1,00\nCanal Exemplo',
    );
    expect(
      embeddedJsonText(
        '<script type="application/json">{"planos":[{"nome":"Plano A","canais":["Canal Exemplo","https://x"]}]}</script>',
      ),
    ).toEqual(['Plano A\nCanal Exemplo']);
  });
});

describe('leitor da página oficial', () => {
  it('só domínio oficial: fora dele nem busca', async () => {
    const { r, calls } = reader({});
    expect((await r.read('https://comparador.exemplo/planos', PLATFORM)).status).toBe('off_domain');
    expect(calls).toEqual([]);
  });

  it('lê o HTML estático com o User-Agent do projeto, respeitando o robots.txt e o intervalo por host', async () => {
    const { r, calls, sleeps } = reader({
      'https://plataforma.exemplo/robots.txt': { body: 'User-agent: *\nDisallow: /restrito' },
      'https://plataforma.exemplo/planos': { body: card(1) },
      'https://plataforma.exemplo/planos/2': { body: card(2) },
    });
    const a = await r.read('https://plataforma.exemplo/planos', PLATFORM);
    expect([a.status, a.via, a.hash?.length]).toEqual(['ok', 'static', 64]);
    expect(a.content?.text).toContain('Plano Exemplo 1');
    expect(calls.every((c) => c.headers['user-agent'] === LINEUP_USER_AGENT)).toBe(true);
    await r.read('https://plataforma.exemplo/planos/2', PLATFORM);
    // robots.txt uma vez por origem; espera entre requisições ao mesmo host
    expect(calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(1);
    expect(sleeps.length).toBeGreaterThan(0);
    expect((await r.read('https://plataforma.exemplo/restrito/x', PLATFORM)).status).toBe('robots');
  });

  it('cache dentro da validade não busca de novo; hash diferente na releitura acusa mudança', async () => {
    const routes: Record<string, Route> = { 'https://plataforma.exemplo/planos': { body: card(1) } };
    const { r, calls, store } = reader(routes);
    await r.read('https://plataforma.exemplo/planos', PLATFORM);
    const n = calls.length;
    const cached = await r.read('https://plataforma.exemplo/planos', PLATFORM);
    expect([cached.fromCache, calls.length]).toEqual([true, n]);
    routes['https://plataforma.exemplo/planos'] = { body: card(9) };
    const again = new OfficialPageReader({
      fetch: fakeFetch(routes).fn,
      store,
      now: () => new Date(NOW.getTime() + 30 * 86_400_000),
      sleep: async () => undefined,
    });
    const changed = await again.read('https://plataforma.exemplo/planos', PLATFORM);
    expect([changed.fromCache, changed.hashChanged]).toEqual([false, true]);
  });

  it('login, senha ou captcha: não burla, a página fica bloqueada', async () => {
    const { r } = reader({
      'https://plataforma.exemplo/a': { body: '<form><input type="password"></form>' },
      'https://plataforma.exemplo/b': { body: '<div class="g-recaptcha"></div>' },
      'https://plataforma.exemplo/c': { status: 403 },
      'https://plataforma.exemplo/d': { location: 'https://plataforma.exemplo/login?next=/d' },
      'https://plataforma.exemplo/login?next=/d': { body: 'Entre na sua conta' },
    });
    for (const p of ['a', 'b', 'c', 'd'])
      expect((await r.read(`https://plataforma.exemplo/${p}`, PLATFORM)).status, p).toBe('blocked');
  });

  it('redirecionamento para fora dos domínios oficiais para a leitura', async () => {
    const { r } = reader({
      'https://plataforma.exemplo/planos': { location: 'https://outro.exemplo/planos' },
      'https://grupo.exemplo/tv/planos': { body: card(1) },
      'https://plataforma.exemplo/grupo': { location: 'https://grupo.exemplo/tv/planos' },
    });
    expect((await r.read('https://plataforma.exemplo/planos', PLATFORM)).status).toBe('off_domain');
    // domínio oficial extra (com caminho) vale
    expect((await r.read('https://plataforma.exemplo/grupo', PLATFORM)).status).toBe('ok');
  });

  it('ordem: estático → JSON embutido → navegador (só se configurado)', async () => {
    const shell =
      '<html><body><div id="app">Carregando</div><script type="application/json">{"planos":[{"nome":"Plano A","grade":["Canal Exemplo"]}]}</script></body></html>';
    const enough = (c: { text: string; sections: { text: string }[] }) =>
      [c.text, ...c.sections.map((s) => s.text)].join('\n').includes('Canal Exemplo');
    const routes = { 'https://plataforma.exemplo/planos': { body: shell } };
    const { r } = reader(routes);
    const json = await r.read('https://plataforma.exemplo/planos', PLATFORM, { enough });
    expect([json.status, json.via]).toEqual(['ok', 'embedded_json']);

    const empty = { 'https://plataforma.exemplo/planos': { body: '<html><body>Carregando</body></html>' } };
    const noBrowser = await reader(empty).r.read('https://plataforma.exemplo/planos', PLATFORM, {
      enough,
      force: true,
    });
    expect([noBrowser.status, noBrowser.via]).toEqual(['needs_render', null]);

    const renders: string[] = [];
    const renderer: PageRenderer = {
      render: async (url, opts) => {
        renders.push(`${url}|${opts.userAgent}`);
        return {
          finalUrl: url,
          status: 200,
          text: 'Plano A\nR$ 99,90',
          sections: [{ label: 'Plano A', text: 'Esportes\nCanal Exemplo' }],
          blocked: false,
        };
      },
      close: async () => undefined,
    };
    const rendered = await reader(empty, { renderer }).r.read('https://plataforma.exemplo/planos', PLATFORM, {
      enough,
    });
    expect([rendered.status, rendered.via, rendered.content?.sections[0]?.label]).toEqual([
      'ok',
      'render',
      'Plano A',
    ]);
    expect(renders).toEqual([`https://plataforma.exemplo/planos|${LINEUP_USER_AGENT}`]);
  });

  it('teto de páginas por execução', async () => {
    const { r } = reader({ 'https://plataforma.exemplo/1': { body: card(1) } }, { maxPages: 1 });
    await r.read('https://plataforma.exemplo/1', PLATFORM);
    const second = await r.read('https://plataforma.exemplo/2', PLATFORM);
    expect([second.status, second.error]).toEqual(['error', 'limite de 1 página(s) por execução']);
  });

  it('rebrand: o site que redireciona para outro domínio devolve o domínio novo', async () => {
    const { r } = reader({
      'https://marca-antiga.exemplo': { location: 'https://www.marca-nova.exemplo/home' },
      'https://www.marca-nova.exemplo/home': { body: 'ok' },
      'https://plataforma.exemplo': { location: 'https://www.plataforma.exemplo/inicio' },
      'https://www.plataforma.exemplo/inicio': { body: 'ok' },
    });
    expect(await r.rebrandTarget('https://marca-antiga.exemplo')).toBe('https://www.marca-nova.exemplo/');
    // redirecionar dentro do mesmo domínio não é rebrand
    expect(await r.rebrandTarget('https://plataforma.exemplo')).toBeNull();
  });
});
