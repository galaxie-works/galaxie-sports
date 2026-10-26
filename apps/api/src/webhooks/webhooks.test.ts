import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTopics, validateWebhookUrl, WebhookInputError } from './admin.js';
import { generateWebhookSecret, signWebhook, verifyWebhookSignature } from './signature.js';
import { WebhookSecretBox, WebhookSecretError } from './secret-box.js';
import { BlockedTargetError, isBlockedAddress, postWebhook } from './transport.js';
import { retryDelayMs } from './worker.js';

describe('assinatura HMAC-SHA256', () => {
  const secret = generateWebhookSecret();
  const body = JSON.stringify({ id: '1', topic: 'event.score_changed' });

  it('assina t.corpo e verifica em tempo constante', () => {
    const header = signWebhook(secret, body, 1_800_000_000);
    const v1 = createHmac('sha256', secret).update(`1800000000.${body}`).digest('hex');
    expect(header).toBe(`t=1800000000,v1=${v1}`);
    expect(verifyWebhookSignature(secret, body, header, { nowSec: 1_800_000_010 })).toBe(true);
  });

  it('rejeita corpo alterado, segredo errado, timestamp fora da janela e header malformado', () => {
    const header = signWebhook(secret, body, 1_800_000_000);
    const now = { nowSec: 1_800_000_000 };
    expect(verifyWebhookSignature(secret, `${body} `, header, now)).toBe(false);
    expect(verifyWebhookSignature(generateWebhookSecret(), body, header, now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, header, { nowSec: 1_800_000_301 })).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'v1=abc', now)).toBe(false);
    expect(verifyWebhookSignature(secret, body, undefined, now)).toBe(false);
  });

  it('segredos são únicos e com prefixo', () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

const EP = '01900000-0000-7000-8000-000000000001';

describe('cifra do segredo com a KEK (auditoria API-9)', () => {
  const kek = (n: string) => n.repeat(32);

  it('preso ao endpoint (AAD), tag de 16 bytes obrigatória, texto puro recusável', () => {
    const box = new WebhookSecretBox([kek('a')]);
    const sealed = box.seal('whsec_x', EP);
    // copiado para outro endpoint: não abre
    expect(() => box.open(sealed, '01900000-0000-7000-8000-000000000002')).toThrow(/não confere/);
    // tag truncada para 4 bytes (aceita pelo Node sem authTagLength)
    const parts = sealed.split(':');
    const short = Buffer.from(parts.at(-1)!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() => box.open([...parts.slice(0, -1), short].join(':'), EP)).toThrow(WebhookSecretError);
    const strict = WebhookSecretBox.fromEnv({
      WEBHOOK_SIGNING_SECRET: kek('a'),
      WEBHOOK_REJECT_PLAINTEXT_SECRETS: 'true',
    });
    expect(() => strict.open('whsec_legado', EP)).toThrow(/texto puro recusado/);
    expect(strict.open(sealed, EP)).toBe('whsec_x');
  });

  it('cifra com AES-GCM e decifra de volta; cada cifra é diferente (IV aleatório)', () => {
    const box = new WebhookSecretBox([kek('a')]);
    const secret = generateWebhookSecret();
    const sealed = box.seal(secret, EP);
    expect(sealed).toMatch(/^enc:v1:[0-9a-f]{8}:/);
    expect(sealed).not.toContain(secret.slice(6));
    expect(box.seal(secret, EP)).not.toBe(sealed);
    expect(box.open(sealed, EP)).toBe(secret);
    expect(box.needsSeal(sealed)).toBe(false);
  });

  it('legado em texto puro é lido como está (com ou sem KEK) e precisa ser cifrado', () => {
    const legacy = generateWebhookSecret();
    expect(new WebhookSecretBox([]).open(legacy, EP)).toBe(legacy);
    expect(new WebhookSecretBox([kek('a')]).open(legacy, EP)).toBe(legacy);
    expect(new WebhookSecretBox([kek('a')]).needsSeal(legacy)).toBe(true);
  });

  it('rotação da KEK: nova,antiga decifra os dois e marca o antigo para recifrar', () => {
    const old = new WebhookSecretBox([kek('a')]).seal('whsec_x', EP);
    const both = new WebhookSecretBox([kek('b'), kek('a')]);
    expect(both.open(old, EP)).toBe('whsec_x');
    expect(both.needsSeal(old)).toBe(true);
    expect(both.needsSeal(both.seal('whsec_x', EP))).toBe(false);
  });

  it('sem KEK: não cifra e não decifra; KEK curta, KEK errada e dado alterado falham explicitamente', () => {
    const sealed = new WebhookSecretBox([kek('a')]).seal('whsec_x', EP);
    const none = new WebhookSecretBox([]);
    expect(none.configured).toBe(false);
    expect(() => none.seal('whsec_x', EP)).toThrow(/WEBHOOK_SIGNING_SECRET não definida/);
    expect(() => none.open(sealed, EP)).toThrow(/WEBHOOK_SIGNING_SECRET não está definida/);
    expect(() => new WebhookSecretBox(['curta'])).toThrow(/ao menos 32/);
    expect(() => new WebhookSecretBox([kek('c')]).open(sealed, EP)).toThrow(WebhookSecretError);
    // troca o 1º caractere do tag: no fim do base64url os bits de sobra somem na decodificação e a troca podia não mudar
    // nenhum byte
    const parts = sealed.split(':');
    const tag = parts[parts.length - 1]!;
    parts[parts.length - 1] = (tag.startsWith('A') ? 'B' : 'A') + tag.slice(1);
    const tampered = parts.join(':');
    expect(() => new WebhookSecretBox([kek('a')]).open(tampered, EP)).toThrow(/não confere/);
    expect(
      WebhookSecretBox.fromEnv({ WEBHOOK_SIGNING_SECRET: ` ${kek('a')} , ${kek('b')} ` }).open(sealed, EP),
    ).toBe('whsec_x');
  });
});

describe('transporte da entrega (auditoria API-15)', () => {
  let server: Server;
  let port: number;
  const bodies: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let b = '';
      req.on('data', (c: Buffer) => (b += c.toString('utf8')));
      req.on('end', () => {
        bodies.push(b);
        res.statusCode = req.url === '/redirect' ? 302 : 204;
        if (req.url === '/redirect') res.setHeader('location', 'http://169.254.169.254/');
        res.end('descartado');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((r) => server.close(r)));
  const post = { headers: { 'content-type': 'application/json' }, body: '{"a":1}', timeoutMs: 2_000 };

  it('bloqueia IP privado na URL e nome que resolve para rede privada (no socket)', async () => {
    await expect(postWebhook(`http://127.0.0.1:${port}/x`, post)).rejects.toThrow(BlockedTargetError);
    await expect(postWebhook(`http://localhost:${port}/x`, post)).rejects.toThrow(/rede privada/);
    await expect(postWebhook('http://[::ffff:169.254.169.254]/x', post)).rejects.toThrow(BlockedTargetError);
    expect(bodies).toHaveLength(0);
  });

  it('com allowPrivateTargets entrega, devolve o status e não segue redirect', async () => {
    expect(await postWebhook(`http://localhost:${port}/x`, { ...post, allowPrivateTargets: true })).toBe(204);
    expect(
      await postWebhook(`http://127.0.0.1:${port}/redirect`, { ...post, allowPrivateTargets: true }),
    ).toBe(302);
    expect(bodies).toEqual(['{"a":1}', '{"a":1}']);
  });

  it('faixas bloqueadas', () => {
    // formatos que embutem IPv4 e faixas de documentação
    for (const a of [
      '::7f00:1',
      '::ffff:0:a00:1',
      '2002:a00:1::1',
      '64:ff9b:1::a00:1',
      '192.0.2.1',
      '198.51.100.1',
      '203.0.113.9',
    ])
      expect(isBlockedAddress(a), a).toBe(true);
    for (const a of [
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.31.255.255',
      '192.168.0.1',
      '0.0.0.0',
      '::1',
      'fe80::1',
      'fd12::1',
      '::ffff:10.0.0.1',
    ])
      expect(isBlockedAddress(a), a).toBe(true);
    for (const a of ['93.184.215.14', '8.8.8.8', '172.32.0.1', '2001:4860:4860::8888', 'cliente.example'])
      expect(isBlockedAddress(a), a).toBe(false);
  });
});

describe('retentativas', () => {
  it('dobram a cada falha, com teto e jitter de ±20%', () => {
    const mid = () => 0.5;
    expect([1, 2, 3, 4].map((a) => retryDelayMs(a, 10_000, 3_600_000, mid))).toEqual([
      10_000, 20_000, 40_000, 80_000,
    ]);
    expect(retryDelayMs(20, 10_000, 3_600_000, mid)).toBe(3_600_000);
    expect(retryDelayMs(1, 10_000, 3_600_000, () => 0)).toBe(8_000);
    expect(retryDelayMs(1, 10_000, 3_600_000, () => 1)).toBe(12_000);
  });
});

describe('validação do cadastro', () => {
  it('exige https (http só em localhost ou com --allow-http) e URL sem credenciais', () => {
    expect(validateWebhookUrl('https://cliente.example/hooks')).toBe('https://cliente.example/hooks');
    expect(validateWebhookUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(() => validateWebhookUrl('http://cliente.example/x')).toThrow(WebhookInputError);
    expect(validateWebhookUrl('http://cliente.example/x', true)).toBe('http://cliente.example/x');
    expect(() => validateWebhookUrl('https://u:p@cliente.example/x')).toThrow(WebhookInputError);
    expect(() => validateWebhookUrl('ftp://cliente.example')).toThrow(WebhookInputError);
  });

  it('recusa IP literal privado, link-local (metadata) ou reservado (auditoria API-15)', () => {
    for (const url of [
      'https://10.0.0.5/x',
      'https://169.254.169.254/latest/meta-data',
      'https://192.168.1.1/x',
      'https://[fd00::1]/x',
      'https://[::ffff:172.16.0.1]/x',
    ])
      expect(() => validateWebhookUrl(url), url).toThrow(/IP privado/);
    expect(validateWebhookUrl('https://93.184.215.14/x')).toBe('https://93.184.215.14/x');
    expect(validateWebhookUrl('http://127.0.0.1:3000/x')).toBe('http://127.0.0.1:3000/x');
  });

  it('aceita nomes curtos e completos de tópico', () => {
    expect(parseTopics(['score', 'where_to_watch.changed', 'score'])).toEqual([
      'event.score_changed',
      'where_to_watch.changed',
    ]);
    expect(() => parseTopics(['odds'])).toThrow(WebhookInputError);
  });
});
