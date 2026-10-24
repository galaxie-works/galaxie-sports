/**
 * Auditoria dos perfis de piloto da F1 contra o F1DB (somente leitura): cada piloto com ao menos um GP largado,
 * com prioridade para o grid atual e as lendas (campeões, top 20 em vitórias e em GPs). Usa a mesma lógica da API
 * (`loadRaceCareer`, o país do `/v1/teams/:id` e a campanha do overview), em processo, e escreve um relatório em
 * markdown (uma linha por problema e o placar por campo) e o placar em JSON, para comparar antes e depois.
 *
 *   pnpm --filter @galaxie/api f1:auditoria                                  # release em F1DB_DIR ou ~/.galaxie/f1db
 *   pnpm --filter @galaxie/api f1:auditoria --f1db /data/f1db/v2026.17.0/f1db.db --out relatorio.md --json placar.json
 *   pnpm --filter @galaxie/api f1:auditoria --pilotos lewis-hamilton,ayrton-senna   # só esses (IDs do F1DB)
 *   pnpm --filter @galaxie/api f1:auditoria --prioridade                     # só grid atual e lendas
 *   pnpm --filter @galaxie/api f1:auditoria --completo --ambiente "produção" # outras frentes de todos; rótulo no topo
 *
 * Não grava nada: só lê o banco (`DATABASE_URL`) e o SQLite do release.
 */
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { TeamCompetition } from '@galaxie/contracts';
import { closeDb, createDb, type Database } from '@galaxie/db';
import { liveryFor, loadLiveries } from '@galaxie/knowledge';
import { RulesRegistry } from '../events/rules-registry.js';
import { pickText } from '../i18n.js';
import { meetsReview } from '../routes/v1/semantic.js';
import { loadRaceCareer } from '../teams/career.js';
import { AUDIT_FIELDS, auditDriver, type AuditIssue, type F1dbDriverTruth } from '../teams/f1-audit.js';
import { loadTeamCompetitions } from '../teams/load-campaigns.js';

const RELEASE = 'v2026.17.0';
const LOCALE = 'pt-BR';

function parseArgs(argv: string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) out.set(a.slice(2), (i++, next));
    else out.set(a.slice(2), true);
  }
  return out;
}

type Row = Record<string, unknown>;
/** Na corrida sem largar (o F1DB não conta como GP disputado). */
const NOT_STARTED = new Set(['DNS', 'DNP', 'EX']);
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));

/** Verdade do F1DB por piloto (só quem largou ao menos um GP) e o calendário da temporada atual. */
async function loadF1dbTruth(path: string, today: string) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });
  const all = (q: string, ...p: (string | number)[]) => db.prepare(q).all(...p) as Row[];
  const countries = new Map(all('select id, alpha2_code, name from country').map((c) => [s(c.id)!, c]));
  const country = (id: unknown) => {
    const c = countries.get(String(id));
    return c ? { code: s(c.alpha2_code)!, name: s(c.name)! } : null;
  };
  const [{ year: currentYear }] = all('select max(year) as year from race') as [{ year: number }];
  const [{ left }] = all(
    'select count(*) as left from race where year = ? and date > ?',
    currentYear,
    today,
  ) as [{ left: number }];
  const finishedYear = (y: number) => y < currentYear || Number(left) === 0;

  const results = all(`
    select d.race_id, d.driver_id, r.year, d.position_number, d.position_text, d.driver_number, d.constructor_id
      from race_data d join race r on r.id = d.race_id
     where d.type = 'RACE_RESULT' and coalesce(d.position_text, '') not in ('DNQ', 'DNPQ')
     order by d.race_id, d.position_display_order`);
  const byDriver = new Map<string, Row[]>();
  for (const r of results) byDriver.set(s(r.driver_id)!, [...(byDriver.get(s(r.driver_id)!) ?? []), r]);
  const standings = all('select year, driver_id, position_number, points from season_driver_standing');
  const standingsBy = new Map<string, Row[]>();
  for (const r of standings)
    standingsBy.set(s(r.driver_id)!, [...(standingsBy.get(s(r.driver_id)!) ?? []), r]);

  const truths = new Map<string, F1dbDriverTruth>();
  for (const d of all('select * from driver where total_race_starts > 0')) {
    const id = s(d.id)!;
    // carro compartilhado: uma linha por corrida, a melhor (a primeira na ordem da classificação), como no core
    const seenRace = new Set<string>();
    const rows = (byDriver.get(id) ?? []).filter(
      (r) => !seenRace.has(String(r.race_id)) && !!seenRace.add(String(r.race_id)),
    );
    const startedRows = rows.filter((r) => !NOT_STARTED.has(s(r.position_text) ?? ''));
    const finishes = rows.map((r) => n(r.position_number)).filter((p): p is number => p != null);
    const best = finishes.length ? Math.min(...finishes) : null;
    const mostUsed = (key: string, from: Row[]) => {
      const out = new Map<number, Map<string, number>>();
      for (const r of from) {
        const v = s(r[key]);
        if (v == null) continue;
        const m = out.get(Number(r.year)) ?? new Map<string, number>();
        m.set(v, (m.get(v) ?? 0) + 1);
        out.set(Number(r.year), m);
      }
      return out;
    };
    const numberBySeason = new Map<number, number>();
    for (const [y, m] of mostUsed('driver_number', rows))
      numberBySeason.set(y, Number([...m].sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0]![0]));
    const teamBySeason = new Map<number, string[]>();
    for (const [y, m] of mostUsed('constructor_id', startedRows)) {
      const top = Math.max(...m.values());
      teamBySeason.set(
        y,
        [...m]
          .filter(([, c]) => c === top)
          .map(([t]) => t)
          .sort(),
      );
    }
    const seasons = standingsBy.get(id) ?? [];
    truths.set(id, {
      id,
      name: s(d.name)!,
      firstName: s(d.first_name)!,
      lastName: s(d.last_name)!,
      nationality: country(d.nationality_country_id),
      birthDate: s(d.date_of_birth),
      birthPlace: s(d.place_of_birth),
      birthCountry: country(d.country_of_birth_country_id),
      permanentNumber: n(d.permanent_number),
      starts: Number(d.total_race_starts),
      wins: Number(d.total_race_wins),
      podiums: Number(d.total_podiums),
      poles: Number(d.total_pole_positions),
      // o core guarda os pontos do campeonato arredondados, temporada a temporada (`int` do normalizador: Math.round)
      points: seasons.reduce((acc, r) => acc + Math.round(Number(r.points ?? 0)), 0),
      dnfs: rows.filter((r) => s(r.position_text) === 'DNF').length,
      bestFinish: best == null ? null : { position: best, count: finishes.filter((p) => p === best).length },
      titles: seasons
        .filter((r) => n(r.position_number) === 1 && finishedYear(Number(r.year)))
        .map((r) => Number(r.year))
        .sort((a, b) => a - b),
      numberBySeason,
      teamBySeason,
    });
  }

  // prioridade: grid da temporada atual, campeões e os 20 primeiros em vitórias e em GPs
  const list = [...truths.values()];
  const top = (pick: (t: F1dbDriverTruth) => number) =>
    new Set(
      [...list]
        .sort((a, b) => pick(b) - pick(a))
        .slice(0, 20)
        .map((t) => t.id),
    );
  const topWins = top((t) => t.wins);
  const topStarts = top((t) => t.starts);
  const grid = new Set(results.filter((r) => Number(r.year) === currentYear).map((r) => s(r.driver_id)!));
  const priority = new Map<string, string[]>();
  for (const t of list) {
    const tags = [
      grid.has(t.id) ? `grid ${currentYear}` : null,
      t.titles.length ? 'campeão' : null,
      topWins.has(t.id) ? 'top 20 vitórias' : null,
      topStarts.has(t.id) ? 'top 20 GPs' : null,
    ].filter((x): x is string => !!x);
    priority.set(t.id, tags);
  }
  db.close();
  return { truths, priority, currentYear: Number(currentYear), racesLeft: Number(left) };
}

/** Participantes do core por ID do F1DB e os construtores do F1DB de cada equipe. */
async function loadLinks(db: Database) {
  const rows = await db.execute<{ provider_id: string; entity_id: string }>(sql`
    select provider_id, entity_id::text from core.provider_map
     where provider = 'f1db' and entity_type = 'participant' and sport = 'formula-1'`);
  const drivers = new Map<string, string>();
  const constructorsOf = new Map<string, string[]>();
  for (const r of rows)
    if (r.provider_id.startsWith('driver-')) drivers.set(r.provider_id.slice('driver-'.length), r.entity_id);
    else constructorsOf.set(r.entity_id, [...(constructorsOf.get(r.entity_id) ?? []), r.provider_id]);
  return { drivers, constructorsOf };
}

async function servedCountry(db: Database, id: string) {
  const [row] = await db.execute<{
    name: string;
    code: string | null;
    cname: Record<string, string> | null;
  }>(sql`
    select p.name, c.code, c.name as cname
      from core.participant p left join core.country c on c.code = p.country_code
     where p.id = ${id}::uuid`);
  return {
    name: row?.name ?? '',
    country: row?.code ? { code: row.code, name: pickText(row.cname, LOCALE, row.code)! } : null,
  };
}

const esc = (v: string) => v.replace(/\|/g, '\\|').replace(/\n/g, ' ');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const f1dbPath =
    typeof args.get('f1db') === 'string'
      ? String(args.get('f1db'))
      : join(process.env.F1DB_DIR ?? join(homedir(), '.galaxie', 'f1db'), RELEASE, 'f1db.db');
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const only =
    typeof args.get('pilotos') === 'string' ? new Set(String(args.get('pilotos')).split(',')) : null;

  const f1db = await loadF1dbTruth(f1dbPath, today);
  const db = createDb(url, { max: 4 });
  const liveries = (await loadLiveries()).filter((l) => meetsReview(l.review_status, 'approved'));
  const rules = new RulesRegistry();
  const assetsBaseUrl = process.env.ASSETS_PUBLIC_BASE_URL;
  const displayNames = new Intl.DisplayNames([LOCALE], { type: 'region' });
  const countryName = (code: string) => {
    try {
      const name = displayNames.of(code);
      return name && name !== code ? name : null;
    } catch {
      return null;
    }
  };

  type Result = { id: string; name: string; tags: string[]; issues: AuditIssue[]; missing?: string };
  const results: Result[] = [];
  try {
    const links = await loadLinks(db);
    const targets = [...f1db.truths.values()].filter(
      (t) => (!only || only.has(t.id)) && (!args.has('prioridade') || f1db.priority.get(t.id)!.length),
    );
    const queue = [...targets];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const tags = f1db.priority.get(t.id) ?? [];
        const id = links.drivers.get(t.id);
        if (!id) {
          results.push({ id: t.id, name: t.name, tags, issues: [], missing: 'sem vínculo f1db no core' });
          continue;
        }
        const career = await loadRaceCareer(db, { id, kind: 'driver' }, LOCALE, assetsBaseUrl, { liveries });
        const team = await servedCountry(db, id);
        let competitions: TeamCompetition[] = [];
        if (career.current_season === f1db.currentYear)
          competitions = await loadTeamCompetitions(
            { db, locale: LOCALE, tz: 'America/Sao_Paulo', now, assetsBaseUrl, customLogos: false, rules },
            id,
          );
        const issues = auditDriver(
          t,
          { name: team.name, country: team.country, career, competitions },
          {
            countryName,
            f1dbConstructorsOf: (teamId) => links.constructorsOf.get(teamId) ?? [],
            liveryOf: (c, y) => liveryFor(liveries, c, y),
            racesLeftInCurrentSeason: f1db.racesLeft,
            currentYear: f1db.currentYear,
          },
        );
        results.push({ id: t.id, name: t.name, tags, issues });
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  } finally {
    await closeDb(db);
  }

  // ─── relatório ───
  const prioritized = (r: Result) => r.tags.length > 0;
  results.sort(
    (a, b) =>
      Number(prioritized(b)) - Number(prioritized(a)) ||
      b.issues.length - a.issues.length ||
      a.name.localeCompare(b.name),
  );
  const audited = results.filter((r) => !r.missing);
  const board = AUDIT_FIELDS.map(({ field, label, outOfScope }) => {
    // errado no escopo deste trabalho; o que é de outra frente (fotos, GB/Wales, curadoria) conta à parte
    const count = (rs: Result[], other: boolean) =>
      rs.filter((r) => r.issues.some((i) => i.field === field && !!i.outOfScope === other)).length;
    const wrong = (rs: Result[]) => count(rs, false);
    const pr = audited.filter(prioritized);
    return {
      field,
      label,
      outOfScope: outOfScope ?? null,
      checked: audited.length,
      wrong: wrong(audited),
      checkedPriority: pr.length,
      wrongPriority: wrong(pr),
      otherFront: count(audited, true),
    };
  });
  const totalIssues = audited.reduce((acc, r) => acc + r.issues.length, 0);
  const lines: string[] = [
    `# Auditoria dos perfis de piloto da F1`,
    '',
    `Gerado em ${now.toISOString()}${typeof args.get('ambiente') === 'string' ? ` · ${String(args.get('ambiente'))}` : ''} · F1DB ${RELEASE} · temporada atual ${f1db.currentYear} (faltam ${f1db.racesLeft} GPs) · idioma ${LOCALE}`,
    '',
    `- Pilotos com ao menos um GP no F1DB: ${f1db.truths.size}; auditados: ${audited.length}; prioritários (grid ${f1db.currentYear}, campeões, top 20 em vitórias e em GPs): ${audited.filter(prioritized).length}.`,
    `- Problemas: ${totalIssues} em ${audited.filter((r) => r.issues.length).length} pilotos.`,
    ...(results.some((r) => r.missing)
      ? [
          `- Sem vínculo no core: ${results
            .filter((r) => r.missing)
            .map((r) => r.id)
            .join(', ')}.`,
        ]
      : []),
    '',
    '## Placar por campo',
    '',
    '| Campo | Errados (todos) | Errados (prioritários) | ↗ De outras frentes | Observação |',
    '|---|---:|---:|---:|---|',
    ...board.map(
      (b) =>
        `| ${b.label} | ${b.wrong} de ${b.checked} | ${b.wrongPriority} de ${b.checkedPriority} | ${b.otherFront || ''} | ${b.outOfScope ? `fora do escopo: ${b.outOfScope}` : ''} |`,
    ),
  ];
  const label = new Map(AUDIT_FIELDS.map((f) => [f.field, f.label]));
  const header = [
    '| Piloto | Prioridade | Campo | Valor atual | Valor certo | Fonte |',
    '|---|---|---|---|---|---|',
  ];
  const table = (rs: Result[], pick: (i: AuditIssue) => boolean) =>
    rs.flatMap((r) =>
      r.issues
        .filter(pick)
        .map(
          (i) =>
            `| ${esc(r.name)} (\`${r.id}\`) | ${r.tags.join(', ') || '—'} | ${label.get(i.field)} | ${esc(i.current)} | ${esc(i.expected)} | ${esc(i.source)} |`,
        ),
    );
  // o escopo, linha a linha; as outras frentes (fotos, curadoria) só dos prioritários, a menos que `--completo`
  const others = args.has('completo') ? audited : audited.filter(prioritized);
  lines.push(
    '',
    '## Problemas',
    '',
    ...header,
    ...table(audited, (i) => !i.outOfScope),
    '',
    '## De outras frentes (só listados)',
    '',
    args.has('completo')
      ? 'Todos os pilotos.'
      : `Só os ${others.length} prioritários; o placar acima conta todos (\`--completo\` lista todos).`,
    '',
    ...header,
    ...table(others, (i) => !!i.outOfScope),
  );
  const md = `${lines.join('\n')}\n`;
  const out = args.get('out');
  if (typeof out === 'string') writeFileSync(out, md);
  else process.stdout.write(md);
  const json = args.get('json');
  if (typeof json === 'string')
    writeFileSync(
      json,
      `${JSON.stringify(
        {
          generated_at: now.toISOString(),
          release: RELEASE,
          audited: audited.length,
          priority: audited.filter(prioritized).length,
          issues: totalIssues,
          board,
          drivers: Object.fromEntries(audited.map((r) => [r.id, r.issues])),
        },
        null,
        1,
      )}\n`,
    );
  console.error(`auditados ${audited.length} · problemas ${totalIssues}`);
}

await main();
