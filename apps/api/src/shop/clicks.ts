/**
 * Redirecionamento e registro de cliques do Shopping (#918).
 *
 *   GET /go/shop/:productId?origin=site|app[&event=<uuid>][&lang=pt-BR]
 *
 * Todo "Comprar" passa por aqui: grava o clique e manda o torcedor para a loja com o link que o conector monta
 * (#916). Regras:
 * - o link de destino nunca vem da requisição: sai do produto curado (#914), então não há redirecionamento aberto;
 * - o registro é assíncrono (fila em memória, gravada em lote): não atrasa o redirecionamento;
 * - sem dado pessoal: nada de IP, e-mail ou id do torcedor na tabela. O IP só conta os limites, como hash do prefixo
 *   (/24 no IPv4, /64 no IPv6), numa chave de vida curta no Valkey;
 * - robô, pré-carregamento ou acima do limite: vai para a loja sem código de afiliado nenhum e o clique não conta (as
 *   redes tratam clique forçado como fraude);
 * - clique e compra nunca viram ponto, selo, conquista ou prêmio: nada daqui é publicado no change feed nem chega à
 *   carteira do torcedor ou ao motor de conquistas;
 * - widget do cliente (#925): `origin=client&w=<widget>`, assinado pela rota do widget; o destino sai de novo da
 *   configuração do widget (código do cliente ou repasse pela Galaxie), nunca com o código da Galaxie.
 *
 * No app, o link abre no navegador do sistema (ou no app da loja), nunca em WebView: é o app que abre esta URL fora.
 */
import { createHash } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as z from 'zod';
import {
  event,
  getWidget,
  listShopStoreConnectorRows,
  recordShopClicks,
  shopClickTarget,
  type Database,
  type ShopClickRow,
  type Widget,
} from '@galaxie/db';
import {
  buildAffiliateLink,
  stripAffiliateParams,
  type ShopDestination,
  type ShopStoreConnector,
} from '@galaxie/engage';
import { settingsSecretBox, type SettingsSecretBox } from '@galaxie/runtime-config/sealed';
import type { RateLimiter } from '../rate-limit.js';
import { problems } from '../errors.js';
import { parseInput } from '../util.js';
import type { ShopClickSigner } from './click-token.js';
import { toConnector } from './offers.js';
import { widgetShopDestinations } from './widget.js';

/** Robôs, pré-visualizações de link e clientes de linha de comando: vão para a loja sem código e não contam. */
export const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|embedly|headless|phantom|puppeteer|playwright|curl|wget|python-requests|httpclient|okhttp|go-http|java\//i;

export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || userAgent.length < 10 || BOT_UA.test(userAgent);
}

/** Pré-carregamento do navegador (`Sec-Purpose`/`Purpose: prefetch`): não é clique. */
function isPrefetch(request: FastifyRequest): boolean {
  const v = `${request.headers['sec-purpose'] ?? ''} ${request.headers.purpose ?? ''} ${request.headers['x-moz'] ?? ''}`;
  return /prefetch|prerender/i.test(v);
}

/** Cliques por origem por minuto que contam (acima disso, vai sem código). */
export const CLICKS_PER_MINUTE = 20;
/** Pedidos por origem por minuto que a rota atende (acima disso, 429): freio contra inundação no banco. */
export const REQUESTS_PER_MINUTE = 120;

/** Tentativas de gravar um lote antes de desistir (o banco reiniciando num deploy, por exemplo). */
const MAX_ATTEMPTS = 3;

/** Fila de cliques gravada em lote: o redirecionamento não espera o banco. Os lotes são gravados um de cada vez. */
export class ShopClickRecorder {
  private queue: Array<{ row: ShopClickRow; attempts: number }> = [];
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database,
    private readonly opts: { flushMs?: number; maxBatch?: number; onError?: (err: unknown) => void } = {},
  ) {}

  add(row: ShopClickRow): void {
    this.queue.push({ row, attempts: 0 });
    if (this.queue.length >= (this.opts.maxBatch ?? 200)) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), this.opts.flushMs ?? 2_000);
  }

  /** Grava o que está na fila. Encadeado: um flush nunca corre ao lado de outro nem termina antes do anterior. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.chain = this.chain.then(async () => {
      const batch = this.queue.splice(0);
      if (!batch.length) return;
      try {
        await recordShopClicks(
          this.db,
          batch.map((b) => b.row),
        );
      } catch (err) {
        this.opts.onError?.(err);
        // volta para a fila, com limite de tentativas (sem crescer sem fim se o banco ficar fora)
        const retry = batch.filter((b) => ++b.attempts < MAX_ATTEMPTS);
        this.queue.unshift(...retry);
        if (retry.length) this.timer ??= setTimeout(() => void this.flush(), this.opts.flushMs ?? 2_000);
      }
    });
    return this.chain;
  }

  /** No desligamento: grava até a fila ficar vazia (ou as tentativas acabarem). */
  async close(): Promise<void> {
    for (let i = 0; i <= MAX_ATTEMPTS && this.queue.length; i++) await this.flush();
    await this.chain;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

const Params = z.object({ productId: z.uuid() });
const Query = z.object({
  // origem desconhecida (ex.: widget de cliente antes do #925) é recusada: não pode contar como Galaxie
  origin: z.enum(['site', 'app', 'client']).default('site'),
  // widget do cliente (#925): o widget que montou o link
  w: z.uuid().optional().catch(undefined),
  event: z.uuid().optional().catch(undefined),
  // idioma fora do formato não quebra o "Comprar": só não é gravado
  lang: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Z]{2}|-\d{3})?$/)
    .optional()
    .catch(undefined),
  // assinatura da vitrine da Galaxie (#921): sem ela, nada de código de afiliado
  t: z.string().max(64).optional().catch(undefined),
});

/**
 * País do torcedor pelo cabeçalho do proxy (Cloudflare, épico #635). Antes da Cloudflare na frente qualquer um pode
 * mandar o cabeçalho: o número por país é indicativo até lá.
 */
function countryOf(header: string | string[] | undefined): string | null {
  const v = (Array.isArray(header) ? header[0] : header)?.toUpperCase();
  return v && /^[A-Z]{2}$/.test(v) && v !== 'XX' && v !== 'T1' ? v : null;
}

/** Expande um IPv6 para os 8 grupos (aceita `::` e o IPv4 embutido no fim). */
function expandIPv6(ip: string): string[] {
  let s = ip.toLowerCase();
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[1]!.split('.').map(Number) as [number, number, number, number];
    s = s.slice(0, -tail[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const r = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const fill = rest !== undefined ? Array<string>(Math.max(0, 8 - h.length - r.length)).fill('0') : [];
  return [...h, ...fill, ...r].map((g) => g.padStart(4, '0'));
}

/**
 * Chave da origem para os limites: hash do prefixo do IP (/24 no IPv4, /64 no IPv6), sem guardar o IP. Com a
 * Cloudflare na frente (#635), o IP do torcedor tem de chegar pelo proxy confiável, senão todos dividem a borda.
 */
export function originKey(ip: string): string {
  let prefix = ip;
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped ? mapped[1]! : ip;
  if (isIPv4(v4)) prefix = v4.split('.').slice(0, 3).join('.');
  else if (isIPv6(ip)) prefix = expandIPv6(ip).slice(0, 4).join(':');
  return createHash('sha256').update(prefix).digest('hex').slice(0, 16);
}

export interface ShopClickRoutesOptions {
  db: Database | undefined;
  /** Confere a assinatura do link (só a vitrine da Galaxie assina). */
  signer?: ShopClickSigner;
  limiter: RateLimiter;
  recorder?: ShopClickRecorder;
  box?: Pick<SettingsSecretBox, 'open'>;
  now?: () => Date;
}

/** Lojas relidas do banco a cada 30 s: desligar uma loja vale em até 30 s, sem deploy. */
const STORES_TTL_MS = 30_000;

export async function shopClickRoutes(app: FastifyInstance, opts: ShopClickRoutesOptions): Promise<void> {
  const db = opts.db;
  if (!db) return;
  const recorder =
    opts.recorder ??
    new ShopClickRecorder(db, {
      onError: (err) => app.log.error({ err }, 'shop: lote de cliques não gravado'),
    });
  app.addHook('onClose', async () => recorder.close());

  let stores: { at: number; byId: Map<string, ShopStoreConnector> } | null = null;
  let loading: Promise<void> | null = null;
  const storeOf = async (id: string) => {
    if (!stores || Date.now() - stores.at > STORES_TTL_MS) {
      // uma recarga por vez; se falhar, fica com a lista anterior (e só sem nenhuma o erro sobe)
      loading ??= (async () => {
        try {
          const box = opts.box ?? settingsSecretBox();
          const rows = await listShopStoreConnectorRows(db);
          stores = { at: Date.now(), byId: new Map(rows.map((r) => [r.id, toConnector(r, box)])) };
        } catch (err) {
          app.log.warn({ err }, 'shop: lojas não recarregadas');
          if (!stores) throw err;
        } finally {
          loading = null;
        }
      })();
      await loading;
    }
    return stores!.byId.get(id) ?? null;
  };
  const allStores = async () => {
    await storeOf('');
    return stores!.byId;
  };
  const widgetCache = new Map<string, { value: Widget | null; at: number }>();
  const widgetOf = async (id: string): Promise<Widget | null> => {
    const hit = widgetCache.get(id);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const value = await getWidget(db, id);
    if (widgetCache.size > 10_000) widgetCache.clear();
    widgetCache.set(id, { value, at: Date.now() });
    return value;
  };

  const plain = (url: string) => stripAffiliateParams(new URL(url)).toString();

  app.get(
    '/go/shop/:productId',
    // HEAD (verificador de link, antivírus de e-mail) não é clique
    { exposeHeadRoute: false },
    async (request, reply) => {
      const { productId } = parseInput(Params, request.params);
      const q = parseInput(Query, request.query);
      const key = originKey(request.ip);
      let served = true;
      let resetSec = 60;
      try {
        const r = await opts.limiter.hit(`shopgo:${key}`, REQUESTS_PER_MINUTE, 60_000);
        served = r.allowed;
        resetSec = Math.max(1, Math.ceil(r.resetMs / 1000));
      } catch {
        // limite indisponível não derruba o clique (fail-open), como no resto da API
      }
      if (!served) throw problems.rateLimited(resetSec);

      const target = await shopClickTarget(db, productId);
      const store = target ? await storeOf(target.storeId) : null;
      if (!target || !store?.active) throw problems.notFound('Produto');
      reply.header('cache-control', 'no-store').header('referrer-policy', 'strict-origin-when-cross-origin');
      // link que não veio da vitrine da Galaxie (copiado para outro site, adulterado ou vencido): sem código e sem
      // contar. Assim o código da Galaxie não roda a partir de domínio de cliente
      const now = opts.now?.() ?? new Date();
      // origem assinada: a da vitrine da Galaxie (`site`/`app`) ou a do widget do cliente (`client:<widget>`)
      const signedOrigin = q.origin === 'client' ? (q.w ? `client:${q.w}` : null) : q.origin;
      if (!signedOrigin || !opts.signer?.verify(productId, signedOrigin, q.t, now))
        return reply.redirect(plain(target.url), 302);
      // widget do cliente: o destino sai da configuração dele de novo (loja ainda ligada, checagem em dia), sempre
      // com o código do cliente ou o repasse pela Galaxie, nunca com o código da Galaxie
      let widget: Widget | null = null;
      let dest: ShopDestination = { kind: 'galaxie' };
      if (q.origin === 'client') {
        widget = await widgetOf(q.w!);
        if (!widget || widget.archivedAt || widget.kind !== 'shop_the_game')
          return reply.redirect(plain(target.url), 302);
        const d = widgetShopDestinations(widget.tenantId, widget.config.shop, await allStores()).get(
          store.id,
        );
        if (!d) return reply.redirect(plain(target.url), 302);
        dest = d.dest;
      }
      const link = buildAffiliateLink(store, target, dest);
      // sem link (credenciais faltando): para a loja sem código nenhum; não há o que medir
      if (!link.ok) return reply.redirect(plain(target.url), 302);

      let counts = !isBot(request.headers['user-agent']) && !isPrefetch(request);
      if (counts) {
        try {
          counts = (await opts.limiter.hit(`shopclick:${key}`, CLICKS_PER_MINUTE, 60_000)).allowed;
        } catch {
          // fail-open
        }
      }
      if (!counts) return reply.redirect(plain(target.url), 302);

      // jogo que não existe não infla a estatística de ninguém
      let eventId: string | null = null;
      if (q.event) {
        const [row] = await db.select({ id: event.id }).from(event).where(eq(event.id, q.event));
        eventId = row?.id ?? null;
      }
      recorder.add({
        clickedAt: opts.now?.() ?? new Date(),
        eventId,
        entityKind: target.entityKind,
        entityId: target.entityId,
        productId: target.productId,
        storeId: target.storeId,
        origin: widget ? 'client' : q.origin === 'app' ? 'galaxie_app' : 'galaxie_site',
        tenantId: widget?.tenantId ?? null,
        widgetId: widget?.id ?? null,
        country: countryOf(request.headers['cf-ipcountry']),
        locale: q.lang ?? null,
      });
      return reply.redirect(link.url, 302);
    },
  );
}
