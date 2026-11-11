// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { readAssistantStream } from './assistant-stream';
import { readScreenContext, routeOf, suggestionGroup } from './screen-context';

const body = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
        c.close();
      },
    }),
  );

const collect = async (res: Response) => {
  const out = [];
  for await (const e of readAssistantStream(res)) out.push(e);
  return out;
};

describe('resposta em fluxo no navegador', () => {
  it('lê as linhas mesmo cortadas no meio', async () => {
    const text =
      '{"type":"start","reserved":3}\n{"type":"delta","text":"Olá"}\n{"type":"delta","text":" mundo"}\n{"type":"done","charged":2.5,"available":97.5}\n';
    const events = await collect(body([text.slice(0, 20), text.slice(20, 61), text.slice(61)]));
    expect(events).toEqual([
      { type: 'start', reserved: 3 },
      { type: 'delta', text: 'Olá' },
      { type: 'delta', text: ' mundo' },
      { type: 'done', charged: 2.5, available: 97.5 },
    ]);
  });

  it('erro da rota passa o código; código estranho vira failed', async () => {
    expect(await collect(body(['{"type":"error","code":"insufficient"}\n']))).toEqual([
      { type: 'error', code: 'insufficient' },
    ]);
    expect(await collect(body(['{"type":"error","code":"xyz"}']))).toEqual([
      { type: 'error', code: 'failed' },
    ]);
  });

  it('resposta cortada antes do fim vira failed', async () => {
    const events = await collect(body(['{"type":"start","reserved":1}\n{"type":"delta","text":"me']));
    expect(events.at(-1)).toEqual({ type: 'error', code: 'failed' });
  });
});

describe('contexto da tela', () => {
  it('rota sem idioma e grupo de sugestões', () => {
    expect(routeOf('/en/cliente/cosmos')).toBe('/cliente/cosmos');
    expect(routeOf('/es-AR')).toBe('/');
    expect(routeOf('/docs/webhooks')).toBe('/docs/webhooks');
    expect(suggestionGroup('/cliente/cosmos/uso')).toBe('cosmos');
    expect(suggestionGroup('/docs')).toBe('docs');
    expect(suggestionGroup('/documentos')).toBe('general');
    expect(suggestionGroup('/futebol')).toBe('general');
  });

  it('título, texto da área principal sem campos nem o assistente, e destinos do menu', () => {
    document.body.innerHTML = `
      <div data-sidebar="menu">
        <a href="/en/cliente">Painel</a><a href="/cliente">Painel</a><a href="https://x.com">Fora</a>
        <a href="/docs">Docs</a>
      </div>
      <main>
        <header><h1>Webhooks</h1></header>
        <p>Entregas   de hoje: 12</p>
        <input value="segredo-nao" />
        <textarea>rascunho</textarea>
        <div data-cosmos-assistant>conversa anterior</div>
        <span aria-hidden="true">decorativo</span>
      </main>`;
    history.replaceState(null, '', '/pt-BR/cliente/webhooks');
    const ctx = readScreenContext();
    expect(ctx.route).toBe('/cliente/webhooks');
    expect(ctx.title).toBe('Webhooks');
    expect(ctx.visible).toContain('Entregas de hoje: 12');
    expect(ctx.visible).not.toContain('segredo');
    expect(ctx.visible).not.toContain('rascunho');
    expect(ctx.visible).not.toContain('conversa anterior');
    expect(ctx.visible).not.toContain('decorativo');
    expect(ctx.destinations).toEqual([
      { label: 'Painel', href: '/cliente' },
      { label: 'Docs', href: '/docs' },
    ]);
  });
});
