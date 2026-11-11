/**
 * Leitura no navegador da resposta em fluxo do assistente da Cosmos (#1003): uma linha JSON por evento
 * (ver a rota `api/cliente/cosmos/assistente`). Puro, para testar sem a tela.
 */
export type AssistantErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'unavailable'
  | 'module'
  | 'staff'
  | 'disabled'
  | 'blocked'
  | 'insufficient'
  | 'no_wallet'
  | 'busy'
  | 'rate_limited'
  | 'tenant_limit'
  | 'failed';

export type AssistantEvent =
  | { type: 'start'; reserved: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; charged: number; available: number; sig?: string }
  | { type: 'error'; code: AssistantErrorCode };

const CODES: readonly AssistantErrorCode[] = [
  'unauthorized',
  'bad_request',
  'unavailable',
  'module',
  'staff',
  'disabled',
  'blocked',
  'insufficient',
  'no_wallet',
  'busy',
  'rate_limited',
  'tenant_limit',
  'failed',
];

function parseLine(line: string): AssistantEvent | null {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  switch (e.type) {
    case 'start':
      return { type: 'start', reserved: Number(e.reserved) || 0 };
    case 'delta':
      return typeof e.text === 'string' ? { type: 'delta', text: e.text } : null;
    case 'done':
      return {
        type: 'done',
        charged: Number(e.charged) || 0,
        available: Number(e.available) || 0,
        ...(typeof e.sig === 'string' ? { sig: e.sig } : {}),
      };
    case 'error':
      return {
        type: 'error',
        code: CODES.includes(e.code as AssistantErrorCode) ? (e.code as AssistantErrorCode) : 'failed',
      };
    default:
      return null;
  }
}

/** Eventos de uma resposta da rota; corpo vazio ou cortado vira `failed`. */
export async function* readAssistantStream(res: Response): AsyncGenerator<AssistantEvent> {
  if (!res.body) {
    yield { type: 'error', code: 'failed' };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const event = parseLine(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 1);
      if (!event) continue;
      if (event.type === 'done' || event.type === 'error') finished = true;
      yield event;
    }
    if (done) break;
  }
  const tail = buffer.trim() ? parseLine(buffer) : null;
  if (tail) {
    if (tail.type === 'done' || tail.type === 'error') finished = true;
    yield tail;
  }
  if (!finished) yield { type: 'error', code: 'failed' };
}
