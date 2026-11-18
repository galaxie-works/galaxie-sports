/**
 * Enquetes (#947), motor único da Comunidade e da Sala do Jogo:
 *
 * - `POST /v1/polls` e `PATCH /v1/polls/{id}`: o servidor do cliente cria e fecha (chave secreta). Com
 *   `community_id`, enquete da Comunidade (módulo `communities`); sem ele, da Sala do Jogo (módulo `live_chat`). O
 *   craque do jogo usa a escalação e é um só por jogo e lugar;
 * - `GET /v1/polls/{id}` e `POST /v1/polls/{id}/votes`: o torcedor lê e vota (`config.age: 'react'`: 13 a 17 vota).
 *   Na Comunidade, só membro;
 * - `GET /v1/communities/{id}/polls` (membro) e `GET /v1/chat/rooms/{jogo}/polls` (chave, como a leitura da sala).
 *
 * Pergunta e opções passam pela base de regras (#969). Os Pontos do voto vêm da Gamificação, que varre os votos
 * (`GameScorer.sweepPolls`); sem ela, a enquete funciona igual.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CommunityParams,
  CommunityPollCreateBody,
  CommunityPollPatchBody,
  CommunityVoteBody,
  PollParams,
  PollsQuery,
  RoomPollsParams,
  type CommunityPoll,
  type CommunityPollList,
  type CommunityPollResponse,
} from '@galaxie/contracts';
import {
  castVote,
  closePoll,
  CommunityPollError,
  createPoll,
  event,
  listPolls,
  memberStanding,
  readCommunity,
  readPoll,
  type CommunityPollRow,
  type Database,
} from '@galaxie/db';
import { screen } from '@galaxie/engage';
import { eq } from 'drizzle-orm';
import { requireModule, type TenantContext } from '../auth/authenticator.js';
import { tenantHasLiveChat } from '../chat/rooms.js';
import { ProblemError, problems } from '../errors.js';
import { buildLineups } from '../events/detail.js';
import { parseInput } from '../util.js';
import { CommunityGate } from './community-routes.js';
import { ModerationLists } from './moderation.js';

export interface CommunityPollRoutesDeps {
  db: Database | undefined;
  now?: (() => Date) | undefined;
}

/** Servidor do cliente: chave do tenant (a rota confere que é a secreta). */
const SECRET = { authenticated: true } as const;
const FAN_READ = { fan: true, age: 'read' } as const;
const FAN_VOTE = { fan: true, age: 'react', fanBucket: { name: 'vote', perMinute: 120 } } as const;

const refuse = (refusal: string, detail: string) =>
  new ProblemError(409, 'CONFLICT', 'Voto recusado', detail, {
    errors: [{ path: 'refusal', message: refusal }],
  });

export function pollView(p: CommunityPollRow): CommunityPoll {
  return {
    id: p.id,
    scope: p.scope,
    community_id: p.communityId,
    fixture_id: p.eventId,
    kind: p.kind,
    question: p.question,
    open: p.open,
    closes_at: p.closesAt?.toISOString() ?? null,
    total_votes: p.totalVotes,
    my_option_id: p.myOptionId,
    options: p.options.map((o) => ({
      id: o.id,
      label: o.label,
      person: o.personId ? { id: o.personId, name: o.personName } : null,
      team: o.participantId ? { id: o.participantId, name: o.participantName } : null,
      votes: o.votes,
      share: p.totalVotes ? o.votes / p.totalVotes : 0,
    })),
    created_at: p.createdAt.toISOString(),
  };
}

/** Chave secreta (servidor do cliente). */
function secretTenant(request: FastifyRequest): TenantContext {
  const t = request.tenant!;
  if (t.keyKind !== 'secret' || !t.keyPrefix)
    throw problems.invalidKey('Use a chave secreta no header x-galaxie-key, no seu servidor.');
  return t;
}

export async function communityPollRoutes(
  app: FastifyInstance,
  deps: CommunityPollRoutesDeps,
): Promise<void> {
  const gate = new CommunityGate(deps.db);
  const db = () => gate.db();
  const now = () => deps.now?.() ?? new Date();
  const moderation = deps.db ? new ModerationLists(deps.db) : null;

  /** Texto da equipe: a base de regras recusa o que barraria ou esconderia (sem fila: a equipe reescreve). */
  async function cleanText(tenantId: string, locale: string, path: string, raw: string): Promise<string> {
    const text = raw.trim();
    const lists = await moderation!.forTenant(tenantId);
    const r = screen(text, { kind: 'poll_option', locale }, lists);
    if (r.action !== 'allow' || !text)
      throw problems.invalidParams([{ path, message: 'texto recusado pelas regras da plataforma' }]);
    return text;
  }

  /** Enquete que o torcedor pode ler e votar: na Comunidade, membro ativo; na Sala, cliente com o Chat ao vivo. */
  async function fanPoll(fan: { tenantId: string; profileId: string; locale: string }, pollId: string) {
    const poll = await readPoll(db(), fan.tenantId, pollId, fan.profileId, now());
    if (!poll) throw problems.notFound('Enquete');
    if (poll.scope === 'community') {
      await gate.requireModule(fan.tenantId);
      await gate.activeCommunity(fan.tenantId, poll.communityId!, fan.locale);
      const standing = await memberStanding(db(), fan.tenantId, poll.communityId!, fan.profileId);
      if (!standing.member) throw refuse('not_member', 'Entre na Comunidade para votar.');
    } else if (!(await tenantHasLiveChat(db(), fan.tenantId))) throw problems.moduleNotInPlan('live_chat');
    return poll;
  }

  app.post('/v1/polls', { config: SECRET }, async (request, reply) => {
    const tenant = secretTenant(request);
    const body = parseInput(CommunityPollCreateBody, request.body);
    const database = db();
    const locale = 'pt-BR';
    if (body.community_id) {
      await gate.requireModule(tenant.tenantId);
      const c = await readCommunity(database, tenant.tenantId, body.community_id);
      if (!c || c.state !== 'active') throw problems.notFound('Comunidade');
    } else {
      requireModule(tenant, 'live_chat');
      if (!body.fixture_id)
        throw problems.invalidParams([
          { path: 'fixture_id', message: 'obrigatório na enquete da Sala do Jogo' },
        ]);
    }
    let ev: { id: string; sport: string } | null = null;
    if (body.fixture_id) {
      const [row] = await database
        .select({ id: event.id, sport: event.sport })
        .from(event)
        .where(eq(event.id, body.fixture_id))
        .limit(1);
      if (!row) throw problems.notFound('Jogo');
      ev = row;
    }
    let options: { label: string | null; personId: string | null; participantId: string | null }[];
    let question: string | null = null;
    if (body.kind === 'man_of_match') {
      if (!ev)
        throw problems.invalidParams([{ path: 'fixture_id', message: 'obrigatório no craque do jogo' }]);
      const lineups = await buildLineups(database, ev, undefined);
      options = lineups.lineups.flatMap((l) =>
        [...l.start_xi, ...l.substitutes]
          .filter((p) => p.person.id)
          .map((p) => ({ label: null, personId: p.person.id!, participantId: l.team.id ?? null })),
      );
      if (options.length < 2)
        throw problems.invalidParams([{ path: 'kind', message: 'a escalação do jogo ainda não saiu' }]);
      options = options.slice(0, 60);
    } else {
      if (!body.question || !body.options)
        throw problems.invalidParams([{ path: 'question', message: 'pergunta e opções são obrigatórias' }]);
      question = await cleanText(tenant.tenantId, locale, 'question', body.question);
      options = [];
      for (const [i, o] of body.options.entries())
        options.push({
          label: await cleanText(tenant.tenantId, locale, `options.${i}`, o),
          personId: null,
          participantId: null,
        });
    }
    try {
      const res = await createPoll(database, {
        tenantId: tenant.tenantId,
        scope: body.community_id ? 'community' : 'room',
        communityId: body.community_id ?? null,
        eventId: ev?.id ?? null,
        kind: body.kind,
        question,
        closesAt: body.closes_at ? new Date(body.closes_at) : null,
        createdBy: `tenant:${tenant.keyPrefix}`,
        options,
      });
      const poll = await readPoll(database, tenant.tenantId, res.id, null, now());
      const out: CommunityPollResponse = { data: pollView(poll!) };
      return reply.code(res.created ? 201 : 200).send(out);
    } catch (err) {
      if (err instanceof CommunityPollError && err.code === 'no_options')
        throw problems.invalidParams([{ path: 'options', message: 'de 2 a 60 opções' }]);
      throw err;
    }
  });

  app.patch('/v1/polls/:pollId', { config: SECRET }, async (request): Promise<CommunityPollResponse> => {
    const tenant = secretTenant(request);
    const { pollId } = parseInput(PollParams, request.params);
    parseInput(CommunityPollPatchBody, request.body);
    const before = await readPoll(db(), tenant.tenantId, pollId, null, now());
    if (!before) throw problems.notFound('Enquete');
    await closePoll(db(), {
      tenantId: tenant.tenantId,
      pollId,
      actor: `tenant:${tenant.keyPrefix}`,
      now: now(),
    });
    return { data: pollView((await readPoll(db(), tenant.tenantId, pollId, null, now()))!) };
  });

  app.get(
    '/v1/polls/:pollId',
    { config: FAN_READ },
    async (request, reply): Promise<CommunityPollResponse> => {
      const fan = request.fan!;
      const { pollId } = parseInput(PollParams, request.params);
      const poll = await fanPoll(fan, pollId);
      reply.header('x-robots-tag', 'noindex, nofollow');
      return { data: pollView(poll) };
    },
  );

  app.post('/v1/polls/:pollId/votes', { config: FAN_VOTE }, async (request, reply) => {
    const fan = request.fan!;
    const { pollId } = parseInput(PollParams, request.params);
    const { option_id } = parseInput(CommunityVoteBody, request.body);
    await fanPoll(fan, pollId);
    try {
      await castVote(db(), {
        tenantId: fan.tenantId,
        pollId,
        optionId: option_id,
        profileId: fan.profileId,
        now: now(),
      });
    } catch (err) {
      if (err instanceof CommunityPollError) {
        if (err.code === 'closed') throw refuse('closed', 'A votação desta enquete já fechou.');
        if (err.code === 'duplicate') throw refuse('already_voted', 'Você já votou nesta enquete.');
        if (err.code === 'bad_option') throw refuse('bad_option', 'Essa opção não é desta enquete.');
        if (err.code === 'not_found') throw problems.notFound('Enquete');
      }
      throw err;
    }
    const out: CommunityPollResponse = {
      data: pollView((await readPoll(db(), fan.tenantId, pollId, fan.profileId, now()))!),
    };
    return reply.code(201).send(out);
  });

  app.get(
    '/v1/communities/:communityId/polls',
    { config: FAN_READ },
    async (request, reply): Promise<CommunityPollList> => {
      const fan = request.fan!;
      const { communityId } = parseInput(CommunityParams, request.params);
      const q = parseInput(PollsQuery, request.query);
      await gate.requireModule(fan.tenantId);
      await gate.activeCommunity(fan.tenantId, communityId, fan.locale);
      const standing = await memberStanding(db(), fan.tenantId, communityId, fan.profileId);
      if (!standing.member) throw refuse('not_member', 'Entre na Comunidade para ver as enquetes.');
      const rows = await listPolls(db(), {
        tenantId: fan.tenantId,
        where: { communityId },
        viewerProfileId: fan.profileId,
        before: q.before ?? null,
        limit: q.limit,
        now: now(),
      });
      reply.header('x-robots-tag', 'noindex, nofollow');
      return { data: rows.map(pollView), next: rows.length === q.limit ? rows[rows.length - 1]!.id : null };
    },
  );

  app.get(
    '/v1/chat/rooms/:fixtureId/polls',
    { config: { module: 'live_chat' as const } },
    async (request, reply): Promise<CommunityPollList> => {
      const { fixtureId } = parseInput(RoomPollsParams, request.params);
      const q = parseInput(PollsQuery, request.query);
      const rows = await listPolls(db(), {
        tenantId: request.tenant!.tenantId,
        where: { roomEventId: fixtureId },
        viewerProfileId: null,
        before: q.before ?? null,
        limit: q.limit,
        now: now(),
      });
      reply.header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow');
      return { data: rows.map(pollView), next: rows.length === q.limit ? rows[rows.length - 1]!.id : null };
    },
  );
}
