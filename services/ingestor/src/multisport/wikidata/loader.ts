import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  games,
  medal,
  medalReference,
  msEvent,
  msParticipant,
  msPerson,
  noc,
  sourceRef,
  teamMember,
  type Database,
  type MedalType,
} from '@galaxie/db';
import { refreshMedalTableSnapshot } from '../medal-store.js';
import { updateMedalDataQuality, type MedalDataQuality } from '../qa/report.js';
import { disciplineAliasMap, EXCLUDED_SPORT_ALIASES } from '../seed/sports.js';
import {
  buildMedals,
  eventGenderFromLabel,
  eventSportLabels,
  historicalNoc,
  interpretStatement,
  isHuman,
  isMedalEvent,
  isTeamEventLabel,
  KNOWN_MEDAL_QIDS,
  medalFromLabel,
  parseEvents,
  parseIocCodes,
  parseMedalStatements,
  parseParticipants,
  resolveNoc,
  toQid,
  type BuiltMedal,
  type EventMeta,
  type MedalCandidate,
  type MedalConflict,
  type ParticipantMeta,
} from './parse.js';
import {
  delegationAggregatesQuery,
  eventsQuery,
  iocCodesQuery,
  labelsQuery,
  medalStatementsQuery,
  participantsQuery,
} from './queries.js';
import type { SparqlBinding, SparqlClient } from './sparql-client.js';

const LICENSE = 'CC0-1.0';
const wdUrl = (qid: string) => `https://www.wikidata.org/wiki/${qid}`;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type GamesRow = typeof games.$inferSelect;

const DAY = 86_400_000;

/** Data da prova só é aceita se cair na janela da edição (−200 dias para torneios com fase prévia, +30). */
function plausibleDate(date: string | undefined, g: Pick<GamesRow, 'startDate' | 'endDate'>): string | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return t >= Date.parse(g.startDate) - 200 * DAY && t <= Date.parse(g.endDate) + 30 * DAY ? date : null;
}

export interface GamesLoadReport {
  slug: string;
  statements: number;
  candidateEvents: number;
  medalEvents: number;
  excludedEvents: number;
  excludedStatements: number;
  unresolvedNoc: { participantQid: string; eventQid: string }[];
  unmappedSports: string[];
  conflicts: MedalConflict[];
  teamEvents: number;
  medals: { active: number; revoked: number; G: number; S: number; B: number };
  delegationReferences: number;
  coverage: number | null;
  quality: MedalDataQuality;
}

export interface LoaderOptions {
  pageSize?: number;
  batchSize?: number;
  log?: (msg: string) => void;
  now?: () => Date;
}

/**
 * Carga do histórico de medalhas a partir do Wikidata (CC0), uma edição por vez.
 * Idempotente: medalhas são gravadas por chave natural (`source_key`) e as que sumiram da fonte são removidas.
 */
export class WikidataMedalLoader {
  private iocByQid: Map<string, string[]> | null = null;
  private knownNocs: Set<string> | null = null;
  private readonly medalMap = new Map<string, MedalType>(Object.entries(KNOWN_MEDAL_QIDS));
  private readonly checkedMedalQids = new Set<string>(Object.keys(KNOWN_MEDAL_QIDS));
  private readonly aliasMap = disciplineAliasMap();
  private readonly pageSize: number;
  private readonly batchSize: number;
  private readonly log: (msg: string) => void;
  private readonly now: () => Date;

  constructor(
    private readonly db: Database,
    private readonly client: SparqlClient,
    options: LoaderOptions = {},
  ) {
    this.pageSize = options.pageSize ?? 5000;
    this.batchSize = options.batchSize ?? 150;
    this.log = options.log ?? (() => {});
    this.now = options.now ?? (() => new Date());
  }

  private async nocContext() {
    if (!this.iocByQid) {
      const { data } = await this.client.query('ioc-codes', iocCodesQuery(), {});
      this.iocByQid = parseIocCodes(data.results.bindings);
    }
    if (!this.knownNocs) {
      const rows = await this.db.select({ code: noc.code }).from(noc);
      this.knownNocs = new Set(rows.map((r) => r.code));
    }
    return { iocByQid: this.iocByQid, knownNocs: this.knownNocs };
  }

  private async batched(name: string, slug: string, qids: string[], build: (q: string[]) => string) {
    const rows: SparqlBinding[] = [];
    const sorted = [...qids].sort();
    for (const [i, batch] of chunks(sorted, this.batchSize).entries()) {
      const { data } = await this.client.query(name, build(batch), { games: slug, batch: i });
      rows.push(...data.results.bindings);
    }
    return rows;
  }

  /** Descobre ouro/prata/bronze de itens de medalha ainda não conhecidos (ex.: medalhas do Pan) pelo rótulo. */
  private async learnMedalQids(qids: Iterable<string>, slug: string) {
    const unknown = [...new Set(qids)].filter((q) => !this.checkedMedalQids.has(q));
    if (!unknown.length) return;
    const rows = await this.batched('medal-labels', slug, unknown, labelsQuery);
    for (const b of rows) {
      const qid = toQid(b.item);
      const m = b.lbl ? medalFromLabel(b.lbl.value) : null;
      if (qid && m) this.medalMap.set(qid, m);
    }
    for (const q of unknown) this.checkedMedalQids.add(q);
  }

  async loadGames(g: GamesRow): Promise<GamesLoadReport> {
    if (!g.wikidataQid) throw new Error(`Edição ${g.slug} sem QID do Wikidata`);
    const qid = g.wikidataQid;
    const ctx = await this.nocContext();

    const statementRows = await this.client.paginate(
      'medal-statements',
      (limit, offset) => medalStatementsQuery(qid, limit, offset),
      { games: g.slug },
      this.pageSize,
    );
    const statements = parseMedalStatements(statementRows);
    await this.learnMedalQids(
      statements.flatMap((s) => [...s.medalQids]),
      g.slug,
    );

    const eventQids = [...new Set(statements.map((s) => s.eventQid))];
    const events = parseEvents(await this.batched('events', g.slug, eventQids, eventsQuery));

    const excludedSports = new Set(EXCLUDED_SPORT_ALIASES);
    const medalEventQids = new Set(
      eventQids.filter((q) => {
        const meta = events.get(q);
        if (!isMedalEvent(meta)) return false;
        return !eventSportLabels(meta!).some((l) => excludedSports.has(l));
      }),
    );

    const usable = statements
      .map((s) => ({ s, m: interpretStatement(s, this.medalMap) }))
      .filter((x) => x.m && medalEventQids.has(x.s.eventQid));
    const participantQids = [...new Set(usable.map((x) => x.s.participantQid))];
    const participants = parseParticipants(
      await this.batched('participants', g.slug, participantQids, participantsQuery),
    );

    const unresolvedNoc: GamesLoadReport['unresolvedNoc'] = [];
    const candidates: MedalCandidate[] = [];
    for (const { s, m } of usable) {
      const meta = participants.get(s.participantQid);
      const res = resolveNoc(s.contextQids, meta, g.year, ctx);
      if (!res) {
        unresolvedNoc.push({ participantQid: s.participantQid, eventQid: s.eventQid });
        continue;
      }
      const code = g.type === 'OG' ? historicalNoc(res.code, g.year, g.season) : res.code;
      candidates.push({
        eventQid: s.eventQid,
        participantQid: s.participantQid,
        human: isHuman(meta),
        noc: ctx.knownNocs.has(code) ? code : res.code,
        medal: m!.medal,
        explicit: m!.explicit,
        revoked: s.deprecated,
        revokedReason: s.deprecated
          ? `Declaração depreciada no Wikidata${s.reasonQids.size ? ` (${[...s.reasonQids].join(', ')})` : ''}`
          : undefined,
        revokedAt: s.deprecated ? s.endDate : undefined,
        confidence: res.confidence,
        statementIds: [s.id],
      });
    }

    const teamHints = new Map(
      [...medalEventQids].map((q) => [q, isTeamEventLabel(events.get(q)?.labels.en)]),
    );
    const built = buildMedals(candidates, teamHints);

    const unmapped = new Set<string>();
    const persisted = await this.persist(g, built.medals, built.teamEvents, events, participants, unmapped);
    const delegationReferences = await this.loadDelegationReferences(g, ctx);
    await refreshMedalTableSnapshot(this.db, g.id);
    const quality = await updateMedalDataQuality(this.db, g.id);

    const active = built.medals.filter((m) => !m.revoked);
    return {
      slug: g.slug,
      statements: statements.length,
      candidateEvents: eventQids.length,
      medalEvents: persisted.events,
      excludedEvents: eventQids.length - medalEventQids.size,
      excludedStatements: statements.length - usable.length,
      unresolvedNoc,
      unmappedSports: [...unmapped].sort(),
      conflicts: built.conflicts,
      teamEvents: built.teamEvents.size,
      medals: {
        active: active.length,
        revoked: built.medals.length - active.length,
        G: active.filter((m) => m.medal === 'G').length,
        S: active.filter((m) => m.medal === 'S').length,
        B: active.filter((m) => m.medal === 'B').length,
      },
      delegationReferences,
      coverage: quality.coverage,
      quality: quality.quality,
    };
  }

  private disciplineFor(meta: EventMeta): { code: string | null; label: string | null } {
    const labels = eventSportLabels(meta);
    for (const l of labels) {
      const code = this.aliasMap.get(l);
      if (code) return { code, label: l };
    }
    return { code: null, label: labels[0] ?? null };
  }

  private async persist(
    g: GamesRow,
    medals: BuiltMedal[],
    teamEvents: Set<string>,
    events: Map<string, EventMeta>,
    participants: Map<string, ParticipantMeta>,
    unmapped: Set<string>,
  ): Promise<{ events: number }> {
    const fetchedAt = this.now();
    return this.db.transaction(async (tx) => {
      // provas
      const usedEvents = [...new Set(medals.map((m) => m.eventQid))].sort();
      const eventValues = usedEvents.map((q) => {
        const meta = events.get(q)!;
        const d = this.disciplineFor(meta);
        if (!d.code) unmapped.add(d.label ?? `(sem esporte) ${q}`);
        const name = {
          ...(meta.labels.pt ? { 'pt-BR': meta.labels.pt } : {}),
          ...(meta.labels.es ? { es: meta.labels.es } : {}),
          en: meta.labels.en ?? q,
        };
        return {
          gamesId: g.id,
          disciplineCode: d.code,
          gender: eventGenderFromLabel(meta.labels.en),
          name,
          isTeam: teamEvents.has(q),
          eventDate: plausibleDate(meta.date, g),
          wikidataQid: q,
          sourceSport: d.code ? null : d.label,
        };
      });
      const eventIds = new Map<string, string>();
      for (const chunk of chunks(eventValues, 500)) {
        const rows = await tx
          .insert(msEvent)
          .values(chunk)
          .onConflictDoUpdate({
            target: msEvent.wikidataQid,
            set: {
              gamesId: sql`excluded.games_id`,
              disciplineCode: sql`excluded.discipline_code`,
              gender: sql`excluded.gender`,
              name: sql`excluded.name`,
              isTeam: sql`excluded.is_team`,
              eventDate: sql`excluded.event_date`,
              sourceSport: sql`excluded.source_sport`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: msEvent.id, qid: msEvent.wikidataQid });
        for (const r of rows) eventIds.set(r.qid!, r.id);
      }

      // pessoas
      const personQids = [...new Set(medals.flatMap((m) => m.personQids))].sort();
      const personIds = new Map<string, string>();
      for (const chunk of chunks(personQids, 500)) {
        const rows = await tx
          .insert(msPerson)
          .values(
            chunk.map((q) => {
              const p = participants.get(q);
              return {
                fullName: p?.labels.pt ?? p?.labels.en ?? p?.labels.es ?? q,
                gender: p?.gender ?? null,
                birthDate: p?.birthDate ?? null,
                olympediaId: p?.olympediaId ?? null,
                wikidataQid: q,
              };
            }),
          )
          .onConflictDoUpdate({
            target: msPerson.wikidataQid,
            set: {
              fullName: sql`excluded.full_name`,
              gender: sql`excluded.gender`,
              birthDate: sql`excluded.birth_date`,
              olympediaId: sql`excluded.olympedia_id`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: msPerson.id, qid: msPerson.wikidataQid });
        for (const r of rows) personIds.set(r.qid!, r.id);
      }

      // participantes (atleta × CON; equipe por prova × CON × cor)
      const participantValues = new Map<string, typeof msParticipant.$inferInsert>();
      const keyOf = (m: BuiltMedal) =>
        m.kind === 'athlete'
          ? `athlete:${m.participantQid}:${m.noc}`
          : `team:${m.eventQid}:${m.noc}:${m.medal}`;
      for (const m of medals) {
        const key = keyOf(m);
        if (participantValues.has(key)) continue;
        const team = m.participantQid ? participants.get(m.participantQid) : undefined;
        participantValues.set(key, {
          kind: m.kind,
          nocCode: m.noc,
          personId: m.kind === 'athlete' ? personIds.get(m.participantQid!)! : null,
          teamName: m.kind === 'team' ? (team?.labels.pt ?? team?.labels.en ?? m.noc) : null,
          externalKey: key,
          wikidataQid: m.participantQid,
        });
      }
      const participantIds = new Map<string, string>();
      for (const chunk of chunks([...participantValues.values()], 500)) {
        const rows = await tx
          .insert(msParticipant)
          .values(chunk)
          .onConflictDoUpdate({
            target: msParticipant.externalKey,
            set: {
              personId: sql`excluded.person_id`,
              teamName: sql`excluded.team_name`,
              wikidataQid: sql`excluded.wikidata_qid`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: msParticipant.id, key: msParticipant.externalKey });
        for (const r of rows) participantIds.set(r.key, r.id);
      }

      const members = medals
        .filter((m) => m.kind === 'team')
        .flatMap((m) =>
          m.personQids.map((p) => ({
            teamParticipantId: participantIds.get(keyOf(m))!,
            personId: personIds.get(p)!,
          })),
        );
      for (const chunk of chunks(members, 1000))
        await tx.insert(teamMember).values(chunk).onConflictDoNothing();

      // medalhas
      const eventDates = new Map(eventValues.map((e) => [e.wikidataQid, e.eventDate]));
      const medalValues = medals.map((m) => {
        const meta = events.get(m.eventQid);
        return {
          eventId: eventIds.get(m.eventQid)!,
          participantId: participantIds.get(keyOf(m))!,
          nocCode: m.noc,
          medal: m.medal,
          awardedAt: eventDates.get(m.eventQid) ?? g.endDate,
          revokedAt: m.revoked ? (m.revokedAt ? new Date(m.revokedAt) : fetchedAt) : null,
          revokedReason: m.revoked ? (m.revokedReason ?? null) : null,
          source: 'wikidata',
          sourceKey: m.sourceKey,
          confidence: m.confidence.toFixed(2),
          notes: meta ? null : 'prova sem metadados',
        };
      });
      const medalIds = new Map<string, string>();
      for (const chunk of chunks(medalValues, 500)) {
        const rows = await tx
          .insert(medal)
          .values(chunk)
          .onConflictDoUpdate({
            target: medal.sourceKey,
            set: {
              eventId: sql`excluded.event_id`,
              participantId: sql`excluded.participant_id`,
              nocCode: sql`excluded.noc_code`,
              medal: sql`excluded.medal`,
              awardedAt: sql`excluded.awarded_at`,
              // a data de revogação detectada na primeira carga é preservada
              revokedAt: sql`case when excluded.revoked_at is null then null else coalesce(${medal.revokedAt}, excluded.revoked_at) end`,
              revokedReason: sql`excluded.revoked_reason`,
              confidence: sql`excluded.confidence`,
              updatedAt: sql`now()`,
            },
          })
          .returning({ id: medal.id, key: medal.sourceKey });
        for (const r of rows) medalIds.set(r.key, r.id);
      }

      // medalhas desta edição que sumiram da fonte
      const gamesEventIds = tx.select({ id: msEvent.id }).from(msEvent).where(eq(msEvent.gamesId, g.id));
      const keep = [...medalIds.keys()];
      await tx
        .delete(medal)
        .where(
          and(
            eq(medal.source, 'wikidata'),
            inArray(medal.eventId, gamesEventIds),
            keep.length ? notInArray(medal.sourceKey, keep) : sql`true`,
          ),
        );

      // proveniência
      const refs = [
        ...[...eventIds.entries()].map(([q, id]) => ({ entityType: 'event', entityId: id, sourceId: q })),
        ...[...personIds.entries()].map(([q, id]) => ({ entityType: 'person', entityId: id, sourceId: q })),
        ...medals.map((m) => ({
          entityType: 'medal',
          entityId: medalIds.get(m.sourceKey)!,
          sourceId: m.statementIds[0] ?? m.eventQid,
        })),
      ].map((r) => ({
        ...r,
        source: 'wikidata',
        url: wdUrl(r.sourceId.split('$')[0]!.split('-')[0]!),
        license: LICENSE,
        fetchedAt,
      }));
      for (const chunk of chunks(refs, 1000))
        await tx
          .insert(sourceRef)
          .values(chunk)
          .onConflictDoUpdate({
            target: [sourceRef.entityType, sourceRef.entityId, sourceRef.source, sourceRef.sourceId],
            set: { fetchedAt: sql`excluded.fetched_at` },
          });

      return { events: eventIds.size };
    });
  }

  /** Agregados por delegação (P166 + P1114) → medal_reference (source = wikidata-delegation). */
  private async loadDelegationReferences(
    g: GamesRow,
    ctx: { iocByQid: Map<string, string[]>; knownNocs: Set<string> },
  ): Promise<number> {
    const { data } = await this.client.query(
      'delegation-aggregates',
      delegationAggregatesQuery(g.wikidataQid!),
      {
        games: g.slug,
      },
    );
    const rows = data.results.bindings;
    await this.learnMedalQids(
      rows.map((b) => toQid(b.medal)).filter((q): q is string => !!q),
      g.slug,
    );
    const byNoc = new Map<string, { G: number; S: number; B: number }>();
    for (const b of rows) {
      const country = toQid(b.country);
      const delegation = toQid(b.d);
      const codes = [
        ...(country ? (ctx.iocByQid.get(country) ?? []) : []),
        ...(delegation ? (ctx.iocByQid.get(delegation) ?? []) : []),
      ].filter((c) => ctx.knownNocs.has(c));
      const code = codes[0];
      const m = toQid(b.medal);
      const colour = m ? this.medalMap.get(m) : undefined;
      const qty = Number(b.qty?.value);
      if (!code || !colour || !Number.isFinite(qty)) continue;
      const c = byNoc.get(code) ?? { G: 0, S: 0, B: 0 };
      c[colour] = Math.max(c[colour], qty);
      byNoc.set(code, c);
    }
    await this.db
      .delete(medalReference)
      .where(and(eq(medalReference.gamesId, g.id), eq(medalReference.source, 'wikidata-delegation')));
    if (byNoc.size)
      await this.db.insert(medalReference).values(
        [...byNoc.entries()].map(([code, c]) => ({
          gamesId: g.id,
          nocCode: code,
          source: 'wikidata-delegation',
          gold: c.G,
          silver: c.S,
          bronze: c.B,
          url: wdUrl(g.wikidataQid!),
        })),
      );
    return byNoc.size;
  }
}
