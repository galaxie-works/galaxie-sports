import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THEMES,
  chatRetryMs,
  maxReactionTotals,
  mergeChatMessages,
  mergeGameMessages,
  parseSse,
  safeImageUrl,
  textsFor,
  type GsChatGameMessage,
  type GsChatRoom,
} from './core/model.js';
import { GalaxieWidgetProvider } from './core/react.js';
import { LiveChat } from './widgets/live-chat.js';

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // sem armazenamento no ambiente
  }
});

const T = textsFor('pt-BR').liveChat;
const FIXTURE = '0190f000-0000-7000-8000-00000000f001';
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `gft_${b64({ v: 1, t: 'site', p: 'p1', exp: Math.floor(Date.now() / 1000) + 900 })}.sig`;

const msg = (id: string, body: string, at: string, nickname = 'Tricolor_77') => ({
  id,
  body,
  author: { profile_id: `p-${id}`, nickname, avatar_url: null },
  created_at: at,
});

const room = (patch: Partial<GsChatRoom> = {}): GsChatRoom => ({
  room_id: 'r1',
  fixture_id: FIXTURE,
  state: 'open',
  opens_at: '2026-11-18T18:00:00Z',
  closes_at: '2026-11-18T21:30:00Z',
  settings: { slow_mode_seconds: 0, strictness: 'standard', max_chars: 280 },
  messages: [msg('00000000-0000-7000-8000-000000000001', 'Vamos, time!', '2026-11-18T19:00:00Z')],
  pinned: null,
  reactions: { fire: 3 },
  game_messages: [],
  ...patch,
});

/** SSE de mentira: devolve os blocos e fecha (o widget reconecta depois de 1 s; o teste acaba antes). */
const sse = (text: string) =>
  new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(text));
        c.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

function api(
  opts: { band?: '18plus' | '13_17'; stream?: string; room?: GsChatRoom; guidelines?: boolean } = {},
) {
  const calls: { url: string; init?: RequestInit | undefined }[] = [];
  // sem o aceite das Diretrizes (#957), a primeira mensagem volta 409 até o aceite
  let accepted = !opts.guidelines;
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.endsWith('/v1/fans/me'))
      return new Response(
        JSON.stringify({
          data: {
            profile_id: 'p1',
            nickname: 'Eu',
            avatar_url: null,
            age_band: opts.band ?? '18plus',
            country: 'BR',
            locale: 'pt-BR',
            capabilities:
              opts.band === '13_17' ? ['read', 'predict'] : ['read', 'predict', 'write', 'redeem'],
          },
        }),
        { status: 200 },
      );
    if (u.includes('/stream')) return sse(opts.stream ?? '');
    if (u.endsWith('/v1/chat/guidelines'))
      return new Response(
        JSON.stringify({
          data: {
            version: 1,
            accepted_version: null,
            title: 'Como funciona o chat',
            intro: 'O chat é para torcer junto.',
            not_allowed_title: 'Aqui não pode:',
            not_allowed: ['ofender', 'ameaçar'],
            who_writes: 'Só maiores de 18 anos escrevem.',
            consequences: 'Você sempre vê o motivo.',
            report: 'Viu algo errado? Denuncie.',
            accept: 'Li e aceito',
          },
        }),
        { status: 200 },
      );
    if (u.endsWith('/v1/chat/guidelines/accept') && init?.method === 'POST') {
      accepted = true;
      return new Response(null, { status: 204 });
    }
    if (u.endsWith('/messages') && init?.method === 'POST' && !accepted)
      return new Response(
        JSON.stringify({ detail: 'Aceite as regras.', errors: [{ path: 'refusal', message: 'guidelines' }] }),
        { status: 409 },
      );
    if (u.endsWith('/messages') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { body: string };
      return new Response(
        JSON.stringify({
          data: {
            ...msg('00000000-0000-7000-8000-0000000000aa', body.body, '2026-11-18T19:05:00Z', 'Eu'),
            status: 'held',
          },
        }),
        { status: 201 },
      );
    }
    if (u.endsWith('/reactions'))
      return new Response(JSON.stringify({ data: { accepted: true } }), { status: 202 });
    if (u.includes(`/v1/chat/rooms/${FIXTURE}`))
      return new Response(JSON.stringify({ data: opts.room ?? room() }), { status: 200 });
    return new Response('{}', { status: 404 });
  });
  return { fetchImpl, calls };
}

function setup(fetchImpl: typeof fetch, props: { readOnly?: boolean; token?: string | null } = {}) {
  render(
    <GalaxieWidgetProvider
      baseUrl="https://api.exemplo.test"
      publishableKey="gs_pk_test_site"
      theme={DEFAULT_THEMES.light}
      locale="pt-BR"
      fetch={fetchImpl}
      fanToken={props.token === undefined ? TOKEN : props.token}
    >
      <LiveChat eventId={FIXTURE} readOnly={props.readOnly} />
    </GalaxieWidgetProvider>,
  );
}

describe('chat ao vivo: utilitários', () => {
  it('lê o SSE em pedaços, com o resto incompleto para o próximo', () => {
    const a = parseSse('event: chat.batch\nid: 1-1\ndata: {"messages":[]}\n\nevent: chat.st');
    expect(a.events).toEqual([{ event: 'chat.batch', data: '{"messages":[]}', id: '1-1' }]);
    const b = parseSse(`${a.rest}ate\ndata: {"state":"frozen"}\n\n: comentário\n\n`);
    expect(b.events).toEqual([{ event: 'chat.state', data: '{"state":"frozen"}', id: null }]);
    expect(b.rest).toBe('');
  });

  it('junta mensagens sem repetir e guarda as últimas', () => {
    const a = [{ id: '1' }, { id: '2' }];
    expect(mergeChatMessages(a, [{ id: '2' }, { id: '3' }]).map((m) => m.id)).toEqual(['1', '2', '3']);
    expect(mergeChatMessages(a, [{ id: '3' }], 2).map((m) => m.id)).toEqual(['2', '3']);
  });

  it('gol anulado troca a mensagem pelo id; reações ficam com o maior total', () => {
    const goal = { id: 'g', created_at: '2026-11-18T19:10:00Z', cancelled: false } as GsChatGameMessage;
    const merged = mergeGameMessages([goal], [{ ...goal, cancelled: true }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.cancelled).toBe(true);
    expect(maxReactionTotals({ fire: 5, clap: 2 }, { fire: 4, clap: 3 })).toEqual({ fire: 5, clap: 3 });
  });
});

describe('chat ao vivo: casos de borda', () => {
  it('\\r\\n partido entre dois pedaços não vira linha em branco falsa', () => {
    const a = parseSse('event: chat.state\r');
    expect(a.events).toEqual([]);
    const b = parseSse(`${a.rest}\ndata: {"state":"open"}\r\n\r\n`);
    expect(b.events).toEqual([{ event: 'chat.state', data: '{"state":"open"}', id: null }]);
  });

  it('ordena pelo horário antes de cortar (sem buraco no meio)', () => {
    const at = (m: number) => `2026-11-18T19:${String(m).padStart(2, '0')}:00Z`;
    const cur = [{ id: 'c', created_at: at(30) }];
    const merged = mergeChatMessages(
      cur,
      [
        { id: 'a', created_at: at(10) },
        { id: 'b', created_at: at(20) },
      ],
      2,
    );
    expect(merged.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('reconecta respeitando o Retry-After, com acréscimo aleatório e teto', () => {
    expect(chatRetryMs(1, '5', () => 0)).toBe(5_000);
    expect(chatRetryMs(1, null, () => 0)).toBe(1_000);
    expect(chatRetryMs(3, null, () => 0.5)).toBe(6_000);
    expect(chatRetryMs(20, null, () => 0)).toBe(30_000);
  });

  it('avatar só por https', () => {
    expect(safeImageUrl('https://cdn.exemplo.test/a.png')).toBe('https://cdn.exemplo.test/a.png');
    expect(safeImageUrl('http://cdn.exemplo.test/a.png')).toBeNull();
    expect(safeImageUrl('javascript:alert(1)')).toBeNull();
    expect(safeImageUrl(null)).toBeNull();
  });
});

describe('chat ao vivo: widget', () => {
  it('mostra a sala, junta o lote do stream e o jogo dentro do chat', async () => {
    const goal = {
      id: '00000000-0000-7000-8000-0000000000g1',
      kind: 'goal',
      minute: 23,
      extra: null,
      team: null,
      player: 'Calleri',
      score: { home: 1, away: 0 },
      cancelled: false,
      text: { 'pt-BR': 'Gol do São Paulo!', es: '¡Gol!', en: 'Goal!' },
      created_at: '2026-11-18T19:02:00Z',
      updated_at: '2026-11-18T19:02:00Z',
    };
    const stream =
      `event: chat.game\ndata: ${JSON.stringify({ messages: [goal], snapshot: true })}\n\n` +
      `event: chat.batch\nid: 1-2\ndata: ${JSON.stringify({
        batch_id: 2,
        messages: [msg('00000000-0000-7000-8000-000000000002', 'Que golaço', '2026-11-18T19:03:00Z')],
      })}\n\n`;
    const { fetchImpl } = api({ stream });
    setup(fetchImpl);
    expect(await screen.findByText('Vamos, time!')).toBeTruthy();
    expect(await screen.findByText('Que golaço')).toBeTruthy();
    expect(await screen.findByText('Gol do São Paulo!')).toBeTruthy();
    // a chave publicável vai no header do stream, nunca na URL
    const streamCall = fetchImpl.mock.calls.find(([u]) => String(u).includes('/stream'));
    expect(String(streamCall?.[0])).not.toContain('gs_pk');
    expect(new Headers(streamCall?.[1]?.headers).get('x-galaxie-publishable-key')).toBe('gs_pk_test_site');
  });

  it('18plus escreve; a mensagem retida fica só para o autor, marcada', async () => {
    const { fetchImpl, calls } = api();
    setup(fetchImpl);
    const box = await screen.findByLabelText(T.placeholder);
    fireEvent.change(box, { target: { value: 'Bora!' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: T.send }));
    });
    const post = calls.find((c) => c.url.endsWith('/messages'));
    expect(new Headers(post?.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(await screen.findByText('Bora!')).toBeTruthy();
    expect(screen.getByText(new RegExp(T.onlyYou))).toBeTruthy();
  });

  it('Diretrizes (#957): a primeira mensagem mostra as regras; depois do aceite, envia', async () => {
    const { fetchImpl, calls } = api({ guidelines: true });
    setup(fetchImpl);
    const box = await screen.findByLabelText(T.placeholder);
    fireEvent.change(box, { target: { value: 'Bora!' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: T.send }));
    });
    expect(await screen.findByText('Como funciona o chat')).toBeTruthy();
    expect(screen.getByText('ameaçar')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Li e aceito' }));
    });
    const accept = calls.find((c) => c.url.endsWith('/v1/chat/guidelines/accept'));
    expect(JSON.parse(String(accept?.init?.body))).toEqual({ version: 1 });
    expect(screen.queryByText('Como funciona o chat')).toBeNull();
    // o rascunho ficou: o torcedor manda de novo
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: T.send }));
    });
    expect(await screen.findByText('Bora!')).toBeTruthy();
  });

  it('13_17 lê e reage, mas não tem campo de escrever', async () => {
    const { fetchImpl, calls } = api({ band: '13_17' });
    setup(fetchImpl);
    expect(await screen.findByText('Vamos, time!')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: new RegExp(`^${T.reactions.fire}, `) })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    expect(screen.queryByLabelText(T.placeholder)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${T.reactions.fire}, `) }));
    });
    expect(calls.some((c) => c.url.endsWith('/reactions'))).toBe(true);
  });

  it('sala congelada avisa e não abre o campo; sem login, só leitura', async () => {
    const { fetchImpl } = api({ room: room({ state: 'frozen' }) });
    setup(fetchImpl, { token: null });
    expect(await screen.findByText(T.states.frozen)).toBeTruthy();
    expect(screen.queryByLabelText(T.placeholder)).toBeNull();
    expect(screen.getByRole('button', { name: new RegExp(`^${T.reactions.fire}, `) })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('o torcedor esconde o chat, e a escolha fica', async () => {
    const { fetchImpl } = api();
    setup(fetchImpl);
    await screen.findByText('Vamos, time!');
    fireEvent.click(screen.getByRole('button', { name: T.hide }));
    expect(screen.getByText(T.hidden)).toBeTruthy();
    expect(screen.queryByText('Vamos, time!')).toBeNull();
    cleanup();
    setup(api().fetchImpl);
    expect(await screen.findByText(T.hidden)).toBeTruthy();
  });
});
