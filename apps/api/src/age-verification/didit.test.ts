import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DiditClient, DiditError, verifyDiditWebhook, type DiditFetch } from './didit.js';

const NOW = new Date('2026-11-14T12:00:00Z');
const TS = String(Math.floor(NOW.getTime() / 1000));
// segredo fictício montado na hora (o gitleaks lê literal com cara de chave como segredo)
const SECRET = ['segredo', 'teste', 'didit'].join('-');
const SESSION = '4c5c7f3a-1f82-4f3b-8d8e-1a8d2d2f9b7a';

function recorder(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn: DiditFetch = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  };
  return { calls, fetchFn };
}

const client = (fetchFn: DiditFetch) =>
  new DiditClient({ apiKey: 'chave', workflowId: 'wf-1', baseUrl: 'https://didit.test/' }, fetchFn);

describe('cliente do Didit (#1109)', () => {
  it('cria a sessão com o workflow, a referência opaca e o consentimento colhido', async () => {
    const { calls, fetchFn } = recorder([
      {
        status: 201,
        body: {
          session_id: SESSION,
          url: 'https://verify.didit.me/pt/session/abc',
          expires_at: '2026-11-14T13:00:00Z',
        },
      },
    ]);
    const s = await client(fetchFn).createSession(
      {
        ref: 'ref-opaca',
        language: 'pt',
        returnUrl: 'https://cliente.test/volta',
        consent: { givenAt: new Date('2026-11-14T11:59:00Z'), textVersion: 'v1' },
        expiresInSec: 60,
      },
      NOW,
    );
    expect(s).toEqual({
      sessionId: SESSION,
      url: 'https://verify.didit.me/pt/session/abc',
      expiresAt: new Date('2026-11-14T13:00:00Z'),
    });
    expect(calls[0]!.url).toBe('https://didit.test/v3/session/');
    expect((calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('chave');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      workflow_id: 'wf-1',
      vendor_data: 'ref-opaca',
      callback: 'https://cliente.test/volta',
      callback_method: 'both',
      language: 'pt',
      // o mínimo do provedor é 1 h
      session_expiration_time: 3600,
      biometric_consent: { given_at: '2026-11-14T11:59:00.000Z', text_version: 'v1' },
    });
  });

  it('resposta sem id ou sem url https é erro', async () => {
    for (const body of [{ url: 'https://x' }, { session_id: SESSION, url: 'http://x' }]) {
      const { fetchFn } = recorder([{ status: 201, body }]);
      await expect(
        client(fetchFn).createSession({
          ref: 'r',
          language: 'pt',
          returnUrl: 'https://x',
          consent: { givenAt: NOW, textVersion: 'v1' },
        }),
      ).rejects.toBeInstanceOf(DiditError);
    }
  });

  it('decisão e apagamento: sem guardar o rosto, 404 conta como apagada, 503 tenta depois, id estranho nem sai', async () => {
    const { calls, fetchFn } = recorder([
      { status: 200, body: { status: 'Approved' } },
      { status: 200, body: { session_id: SESSION, face_retention_outcome: 'deleted' } },
      { status: 404 },
      { status: 503 },
      { status: 409 },
      { status: 200, body: { session_id: SESSION, face_retention_outcome: 'retained_with_user' } },
    ]);
    const c = client(fetchFn);
    expect(await c.decision(SESSION)).toEqual({ status: 'Approved' });
    expect(calls[0]!.url).toBe(`https://didit.test/v3/session/${SESSION}/decision/`);
    expect(await c.purge(SESSION)).toBe(true);
    expect(calls[1]!.init.method).toBe('DELETE');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ retain_face_embeddings: false });
    expect(await c.purge(SESSION)).toBe(true);
    expect(await c.purge(SESSION)).toBe(false);
    await expect(c.purge(SESSION)).rejects.toBeInstanceOf(DiditError);
    // template do rosto guardado = não apagou o que prometemos
    await expect(c.purge(SESSION)).rejects.toThrow(/template do rosto/);
    await expect(c.decision('../admin')).rejects.toBeInstanceOf(DiditError);
    expect(calls).toHaveLength(6);
  });
});

describe('webhook do Didit (#1109)', () => {
  const payload = {
    event_id: 'evt-1',
    webhook_type: 'status.updated',
    session_id: SESSION,
    status: 'Approved',
    vendor_data: 'ref-opaca',
    timestamp: Number(TS),
    decision: { score: 1.0, nome: 'João' },
  };
  // o Didit assina o JSON canônico: chaves em ordem, compacto, Unicode como está
  const canonical = (o: unknown): string =>
    o === null || typeof o !== 'object'
      ? JSON.stringify(o)
      : `{${Object.keys(o as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical((o as Record<string, unknown>)[k])}`)
          .join(',')}}`;
  const sign = (data: string, secret = SECRET) => createHmac('sha256', secret).update(data).digest('hex');
  // corpo com espaços e outra ordem: a V2 continua valendo
  const raw = Buffer.from(JSON.stringify(payload, null, 2));

  it('aceita a V2 sobre o JSON canônico e devolve só o envelope', () => {
    expect(
      verifyDiditWebhook(
        { 'x-timestamp': TS, 'x-signature-v2': sign(canonical(payload)) },
        raw,
        [SECRET],
        NOW,
      ),
    ).toEqual({
      eventId: 'evt-1',
      sessionId: SESSION,
      vendorData: 'ref-opaca',
      status: 'Approved',
      webhookType: 'status.updated',
    });
  });

  it('aceita a assinatura dos bytes crus e o segredo anterior na troca', () => {
    expect(
      verifyDiditWebhook({ 'x-timestamp': TS, 'x-signature': sign(raw.toString()) }, raw, [SECRET], NOW),
    ).not.toBeNull();
    expect(
      verifyDiditWebhook(
        { 'x-timestamp': TS, 'x-signature-v2-previous': sign(canonical(payload), 'antigo') },
        raw,
        [SECRET, 'antigo'],
        NOW,
      ),
    ).not.toBeNull();
  });

  it('recusa assinatura errada, só a Simple, fora da janela, sem segredo e corpo adulterado', () => {
    const good = sign(canonical(payload));
    const simple = sign(`${TS}:${SESSION}:Approved:status.updated`);
    const old = String(Number(TS) - 301);
    const tampered = Buffer.from(JSON.stringify({ ...payload, status: 'Declined' }));
    expect(
      verifyDiditWebhook({ 'x-timestamp': TS, 'x-signature-v2': sign('x') }, raw, [SECRET], NOW),
    ).toBeNull();
    expect(
      verifyDiditWebhook({ 'x-timestamp': TS, 'x-signature-simple': simple }, raw, [SECRET], NOW),
    ).toBeNull();
    expect(verifyDiditWebhook({ 'x-timestamp': old, 'x-signature-v2': good }, raw, [SECRET], NOW)).toBeNull();
    expect(verifyDiditWebhook({ 'x-timestamp': TS, 'x-signature-v2': good }, raw, [], NOW)).toBeNull();
    // assinatura com caractere de vários bytes: recusa sem lançar (seria 500)
    expect(
      verifyDiditWebhook({ 'x-timestamp': TS, 'x-signature-v2': 'é'.repeat(64) }, raw, [SECRET], NOW),
    ).toBeNull();
    expect(
      verifyDiditWebhook({ 'x-timestamp': TS, 'x-signature-v2': good }, tampered, [SECRET], NOW),
    ).toBeNull();
  });
});
