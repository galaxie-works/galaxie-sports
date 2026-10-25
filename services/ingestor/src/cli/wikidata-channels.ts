/**
 * Mapa de canais oficiais do Conteúdo relacionado (docs/12 §3.2) pelo Wikidata: P2397 (YouTube channel ID) do QID
 * dos times e das competições de futebol com jogos na janela. Não usa a cota da api-sports nem a do YouTube.
 *   pnpm --filter @galaxie/ingestor canais:wikidata --plan        # consulta e relata, sem gravar
 *   pnpm --filter @galaxie/ingestor canais:wikidata               # grava em enrich.related_channel
 *   pnpm --filter @galaxie/ingestor canais:wikidata --resolver    # antes, liga ao Wikidata os times sem QID
 * Opções: --dias-antes 14 · --dias-depois 14 · --tier-max 2
 * O QID do time vem do casamento estrito do `core.provider_map` (CLI pessoas:wikidata-por-time); com --resolver,
 * do mesmo `resolveTeams` (clube de futebol do mesmo país e categoria; ambíguo não liga).
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '@galaxie/db';
import { WikimediaClient } from '../assets/commons/client.js';
import {
  channelTargets,
  saveChannelLinks,
  saveTeamQids,
  wikidataChannelLinks,
} from '../assets/wikidata-channels.js';
import { resolveTeams } from '../assets/wikidata-teams.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    resolver: { type: 'boolean', default: false },
    'dias-antes': { type: 'string', default: '14' },
    'dias-depois': { type: 'string', default: '14' },
    'tier-max': { type: 'string', default: '2' },
  },
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(url);
try {
  const now = Date.now();
  const opts = {
    since: new Date(now - Number(values['dias-antes']) * 86_400_000),
    until: new Date(now + Number(values['dias-depois']) * 86_400_000),
    maxTier: Number(values['tier-max']),
  };
  let targets = await channelTargets(db, opts);
  console.log(
    `Times: ${targets.teams.length} (${targets.teams.length - targets.unresolved.length} com QID) · ` +
      `competições com QID: ${targets.competitions.length}`,
  );
  const wiki = new WikimediaClient({ log: (m) => console.log(`  ${m}`) });
  if (values.resolver && targets.unresolved.length) {
    const resolved = await resolveTeams(wiki, targets.unresolved, {
      onProgress: (d, t) => console.log(`  times buscados: ${d}/${t}`),
    });
    const ok = [...resolved.values()].filter((r) => 'qid' in r).length;
    console.log(`Resolvidos agora: ${ok} de ${targets.unresolved.length} (ambíguos e sem par ficam de fora)`);
    if (!values.plan) {
      console.log(`QIDs gravados em core.provider_map: ${await saveTeamQids(db, resolved)}`);
      targets = await channelTargets(db, opts);
    }
  }
  const teams = targets.teams.flatMap((t) => (t.qid ? [{ participantId: t.participantId, qid: t.qid }] : []));
  const links = await wikidataChannelLinks(wiki, { teams, competitions: targets.competitions });
  const clubs = links.filter((l) => l.kind === 'club');
  console.log(
    `Canais no Wikidata (P2397): ${new Set(clubs.map((l) => l.participantId)).size} times · ` +
      `${links.length - clubs.length} de competição · requisições ao Wikidata: ${wiki.requests}`,
  );
  for (const c of targets.competitions)
    if (!links.some((l) => l.competitionId === c.competitionId))
      console.log(`  sem canal: ${c.slug} (${c.qid})`);
  if (values.plan) {
    console.log('Prévia: nada foi gravado.');
  } else {
    const r = await saveChannelLinks(db, links, {
      club: teams.map((t) => t.participantId),
      competition: targets.competitions.map((c) => c.competitionId),
    });
    console.log(
      `enrich.related_channel: ${r.inserted} novos · ${r.kept} mantidos · ${r.deactivated} desativados. ` +
        'Próximo passo: related:canais (ai-agents) confere os canais no YouTube e soma os do channels.yaml.',
    );
  }
} finally {
  await closeDb(db);
}
