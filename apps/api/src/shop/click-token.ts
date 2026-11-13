/**
 * Assinatura do link de compra do Shopping (#921): a rota de cliques (`/go/shop/<id>`) só põe o código de afiliado da
 * Galaxie no redirecionamento quando o link veio da vitrine da Galaxie (`GET /v1/shop`, só para os tenants da
 * Galaxie). O link leva `t=<validade>.<assinatura>`: HMAC-SHA256 do produto, da origem e da validade, com uma chave
 * derivada da `SETTINGS_KEK` do servidor. Link copiado para outro site vence; link sem assinatura, adulterado ou
 * vencido vai para a loja sem código nenhum e não conta como clique.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/** Validade do link: cobre o cache das páginas (minutos) e o app aberto por um dia, sem durar para sempre. */
export const SHOP_CLICK_TTL_MS = 24 * 3_600_000;

const MIN_SECRET = 32;

export class ShopClickSigner {
  private readonly key: Buffer | null;

  constructor(secret: string | undefined) {
    const raw = (secret ?? '').split(',')[0]?.trim() ?? '';
    this.key =
      raw.length >= MIN_SECRET
        ? Buffer.from(hkdfSync('sha256', raw, Buffer.alloc(0), 'galaxie-sports/shop-click/v1', 32))
        : null;
  }

  static fromEnv(env: Readonly<Record<string, string | undefined>> = process.env): ShopClickSigner {
    return new ShopClickSigner(env.SETTINGS_KEK);
  }

  get configured(): boolean {
    return this.key !== null;
  }

  private mac(productId: string, origin: string, exp: number): string {
    return createHmac('sha256', this.key!)
      .update(`${productId.toLowerCase()}|${origin}|${exp}`)
      .digest('base64url')
      .slice(0, 32);
  }

  /** Token do link; sem chave, null (o link sai sem assinatura e não leva código). */
  sign(productId: string, origin: string, now: Date): string | null {
    if (!this.key) return null;
    const exp = Math.floor((now.getTime() + SHOP_CLICK_TTL_MS) / 1000);
    return `${exp}.${this.mac(productId, origin, exp)}`;
  }

  verify(productId: string, origin: string, token: string | undefined, now: Date): boolean {
    if (!this.key || !token) return false;
    const m = /^(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(token);
    if (!m) return false;
    const exp = Number(m[1]);
    if (exp * 1000 < now.getTime()) return false;
    const want = Buffer.from(this.mac(productId, origin, exp));
    const got = Buffer.from(m[2]!);
    return want.length === got.length && timingSafeEqual(want, got);
  }
}
