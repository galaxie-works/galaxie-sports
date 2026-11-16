/**
 * Rotas do torcedor nas Comunidades (épico #936, #939), com o token `gft_`:
 *
 * - `GET /v1/communities`: as Comunidades ativas do cliente, com o vínculo do torcedor em cada uma;
 * - `GET /v1/communities/{id}`: a vitrine (nome, Âncora, membros, Modo de entrada, termos em vigor);
 * - `GET /v1/communities/{id}/terms/{versão}`: o texto dos termos no idioma do torcedor;
 * - `POST /v1/communities/{id}/join`, `.../leave` e `.../accept`: entrar, sair e aceitar a versão nova dos termos.
 *
 * Nada é público (sem token, nada aparece) e tudo exige o módulo `communities`. A Comunidade arquivada ou suspensa
 * não aparece. Quem decide a entrada é `decideJoin` de `@galaxie/engage`; o banco só lê os fatos e grava.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  CommunityAcceptBody,
  CommunityJoinBody,
  CommunityParams,
  CommunityTermsParams,
  type CommunityDetail,
  type CommunityJoinResponse,
  type CommunityList,
  type CommunitySummary,
  type CommunityTerms,
} from '@galaxie/contracts';
import {
  acceptTerms,
  fanCommunityViews,
  joinCommunity,
  leaveCommunity,
  listCommunities,
  readCommunity,
  readTerms,
  tenant,
  type CommunityFanView,
  type CommunityRow,
  type Database,
} from '@galaxie/db';
import { decideJoin, inviteUsable, needsNewAcceptance } from '@galaxie/engage';
import { eq, sql } from 'drizzle-orm';
import { ProblemError, problems } from '../errors.js';
import { parseInput } from '../util.js';

export interface CommunityRoutesDeps {
  db: Database | undefined;
  now?: (() => Date) | undefined;
}

/** Ler e entrar: 13 a 17 lê e reage, sem escrever. O portão de idade decide pela ficha do país. */
const READ = { fan: true, age: 'read' } as const;
/** Sair nunca depende da autorização do responsável: é proteção. */
const SAFETY = { fan: true, age: 'safety' } as const;

const termsLang = (locale: string): 'pt' | 'es' | 'en' =>
  locale.startsWith('pt') ? 'pt' : locale.startsWith('es') ? 'es' : 'en';

export function communitySummary(c: CommunityRow, view: CommunityFanView | undefined): CommunitySummary {
  const membership = view?.membership ?? null;
  const accepted = view?.acceptedTermsVersion ?? null;
  return {
    id: c.id,
    name: c.name,
    anchor: { type: c.anchorType, id: c.anchorId, sport: c.sport },
    join_mode: c.joinMode,
    members: c.members,
    terms_version: c.termsVersion,
    me: {
      membership,
      pending_request: view?.pendingRequest ?? false,
      accepted_terms_version: accepted,
      needs_acceptance: membership === 'active' && needsNewAcceptance(c.termsVersion, accepted),
    },
  };
}

export async function communityRoutes(app: FastifyInstance, deps: CommunityRoutesDeps): Promise<void> {
  const now = () => deps.now?.() ?? new Date();
  const db = () => {
    if (!deps.db) throw problems.degraded('Banco de dados não configurado.');
    return deps.db;
  };

  // Módulo do cliente, guardado por 10 s (ligar e desligar o módulo vale em até 10 s)
  const modules = new Map<string, { at: number; value: Promise<boolean> }>();
  async function requireCommunities(tenantId: string): Promise<void> {
    const hit = modules.get(tenantId);
    let value = hit && Date.now() - hit.at < 10_000 ? hit.value : undefined;
    if (!value) {
      value = db()
        .select({
          ok: sql<boolean>`'communities' = any(${tenant.modules}) and ${tenant.state} in ('trial', 'active', 'past_due')`,
        })
        .from(tenant)
        .where(eq(tenant.id, tenantId))
        .limit(1)
        .then(([row]) => row?.ok === true);
      value.catch(() => modules.delete(tenantId));
      if (modules.size > 10_000) modules.clear();
      modules.set(tenantId, { at: Date.now(), value });
    }
    if (!(await value)) throw problems.moduleNotInPlan('communities');
  }

  /** A Comunidade ativa do cliente, senão 404 (arquivada e suspensa não aparecem). */
  async function activeCommunity(tenantId: string, id: string, locale: string): Promise<CommunityRow> {
    const c = await readCommunity(db(), tenantId, id, locale);
    if (!c || c.state !== 'active') throw problems.notFound('Comunidade');
    return c;
  }

  const noIndex = (reply: FastifyReply) => reply.header('x-robots-tag', 'noindex, nofollow');

  app.get('/v1/communities', { config: READ }, async (request, reply): Promise<CommunityList> => {
    const fan = request.fan!;
    await requireCommunities(fan.tenantId);
    const rows = await listCommunities(db(), fan.tenantId, { states: ['active'], locale: fan.locale });
    const views = await fanCommunityViews(
      db(),
      fan.tenantId,
      fan.profileId,
      rows.map((r) => r.id),
    );
    noIndex(reply);
    return { data: rows.map((r) => communitySummary(r, views.get(r.id))) };
  });

  app.get(
    '/v1/communities/:communityId',
    { config: READ },
    async (request, reply): Promise<CommunityDetail> => {
      const fan = request.fan!;
      const { communityId } = parseInput(CommunityParams, request.params);
      await requireCommunities(fan.tenantId);
      const c = await activeCommunity(fan.tenantId, communityId, fan.locale);
      const view = (await fanCommunityViews(db(), fan.tenantId, fan.profileId, [c.id])).get(c.id);
      noIndex(reply);
      return {
        data: {
          ...communitySummary(c, view),
          features: { member_posts: c.memberPosts, chat: c.chatEnabled },
        },
      };
    },
  );

  app.get(
    '/v1/communities/:communityId/terms/:version',
    { config: READ },
    async (request, reply): Promise<CommunityTerms> => {
      const fan = request.fan!;
      const { communityId, version } = parseInput(CommunityTermsParams, request.params);
      await requireCommunities(fan.tenantId);
      await activeCommunity(fan.tenantId, communityId, fan.locale);
      const terms = await readTerms(db(), fan.tenantId, communityId, version);
      if (!terms) throw problems.notFound('Versão dos termos');
      noIndex(reply);
      return {
        data: {
          version: terms.version,
          text: terms.body[termsLang(fan.locale)],
          published_at: terms.publishedAt.toISOString(),
        },
      };
    },
  );

  app.post(
    '/v1/communities/:communityId/join',
    { config: READ },
    async (request): Promise<CommunityJoinResponse> => {
      const fan = request.fan!;
      const { communityId } = parseInput(CommunityParams, request.params);
      const body = parseInput(CommunityJoinBody, request.body ?? {});
      await requireCommunities(fan.tenantId);
      await activeCommunity(fan.tenantId, communityId, fan.locale);
      const decision = await joinCommunity(
        db(),
        {
          tenantId: fan.tenantId,
          communityId,
          profileId: fan.profileId,
          acceptedTermsVersion: body.accepted_terms_version ?? null,
          inviteCode: body.invite_code ?? null,
          now: now(),
        },
        decideJoin,
        inviteUsable,
      );
      if (!decision.ok)
        throw new ProblemError(
          409,
          'CONFLICT',
          'Entrada recusada',
          `Entrada recusada: ${decision.refusal}.`,
          {
            errors: [{ path: 'refusal', message: decision.refusal }],
          },
        );
      return { data: { result: decision.result } };
    },
  );

  app.post('/v1/communities/:communityId/leave', { config: SAFETY }, async (request, reply) => {
    const fan = request.fan!;
    const { communityId } = parseInput(CommunityParams, request.params);
    await requireCommunities(fan.tenantId);
    // sair vale até de Comunidade arquivada (o vínculo continua lá)
    const c = await readCommunity(db(), fan.tenantId, communityId);
    if (!c) throw problems.notFound('Comunidade');
    await leaveCommunity(db(), { tenantId: fan.tenantId, communityId, profileId: fan.profileId, now: now() });
    return reply.status(204).send();
  });

  app.post('/v1/communities/:communityId/accept', { config: READ }, async (request, reply) => {
    const fan = request.fan!;
    const { communityId } = parseInput(CommunityParams, request.params);
    const { version } = parseInput(CommunityAcceptBody, request.body);
    await requireCommunities(fan.tenantId);
    const c = await activeCommunity(fan.tenantId, communityId, fan.locale);
    // só a versão em vigor: aceitar uma antiga não libera a escrita
    if (c.termsVersion !== version) throw problems.notFound('Versão dos termos');
    const ok = await acceptTerms(db(), {
      tenantId: fan.tenantId,
      communityId,
      profileId: fan.profileId,
      version,
      now: now(),
    });
    if (!ok) throw problems.notFound('Versão dos termos');
    return reply.status(204).send();
  });
}
