/**
 * Resolve slugs da base semântica ↔ times da api-sports (issue #17), lendo só o banco local
 * (raw /teams, /fixtures, /leagues e core.participant) — nenhuma chamada à api-sports.
 *   pnpm resolve:ids                         # relatório de todos os times
 *   pnpm resolve:ids --pais Brazil           # só um país (nome da api-sports ou ISO2: BR)
 *   pnpm resolve:ids --json relatorio.json   # relatório completo em JSON
 *   pnpm resolve:ids --write                 # grava no YAML os IDs resolvidos sem ambiguidade
 *   pnpm resolve:ids --apply-db              # grava provider_map/team_profile.participant_id (participantes existentes)
 * Casos ambíguos, conflitos e não encontrados nunca são aplicados: ficam no relatório para revisão manual.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { closeDb, createDb } from '@galaxie/db';
import { DEFAULT_KNOWLEDGE_DIR, loadKnowledge } from '../load.js';
import { applyResolutionsToDb } from '../resolver/apply-db.js';
import { resolveTeams, summarizeResolutions, teamRef, type Resolution } from '../resolver/match.js';
import { normalizeName } from '../resolver/normalize.js';
import { loadCandidatePool } from '../resolver/sources.js';
import { setTeamIdInYaml } from '../resolver/yaml-writeback.js';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');
// pnpm roda o script dentro do pacote; caminhos relativos são os de quem chamou
const cwd = process.env.INIT_CWD ?? process.cwd();
const dir = opt('--dir') ? resolve(cwd, opt('--dir')!) : DEFAULT_KNOWLEDGE_DIR;
const country = opt('--pais') ?? opt('--country');

const kb = await loadKnowledge(dir);
const db = createDb(process.env.DATABASE_URL, { max: 2 });
try {
  const pool = await loadCandidatePool(db);
  const refs = kb.teams
    .map(teamRef)
    .filter(
      (t) =>
        !country ||
        t.countryCode.toLowerCase() === country.toLowerCase() ||
        normalizeName(t.countryName) === normalizeName(country),
    );
  const results = resolveTeams(refs, pool);
  const summary = summarizeResolutions(results);

  console.log(
    `Candidatos: ${pool.candidates.length} (países com /teams completo: ${[...pool.coveredCountries].join(', ') || 'nenhum'})`,
  );
  console.table(summary);
  const show = (status: Resolution['status'][], title: string) => {
    const list = results.filter((r) => status.includes(r.status));
    if (!list.length) return;
    console.log(`\n${title} (${list.length}):`);
    for (const r of list)
      console.log(
        `  ${r.slug} [${r.status}${r.currentId !== null ? ` · YAML ${r.currentId}` : ''}${r.apiId !== null ? ` → ${r.apiId}` : ''}]` +
          `${r.note ? ` ${r.note}` : ''}` +
          (r.candidates.length
            ? `\n      ${r.candidates.map((c) => `${c.apiId ?? c.participantId} "${c.name}" ${c.confidence}`).join(' | ')}`
            : ''),
      );
  };
  show(['resolved'], 'Resolvidos (podem ser gravados com --write)');
  show(['conflict'], 'Conflitos (team_id do YAML não confere — revisar)');
  show(['ambiguous'], 'Ambíguos (revisão manual; nunca aplicados)');
  show(['unmatched'], 'Sem candidato no país');
  if (args.includes('--verbose')) show(['verified', 'unverified', 'no-data'], 'Demais');

  const jsonPath = opt('--json');
  if (jsonPath) {
    await writeFile(resolve(cwd, jsonPath), JSON.stringify({ summary, results }, null, 2));
    console.log(`\nRelatório salvo em ${resolve(cwd, jsonPath)}`);
  }

  if (args.includes('--write')) {
    const byFile = new Map<string, Resolution[]>();
    for (const r of results.filter((x) => x.status === 'resolved' && x.apiId !== null))
      byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
    let written = 0;
    for (const [file, list] of byFile) {
      const path = join(dir, file);
      let source = await readFile(path, 'utf8');
      for (const r of list) {
        const out = setTeamIdInYaml(source, r.slug, r.apiId!);
        source = out.source;
        if (out.changed) written++;
      }
      await writeFile(path, source);
    }
    console.log(`\n${written} team_id gravado(s) no YAML. Revise o diff e rode pnpm knowledge:validate.`);
  }

  if (args.includes('--apply-db')) {
    const applied = await applyResolutionsToDb(db, results);
    console.log(
      `\nBanco: ${applied.providerMap} mapeamento(s) em core.provider_map, ${applied.teamProfiles} perfil(is) ligados.`,
    );
  }
} finally {
  await closeDb(db);
}
