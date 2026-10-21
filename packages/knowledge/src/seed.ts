import { createHash } from 'node:crypto';
import { getTableColumns, notInArray, sql, type Table } from 'drizzle-orm';
import {
  competitionProfile,
  copyTemplate,
  derby,
  derbyTeam,
  loadRun,
  teamProfile,
  type Database,
  type TeamRival,
} from '@galaxie/db';
import { toCopyTemplate } from './copy/library.js';
import { assignEventDerbies, type Executor } from './derby.js';
import type { KnowledgeBase } from './load.js';

type Tx = Executor;

export interface EntityStats {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  removed: number;
}

export interface SeedResult {
  teams: EntityStats;
  derbies: EntityStats;
  competitions: EntityStats;
  copyTemplates: EntityStats;
  /** Perfis ligados a core.participant (via provider_map) e competições ligadas a core.competition. */
  linked: { teams: number; competitions: number };
  /** Eventos cujo derby_id mudou após a carga. */
  events: { updated: number };
  loadRunId: string;
}

/** JSON canônico (chaves ordenadas) para o hash de conteúdo. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}
const contentHash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

const CHUNK = 200;
function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/** Monta as linhas de semantic.* a partir da base carregada (sem tocar no banco). */
export function buildSeedRows(kb: KnowledgeBase) {
  const teams = kb.teams.map(({ entry: t, file, countryCode, kind }) => {
    const row = {
      slug: t.slug,
      kind,
      countryCode,
      apiSportsTeamId: t.api_sports?.team_id ?? null,
      names: t.names,
      labels: t.labels ?? null,
      city: t.city ?? null,
      region: t.region ?? null,
      founded: t.founded ?? null,
      colors: t.colors ?? [],
      nicknames: t.nicknames ?? [],
      fans: t.fans ?? null,
      mascot: t.mascot ?? null,
      rallyingCries: t.rallying_cries ?? [],
      stadium: t.stadium ?? null,
      rivals: (t.rivals ?? []).map((r): TeamRival => ({
        team: r.team,
        derby: r.derby ?? null,
        intensity: r.intensity ?? null,
      })),
      identity: t.identity ?? [],
      copyHints: t.copy_hints ?? null,
      worldCupTitles: t.world_cup_titles ?? null,
      sourceFile: `data/knowledge/${file}`,
      sources: t.sources ?? [],
      reviewStatus: t.review_status ?? 'draft',
    };
    return { ...row, contentHash: contentHash(row) };
  });
  const derbies = kb.derbies.map(({ entry: d, file }) => {
    const row = {
      slug: d.slug,
      name: d.name,
      aliases: d.aliases ?? [],
      labels: d.labels ?? null,
      scope: d.scope,
      intensity: d.intensity,
      firstMatch: d.first_match ?? null,
      origin: d.origin ?? null,
      trivia: d.trivia ?? [],
      sourceFile: `data/knowledge/${file}`,
      sources: d.sources ?? [],
      reviewStatus: d.review_status ?? 'draft',
    };
    return { ...row, contentHash: contentHash({ ...row, teams: d.teams }) };
  });
  const derbyTeams = kb.derbies.flatMap(({ entry: d }) =>
    d.teams.map((teamSlug) => ({ derbySlug: d.slug, teamSlug })),
  );
  const competitions = kb.competitions.map(({ entry: c, file }) => {
    const row = {
      slug: c.slug,
      apiSportsLeagueId: c.api_sports_league_id ?? null,
      labels: c.labels ?? null,
      nicknames: c.nicknames ?? null,
      trophyNickname: c.trophy_nickname ?? null,
      sourceFile: `data/knowledge/${file}`,
      sources: c.sources ?? [],
      reviewStatus: c.review_status ?? 'draft',
    };
    return { ...row, contentHash: contentHash(row) };
  });
  const copy = kb.copyTemplates.map((located) => {
    const t = toCopyTemplate(located);
    const row = {
      key: t.key,
      locale: t.locale,
      sport: t.sport,
      copyIntent: t.intent,
      toneIntensity: t.tone,
      affinityType: t.affinityType,
      affinitySource: t.affinitySource,
      momentum: t.momentum,
      competitionContext: t.competitionContext,
      confidence: t.confidence,
      template: t.template,
      sourceFile: `data/knowledge/${located.file}`,
      reviewStatus: t.reviewStatus,
    };
    return { ...row, contentHash: contentHash(row) };
  });
  return { teams, derbies, derbyTeams, competitions, copy };
}

const emptyStats = (total: number): EntityStats => ({
  total,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  removed: 0,
});

function tally(stats: EntityStats, returned: { inserted: boolean }[]) {
  for (const r of returned) {
    if (r.inserted) stats.inserted++;
    else stats.updated++;
  }
}

/** Colunas `excluded.*` para o ON CONFLICT DO UPDATE (todas menos as da chave). */
function excludedSet(table: Table, skip: string[]) {
  return Object.fromEntries(
    Object.entries(getTableColumns(table))
      .filter(([key]) => !skip.includes(key))
      .map(([key, col]) => [key, sql.raw(`excluded."${col.name}"`)]),
  );
}

/**
 * Carrega a base semântica no Postgres (issue #39). Idempotente: só reescreve linhas cujo conteúdo mudou,
 * remove o que saiu do YAML, liga perfis a participantes/competições já existentes, recalcula o
 * derby_id dos eventos e registra semantic.load_run com o SHA do Git.
 * Rode `validateKnowledge` antes — o seed assume dados válidos.
 */
export async function seedSemantic(
  db: Database,
  kb: KnowledgeBase,
  options: { gitSha?: string | null } = {},
): Promise<SeedResult> {
  const rows = buildSeedRows(kb);
  return db.transaction(async (tx) => {
    const stats = {
      teams: emptyStats(rows.teams.length),
      derbies: emptyStats(rows.derbies.length),
      competitions: emptyStats(rows.competitions.length),
      copyTemplates: emptyStats(rows.copy.length),
    };

    // 1. perfis de time (participant_id é derivado depois, não vem do YAML)
    for (const batch of chunks(rows.teams)) {
      const returned = await tx
        .insert(teamProfile)
        .values(batch)
        .onConflictDoUpdate({
          target: teamProfile.slug,
          set: { ...excludedSet(teamProfile, ['slug', 'participantId', 'updatedAt']), updatedAt: sql`now()` },
          setWhere: sql`${teamProfile.contentHash} is distinct from excluded.content_hash`,
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      tally(stats.teams, returned);
    }

    // 2. clássicos
    for (const batch of chunks(rows.derbies)) {
      const returned = await tx
        .insert(derby)
        .values(batch)
        .onConflictDoUpdate({
          target: derby.slug,
          set: { ...excludedSet(derby, ['id', 'slug', 'updatedAt']), updatedAt: sql`now()` },
          setWhere: sql`${derby.contentHash} is distinct from excluded.content_hash`,
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      tally(stats.derbies, returned);
    }

    // 3. pares do clássico: troca o conjunto inteiro pelo do YAML
    const derbyIds = new Map(
      (await tx.select({ id: derby.id, slug: derby.slug }).from(derby)).map((d) => [d.slug, d.id]),
    );
    const pairs = rows.derbyTeams.map((p) => ({ derbyId: derbyIds.get(p.derbySlug)!, teamSlug: p.teamSlug }));
    await tx.execute(sql`
      delete from semantic.derby_team dt
      where not exists (
        select 1 from jsonb_to_recordset(${JSON.stringify(pairs)}::jsonb) as p(derby_id uuid, team_slug text)
        where p.derby_id = dt.derby_id and p.team_slug = dt.team_slug
      )`);
    if (pairs.length)
      for (const batch of chunks(pairs)) await tx.insert(derbyTeam).values(batch).onConflictDoNothing();

    // 4. remove o que saiu do YAML (clássicos antes dos times, por causa de derby_team)
    stats.derbies.removed = await removeMissing(
      tx,
      'derby',
      rows.derbies.map((d) => d.slug),
    );
    stats.teams.removed = await removeMissing(
      tx,
      'team',
      rows.teams.map((t) => t.slug),
    );

    // 5. competições
    for (const batch of chunks(rows.competitions)) {
      const returned = await tx
        .insert(competitionProfile)
        .values(batch)
        .onConflictDoUpdate({
          target: competitionProfile.slug,
          set: {
            ...excludedSet(competitionProfile, ['slug', 'competitionId', 'updatedAt']),
            updatedAt: sql`now()`,
          },
          setWhere: sql`${competitionProfile.contentHash} is distinct from excluded.content_hash`,
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      tally(stats.competitions, returned);
    }
    stats.competitions.removed = await removeMissing(
      tx,
      'competition',
      rows.competitions.map((c) => c.slug),
    );

    // 6. biblioteca de copy
    for (const batch of chunks(rows.copy)) {
      const returned = await tx
        .insert(copyTemplate)
        .values(batch)
        .onConflictDoUpdate({
          target: copyTemplate.key,
          set: {
            ...excludedSet(copyTemplate, ['id', 'key', 'createdAt', 'updatedAt']),
            updatedAt: sql`now()`,
          },
          setWhere: sql`${copyTemplate.contentHash} is distinct from excluded.content_hash`,
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      tally(stats.copyTemplates, returned);
    }
    stats.copyTemplates.removed = await removeMissing(
      tx,
      'copy',
      rows.copy.map((c) => c.key),
    );

    for (const s of Object.values(stats)) s.unchanged = s.total - s.inserted - s.updated;

    // 7. ligações com o core
    const linked = { teams: await linkParticipants(tx), competitions: await linkCompetitions(tx) };

    // 8. clássicos nos eventos já existentes
    const events = await assignEventDerbies(tx);

    const [run] = await tx
      .insert(loadRun)
      .values({
        gitSha: options.gitSha ?? null,
        teams: rows.teams.length,
        derbies: rows.derbies.length,
        competitions: rows.competitions.length,
        copyTemplates: rows.copy.length,
        stats: { ...stats, linked, events: { updated: events.updated } },
      })
      .returning({ id: loadRun.id });

    return { ...stats, linked, events: { updated: events.updated }, loadRunId: run!.id };
  });
}

async function removeMissing(tx: Tx, kind: 'team' | 'derby' | 'competition' | 'copy', keep: string[]) {
  const keepList = keep.length ? keep : ['\u0000'];
  const removed =
    kind === 'team'
      ? await tx
          .delete(teamProfile)
          .where(notInArray(teamProfile.slug, keepList))
          .returning({ k: teamProfile.slug })
      : kind === 'derby'
        ? await tx.delete(derby).where(notInArray(derby.slug, keepList)).returning({ k: derby.slug })
        : kind === 'competition'
          ? await tx
              .delete(competitionProfile)
              .where(notInArray(competitionProfile.slug, keepList))
              .returning({ k: competitionProfile.slug })
          : await tx
              .delete(copyTemplate)
              .where(notInArray(copyTemplate.key, keepList))
              .returning({ k: copyTemplate.key });
  return removed.length;
}

/**
 * Liga semantic.team_profile.participant_id ao participante com o mesmo api_sports.team_id em core.provider_map.
 * Perfis sem team_id no YAML mantêm a ligação feita pelo resolvedor (pnpm resolve:ids --apply-db).
 */
export async function linkParticipants(tx: Tx | Database): Promise<number> {
  const rows = await tx.execute<{ slug: string }>(sql`
    with target as (
      select tp.slug,
             (select pm.entity_id from core.provider_map pm
               where pm.provider = 'api-sports' and pm.sport = 'football' and pm.entity_type = 'participant'
                 and pm.provider_id = tp.api_sports_team_id::text
               limit 1) as participant_id
        from semantic.team_profile tp
       where tp.api_sports_team_id is not null
    )
    update semantic.team_profile tp
       set participant_id = target.participant_id, updated_at = now()
      from target
     where target.slug = tp.slug and tp.participant_id is distinct from target.participant_id
    returning tp.slug`);
  return rows.length;
}

/** Liga competition_profile.competition_id pela liga da api-sports (provider_map) ou, sem ID, pelo slug do catálogo. */
export async function linkCompetitions(tx: Tx | Database): Promise<number> {
  const rows = await tx.execute<{ slug: string }>(sql`
    with target as (
      select cp.slug,
             coalesce(
               (select pm.entity_id from core.provider_map pm
                 where pm.provider = 'api-sports' and pm.sport = 'football' and pm.entity_type = 'competition'
                   and pm.provider_id = cp.api_sports_league_id::text
                 limit 1),
               (select c.id from core.competition c where c.sport = 'football' and c.slug = cp.slug limit 1)
             ) as competition_id
        from semantic.competition_profile cp
    )
    update semantic.competition_profile cp
       set competition_id = target.competition_id, updated_at = now()
      from target
     where target.slug = cp.slug and cp.competition_id is distinct from target.competition_id
    returning cp.slug`);
  return rows.length;
}
