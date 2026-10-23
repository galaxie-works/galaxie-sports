import { createHash } from 'node:crypto';
import { getTableColumns, notInArray, sql, type Table } from 'drizzle-orm';
import {
  competitionProfile,
  copyTemplate,
  derby,
  derbyTeam,
  headToHead,
  loadRun,
  reviewDecision,
  reviewItem,
  teamProfile,
  type Database,
  type LocalizedDerbyTexts,
  type LocalizedTeamTexts,
  type TeamRival,
} from '@galaxie/db';
import { toCopyTemplate } from './copy/library.js';
import { assignEventDerbies, type Executor } from './derby.js';
import type { KnowledgeBase } from './load.js';
import {
  buildReviewItems,
  decidedStatuses,
  effectiveReviewStatus,
  reviewItemId,
  type ReviewItem,
} from './review.js';
import type { ReviewStatus } from './types.js';
import { linkVenues, type VenueLinkResult } from './venues.js';

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
  /** Pares que não são clássicos, com histórico geral curado. */
  headToHead: EntityStats;
  competitions: EntityStats;
  copyTemplates: EntityStats;
  /** Perfis ligados a core.participant (via provider_map) e competições ligadas a core.competition. */
  linked: { teams: number; competitions: number };
  /** Estádios do YAML reconciliados com core.venue (nome curado vence o do fornecedor). */
  venues: VenueLinkResult;
  /** Eventos cujo derby_id mudou após a carga. */
  events: { updated: number };
  /**
   * Revisão pelo painel: itens no catálogo semantic.review_item, decisões aplicadas (valem sobre o YAML)
   * e decisões desatualizadas (o conteúdo mudou depois delas; volta a valer o status do YAML).
   */
  review: { items: number; decided: number; stale: number };
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

/**
 * Monta as linhas de semantic.* a partir da base carregada (sem tocar no banco). `decided` traz o status
 * das decisões do painel que ainda valem (por id de item, ver `decidedStatuses`); elas vencem o YAML.
 */
export function buildSeedRows(kb: KnowledgeBase, decided: ReadonlyMap<string, ReviewStatus> = new Map()) {
  const texts = textsBySlug(kb, decided);
  const teams = kb.teams.map(({ entry: t, file, countryCode, kind, textLocale }) => {
    const row = {
      slug: t.slug,
      kind,
      countryCode,
      apiSportsTeamId: t.api_sports?.team_id ?? null,
      f1dbId: t.f1db?.id ?? null,
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
      textLocale,
      texts: (texts.teams.get(t.slug) ?? {}) as Record<string, LocalizedTeamTexts>,
      copyHints: t.copy_hints ?? null,
      worldCupTitles: t.world_cup_titles ?? null,
      sourceFile: `data/knowledge/${file}`,
      sources: t.sources ?? [],
      reviewStatus: decided.get(reviewItemId('team', t.slug)) ?? t.review_status ?? 'draft',
    };
    return { ...row, contentHash: contentHash(row) };
  });
  const derbies = kb.derbies.map(({ entry: d, file, textLocale }) => {
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
      // o histórico geral tem decisão própria no painel (item `all-time`)
      allTime: d.all_time
        ? {
            ...d.all_time,
            review_status:
              decided.get(reviewItemId('all-time', `derby:${d.slug}`)) ?? d.all_time.review_status,
          }
        : null,
      textLocale,
      texts: (texts.derbies.get(d.slug) ?? {}) as Record<string, LocalizedDerbyTexts>,
      sourceFile: `data/knowledge/${file}`,
      sources: d.sources ?? [],
      reviewStatus: decided.get(reviewItemId('derby', d.slug)) ?? d.review_status ?? 'draft',
    };
    return { ...row, contentHash: contentHash({ ...row, teams: d.teams }) };
  });
  const pairs = kb.headToHead.map(({ entry: p, file, sport }) => {
    const reviewStatus =
      decided.get(reviewItemId('all-time', `pair:${p.slug}`)) ?? p.all_time.review_status ?? 'draft';
    const row = {
      slug: p.slug,
      sport,
      teams: [...p.teams].sort() as [string, string],
      allTime: { ...p.all_time, review_status: reviewStatus },
      sourceFile: `data/knowledge/${file}`,
      reviewStatus,
    };
    return { ...row, contentHash: contentHash(row) };
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
      reviewStatus: decided.get(reviewItemId('competition', c.slug)) ?? c.review_status ?? 'draft',
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
      reviewStatus: decided.get(reviewItemId('copy', t.key)) ?? t.reviewStatus,
    };
    return { ...row, contentHash: contentHash(row) };
  });
  return { teams, derbies, derbyTeams, pairs, competitions, copy };
}

/** Traduções de i18n/<locale>.yaml agrupadas por slug: `{ "<locale>": { ...campos, review_status } }`. */
function textsBySlug(kb: KnowledgeBase, decided: ReadonlyMap<string, ReviewStatus>) {
  const teams = new Map<string, Record<string, unknown>>();
  const derbies = new Map<string, Record<string, unknown>>();
  for (const x of kb.texts) {
    const { slug, note: _note, ...fields } = x.entry;
    const target = x.listKey === 'teams' ? teams : derbies;
    if (!target.has(slug)) target.set(slug, {});
    const id = reviewItemId('translation', `${x.listKey === 'teams' ? 'team' : 'derby'}:${slug}`, x.locale);
    const status = decided.get(id);
    target.get(slug)![x.locale] = status ? { ...fields, review_status: status } : fields;
  }
  return { teams, derbies };
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
  const items = buildReviewItems(kb);
  return db.transaction(async (tx) => {
    // 0. decisões do painel: valem sobre o status do YAML enquanto o conteúdo for o mesmo que foi revisado
    const decisions = await tx
      .select({
        itemId: reviewDecision.itemId,
        status: reviewDecision.status,
        reviewHash: reviewDecision.reviewHash,
      })
      .from(reviewDecision);
    const decided = decidedStatuses(items, decisions);
    const byId = new Map(decisions.map((d) => [d.itemId, d]));
    const review = {
      items: items.length,
      decided: decided.size,
      stale: items.filter((i) => effectiveReviewStatus(i, byId.get(i.id)).stale).length,
    };
    const rows = buildSeedRows(kb, decided);

    const stats = {
      teams: emptyStats(rows.teams.length),
      derbies: emptyStats(rows.derbies.length),
      headToHead: emptyStats(rows.pairs.length),
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

    // 4b. pares que não são clássicos (só dependem dos slugs, sem chave estrangeira)
    for (const batch of chunks(rows.pairs)) {
      const returned = await tx
        .insert(headToHead)
        .values(batch)
        .onConflictDoUpdate({
          target: headToHead.slug,
          set: { ...excludedSet(headToHead, ['slug', 'updatedAt']), updatedAt: sql`now()` },
          setWhere: sql`${headToHead.contentHash} is distinct from excluded.content_hash`,
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      tally(stats.headToHead, returned);
    }
    stats.headToHead.removed = await removeMissing(
      tx,
      'head-to-head',
      rows.pairs.map((p) => p.slug),
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

    // 6b. catálogo da revisão (o painel lê daqui)
    await syncReviewItems(tx, items);

    // 7. ligações com o core
    const linked = { teams: await linkParticipants(tx), competitions: await linkCompetitions(tx) };
    // 7b. estádios curados (depende do participant_id ligado acima)
    const venues = await linkVenues(tx);

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
        stats: { ...stats, linked, venues, events: { updated: events.updated }, review },
      })
      .returning({ id: loadRun.id });

    return { ...stats, linked, venues, events: { updated: events.updated }, review, loadRunId: run!.id };
  });
}

/** Reescreve semantic.review_item com os itens do YAML (só as linhas que mudaram) e tira os que saíram. */
async function syncReviewItems(tx: Tx, items: ReviewItem[]) {
  const values = items.map((i) => ({
    id: i.id,
    kind: i.kind,
    key: i.key,
    locale: i.locale,
    sport: i.sport,
    market: i.market,
    title: i.title,
    sourceFile: i.sourceFile,
    yamlStatus: i.yamlStatus,
    reviewHash: i.reviewHash,
    content: i.content,
    original: i.original,
    originalLocale: i.originalLocale,
    parentKind: i.parentKind,
  }));
  for (const batch of chunks(values))
    await tx
      .insert(reviewItem)
      .values(batch)
      .onConflictDoUpdate({
        target: reviewItem.id,
        set: { ...excludedSet(reviewItem, ['id', 'updatedAt']), updatedAt: sql`now()` },
        setWhere: sql`(${reviewItem.reviewHash}, ${reviewItem.yamlStatus}, ${reviewItem.title}, ${reviewItem.sourceFile}, ${reviewItem.market})
          is distinct from (excluded.review_hash, excluded.yaml_status, excluded.title, excluded.source_file, excluded.market)`,
      });
  await tx
    .delete(reviewItem)
    .where(notInArray(reviewItem.id, values.length ? values.map((v) => v.id) : ['\u0000']));
}

async function removeMissing(
  tx: Tx,
  kind: 'team' | 'derby' | 'head-to-head' | 'competition' | 'copy',
  keep: string[],
) {
  const keepList = keep.length ? keep : ['\u0000'];
  const removed =
    kind === 'team'
      ? await tx
          .delete(teamProfile)
          .where(notInArray(teamProfile.slug, keepList))
          .returning({ k: teamProfile.slug })
      : kind === 'derby'
        ? await tx.delete(derby).where(notInArray(derby.slug, keepList)).returning({ k: derby.slug })
        : kind === 'head-to-head'
          ? await tx
              .delete(headToHead)
              .where(notInArray(headToHead.slug, keepList))
              .returning({ k: headToHead.slug })
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
         -- só o futebol tem vinculação por ID; os demais esportes (team_id null) ficam para depois
         and tp.source_file like 'data/knowledge/football/%'
    )
    update semantic.team_profile tp
       set participant_id = target.participant_id, updated_at = now()
      from target
     where target.slug = tp.slug and tp.participant_id is distinct from target.participant_id
    returning tp.slug`);
  // Fórmula 1: pelo id do F1DB (piloto `driver-<id>`, construtor `<id>`), quando o F1DB já foi importado
  const f1 = await tx.execute<{ slug: string }>(sql`
    with target as (
      select tp.slug,
             (select pm.entity_id from core.provider_map pm
               where pm.provider = 'f1db' and pm.sport = 'formula-1' and pm.entity_type = 'participant'
                 and pm.provider_id = case when tp.kind = 'driver' then 'driver-' || tp.f1db_id else tp.f1db_id end
               limit 1) as participant_id
        from semantic.team_profile tp
       where tp.f1db_id is not null
    )
    update semantic.team_profile tp
       set participant_id = target.participant_id, updated_at = now()
      from target
     where target.slug = tp.slug and target.participant_id is not null
       and tp.participant_id is distinct from target.participant_id
    returning tp.slug`);
  return rows.length + f1.length;
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
