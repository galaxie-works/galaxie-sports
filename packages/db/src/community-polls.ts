/**
 * Enquetes (#947): motor único da Comunidade e da Sala do Jogo. Um voto por Perfil e enquete, resultado ao vivo,
 * craque do jogo com as opções da escalação. Votar dá Pontos de participação pela Gamificação (#938), que varre os
 * votos recentes (`pollVoteCandidates`) com o teto diário; sem a Gamificação ligada, a enquete funciona igual.
 *
 * As regras (quem vota, o texto da pergunta) ficam nas rotas e em `@galaxie/engage`; aqui a leitura e a gravação,
 * sempre filtradas pelo tenant.
 */
import { and, asc, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  communityPoll,
  communityPollOption,
  communityPollVote,
  type CommunityPollKind,
  type CommunityPollScope,
} from './schema/community.js';
import { participant, person } from './schema/core.js';

export interface CommunityPollOptionRow {
  id: string;
  position: number;
  label: string | null;
  personId: string | null;
  personName: string | null;
  participantId: string | null;
  participantName: string | null;
  votes: number;
}

export interface CommunityPollRow {
  id: string;
  scope: CommunityPollScope;
  communityId: string | null;
  eventId: string | null;
  kind: CommunityPollKind;
  question: string | null;
  closesAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  /** Aberta agora (sem `closed_at` e antes de `closes_at`). */
  open: boolean;
  totalVotes: number;
  /** Opção em que o torcedor votou (null se não votou ou sem torcedor). */
  myOptionId: string | null;
  options: CommunityPollOptionRow[];
}

export class CommunityPollError extends Error {
  constructor(readonly code: 'not_found' | 'closed' | 'bad_option' | 'duplicate' | 'no_options') {
    super(code);
    this.name = 'CommunityPollError';
  }
}

/** Cria a enquete e as opções numa transação. O craque do jogo é único por jogo e lugar: repetir devolve o mesmo. */
export async function createPoll(
  db: Database,
  input: {
    tenantId: string;
    scope: CommunityPollScope;
    communityId: string | null;
    eventId: string | null;
    kind: CommunityPollKind;
    question: string | null;
    closesAt: Date | null;
    createdBy: string;
    options: { label: string | null; personId: string | null; participantId: string | null }[];
  },
): Promise<{ id: string; created: boolean }> {
  if (input.options.length < 2 || input.options.length > 60) throw new CommunityPollError('no_options');
  return db.transaction(async (tx) => {
    const [poll] = await tx
      .insert(communityPoll)
      .values({
        tenantId: input.tenantId,
        scope: input.scope,
        communityId: input.scope === 'community' ? input.communityId : null,
        eventId: input.eventId,
        kind: input.kind,
        question: input.kind === 'man_of_match' ? null : input.question,
        closesAt: input.closesAt,
        createdBy: input.createdBy,
      })
      .onConflictDoNothing()
      .returning({ id: communityPoll.id });
    if (!poll) {
      // craque do jogo já existe para este jogo e lugar
      const [existing] = await tx
        .select({ id: communityPoll.id })
        .from(communityPoll)
        .where(
          and(
            eq(communityPoll.tenantId, input.tenantId),
            eq(communityPoll.kind, 'man_of_match'),
            eq(communityPoll.scope, input.scope),
            input.eventId ? eq(communityPoll.eventId, input.eventId) : undefined,
            input.scope === 'community' && input.communityId
              ? eq(communityPoll.communityId, input.communityId)
              : isNull(communityPoll.communityId),
          ),
        )
        .limit(1);
      if (!existing) throw new CommunityPollError('duplicate');
      return { id: existing.id, created: false };
    }
    await tx.insert(communityPollOption).values(
      input.options.map((o, i) => ({
        tenantId: input.tenantId,
        pollId: poll.id,
        position: i,
        label: o.label,
        personId: o.personId,
        participantId: o.participantId,
      })),
    );
    return { id: poll.id, created: true };
  });
}

/** Fecha a votação (o resultado continua à vista). */
export async function closePoll(
  db: Database,
  input: { tenantId: string; pollId: string; actor: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(communityPoll)
    .set({ closedAt: input.now, closedBy: input.actor })
    .where(
      and(
        eq(communityPoll.tenantId, input.tenantId),
        eq(communityPoll.id, input.pollId),
        isNull(communityPoll.closedAt),
      ),
    )
    .returning({ id: communityPoll.id });
  return rows.length > 0;
}

const isOpen = (p: { closedAt: Date | null; closesAt: Date | null }, now: Date) =>
  p.closedAt === null && (p.closesAt === null || p.closesAt.getTime() > now.getTime());

/** Enquetes com opções, contagem e o voto do torcedor, para uma lista de ids (na ordem pedida). */
async function hydrate(
  db: Database,
  tenantId: string,
  polls: (typeof communityPoll.$inferSelect)[],
  viewerProfileId: string | null,
  now: Date,
): Promise<CommunityPollRow[]> {
  if (!polls.length) return [];
  const ids = polls.map((p) => p.id);
  const options = await db
    .select({
      id: communityPollOption.id,
      pollId: communityPollOption.pollId,
      position: communityPollOption.position,
      label: communityPollOption.label,
      personId: communityPollOption.personId,
      personName: person.name,
      participantId: communityPollOption.participantId,
      participantName: participant.name,
      votes: sql<number>`(select count(*)::int from ${communityPollVote} v
        join fan.profile vp on vp.tenant_id = v.tenant_id and vp.id = v.profile_id and vp.deleted_at is null
        where v.tenant_id = ${communityPollOption.tenantId} and v.poll_id = ${communityPollOption.pollId}
          and v.option_id = ${communityPollOption.id})`,
    })
    .from(communityPollOption)
    .leftJoin(person, eq(person.id, communityPollOption.personId))
    .leftJoin(participant, eq(participant.id, communityPollOption.participantId))
    .where(and(eq(communityPollOption.tenantId, tenantId), inArray(communityPollOption.pollId, ids)))
    .orderBy(asc(communityPollOption.position));
  const mine = viewerProfileId
    ? await db
        .select({ pollId: communityPollVote.pollId, optionId: communityPollVote.optionId })
        .from(communityPollVote)
        .where(
          and(
            eq(communityPollVote.tenantId, tenantId),
            eq(communityPollVote.profileId, viewerProfileId),
            inArray(communityPollVote.pollId, ids),
          ),
        )
    : [];
  const myVote = new Map(mine.map((m) => [m.pollId, m.optionId]));
  return polls.map((p) => {
    const opts = options.filter((o) => o.pollId === p.id).map(({ pollId: _p, ...o }) => o);
    return {
      id: p.id,
      scope: p.scope,
      communityId: p.communityId,
      eventId: p.eventId,
      kind: p.kind,
      question: p.question,
      closesAt: p.closesAt,
      closedAt: p.closedAt,
      createdAt: p.createdAt,
      open: isOpen(p, now),
      totalVotes: opts.reduce((n, o) => n + o.votes, 0),
      myOptionId: myVote.get(p.id) ?? null,
      options: opts,
    };
  });
}

export async function readPoll(
  db: Database,
  tenantId: string,
  pollId: string,
  viewerProfileId: string | null,
  now: Date,
): Promise<CommunityPollRow | null> {
  const rows = await db
    .select()
    .from(communityPoll)
    .where(and(eq(communityPoll.tenantId, tenantId), eq(communityPoll.id, pollId)))
    .limit(1);
  return (await hydrate(db, tenantId, rows, viewerProfileId, now))[0] ?? null;
}

/** Enquetes de uma Comunidade ou da Sala do Jogo, da mais nova para a mais velha. */
export async function listPolls(
  db: Database,
  input: {
    tenantId: string;
    where: { communityId: string } | { roomEventId: string };
    viewerProfileId: string | null;
    before?: string | null;
    limit: number;
    now: Date;
  },
): Promise<CommunityPollRow[]> {
  const place =
    'communityId' in input.where
      ? and(eq(communityPoll.scope, 'community'), eq(communityPoll.communityId, input.where.communityId))
      : and(eq(communityPoll.scope, 'room'), eq(communityPoll.eventId, input.where.roomEventId));
  const rows = await db
    .select()
    .from(communityPoll)
    .where(
      and(
        eq(communityPoll.tenantId, input.tenantId),
        place,
        input.before ? lt(communityPoll.id, input.before) : undefined,
      ),
    )
    .orderBy(desc(communityPoll.id))
    .limit(Math.min(Math.max(input.limit, 1), 50));
  return hydrate(db, input.tenantId, rows, input.viewerProfileId, input.now);
}

/**
 * Voto do torcedor: um por enquete, sem trocar depois (o resultado ao vivo não vira disputa de troca). Aberta, opção
 * da própria enquete. `duplicate` quando já votou.
 */
export async function castVote(
  db: Database,
  input: { tenantId: string; pollId: string; optionId: string; profileId: string; now: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [poll] = await tx
      .select({ closedAt: communityPoll.closedAt, closesAt: communityPoll.closesAt })
      .from(communityPoll)
      .where(and(eq(communityPoll.tenantId, input.tenantId), eq(communityPoll.id, input.pollId)))
      .for('share');
    if (!poll) throw new CommunityPollError('not_found');
    if (!isOpen(poll, input.now)) throw new CommunityPollError('closed');
    const [opt] = await tx
      .select({ id: communityPollOption.id })
      .from(communityPollOption)
      .where(
        and(
          eq(communityPollOption.tenantId, input.tenantId),
          eq(communityPollOption.pollId, input.pollId),
          eq(communityPollOption.id, input.optionId),
        ),
      )
      .limit(1);
    if (!opt) throw new CommunityPollError('bad_option');
    const rows = await tx
      .insert(communityPollVote)
      .values({
        tenantId: input.tenantId,
        pollId: input.pollId,
        profileId: input.profileId,
        optionId: input.optionId,
        createdAt: input.now,
      })
      .onConflictDoNothing()
      .returning({ id: communityPollVote.profileId });
    if (!rows.length) throw new CommunityPollError('duplicate');
  });
}

export interface PollVoteCandidate {
  tenantId: string;
  profileId: string;
  profileCountry: string;
  pollId: string;
  votedAt: Date;
}

/**
 * Votos recentes (desde `since`) nos clientes com a Gamificação ligada que ainda não viraram participação
 * (`game.participation_daily`, ação `poll`, ref `poll:<id>`). Perfil `under13` e excluído ficam fora. Parte do índice
 * por `created_at`: a consulta roda a cada minuto e não varre a base histórica.
 */
export async function pollVoteCandidates(
  db: Pick<Database, 'execute'>,
  window: { since: Date; limit?: number },
): Promise<PollVoteCandidate[]> {
  const rows = await db.execute<{
    tenant_id: string;
    profile_id: string;
    country: string;
    poll_id: string;
    created_at: string | Date;
  }>(sql`
    select v.tenant_id, v.profile_id, p.country, v.poll_id, v.created_at
      from community.poll_vote v
      join fan.profile p on p.tenant_id = v.tenant_id and p.id = v.profile_id
                        and p.deleted_at is null and p.age_band <> 'under13'
      join api.tenant t on t.id = v.tenant_id and 'gamification' = any(t.modules)
                       and t.state in ('trial', 'active', 'past_due')
     where v.created_at >= ${window.since.toISOString()}::timestamptz
       and not exists (
         select 1 from game.participation_daily pd
          where pd.tenant_id = v.tenant_id and pd.profile_id = v.profile_id
            and pd.action = 'poll' and pd.ref = 'poll:' || v.poll_id::text)
     order by v.created_at
     limit ${window.limit ?? 2000}`);
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    profileId: r.profile_id,
    profileCountry: r.country,
    pollId: r.poll_id,
    votedAt: new Date(r.created_at),
  }));
}
