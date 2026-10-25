import { sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  SEARCH_TYPES,
  SearchQuery,
  type EventStatus,
  type SearchResponse,
  type SearchResult,
  type SearchType,
} from '@galaxie/contracts';
import { venueDisplay, type Database, type VenueCuration } from '@galaxie/db';
import { sendCached } from '../../cache/http.js';
import { CACHE_TTL } from '../../cache/policy.js';
import { requireDb, type AppContext } from '../../context.js';
import { actuallyLiveCond, IN_PLAY, sportScope } from '../../events/queries.js';
import { pickText } from '../../i18n.js';
import {
  accentPattern,
  bestMatch,
  fold,
  foldSql,
  likeTerm,
  matchRank,
  stringsOf,
} from '../../search/match.js';
import { logoIdSql } from '../../assets/custom-logos.js';
import { assetUrl, parseInput } from '../../util.js';
import { localeOf } from './events.js';
import { loadTeamNames, teamNameOptions } from '../../teams/display-name.js';
import { OFF_CATALOG_SPORTS } from '../../off-catalog.js';

const MODULE = { module: 'core_data' } as const;

/** Candidatos lidos do banco por tipo, antes do ranking fino (o SQL já ordena pelo nível do casamento). */
const CANDIDATES = 40;
/** Times encontrados que entram na busca de jogos. */
const EVENT_TEAMS = 8;
/** Janela dos próximos jogos. */
const UPCOMING_DAYS = 14;
/** Jogo provisório (anunciado, ainda sem o fornecedor) entra na busca com mais antecedência. */
const PROVISIONAL_DAYS = 90;

type Text = Record<string, string> | null;
interface Hit {
  result: SearchResult;
  rank: number;
  /** Desempate dentro do mesmo nível (menor primeiro); sem ele vale a ordem do SQL. */
  weight?: number[];
}

const byWeight = (a: Hit, b: Hit) => {
  const wa = a.weight ?? [];
  const wb = b.weight ?? [];
  for (let i = 0; i < Math.max(wa.length, wb.length); i++) {
    const d = (wa[i] ?? 0) - (wb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/**
 * Nível do casamento no SQL (0 exato, 1 começo, 2 trecho), sobre o nome e um JSON de apelidos:
 * nos apelidos o JSON entra como texto, e as aspas marcam o começo e o fim de cada string.
 */
function rankSql(main: SQL, aliases: SQL, term: string): SQL {
  const t = likeTerm(term);
  const m = foldSql(main);
  const a = foldSql(sql`(${aliases})::text`);
  return sql`case
    when ${m} = ${term} or ${a} like ${`%"${t}"%`} then 0
    when ${m} like ${`${t}%`} or ${m} like ${`% ${t}%`} or ${a} like ${`%"${t}%`} or ${a} like ${`% ${t}%`} then 1
    else 2 end`;
}

/**
 * Pré-seleção dos candidatos: regex sem acento sobre o nome e os apelidos (o ranking vem depois).
 * Termo curto (2 letras) só casa no começo de uma palavra: "br" acha Brasil, não Gibraltar.
 */
function matchesSql(main: SQL, aliases: SQL, term: string): SQL {
  const pattern = term.length < 3 ? `(^|[^[:alnum:]])${accentPattern(term)}` : accentPattern(term);
  return sql`concat_ws(' ', ${main}, (${aliases})::text) ~* ${pattern}`;
}

/** Nome do país para o `detail`; competições e times internacionais (`WORLD`) ficam sem. */
const countryLabel = (name: Text, code: string | null, locale: string) =>
  name && code && code !== 'WORLD' ? pickText(name, locale, code) : null;

const inList = (col: SQL, values: string[]) =>
  sql`${col} in (${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;

/** Busca global (docs/05 §3.6): uma chamada para a caixa de busca dos clientes. Módulo core_data. */
export async function searchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const asset = (key: string | null, url: string | null) => assetUrl(ctx.assetsBaseUrl, key, url);

  // ─── times ─────────────────────────────────────────────────────────────────────────────────
  async function teams(db: Database, term: string, locale: string, sports: string[] | null, now: Date) {
    const aliases = sql`jsonb_build_array(p.short_name, p.code, tp.names, tp.labels, tp.nicknames, p.provider_former_names)`;
    const rows = await db.execute<{
      id: string;
      sport: string;
      name: string;
      short_name: string | null;
      code: string | null;
      country_code: string | null;
      former: { name: string }[] | null;
      names: Record<string, string> | null;
      labels: Text;
      nicknames: string[] | null;
      curated: boolean;
      logo_key: string | null;
      logo_url: string | null;
      country_name: Text;
    }>(sql`
      select p.id, p.sport, p.name, p.short_name, p.code, p.country_code, p.provider_former_names as former,
             tp.names, tp.labels, tp.nicknames, tp.slug is not null as curated,
             a.storage_key as logo_key, a.source_url as logo_url, c.name as country_name
        from core.participant p
        left join lateral (
          select t.slug, t.names, t.labels, t.nicknames from semantic.team_profile t
           where t.participant_id = p.id order by t.slug limit 1) tp on true
        left join core.asset a on a.id = ${logoIdSql('p', ctx.logos.enabled())}
        left join core.country c on c.code = p.country_code
       where ${matchesSql(sql`p.name`, aliases, term)}
         and p.sport not in (${sql.join(
           OFF_CATALOG_SPORTS.map((s) => sql`${s}`),
           sql`, `,
         )})
         ${sports ? sql`and ${inList(sql`p.sport`, sports)}` : sql``}
       order by ${rankSql(sql`p.name`, aliases, term)}, tp.slug is null, length(p.name), p.name, p.id
       limit ${CANDIDATES}`);
    // Relevância dos candidatos: melhor tier das competições e número de jogos no último ano.
    const prominence = new Map<string, { tier: number | null; events: number }>();
    if (rows.length) {
      const stats = await db.execute<{ id: string; tier: number | null; events: number }>(sql`
        select ep.participant_id as id, min(c.tier)::int as tier, count(*)::int as events
          from core.event_participant ep
          join core.event e on e.id = ep.event_id
          left join core.competition c on c.id = e.competition_id
         where ${inList(
           sql`ep.participant_id`,
           rows.map((r) => r.id),
         )} and e.starts_at > ${now.toISOString()}::timestamptz - interval '365 days'
         group by ep.participant_id`);
      for (const s of stats) prominence.set(s.id, { tier: s.tier, events: s.events });
    }
    // nome exibido no idioma (base semântica ou corretor); o do fornecedor segue casando como apelido
    const names = await loadTeamNames(
      db,
      rows.map((r) => r.id),
      teamNameOptions(ctx, locale),
    );
    const hits: Hit[] = [];
    for (const r of rows) {
      const display = names.name(r.id, r.name);
      const m = bestMatch(
        display,
        [
          r.name,
          r.short_name,
          r.code,
          ...stringsOf(r.names),
          ...stringsOf(r.labels),
          ...(r.nicknames ?? []),
          ...(r.former ?? []).map((f) => f.name),
        ],
        term,
      );
      if (!m) continue;
      const p = prominence.get(r.id);
      hits.push({
        rank: matchRank(m.match),
        weight: [r.curated ? 0 : 1, p?.tier ?? 9, -(p?.events ?? 0)],
        result: {
          type: 'team',
          id: r.id,
          slug: null,
          name: display,
          ...m,
          sport: r.sport,
          country: r.country_code,
          image: asset(r.logo_key, r.logo_url),
          detail: countryLabel(r.country_name, r.country_code, locale),
          event: null,
        },
      });
    }
    return hits.sort((a, b) => a.rank - b.rank || byWeight(a, b));
  }

  // ─── competições ───────────────────────────────────────────────────────────────────────────
  async function competitions(db: Database, term: string, locale: string, sports: string[] | null) {
    const aliases = sql`jsonb_build_array(c.slug, c.labels, cp.labels, cp.nicknames, cp.trophy_nickname)`;
    const rows = await db.execute<{
      id: string;
      slug: string;
      sport: string;
      name: string;
      country_code: string | null;
      labels: Text;
      profile_labels: Text;
      nicknames: Record<string, string[]> | null;
      trophy: string | null;
      logo_key: string | null;
      logo_url: string | null;
      country_name: Text;
    }>(sql`
      select c.id, c.slug, c.sport, c.name, c.country_code, c.labels, cp.labels as profile_labels,
             cp.nicknames, cp.trophy_nickname as trophy,
             a.storage_key as logo_key, a.source_url as logo_url, co.name as country_name
        from core.competition c
        left join lateral (
          select x.labels, x.nicknames, x.trophy_nickname from semantic.competition_profile x
           where x.competition_id = c.id order by x.slug limit 1) cp on true
        left join core.asset a on a.id = ${logoIdSql('c', ctx.logos.enabled())}
        left join core.country co on co.code = c.country_code
       where ${matchesSql(sql`c.name`, aliases, term)}
         ${sports ? sql`and ${inList(sql`c.sport`, sports)}` : sql``}
       order by ${rankSql(sql`c.name`, aliases, term)}, c.tier, c.prestige desc, length(c.name), c.name, c.id
       limit ${CANDIDATES}`);
    const hits: Hit[] = [];
    for (const r of rows) {
      const labels = { ...(r.labels ?? {}), ...(r.profile_labels ?? {}) };
      const name = pickText(labels, locale, r.name)!;
      const m = bestMatch(
        name,
        [r.name, ...Object.values(labels), ...stringsOf(r.nicknames), r.trophy, r.slug.replace(/-/g, ' ')],
        term,
      );
      if (!m) continue;
      hits.push({
        rank: matchRank(m.match),
        result: {
          type: 'competition',
          id: r.id,
          slug: r.slug,
          name,
          ...m,
          sport: r.sport,
          country: r.country_code,
          image: asset(r.logo_key, r.logo_url),
          detail: countryLabel(r.country_name, r.country_code, locale),
          event: null,
        },
      });
    }
    return hits;
  }

  // ─── pessoas ───────────────────────────────────────────────────────────────────────────────
  async function people(db: Database, term: string, sports: string[] | null) {
    const aliases = sql`jsonb_build_array(concat_ws(' ', p.first_name, p.last_name), p.last_name)`;
    const rows = await db.execute<{
      id: string;
      name: string;
      first_name: string | null;
      last_name: string | null;
      nationality: string | null;
      photo_key: string | null;
      photo_url: string | null;
      team: string | null;
      team_sport: string | null;
    }>(sql`
      select p.id, p.name, p.first_name, p.last_name, p.nationality,
             a.storage_key as photo_key, a.source_url as photo_url, t.name as team, t.sport as team_sport
        from core.person p
        left join core.asset a on a.id = p.photo_asset_id
        left join lateral (
          select tm.name, tm.sport from core.roster r join core.participant tm on tm.id = r.participant_id
           where r.person_id = p.id
           order by r.season_id is not null, r.valid_to desc nulls first, tm.name limit 1) t on true
       where ${matchesSql(sql`p.name`, aliases, term)}
         ${sports ? sql`and ${inList(sql`t.sport`, sports)}` : sql``}
       order by ${rankSql(sql`p.name`, aliases, term)}, t.name is null, p.photo_asset_id is null,
                length(p.name), p.name, p.id
       limit ${CANDIDATES}`);
    const hits: Hit[] = [];
    for (const r of rows) {
      const full = [r.first_name, r.last_name].filter(Boolean).join(' ');
      const m = bestMatch(r.name, [full, r.last_name], term);
      if (!m) continue;
      hits.push({
        rank: matchRank(m.match),
        result: {
          type: 'person',
          id: r.id,
          slug: null,
          name: r.name,
          ...m,
          sport: r.team_sport,
          country: null,
          image: asset(r.photo_key, r.photo_url),
          detail: r.team ?? r.nationality,
          event: null,
        },
      });
    }
    return hits;
  }

  // ─── estádios ──────────────────────────────────────────────────────────────────────────────
  async function venues(db: Database, term: string) {
    const aliases = sql`jsonb_build_array(v.name, v.curated, v.provider_former_names)`;
    const rows = await db.execute<{
      id: string;
      name: string;
      city: string | null;
      country_code: string | null;
      curated: VenueCuration | null;
      former: { name: string }[] | null;
      image_key: string | null;
      image_url: string | null;
    }>(sql`
      select v.id, v.name, v.city, v.country_code, v.curated, v.provider_former_names as former,
             a.storage_key as image_key, a.source_url as image_url
        from core.venue v
        left join core.asset a on a.id = v.image_asset_id
       where ${matchesSql(sql`coalesce(v.curated->>'name', v.name)`, aliases, term)}
       order by ${rankSql(sql`coalesce(v.curated->>'name', v.name)`, aliases, term)}, v.curated is null,
                v.capacity desc nulls last, v.name, v.id
       limit ${CANDIDATES}`);
    const hits: Hit[] = [];
    for (const r of rows) {
      const display = venueDisplay(r);
      const m = bestMatch(
        display.name,
        [
          r.name,
          ...(r.curated?.nicknames ?? []),
          ...(r.curated?.former_names ?? []).map((f) => f.name),
          ...(r.former ?? []).map((f) => f.name),
        ],
        term,
      );
      if (!m) continue;
      hits.push({
        rank: matchRank(m.match),
        result: {
          type: 'venue',
          id: r.id,
          slug: null,
          name: display.name,
          ...m,
          sport: null,
          country: r.country_code,
          image: asset(r.image_key, r.image_url),
          detail: display.city,
          event: null,
        },
      });
    }
    return hits;
  }

  // ─── países ────────────────────────────────────────────────────────────────────────────────
  async function countries(db: Database, term: string, locale: string) {
    const aliases = sql`jsonb_build_array(c.code, c.ioc_code, c.name)`;
    const rows = await db.execute<{
      code: string;
      name: Text;
      ioc_code: string | null;
      confederation: string | null;
      flag_key: string | null;
      flag_url: string | null;
    }>(sql`
      select c.code, c.name, c.ioc_code, c.confederation, a.storage_key as flag_key, a.source_url as flag_url
        from core.country c
        left join core.asset a on a.id = c.flag_asset_id
       where c.code <> 'WORLD' and ${matchesSql(sql`c.code`, aliases, term)}
       order by ${rankSql(sql`c.name->>${locale}`, aliases, term)}, c.code
       limit ${CANDIDATES}`);
    const hits: Hit[] = [];
    for (const r of rows) {
      const name = pickText(r.name, locale, r.code)!;
      // Código e sigla só valem por inteiro ("br" acha o Brasil; "b" não acha todos com B).
      const codes = [r.code, r.ioc_code].filter((c): c is string => !!c && fold(c) === term);
      const m = bestMatch(name, [...stringsOf(r.name), ...codes], term);
      if (!m) continue;
      hits.push({
        rank: matchRank(m.match),
        result: {
          type: 'country',
          id: r.code,
          slug: null,
          name,
          ...m,
          sport: null,
          country: r.code,
          image: asset(r.flag_key, r.flag_url),
          detail: r.confederation,
          event: null,
        },
      });
    }
    return hits;
  }

  // ─── jogos: ao vivo e próximos dos times encontrados ───────────────────────────────────────
  async function events(db: Database, teamHits: Hit[], locale: string, sports: string[] | null, now: Date) {
    const teamsById = new Map(teamHits.slice(0, EVENT_TEAMS).map((h) => [h.result.id, h]));
    if (!teamsById.size) return [];
    const ids = [...teamsById.keys()];
    const until = new Date(now.getTime() + UPCOMING_DAYS * 86_400_000).toISOString();
    const provisionalUntil = new Date(now.getTime() + PROVISIONAL_DAYS * 86_400_000).toISOString();
    const rows = await db.execute<{
      id: string;
      sport: string;
      starts_at: Date | string;
      status: EventStatus;
      live: boolean;
      is_provisional: boolean;
      competition: string | null;
      competition_labels: Text;
    }>(sql`
      select event.id, event.sport, event.starts_at, event.status,
             (event.status in (${sql.join(
               IN_PLAY.map((s) => sql`${s}`),
               sql`, `,
             )}) and ${actuallyLiveCond(now)}) as live,
             event.is_provisional,
             c.name as competition, c.labels as competition_labels
        from core.event
        left join core.competition c on c.id = event.competition_id
       where exists (select 1 from core.event_participant ep
                      where ep.event_id = event.id and ${inList(sql`ep.participant_id`, ids)})
         ${sports ? sql`and ${inList(sql`event.sport`, sports)}` : sql``}
         and ((event.status in (${sql.join(
           IN_PLAY.map((s) => sql`${s}`),
           sql`, `,
         )}) and ${actuallyLiveCond(now)})
              or (event.status = 'scheduled' and event.starts_at >= ${now.toISOString()}::timestamptz - interval '3 hours'
                  and event.starts_at < (case when event.is_provisional then ${provisionalUntil}::timestamptz
                                              else ${until}::timestamptz end)))
       order by live desc, event.starts_at, event.id
       limit ${CANDIDATES}`);
    if (!rows.length) return [];
    const parts = await db.execute<{
      event_id: string;
      id: string;
      name: string;
      short_name: string | null;
      side: string;
      position: number | null;
      logo_key: string | null;
      logo_url: string | null;
    }>(sql`
      select ep.event_id, p.id, p.name, p.short_name, ep.side, ep.position,
             a.storage_key as logo_key, a.source_url as logo_url
        from core.event_participant ep
        join core.participant p on p.id = ep.participant_id
        left join core.asset a on a.id = ${logoIdSql('p', ctx.logos.enabled())}
       where ${inList(
         sql`ep.event_id`,
         rows.map((r) => r.id),
       )}
       order by ep.event_id, case ep.side when 'home' then 0 when 'away' then 1 else 2 end, ep.position nulls last`);
    const names = await loadTeamNames(
      db,
      parts.map((p) => p.id),
      teamNameOptions(ctx, locale),
    );
    const byEvent = new Map<string, (typeof parts)[number][]>();
    for (const p of parts) byEvent.set(p.event_id, [...(byEvent.get(p.event_id) ?? []), p]);
    const hits: Hit[] = [];
    for (const r of rows) {
      const ps = byEvent.get(r.id) ?? [];
      // O jogo herda o casamento do melhor time dele que a busca encontrou.
      const team = ps
        .map((p) => teamsById.get(p.id))
        .filter((h): h is Hit => !!h)
        .sort((a, b) => a.rank - b.rank)[0];
      if (!team) continue;
      const competition = r.competition ? pickText(r.competition_labels, locale, r.competition) : null;
      hits.push({
        rank: team.rank,
        result: {
          type: 'event',
          id: r.id,
          slug: null,
          name: ps.map((p) => names.name(p.id, p.name)).join(' x '),
          match: team.result.match,
          matched: team.result.matched,
          sport: r.sport,
          country: null,
          image: team.result.image,
          detail: competition,
          event: {
            starts_at: new Date(r.starts_at).toISOString(),
            status: r.status,
            live: r.live,
            provisional: r.is_provisional,
            competition,
            participants: ps.map((p) => ({
              id: p.id,
              ...names.of(p.id, p.name),
              short_name: p.short_name,
              logo: asset(p.logo_key, p.logo_url),
            })),
          },
        },
      });
    }
    return hits;
  }

  // ─── /v1/search ──────────────────────────────────────────────────────────────────────────────
  app.get('/v1/search', { config: MODULE }, async (request, reply) => {
    const query = parseInput(SearchQuery, request.query);
    const locale = localeOf(request, query);
    const scope = sportScope(request, query.sport);
    const sports = query.sport ? [query.sport] : scope;
    const types: readonly SearchType[] = query.types?.length ? query.types : SEARCH_TYPES;
    const term = fold(query.q);
    reply.header('content-language', locale);
    return sendCached(request, reply, ctx.cache, {
      // Com jogos, a resposta envelhece com o placar e a agenda.
      ttl: types.includes('event') ? CACHE_TTL.schedule : CACHE_TTL.catalog,
      vary: [locale, ...(scope ?? [])],
      load: async () => {
        const db = requireDb(ctx);
        const want = (t: SearchType) => types.includes(t);
        const [teamHits, competitionHits, personHits, venueHits, countryHits] = await Promise.all([
          want('team') || want('event') ? teams(db, term, locale, sports, ctx.now()) : [],
          want('competition') ? competitions(db, term, locale, sports) : [],
          want('person') ? people(db, term, sports) : [],
          want('venue') && !query.sport ? venues(db, term) : [],
          want('country') && !query.sport ? countries(db, term, locale) : [],
        ]);
        const eventHits = want('event') ? await events(db, teamHits, locale, sports, ctx.now()) : [];
        const byType: Record<SearchType, Hit[]> = {
          team: want('team') ? teamHits : [],
          competition: competitionHits,
          event: eventHits,
          person: personHits,
          venue: venueHits,
          country: countryHits,
        };
        // Dentro do tipo: nível do casamento e a ordem do SQL (relevância); entre tipos: nível e `types`.
        const ranked = types.flatMap((type, typeIndex) =>
          byType[type]
            .map((h, i) => ({ ...h, i }))
            .sort((a, b) => a.rank - b.rank || byWeight(a, b) || a.i - b.i)
            .slice(0, query.limit)
            .map((h) => ({ ...h, typeIndex })),
        );
        ranked.sort((a, b) => a.rank - b.rank || a.typeIndex - b.typeIndex || a.i - b.i);
        const body: SearchResponse = { q: query.q, data: ranked.map((h) => h.result) };
        return {
          body,
          tags: [
            'participant',
            'team_profile',
            'competition',
            'competition_profile',
            'person',
            'venue',
            'country',
            'event',
          ],
        };
      },
    });
  });
}
