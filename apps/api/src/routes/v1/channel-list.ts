import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ChannelListBody } from '@galaxie/contracts';
import { confirmChannelList, getChannelList, type TenantChannelList } from '@galaxie/db';
import {
  CHANNEL_LIST_MAX_BYTES,
  CHANNEL_LIST_MAX_CHANNELS,
  ChannelListError,
  parseChannelList,
  WTW_COUNTRIES,
  type ChannelOverride,
  type WtwCountry,
} from '@galaxie/where-to-watch';
import type { TenantContext } from '../../auth/authenticator.js';
import { channelListDto, storeChannelList } from '../../channel-list/lists.js';
import { requireDb, type AppContext } from '../../context.js';
import { problems } from '../../errors.js';
import { formatInstant } from '../../i18n.js';
import { parseInput } from '../../util.js';

const MODULE = { module: 'where_to_watch' } as const;

/** Só a chave secreta (backend do cliente) lê e muda a lista; a publicável fica de fora. */
function secretTenant(request: FastifyRequest): TenantContext {
  const t = request.tenant;
  if (!t) throw problems.invalidKey();
  if (t.keyKind !== 'secret') throw problems.publishableKeyNotAllowed();
  return t;
}

const isCountry = (c: string | null | undefined): c is WtwCountry =>
  !!c && (WTW_COUNTRIES as readonly string[]).includes(c);

const dto = (row: TenantChannelList) => channelListDto(row, (d) => formatInstant(d, 'UTC'));

/**
 * Lista de canais do tenant (docs/05 §4.2): GET consulta, PUT envia ou substitui, POST reprocess refaz
 * o casamento por código com o dicionário atual e POST confirm publica o casamento em `client_channels`.
 * As sobras vão para o job da IA (`channel-lists`, na VPS). Respostas nunca são cacheadas.
 */
export async function channelListRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const config = () => {
    const c = ctx.wtwConfig?.();
    if (!c) throw problems.degraded('Dicionário de emissoras indisponível.');
    return c;
  };
  const noStore = {
    onSend: async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.header('cache-control', 'no-store');
    },
  };

  app.get('/v1/channel-list', { config: MODULE, ...noStore }, async (request) => {
    const t = secretTenant(request);
    const row = await getChannelList(requireDb(ctx), t.tenantId);
    if (!row) throw problems.notFound('Lista de canais');
    return dto(row);
  });

  app.put(
    '/v1/channel-list',
    { config: MODULE, bodyLimit: CHANNEL_LIST_MAX_BYTES + 64 * 1024, ...noStore },
    async (request) => {
      const t = secretTenant(request);
      const body = parseInput(ChannelListBody.strict(), request.body ?? {});
      if (body.default_country && !isCountry(body.default_country))
        throw problems.invalidParams([{ path: 'default_country', message: 'país fora do onde assistir' }]);
      let parsed;
      try {
        parsed = parseChannelList(body.content, body.format);
      } catch (err) {
        if (err instanceof ChannelListError)
          throw problems.invalidParams([{ path: 'content', message: err.message }]);
        throw err;
      }
      // o parser descarta o que passa do limite; pela API o cliente não veria o corte, então a lista volta
      if (parsed.truncated > 0) {
        const max = CHANNEL_LIST_MAX_CHANNELS.toLocaleString('pt-BR');
        throw problems.invalidParams([
          {
            path: 'content',
            message: `a lista passa de ${max} canais (${parsed.truncated} a mais, sem contar os repetidos); envie até ${max}`,
          },
        ]);
      }
      const db = requireDb(ctx);
      const current = await getChannelList(db, t.tenantId);
      const row = await storeChannelList(db, config(), t.tenantId, {
        source: parsed.format,
        channels: parsed.channels,
        tenantMarkets: t.markets,
        defaultCountry: isCountry(body.default_country) ? body.default_country : null,
        // as correções do portal seguem valendo para os canais de mesmo nome
        overrides: (current?.overrides ?? []) as ChannelOverride[],
      });
      ctx.channelLists.invalidate(t.tenantId);
      request.log.info(
        { tenant: t.slug, channels: parsed.channels.length, ai: row.aiStatus },
        'lista de canais recebida',
      );
      return dto(row);
    },
  );

  app.post('/v1/channel-list/reprocess', { config: MODULE, ...noStore }, async (request) => {
    const t = secretTenant(request);
    const db = requireDb(ctx);
    const current = await getChannelList(db, t.tenantId);
    if (!current) throw problems.notFound('Lista de canais');
    const row = await storeChannelList(db, config(), t.tenantId, {
      source: current.source,
      channels: current.channels,
      tenantMarkets: t.markets,
      defaultCountry: isCountry(current.defaultCountry) ? current.defaultCountry : null,
      overrides: current.overrides as ChannelOverride[],
      userId: current.uploadedBy,
    });
    return dto(row);
  });

  app.post('/v1/channel-list/confirm', { config: MODULE, ...noStore }, async (request) => {
    const t = secretTenant(request);
    const db = requireDb(ctx);
    const row = await confirmChannelList(db, t.tenantId, `api:${t.keyId}`);
    if (!row) throw problems.notFound('Lista de canais');
    ctx.channelLists.invalidate(t.tenantId);
    return dto(row);
  });
}
