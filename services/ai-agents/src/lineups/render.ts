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
 */
import type { Browser } from 'playwright-core';
import { looksBlocked, type PageRenderer, type RenderResult } from './pages.js';

const MAX_EXPANDS = 12;

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
}

export async function playwrightRenderer(opts: PlaywrightRendererOptions = {}): Promise<PageRenderer> {
  const { chromium } = await import('playwright-core');
  const browser: Browser = opts.wsEndpoint
    ? await chromium.connect(opts.wsEndpoint)
    : await chromium.launch({
        headless: true,
        ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
      });
  return {
    async render(url, { expand, userAgent, timeoutMs }): Promise<RenderResult> {
      const context = await browser.newContext({ userAgent, locale: 'pt-BR' });
      await context.route('**/*', (route) =>
        ['image', 'media', 'font'].includes(route.request().resourceType())
          ? route.abort()
          : route.continue(),
      );
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
        return { finalUrl: page.url(), status: res?.status() ?? 0, text, sections, blocked };
      } finally {
        await context.close();
      }
    },
    close: () => browser.close(),
  };
}
