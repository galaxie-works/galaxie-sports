import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CloudflareCdnPurger,
  cloudflarePurgeConfig,
  type CloudflarePurgerOptions,
} from './cloudflare-purger.js';

const ZONE = '0123456789abcdef0123456789abcdef';
const TOKEN = 'token-de-teste-que-nunca-vai-para-o-log';

interface Call {
  url: string;
  init: RequestInit;
  tags: string[];
}

/** fetch simulado: cada chamada responde com o próximo item de `replies` (o último se repete). */
function fakeFetch(replies: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { tags: string[] };
    calls.push({ url: String(url), init: init ?? {}, tags: body.tags });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return reply();
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const okReply = () => Response.json({ success: true, errors: [], result: { id: ZONE } });

function logger() {
  const lines: Array<{ level: string; obj: object; msg?: string | undefined }> = [];
  return {
    lines,
    info: (obj: object, msg?: string) => lines.push({ level: 'info', obj, msg }),
    warn: (obj: object, msg?: string) => lines.push({ level: 'warn', obj, msg }),
  };
}

function purger(
  replies: Array<() => Response | Promise<Response>>,
  extra: Partial<CloudflarePurgerOptions> = {},
) {
  const f = fakeFetch(replies);
  const log = logger();
  const p = new CloudflareCdnPurger({ zoneId: ZONE, token: TOKEN, fetch: f.fetch, logger: log, ...extra });
  return { p, calls: f.calls, log };
}

describe('CloudflareCdnPurger', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-16T12:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('purga por tag na zona, com o token só no Authorization', async () => {
    const { p, calls } = purger([okReply]);
    await p.purgeTags(['event:1', 'event']);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://api.cloudflare.com/client/v4/zones/${ZONE}/purge_cache`);
    expect(calls[0]!.init.method).toBe('POST');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers['user-agent']).toBe('galaxie-sports/0.1');
    // coleções primeiro: cobrem mais respostas
    expect(calls[0]!.tags).toEqual(['event', 'event:1']);
    expect(p.pendingTags).toBe(0);
  });

  it('lotes de no máximo 100 tags, sem repetição e sem tags que a Cloudflare recusa', async () => {
    const { p, calls } = purger([okReply]);
    const tags = Array.from({ length: 250 }, (_, i) => `event:${i}`);
    await p.purgeTags([...tags, 'event:1', 'com espaço', 'a,b']);
    await vi.runAllTimersAsync();
    expect(calls.map((c) => c.tags.length)).toEqual([100, 100, 50]);
    expect(new Set(calls.flatMap((c) => c.tags)).size).toBe(250);
  });

  it('respeita o ritmo do plano Free (5 por minuto): o excedente espera e junta as mudanças seguintes', async () => {
    const { p, calls } = purger([okReply]);
    for (let i = 0; i < 5; i++) {
      await p.purgeTags([`event:${i}`]);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(calls).toHaveLength(5);
    // balde vazio: as próximas mudanças esperam a vez e saem numa chamada só
    await p.purgeTags(['event:10']);
    await p.purgeTags(['event:11', 'event']);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(calls).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(6);
    expect(calls[5]!.tags).toEqual(['event', 'event:10', 'event:11']);
  });

  it('429: o lote volta para a fila e espera o Retry-After', async () => {
    const { p, calls, log } = purger([
      () =>
        new Response(JSON.stringify({ success: false }), { status: 429, headers: { 'retry-after': '30' } }),
      okReply,
    ]);
    await p.purgeTags(['competition:1']);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(p.pendingTags).toBe(1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.tags).toEqual(['competition:1']);
    expect(p.pendingTags).toBe(0);
    expect(log.lines.some((l) => l.level === 'warn' && l.msg?.includes('limite de purge'))).toBe(true);
  });

  it('5xx e falha de rede: tenta de novo com espera crescente, sem lançar', async () => {
    const { p, calls } = purger([
      () => new Response('erro', { status: 502 }),
      () => Promise.reject(new TypeError('fetch failed')),
      okReply,
    ]);
    await expect(p.purgeTags(['standing:1'])).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(3);
    expect(p.pendingTags).toBe(0);
  });

  it('timeout: a chamada é abortada e o lote volta para a fila', async () => {
    const hang = () =>
      new Promise<Response>((_resolve, reject) => {
        const signal = fakeSignal.current;
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const fakeSignal: { current: AbortSignal | undefined } = { current: undefined };
    const calls: string[][] = [];
    const log = logger();
    const p = new CloudflareCdnPurger({
      zoneId: ZONE,
      token: TOKEN,
      timeoutMs: 2_000,
      logger: log,
      fetch: (async (_url: string, init?: RequestInit) => {
        calls.push((JSON.parse(String(init?.body)) as { tags: string[] }).tags);
        fakeSignal.current = init?.signal ?? undefined;
        return calls.length === 1 ? hang() : okReply();
      }) as unknown as typeof fetch,
    });
    await p.purgeTags(['venue:1']);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(log.lines.some((l) => (l.obj as { reason?: string }).reason === 'timeout')).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(2);
    expect(p.pendingTags).toBe(0);
  });

  it('4xx (token sem permissão): descarta o lote, registra o erro da Cloudflare e nunca o token', async () => {
    const { p, calls, log } = purger([
      () =>
        Response.json(
          { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
          { status: 403 },
        ),
    ]);
    await p.purgeTags(['event:1']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(p.pendingTags).toBe(0);
    const warn = log.lines.find((l) => l.level === 'warn');
    expect(warn?.obj).toMatchObject({
      status: 403,
      errors: [{ code: 10000, message: 'Authentication error' }],
    });
    expect(JSON.stringify(log.lines)).not.toContain(TOKEN);
  });

  it('fila cheia: descarta as tags de entidade mais antigas e mantém as de coleção', async () => {
    const { p, calls, log } = purger([okReply], { maxPendingTags: 3, burst: 1 });
    await p.purgeTags(['x']);
    await vi.advanceTimersByTimeAsync(0); // gasta a única chamada do balde
    await p.purgeTags(['event:1', 'event', 'event:2', 'event:3']);
    expect(p.pendingTags).toBe(3);
    expect(log.lines.some((l) => l.level === 'warn' && (l.obj as { dropped?: number }).dropped === 1)).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(12_000);
    expect(calls[1]!.tags).toEqual(['event', 'event:2', 'event:3']);
  });

  it('close espera o envio em andamento e para de agendar', async () => {
    const { p, calls } = purger([okReply], { burst: 1 });
    await p.purgeTags(['a']);
    await vi.advanceTimersByTimeAsync(0);
    await p.purgeTags(['b']);
    await p.close();
    await p.purgeTags(['c']);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls.map((c) => c.tags)).toEqual([['a']]);
  });
});

describe('cloudflarePurgeConfig', () => {
  it('sem as duas variáveis: nada (NoopCdnPurger)', () => {
    expect(cloudflarePurgeConfig({})).toEqual({});
  });

  it('com só uma: aviso e purge desligado', () => {
    expect(cloudflarePurgeConfig({ CLOUDFLARE_ZONE_ID: ZONE }).warning).toMatch(/CLOUDFLARE_PURGE_TOKEN/);
    expect(cloudflarePurgeConfig({ CLOUDFLARE_PURGE_TOKEN: TOKEN }).warning).toMatch(/CLOUDFLARE_ZONE_ID/);
  });

  it('id de zona malformado: aviso, sem expor o token', () => {
    const r = cloudflarePurgeConfig({
      CLOUDFLARE_ZONE_ID: 'galaxiesports.com',
      CLOUDFLARE_PURGE_TOKEN: TOKEN,
    });
    expect(r.config).toBeUndefined();
    expect(r.warning).not.toContain(TOKEN);
  });

  it('as duas: configuração, com o ritmo opcional', () => {
    expect(cloudflarePurgeConfig({ CLOUDFLARE_ZONE_ID: ZONE, CLOUDFLARE_PURGE_TOKEN: ` ${TOKEN} ` })).toEqual(
      {
        config: { zoneId: ZONE, token: TOKEN },
      },
    );
    expect(
      cloudflarePurgeConfig({
        CLOUDFLARE_ZONE_ID: ZONE,
        CLOUDFLARE_PURGE_TOKEN: TOKEN,
        CLOUDFLARE_PURGE_REQUESTS_PER_MINUTE: '300',
      }).config?.requestsPerMinute,
    ).toBe(300);
    expect(
      cloudflarePurgeConfig({
        CLOUDFLARE_ZONE_ID: ZONE,
        CLOUDFLARE_PURGE_TOKEN: TOKEN,
        CLOUDFLARE_PURGE_REQUESTS_PER_MINUTE: '0',
      }).warning,
    ).toMatch(/REQUESTS_PER_MINUTE/);
  });
});
