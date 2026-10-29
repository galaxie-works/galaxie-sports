/// <reference lib="dom" />
/**
 * Navegador headless para a página oficial do plano que só mostra a grade com JavaScript (a lista de
 * canais abre num botão do cartão do plano e vem de uma API do próprio site). Playwright, sem baixar
 * navegador na imagem dos agentes: conecta num servidor do Playwright (`LINEUP_RENDER_WS`, contêiner à
 * parte, só durante a leitura) ou, no desenvolvimento, abre o Chromium instalado.
 *
 * Educado como o leitor estático: User-Agent do projeto, uma página por vez, sem imagens, fontes nem
 * mídia, sem login nem formulário (página com senha ou captcha volta como bloqueada) e no máximo
 * `MAX_EXPANDS` cliques em "lista de canais" por página.
 *
 * SSRF: o navegador (contêiner à parte) não sai sozinho para a rede. Toda requisição da página (documento,
 * script, XHR, redirecionamento) é interceptada no `context.route` e feita AQUI, pelo `guardedFetch`, que
 * resolve o DNS na própria conexão e recusa IP privado, loopback, link-local (metadados da nuvem) e afins; a
 * resposta volta ao navegador por `route.fulfill`. Assim o endereço conferido é o usado (sem rebinding entre
 * a conferência e a conexão do navegador). Redirecionamento volta ao navegador como 3xx e o salto seguinte
 * passa de novo pelo `route`. WebSocket e service worker ficam desligados (escapariam do `route`).
 * Documento recusado descarta a leitura inteira (volta como bloqueada).
 */
import { guardedFetch, isNotPublicError, isPublicHttpUrl, type GuardedFetch } from '@galaxie/net-guard';
import type { Browser } from 'playwright-core';
import { looksBlocked, type PageRenderer, type RenderResult } from './pages.js';

const MAX_EXPANDS = 12;
/** Teto de bytes por resposta repassada ao navegador. */
const MAX_RESPONSE_BYTES = 8_000_000;

/** Rótulo do cartão do botão: a linha mais próxima que começa com "Plano"/"Plan"/"Pacote". */
function cardLabel(el: HTMLElement): string | null {
  let card: HTMLElement | null = el;
  for (let i = 0; i < 10 && card; i++) {
    card = card.parentElement;
    const m = /^\s*((?:plano|plan|pacote|paquete|pack)\b[^\n]*)/im.exec(card?.innerText ?? '');
    if (m) return m[1]!.trim();
  }
  return null;
}

/** Texto dos diálogos abertos (o que o clique mostrou); `position: fixed` não tem offsetParent. */
function openDialogs(): string {
  return [...document.querySelectorAll<HTMLElement>('[role=dialog], dialog, .modal')]
    .filter((d) => {
      const s = getComputedStyle(d);
      return s.display !== 'none' && s.visibility !== 'hidden';
    })
    .map((d) => d.innerText)
    .filter((t) => t && t.length > 50)
    .join('\n');
}

function closeDialogs(): void {
  for (const b of document.querySelectorAll<HTMLElement>(
    '[role=dialog] .close, .modal .close, [data-dismiss=modal], [aria-label=Close], [aria-label=Fechar], [aria-label=Cerrar]',
  ))
    b.click();
}

export interface PlaywrightRendererOptions {
  /** Servidor do Playwright (`ws://host:3000/`); sem ele, abre o Chromium local. */
  wsEndpoint?: string | null;
  /** Chromium local (desenvolvimento), quando não é o padrão do Playwright. */
  executablePath?: string | null;
  /** `fetch` das requisições do navegador (padrão: `guardedFetch`; testes liberam o servidor local). */
  fetch?: GuardedFetch;
}

/** Requisição do navegador, no formato que `proxyRequest` precisa (o `Request` do Playwright serve). */
export interface BrowserRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  postDataBuffer(): Buffer | null;
}

/** Cabeçalhos que não passam adiante (a conexão é outra; o `guardedFetch` negocia a compressão). */
const HOP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'accept-encoding',
  'keep-alive',
  'upgrade',
]);

/**
 * Faz a requisição do navegador pelo `fetch` protegido, sem seguir redirecionamento, e devolve o que vai no
 * `route.fulfill`. URL não pública: erro com `code: 'EADDRNOTPUBLIC'` (`isNotPublicError`).
 */
export async function proxyRequest(
  fetchImpl: GuardedFetch,
  req: BrowserRequest,
  timeoutMs = 20_000,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const headers = Object.fromEntries(
    Object.entries(req.headers()).filter(([k]) => !HOP_HEADERS.has(k.toLowerCase())),
  );
  const method = req.method();
  const post = req.postDataBuffer();
  const res = await fetchImpl(req.url(), {
    method,
    headers,
    ...(post && method !== 'GET' && method !== 'HEAD' ? { body: new Uint8Array(post) } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  while (reader && total < MAX_RESPONSE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader?.cancel().catch(() => {});
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key] = value;
  });
  // vários Set-Cookie não se juntam com vírgula (a data do Expires tem vírgula): o Playwright separa por \n
  const cookies = res.headers.getSetCookie();
  if (cookies.length) out['set-cookie'] = cookies.join('\n');
  return { status: res.status, headers: out, body: Buffer.concat(chunks) };
}

export async function playwrightRenderer(opts: PlaywrightRendererOptions = {}): Promise<PageRenderer> {
  const { chromium } = await import('playwright-core');
  const browser: Browser = opts.wsEndpoint
    ? await chromium.connect(opts.wsEndpoint)
    : await chromium.launch({
        headless: true,
        ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
      });
  const fetchImpl = opts.fetch ?? guardedFetch();
  return {
    async render(url, { expand, userAgent, timeoutMs }): Promise<RenderResult> {
      if (!isPublicHttpUrl(url)) return { finalUrl: url, status: 0, text: '', sections: [], blocked: true };
      const context = await browser.newContext({ userAgent, locale: 'pt-BR', serviceWorkers: 'block' });
      // navegação (documento) para endereço não público: a leitura inteira é descartada
      let internalNav = false;
      await context.route('**/*', async (route) => {
        const req = route.request();
        if (['image', 'media', 'font'].includes(req.resourceType())) return route.abort();
        try {
          return await route.fulfill(await proxyRequest(fetchImpl, req));
        } catch (err) {
          if (!isNotPublicError(err)) return route.abort('failed');
          if (req.resourceType() === 'document') internalNav = true;
          return route.abort('addressunreachable');
        }
      });
      // WebSocket sairia direto do navegador, com o DNS dele: a grade não precisa
      await context.routeWebSocket(/.*/, (ws) => ws.close());
      const page = await context.newPage();
      try {
        // rastreadores de anúncio nunca deixam a rede quieta: espera o load e, no máximo 8 s, o silêncio
        const res = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
        await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
        const html = await page.content();
        const blocked = looksBlocked(html, page.url());
        const text = await page.evaluate(() => document.body.innerText);
        const sections: RenderResult['sections'] = [];
        if (!blocked) {
          const buttons = await page.getByText(expand).all();
          for (const b of buttons.slice(0, MAX_EXPANDS)) {
            if (!(await b.isVisible().catch(() => false))) continue;
            const label = await b.evaluate(cardLabel).catch(() => null);
            await b.click({ timeout: 5_000 }).catch(() => undefined);
            await page.waitForTimeout(3_000);
            const opened = await page.evaluate(openDialogs);
            if (opened) sections.push({ label, text: opened });
            await page.evaluate(closeDialogs).catch(() => undefined);
            await page.keyboard.press('Escape').catch(() => undefined);
            await page.waitForTimeout(800);
          }
        }
        // navegação para endereço não público: nada do que veio é usado
        if (internalNav || !isPublicHttpUrl(page.url()))
          return { finalUrl: page.url(), status: res?.status() ?? 0, text: '', sections: [], blocked: true };
        return { finalUrl: page.url(), status: res?.status() ?? 0, text, sections, blocked };
      } finally {
        await context.close();
      }
    },
    close: () => browser.close(),
  };
}
