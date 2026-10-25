/**
 * Biografia dos pilotos de F1 (card "Biografia" da página do piloto): nome completo, morte e família do F1DB e, com
 * o QID casado de forma estrita, local, causa e circunstância da morte, apelidos e vitórias em Indianápolis e Le
 * Mans do Wikidata. Sem IA e sem a cota da api-sports. Regras em `f1db/biography.ts`.
 *   pnpm --filter @galaxie/ingestor f1:biografia --plan     # consulta, casa e só relata, sem gravar
 *   pnpm --filter @galaxie/ingestor f1:biografia            # grava em core.participant e liga o QID no provider_map
 * Opções: --pilotos ayrton-senna,graham-hill (só esses) · --refresh (ignora o cache das consultas ao Wikidata)
 * Sem a tabela driver_family_relationship do F1DB no raw, grava antes as páginas que faltam do release fixado (só o
 * raw, em fluxo, como o f1db:import; o core não muda).
 */
import { parseArgs } from 'node:util';
import { closeDb, createDb, type ParticipantBioFacts } from '@galaxie/db';
import { WIKIMEDIA_USER_AGENT } from '../assets/commons/client.js';
import {
  f1dbBiographies,
  loadBiographyTables,
  saveBiographies,
  wikidataBlock,
  wikidataForDrivers,
  type BiographyRow,
} from '../f1db/biography.js';
import { storeF1dbRelease } from '../f1db/package-raw.js';
import { ensureRelease, F1DB_RELEASE, f1dbDir } from '../f1db/release.js';
import { PgSparqlCache, SparqlClient } from '../multisport/wikidata/sparql-client.js';

const { values } = parseArgs({
  options: {
    plan: { type: 'boolean', default: false },
    refresh: { type: 'boolean', default: false },
    pilotos: { type: 'string' },
  },
});

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');
const db = createDb(url, { max: 2 });
try {
  let tables;
  try {
    tables = await loadBiographyTables(db);
  } catch {
    console.log(
      `Tabela de parentesco fora do raw: gravando as páginas que faltam do F1DB ${F1DB_RELEASE.version}…`,
    );
    const path = await ensureRelease(f1dbDir(), F1DB_RELEASE, (m) => console.log(`  ${m}`));
    await storeF1dbRelease(db, path, F1DB_RELEASE.version);
    tables = await loadBiographyTables(db);
  }
  const all = f1dbBiographies(tables);
  const only = values.pilotos
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bios = [...all.values()].filter((b) => !only || only.includes(b.f1dbId));
  if (!bios.length) throw new Error('Nenhum piloto do F1DB na seleção.');
  const sparql = new SparqlClient({
    userAgent: WIKIMEDIA_USER_AGENT,
    cache: new PgSparqlCache(db, 'f1:biografia'),
    cacheMaxAgeMs: 7 * 24 * 3_600_000,
    refresh: values.refresh,
    log: (m) => console.log(`  ${m}`),
  });
  const { matches, facts } = await wikidataForDrivers(sparql, bios);
  const checkedAt = new Date().toISOString();
  const rows: BiographyRow[] = bios.map((b) => {
    const m = matches.get(b.f1dbId);
    const out: ParticipantBioFacts = {};
    if (b.family.length) out.family = b.family;
    if (m) out.wikidata = wikidataBlock(b, m, facts.get(m.qid), checkedAt);
    return { f1dbId: b.f1dbId, fullName: b.fullName, deathDate: b.deathDate, facts: out };
  });

  const w = rows.flatMap((r) => (r.facts.wikidata ? [r.facts.wikidata] : []));
  const dead = rows.filter((r) => r.deathDate);
  console.log(
    [
      `Pilotos do F1DB: ${rows.length} · com nome completo: ${rows.filter((r) => r.fullName).length} · mortos: ${dead.length}`,
      `Família no automobilismo: ${rows.filter((r) => r.facts.family).length} piloto(s)`,
      `Wikidata casado: ${w.length} (pelo id de piloto ${w.filter((x) => x.matched_by === 'driver_id').length}, pelo nome ${w.filter((x) => x.matched_by === 'name').length}) · sem casamento: ${rows.length - w.length}`,
      `Mortos com local único: ${w.filter((x) => x.death_place).length} · com causa: ${w.filter((x) => x.death_cause?.length).length} · com circunstância: ${w.filter((x) => x.death_manner?.length).length}`,
      `Apelidos: ${w.filter((x) => x.nicknames?.length).length} · vitórias em Indianápolis/Le Mans: ${w.reduce((n, x) => n + (x.wins?.length ?? 0), 0)}`,
      `Consultas ao Wikidata: ${sparql.networkCalls} na rede, ${sparql.cacheHits} do cache`,
    ].join('\n'),
  );
  const sample = rows
    .filter((r) => r.facts.wikidata?.wins?.length || (r.deathDate && r.facts.wikidata))
    .slice(0, 12);
  console.table(
    sample.map((r) => ({
      piloto: r.f1dbId,
      qid: r.facts.wikidata?.qid,
      casado: r.facts.wikidata?.matched_by,
      morte: r.deathDate ?? '',
      local: r.facts.wikidata?.death_place?.labels.pt ?? r.facts.wikidata?.death_place?.labels.en ?? '',
      vitorias: (r.facts.wikidata?.wins ?? []).map((x) => `${x.race} ${x.year}`).join(', '),
    })),
  );
  if (values.plan) {
    console.log('PRÉVIA: nada gravado.');
  } else {
    const saved = await saveBiographies(db, rows);
    console.log(
      `Gravado: ${saved.updated} participante(s) atualizado(s), ${saved.linked} QID(s) ligado(s).` +
        (saved.conflicts.length
          ? `\nQID já ligado a outro participante (não religado):\n  ${saved.conflicts.join('\n  ')}`
          : ''),
    );
  }
} finally {
  await closeDb(db);
}
