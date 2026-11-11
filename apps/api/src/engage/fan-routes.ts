/**
 * Rotas da identidade do torcedor (#937, docs/05 §9):
 *
 * - `POST /v1/fans/tokens`: o servidor do cliente (chave secreta) pede o token `gft_` do torcedor;
 * - `GET` e `PATCH /v1/fans/me`: o torcedor, com o token, lê o Perfil e muda visibilidade e time do coração;
 * - `DELETE /v1/fans/{conta}/profiles/{perfil}`: o servidor do cliente exclui o Perfil.
 *
 * Emitir e excluir exigem um módulo de engajamento no plano. A chave publicável nunca chega aqui (só faz GET
 * de leitura; o hook geral responde 403 PUBLISHABLE_KEY_NOT_ALLOWED).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  FanMePatchBody,
  FanProfileParams,
  FanTokenBody,
  type FanMe,
  type FanTokenResponse,
} from '@galaxie/contracts';
import { screen, screenNotice } from '@galaxie/engage';
import { isEngageModule, type Database } from '@galaxie/db';
import type { TenantContext } from '../auth/authenticator.js';
import { problems } from '../errors.js';
import { parseInput } from '../util.js';
import { FAN_REVOCATION_TTL_S, type FanRevocations, type FanTokenTtl } from './fan-auth.js';
import { fanCan, fanCapabilities } from './fan-rules.js';
import type { FanTokenSigner } from './fan-token.js';
import { eraseFan, patchFan, readFan, storedNickname, upsertFan, type FanProfileView } from './fans.js';
import { ModerationLists } from './moderation.js';

export interface FanRoutesDeps {
  db: Database | undefined;
  signer: FanTokenSigner | null;
  ttl: FanTokenTtl;
  revocations: FanRevocations;
}

/** Chave secreta de um tenant com algum módulo de engajamento. */
function engageTenant(request: FastifyRequest): TenantContext {
  const tenant = request.tenant;
  if (!tenant || tenant.keyKind !== 'secret' || !tenant.keyPrefix)
    throw problems.invalidKey('Use a chave secreta no header x-galaxie-key, no seu servidor.');
  if (!tenant.modules.some(isEngageModule)) throw problems.moduleNotInPlan('de engajamento');
  return tenant;
}

function meBody(p: FanProfileView): FanMe {
  return {
    data: {
      profile_id: p.profileId,
      nickname: p.nickname,
      avatar_url: p.avatarUrl,
      age_band: p.ageBand,
      country: p.country,
      locale: p.locale,
      favorite_team_id: p.favoriteTeamId,
      visibility: p.visibility,
      capabilities: fanCapabilities(p.ageBand),
      holder_adult: p.holderAdult,
    },
  };
}

export async function fanRoutes(app: FastifyInstance, deps: FanRoutesDeps): Promise<void> {
  const db = () => {
    if (!deps.db) throw problems.degraded('Banco de dados não configurado.');
    return deps.db;
  };
  const moderation = deps.db ? new ModerationLists(deps.db) : null;
  const signer = () => {
    if (!deps.signer) throw problems.degraded('Tokens do torcedor não configurados (FAN_TOKEN_SECRET).');
    return deps.signer;
  };

  app.post('/v1/fans/tokens', { config: { authenticated: true } }, async (request, reply) => {
    const tenant = engageTenant(request);
    const body = parseInput(FanTokenBody, request.body);
    const sign = signer();
    const database = db();
    // Apelido passa pelo filtro (#969) quando é novo ou mudou: qualquer achado recusa, porque o Apelido aparece para
    // todos. O Apelido que já estava gravado não tranca o login quando a lista ganha um termo (rever os Apelidos
    // gravados contra a lista nova fica para a fila de moderação, B8 #953).
    const stored = await storedNickname(
      database,
      tenant.tenantId,
      body.externalAccountId,
      body.externalProfileId,
    );
    if (stored !== body.nickname) {
      const screened = screen(
        body.nickname,
        { kind: 'nickname', locale: body.locale },
        await moderation!.forTenant(tenant.tenantId),
      );
      if (screened.action !== 'allow')
        throw problems.invalidParams(
          [{ path: 'nickname', message: screenNotice(screened, 'pt-BR') ?? 'Apelido não permitido.' }],
          'Apelido não permitido pelas regras de moderação.',
        );
    }
    const { accountId, profileId } = await upsertFan(database, {
      tenantId: tenant.tenantId,
      externalAccountId: body.externalAccountId,
      externalProfileId: body.externalProfileId,
      nickname: body.nickname,
      avatarUrl: body.avatarUrl,
      ageBand: body.ageBand,
      country: body.country,
      locale: body.locale,
      holderAdult: body.holderAdult,
      favoriteTeamId: body.favoriteTeamId,
    });
    const ttl = await deps.ttl.seconds();
    const { token, expiresAt } = sign.issue(
      {
        tenantId: tenant.tenantId,
        accountId,
        profileId,
        ageBand: body.ageBand,
        country: body.country,
        locale: body.locale,
        holderAdult: body.holderAdult,
        surface: body.surface,
      },
      ttl,
    );
    reply.header('cache-control', 'no-store');
    const res: FanTokenResponse = {
      data: { token, expires_at: expiresAt.toISOString(), expires_in: ttl, profile_id: profileId },
    };
    return reply.code(201).send(res);
  });

  app.get('/v1/fans/me', { config: { fan: true } }, async (request) => {
    const fan = request.fan!;
    const profile = await readFan(db(), fan.tenantId, fan.profileId);
    if (!profile) throw problems.invalidFanToken('Perfil excluído.');
    return meBody(profile);
  });

  app.patch('/v1/fans/me', { config: { fan: true } }, async (request) => {
    const fan = request.fan!;
    if (!fanCan(fan.ageBand, 'read'))
      throw problems.fanAgeRestricted('Perfis com menos de 13 anos não usam os recursos sociais.');
    const body = parseInput(FanMePatchBody, request.body);
    const changed = await patchFan(db(), fan.tenantId, fan.profileId, {
      favoriteTeamId: body.favoriteTeamId,
      visibility: body.visibility,
    });
    if (!changed) throw problems.invalidFanToken('Perfil excluído.');
    const profile = await readFan(db(), fan.tenantId, fan.profileId);
    if (!profile) throw problems.invalidFanToken('Perfil excluído.');
    return meBody(profile);
  });

  app.delete(
    '/v1/fans/:externalAccountId/profiles/:externalProfileId',
    { config: { authenticated: true } },
    async (request, reply) => {
      const tenant = engageTenant(request);
      const params = parseInput(FanProfileParams, request.params);
      const erased = await eraseFan(db(), {
        tenantId: tenant.tenantId,
        externalAccountId: params.externalAccountId,
        externalProfileId: params.externalProfileId,
        requestedBy: `key:${tenant.keyPrefix}`,
      });
      if (erased) {
        try {
          await deps.revocations.revoke(tenant.tenantId, erased.profileId, FAN_REVOCATION_TTL_S);
        } catch (err) {
          // o Perfil já está excluído no banco: as rotas que leem o Perfil recusam o token mesmo sem a marca
          request.log.warn({ err }, 'marca de exclusão do torcedor não gravada');
        }
        request.log.info(
          { tenant: tenant.slug, event: 'fan.profile.deleted', profile: erased.profileId },
          'Perfil do torcedor excluído',
        );
      }
      reply.header('cache-control', 'no-store');
      return reply.code(204).send();
    },
  );
}
