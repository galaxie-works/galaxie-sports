/**
 * Casamento estrito pelo time da temporada no Wikidata para quem não tem data de nascimento no core: nome, idade
 * (±1 ano, da api-sports) e time (P54) num candidato único. Traz nascimento, nacionalidade e foto de licença livre
 * (Commons, crédito em core.asset_credit). Não usa a cota da api-sports.
 *   pnpm --filter @galaxie/ingestor pessoas:wikidata-por-time --plan   # casa tudo e só relata, sem gravar
 *   pnpm --filter @galaxie/ingestor pessoas:wikidata-por-time          # grava e baixa as fotos
 * Opções: --desde 2026-01-01 · --tier-max 2 · --limite-times N (amostra)
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { WIKIMEDIA_USER_AGENT, WikimediaClient } from '../assets/commons/client.js';
import { objectStoreFromEnv } from '../assets/object-store.js';
import {
  asPhotoMatch,
  findTeamPlayers,
  matchByTeam,
  resolveTeams,
  saveTeamMatches,
  teamCandidates,
  type TeamResolution,
} from '../assets/wikidata-teams.js';
import { importPeoplePhotos, type PhotoMatch } from '../assets/wikimedia-photos.js';
import { PgSparqlCache, SparqlClient } from '../multisport/wikidata/sparql-client.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    desde: { type: 'string', default: '2026-01-01' },
    'tier-max': { type: 'string', default: '2' },
    'limite-times': { type: 'string' },
  },
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(url);
try {
  const all = await teamCandidates(db, {
    since: new Date(`${values.desde}T00:00:00Z`),
    maxTier: Number(values['tier-max']),
  });
  const limit = values['limite-times'] ? Number(values['limite-times']) : undefined;
  const teams = limit ? all.teams.slice(0, limit) : all.teams;
  const teamIds = new Set(teams.map((t) => t.providerId));
  const candidates = limit
    ? all.candidates.filter((c) => c.teams.some((t) => teamIds.has(t)))
    : all.candidates;
  console.log(
    `Candidatos (sem foto, sem nascimento, com idade): ${candidates.length} · times: ${teams.length}`,
  );

  const wiki = new WikimediaClient({ log: (m) => console.log(`  ${m}`) });
  const sparql = new SparqlClient({
    userAgent: WIKIMEDIA_USER_AGENT,
    cache: new PgSparqlCache(db, 'pessoas:wikidata-por-time'),
    log: (m) => console.log(`  ${m}`),
  });
  const resolved = await resolveTeams(wiki, sparql, teams, {
    onProgress: (d, t) => console.log(`  times buscados: ${d}/${t}`),
  });
  const counts = { qid: 0, ambiguous: 0, none: 0 };
  for (const r of resolved.values())
    counts['qid' in r ? 'qid' : 'ambiguous' in r ? 'ambiguous' : 'none'] += 1;
  console.log(`Times: com QID único ${counts.qid} · ambíguos ${counts.ambiguous} · sem QID ${counts.none}`);

  const qids = [...resolved.values()].flatMap((r: TeamResolution) => ('qid' in r ? [r.qid] : []));
  const players = await findTeamPlayers(sparql, qids, {
    onProgress: (d, t) => {
      if (d === t || d % 200 === 0) console.log(`  elencos do Wikidata: ${d}/${t} times`);
    },
  });
  const report = matchByTeam(candidates, players, resolved);
  const withPhoto = report.matches.map(asPhotoMatch).filter((m): m is PhotoMatch => !!m);
  console.log(
    `Jogadores do Wikidata nesses times em 2026: ${players.length}\n` +
      `Ligados: ${report.matches.length} (${withPhoto.length} com foto no Wikidata) · ambíguos: ${report.ambiguous} · ` +
      `sem par: ${report.unmatched} · sem time no Wikidata: ${report.noTeam}`,
  );
  for (const m of report.matches.slice(0, 15)) {
    console.log(
      `  ${m.candidate.name} (${m.candidate.age} anos) → ${m.player.labels[0]} ${m.player.qid} · ${m.player.birthDate} · ${m.player.countries.join('/') || '?'}`,
    );
  }

  if (values.plan) {
    console.log('Prévia: nada foi gravado.');
  } else {
    const bio = await saveTeamMatches(db, report.matches, resolved);
    console.log(
      `Gravados: ${bio.linked} QIDs · nascimento ${bio.birthDates} · nacionalidade ${bio.nationalities}`,
    );
    const store = objectStoreFromEnv();
    const photos = await importPeoplePhotos(db, store, wiki, withPhoto);
    store.close();
    console.log(
      `Fotos ligadas: ${photos.linked} (${(photos.bytes / 1024).toFixed(0)} KiB) · sem licença livre: ${photos.notFree} · já tinham foto: ${photos.skipped}`,
    );
  }
} finally {
  await closeDb(db);
}
