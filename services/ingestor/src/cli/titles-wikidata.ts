/**
 * Campeões por edição das competições (Wikidata P1346) em core.competition_title, para o "busca o tetra"
 * (`seeks_title_{n}` nos stakes). Não usa a cota da api-sports.
 *   pnpm --filter @galaxie/ingestor titulos:wikidata --plan   # consulta, confere e só relata, sem gravar
 *   pnpm --filter @galaxie/ingestor titulos:wikidata          # grava títulos e as ligações novas de times
 * Opções: --competicao conmebol-libertadores (só uma) · --refresh (ignora o cache das consultas) ·
 *   --corrigir-ligacoes (move o QID do provider_map para o time que o nome indica, quando a ligação atual
 *   aponta para um time de base/feminino ou para outro clube; sem a opção, o conflito só é relatado)
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { WIKIMEDIA_USER_AGENT } from '../assets/commons/client.js';
import { PgSparqlCache, SparqlClient } from '../multisport/wikidata/sparql-client.js';
import {
  fetchEditions,
  fetchWinnersInfo,
  loadCompetitionIds,
  loadCoreChampions,
  loadCoreTeams,
  loadMappedTeams,
  resolveWinners,
  saveTitles,
  coverageOf,
  TITLE_COMPETITIONS,
  type Coverage,
  type TitleRow,
} from '../titles/wikidata-titles.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
    competicao: { type: 'string' },
    'corrigir-ligacoes': { type: 'boolean', default: false },
  },
});

const REASONS: Record<string, string> = {
  several_winners: 'mais de um vencedor',
  no_date: 'sem data',
  label_year_mismatch: 'rótulo e datas divergem',
  winner_not_participant: 'vencedor fora dos participantes da edição',
  core_disagrees: 'final no core com outro campeão',
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(url);
try {
  const competitions = TITLE_COMPETITIONS.filter(
    (c) => !values.competicao || c.slugs.includes(values.competicao),
  );
  if (!competitions.length) throw new Error(`Competição fora da lista: ${values.competicao}`);
  const ids = await loadCompetitionIds(
    db,
    competitions.flatMap((c) => c.slugs),
  );
  const sparql = new SparqlClient({
    userAgent: WIKIMEDIA_USER_AGENT,
    cache: new PgSparqlCache(db, 'titulos:wikidata'),
    cacheMaxAgeMs: 7 * 24 * 3_600_000,
    refresh: values.refresh,
    log: (m) => console.log(`  ${m}`),
  });

  const editionsBy = await fetchEditions(sparql, competitions, (m) => console.log(`  ${m}`));
  const accepted = [...editionsBy.values()].flat().filter((e) => !e.rejected);
  const winners = await fetchWinnersInfo(
    sparql,
    accepted.flatMap((e) => [...e.winners, ...(e.claimed ?? [])]),
  );
  const mapped = await loadMappedTeams(db);
  const countries = [...new Set(winners.flatMap((w) => w.countries))];
  const teams = await loadCoreTeams(db, countries);
  const resolution = resolveWinners(winners, mapped, teams);
  const teamName = new Map([
    ...[...mapped.values()].map((m) => [m.id, m.name] as const),
    ...teams.map((t) => [t.id, t.name] as const),
  ]);
  const winnerName = new Map(winners.map((w) => [w.qid, w.names[0] ?? w.qid]));
  const newLinks = new Map<string, string>();
  for (const [qid, r] of resolution)
    if ('participantId' in r && r.via === 'name') newLinks.set(qid, r.participantId);
  const fixLinks = values['corrigir-ligacoes'];
  const relinks = new Map<string, string>();
  if (fixLinks)
    for (const [qid, r] of resolution) if ('suggested' in r && r.suggested) relinks.set(qid, r.suggested);
  const participantOf = (qid: string) => {
    const r = resolution.get(qid);
    if (r && 'participantId' in r) return r.participantId;
    return relinks.get(qid) ?? null;
  };

  const champions = await loadCoreChampions(db, [...ids.values()]);
  const rows: TitleRow[] = [];
  const coverage: Coverage[] = [];
  const counts = new Map<string, Map<string, number>>();
  for (const c of competitions) {
    const compIds = c.slugs.map((s) => ids.get(s)).filter((x): x is string => !!x);
    const editions = editionsBy.get(c.qid) ?? [];
    for (const e of editions) {
      if (e.rejected) continue;
      const winner = e.winners[0]!;
      const participantId = participantOf(winner);
      for (const compId of compIds) {
        const core = champions.get(`${compId}|${e.seasonYear}`);
        if (core?.participantId && participantId && core.participantId !== participantId) {
          e.rejected = {
            reason: 'core_disagrees',
            detail: `core: ${teamName.get(core.participantId) ?? core.participantId}`,
          };
          break;
        }
      }
      if (e.rejected) continue;
      for (const compId of compIds) {
        const core = champions.get(`${compId}|${e.seasonYear}`);
        rows.push({
          competitionId: compId,
          participantId,
          seasonYear: e.seasonYear!,
          seasonLabel: e.seasonLabel!,
          // a data da final no core é mais precisa que o fim da edição no Wikidata
          decidedOn: core?.participantId ? core.decidedOn : e.decidedOn!,
          editionQid: e.qid,
          winnerQid: winner,
          competitionQid: c.qid,
          source: e.source,
          sourceRef: e.sourceRef ?? null,
        });
      }
      if (participantId) {
        const m = counts.get(c.qid) ?? new Map<string, number>();
        m.set(participantId, (m.get(participantId) ?? 0) + 1);
        counts.set(c.qid, m);
      }
    }
    for (const compId of compIds) coverage.push(coverageOf(c, compId, editions));
  }

  console.log('');
  const who = (qids: readonly string[]) => qids.map((w) => winnerName.get(w) ?? w).join(' / ');
  for (const c of competitions) {
    const editions = editionsBy.get(c.qid) ?? [];
    const ok = editions.filter((e) => !e.rejected);
    const found = c.slugs.filter((s) => ids.has(s));
    const linked = ok.filter((e) => participantOf(e.winners[0]!)).length;
    const cov = coverage.find((x) => x.competitionId === ids.get(found[0] ?? ''));
    console.log(
      `${c.label} (${c.qid} → ${found.join(', ') || 'sem competição no core'}): ${ok.length}/${editions.length} edições aceitas · ` +
        `${linked} com o campeão ligado ao nosso time · ${cov?.firstYear ?? '—'}–${cov?.latestYear ?? '—'} · ` +
        `completa até ${cov?.completeThrough ?? 'nunca (sem contagem)'}`,
    );
    const missing = cov?.issues.filter((i) => i.reason === 'missing_year').map((i) => i.year) ?? [];
    if (missing.length) console.log(`  anos sem edição no Wikidata: ${missing.join(', ')}`);
    for (const e of editions) {
      if (e.source === 'curated')
        console.log(
          `  corrigida: ${e.label ?? e.qid} (${e.qid}) → ${who(e.winners)} (Wikidata: ${who(e.claimed ?? [])})`,
        );
      if (!e.rejected) continue;
      console.log(
        `  fora: ${e.label ?? e.qid} (${e.qid}) → ${who(e.winners)}: ` +
          `${REASONS[e.rejected.reason]}${e.rejected.detail ? ` (${e.rejected.detail})` : ''}`,
      );
    }
    const top = [...(counts.get(c.qid) ?? new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, n]) => `${teamName.get(id) ?? id} ${n}`);
    if (top.length) console.log(`  mais títulos: ${top.join(' · ')}`);
  }
  const all = [...resolution.values()];
  console.log(
    `\nVencedores: ${winners.length} · ligados antes ${all.filter((r) => 'participantId' in r && r.via === 'provider_map').length} · ` +
      `ligações novas por nome ${newLinks.size} · ambíguos ${all.filter((r) => 'ambiguous' in r).length} · ` +
      `ligações em conflito ${all.filter((r) => 'conflict' in r).length} · ` +
      `sem par ${all.filter((r) => 'none' in r).length}`,
  );
  for (const [qid, r] of resolution)
    if ('conflict' in r)
      console.log(
        `  ligação em conflito: ${winnerName.get(qid)} (${qid}) → ${r.mappedTo} (${r.conflict})` +
          (r.suggested
            ? `; ${fixLinks ? 'corrigida para' : 'com --corrigir-ligacoes iria para'} ${teamName.get(r.suggested)}`
            : ''),
      );
  for (const [qid, id] of newLinks)
    console.log(`  nova ligação: ${winnerName.get(qid)} (${qid}) → ${teamName.get(id)}`);

  if (values.plan) {
    console.log(
      `Prévia: nada foi gravado (${rows.length} títulos e ${coverage.length} coberturas seriam gravados).`,
    );
  } else {
    const saved = await saveTitles(db, rows, newLinks, coverage, relinks);
    console.log(
      `Gravados: ${saved.titles} títulos · ${coverage.length} coberturas · ${saved.links} ligações novas de times · ` +
        `${saved.relinked} ligações corrigidas`,
    );
  }
  console.log(`Consultas ao Wikidata: ${sparql.networkCalls} (cache: ${sparql.cacheHits})`);
} finally {
  await closeDb(db);
}
