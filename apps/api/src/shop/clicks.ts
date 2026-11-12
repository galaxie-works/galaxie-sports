/**
 * Redirecionamento e registro de cliques do Shopping (#918).
 *
 *   GET /go/shop/:productId?origin=site|app[&event=<uuid>][&lang=pt-BR]
 *
 * Todo "Comprar" passa por aqui: grava o clique e manda o torcedor para a loja com o link que o conector monta
 * (#916). Regras:
 * - o link de destino nunca vem da requisição: sai do produto curado (#914), então não há redirecionamento aberto;
 * - o registro é assíncrono (fila em memória, gravada em lote): não atrasa o redirecionamento;
 * - sem dado pessoal: nada de IP, e-mail ou id do torcedor na tabela. O IP só conta o limite por origem, mascarado,
 *   numa chave de vida curta no Valkey;
 * - robô ou acima do limite: vai para a loja sem código de afiliado e o clique não conta (as redes tratam clique
 *   forçado como fraude);
 * - clique e compra nunca viram ponto, selo, conquista ou prêmio: nada daqui é publicado no change feed nem chega à
 *   carteira do torcedor ou ao motor de conquistas;
 * - o widget do cliente (#925) entra quando a matriz e o código de cada cliente estiverem no Builder; até lá, só
 *   site e app Galaxie.
 *
 * No app, o link abre no navegador do sistema (ou no app da loja), nunca em WebView: é o app que abre esta URL fora.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as z from 'zod';
import {
  listShopStoreConnectorRows,
  recordShopClicks,
  shopClickTarget,
  type Database,
  type ShopClickRow,
} from '@galaxie/db';
import { buildAffiliateLink, type ShopStoreConnector } from '@galaxie/engage';
import type { SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import { settingsSecretBox } from '@galaxie/runtime-config/sealed';
import type { RateLimiter } from '../rate-limit.js';
import { problems } from '../errors.js';
import { parseInput } from '../util.js';
import { toConnector } from './offers.js';

/** Robôs, pré-visualizações de link e clientes de linha de comando: vão para a loja sem código e não contam. */
export const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|embedly|headless|phantom|puppeteer|playwright|curl|wget|python-requests|httpclient|okhttp|go-http|java\//i;

export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || userAgent.length < 10 || BOT_UA.test(userAgent);
}

/** Cliques por origem (IP mascarado) por minuto antes de deixar de contar. */
export const CLICKS_PER_MINUTE = 20;

/** Fila de cliques gravada em lote: o redirecionamento não espera o banco. */
export class ShopClickRecorder {
  private queue: ShopClickRow[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly db: Database,
    private readonly opts: { flushMs?: number; maxBatch?: number; onError?: (err: unknown) => void } = {},
  ) {}

  add(row: ShopClickRow): void {
    this.queue.push(row);
    if (this.queue.length >= (this.opts.maxBatch ?? 200)) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), this.opts.flushMs ?? 2_000);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flushing;
    const batch = this.queue.splice(0);
    if (!batch.length) return;
    this.flushing = recordShopClicks(this.db, batch).catch((err) => this.opts.onError?.(err));
    await this.flushing;
    this.flushing = null;
  }
}

const Params = z.object({ productId: z.uuid() });
const Query = z.object({
  origin: z.enum(['site', 'app']).default('site'),
  event: z.uuid().optional(),
  lang: z
    .string()
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .optional(),
});

/** País do torcedor pelo cabeçalho do proxy (Cloudflare), quando vem. */
function countryOf(header: string | string[] | undefined): string | null {
  const v = (Array.isArray(header) ? header[0] : header)?.toUpperCase();
  return v && /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1' ? v : null;
}

/** Chave do limite: hash do IP truncado (sem guardar o IP), por produto. */
function originKey(ip: string): string {
  const masked = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip.split('.').slice(0, 3).join('.');
  return createHash('sha256').update(masked).digest('hex').slice(0, 16);
}

export interface ShopClickRoutesOptions {
  db: Database | undefined;
  limiter: RateLimiter;
  recorder?: ShopClickRecorder;
  box?: Pick<SettingsSecretBox, 'open'>;
  now?: () => Date;
}

export async function shopClickRoutes(app: FastifyInstance, opts: ShopClickRoutesOptions): Promise<void> {
  const db = opts.db;
  if (!db) return;
  const recorder =
    opts.recorder ??
    new ShopClickRecorder(db, { onError: (err) => app.log.error({ err }, 'shop: clique não gravado') });
  app.addHook('onClose', async () => recorder.flush());

  let stores: { at: number; byId: Map<string, ShopStoreConnector> } | null = null;
  const storeOf = async (id: string) => {
    const t = Date.now();
    if (!stores || t - stores.at > 60_000) {
      const box = opts.box ?? settingsSecretBox();
      const rows = await listShopStoreConnectorRows(db);
      stores = { at: t, byId: new Map(rows.map((r) => [r.id, toConnector(r, box)])) };
    }
    return stores.byId.get(id) ?? null;
  };

  app.get('/go/shop/:productId', async (request, reply) => {
    const { productId } = parseInput(Params, request.params);
    const q = parseInput(Query, request.query);
    const target = await shopClickTarget(db, productId);
    const store = target ? await storeOf(target.storeId) : null;
    if (!target || !store?.active) throw problems.notFound('Produto');
    const link = buildAffiliateLink(store, target, { kind: 'galaxie' });
    // sem link (credenciais faltando): para a loja sem código; não há o que medir
    if (!link.ok) return reply.header('cache-control', 'no-store').redirect(target.url, 302);

    let counts = !isBot(request.headers['user-agent']);
    if (counts) {
      try {
        const r = await opts.limiter.hit(`shopclick:${originKey(request.ip)}`, CLICKS_PER_MINUTE, 60_000);
        counts = r.allowed;
      } catch {
        // limite indisponível não derruba o clique (fail-open), como no resto da API
      }
    }
    if (!counts) return reply.header('cache-control', 'no-store').redirect(target.url, 302);

    recorder.add({
      clickedAt: opts.now?.() ?? new Date(),
      eventId: q.event ?? null,
      entityKind: target.entityKind,
      entityId: target.entityId,
      productId: target.productId,
      storeId: target.storeId,
      origin: q.origin === 'app' ? 'galaxie_app' : 'galaxie_site',
      tenantId: null,
      widgetId: null,
      country: countryOf(request.headers['cf-ipcountry']),
      locale: q.lang ?? null,
    });
    return reply
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer-when-downgrade')
      .redirect(link.url, 302);
  });
}
