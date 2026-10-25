import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/** Variável com a KEK (chave de cifra dos segredos dos webhooks); várias separadas por vírgula. */
export const WEBHOOK_KEK_ENV = 'WEBHOOK_SIGNING_SECRET';

/** Prefixo do segredo cifrado em `api.webhook_endpoint.secret`; sem ele, é o formato legado em texto puro. */
const SEALED_PREFIX = 'enc:v1:';
const MIN_KEK_LENGTH = 32;

export class WebhookSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSecretError';
  }
}

interface Kek {
  /** Identificador curto da KEK gravado junto do segredo (escolhe a chave na decifragem). */
  id: string;
  key: Buffer;
}

function deriveKek(raw: string): Kek {
  const key = Buffer.from(hkdfSync('sha256', raw, Buffer.alloc(0), 'galaxie-sports/webhook-secret/v1', 32));
  return { id: createHash('sha256').update(key).digest('hex').slice(0, 8), key };
}

/**
 * Cifra dos segredos de assinatura dos webhooks (AES-256-GCM) com a KEK `WEBHOOK_SIGNING_SECRET`, que fica
 * fora do banco: um dump de `api.webhook_endpoint` não permite forjar webhooks. Formato gravado:
 * `enc:v1:<kid>:<iv>:<cifrado>:<tag>` (base64url).
 *
 * - **Várias KEKs** (`nova,antiga`): cifra com a primeira e decifra com qualquer uma — rotação da KEK
 *   sem janela (`webhook seal-secrets` recifra com a nova; depois remova a antiga).
 * - **Legado**: segredo em texto puro (`whsec_...`, gravado antes da cifra) continua sendo lido como está,
 *   com ou sem KEK, até `webhook seal-secrets` cifrá-lo.
 * - **Sem KEK**: `seal` recusa (o cadastro falha com erro explícito) e `open` de um segredo cifrado
 *   falha — a entrega conta como tentativa com erro e vai para a DLQ se a KEK não voltar.
 */
export class WebhookSecretBox {
  private readonly keks: Kek[];

  constructor(rawKeys: readonly string[]) {
    for (const raw of rawKeys)
      if (raw.length < MIN_KEK_LENGTH)
        throw new WebhookSecretError(
          `${WEBHOOK_KEK_ENV} deve ter ao menos ${MIN_KEK_LENGTH} caracteres por chave (gere com: openssl rand -base64 32).`,
        );
    this.keks = rawKeys.map(deriveKek);
  }

  /** Lê `WEBHOOK_SIGNING_SECRET` (vazia/ausente = sem KEK). */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): WebhookSecretBox {
    return new WebhookSecretBox(
      (env[WEBHOOK_KEK_ENV] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  get configured(): boolean {
    return this.keks.length > 0;
  }

  static isSealed(stored: string): boolean {
    return stored.startsWith(SEALED_PREFIX);
  }

  /** Cifra com a KEK atual (a primeira). */
  seal(secret: string): string {
    const kek = this.keks[0];
    if (!kek)
      throw new WebhookSecretError(
        `${WEBHOOK_KEK_ENV} não definida: o segredo do webhook não pode ser gravado sem cifra.`,
      );
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', kek.key, iv);
    const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const b64 = (b: Buffer) => b.toString('base64url');
    return `${SEALED_PREFIX}${kek.id}:${b64(iv)}:${b64(data)}:${b64(tag)}`;
  }

  /** Segredo em claro para assinar: decifra o formato `enc:v1:` ou devolve o legado em texto puro. */
  open(stored: string): string {
    if (!WebhookSecretBox.isSealed(stored)) return stored;
    const [kid, iv, data, tag] = stored.slice(SEALED_PREFIX.length).split(':');
    if (!kid || !iv || !data || !tag) throw new WebhookSecretError('Segredo do webhook cifrado malformado.');
    const kek = this.keks.find((k) => k.id === kid);
    if (!kek)
      throw new WebhookSecretError(
        this.configured
          ? `Segredo do webhook cifrado com uma KEK (${kid}) que não está em ${WEBHOOK_KEK_ENV}.`
          : `Segredo do webhook cifrado, mas ${WEBHOOK_KEK_ENV} não está definida.`,
      );
    try {
      const decipher = createDecipheriv('aes-256-gcm', kek.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString(
        'utf8',
      );
    } catch {
      throw new WebhookSecretError('Segredo do webhook não confere com a KEK (dado corrompido ou alterado).');
    }
  }

  /** Precisa (re)cifrar: legado em texto puro ou cifrado com uma KEK que não é a atual. */
  needsSeal(stored: string): boolean {
    if (!WebhookSecretBox.isSealed(stored)) return true;
    return stored.slice(SEALED_PREFIX.length).split(':')[0] !== this.keks[0]?.id;
  }
}
