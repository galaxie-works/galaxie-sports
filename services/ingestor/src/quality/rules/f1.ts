/**
 * F1: o que a página do piloto mostra (API `/v1/teams/:id/career` e `/v1/teams/:id`) contra o F1DB, para o grid
 * da temporada atual, os campeões e os 20 primeiros em vitórias e em GPs (a prioridade da auditoria dos perfis).
 * Toda temporada da carreira conta: o herói da página é uma delas.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';
import type { RaceCareer, Team } from '@galaxie/contracts';
import type { F1dbDriverTruth, F1dbTruth } from '../sources/f1db.js';
import { AMBIGUOUS_COUNTRIES } from './geo.js';
import type { QualityContext, QualityFailureItem, QualityRule } from '../types.js';

const LOCALE = 'pt-BR';
const ORIGIN_OWNER = 'erro achado pelo dono do produto na demo (24/10/2026)';

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Palavras que não identificam a época ("F1 Team", "Formula One"). */
const GENERIC = new Set(['f1', 'team', 'formula', 'one', '1', 'the', 'and', 'de', 'of']);
const words = (s: string) =>
  norm(s)
    .split(' ')
    .filter((w) => w && !GENERIC.has(w));

/**
 * Nome da equipe compatível com a época: toda palavra do nome servido aparece no nome do construtor ou numa
 * inscrição daquele ano no F1DB. "Mercedes-AMG Petronas" em 2024 (inscrição "Mercedes-AMG Petronas F1 Team")
 * passa; em 1955 (inscrição "Daimler Benz AG") não.
 */
export function eraNameOk(served: string, accepted: readonly string[]): boolean {
  const ok = new Set(accepted.flatMap(words));
  const got = words(served);
  return got.length > 0 && got.every((w) => ok.has(w));
}

export interface ServedDriver {
  participantId: string;
  name: string;
  truth: F1dbDriverTruth;
  career: RaceCareer;
  team: Team;
}

/** Construtores do F1DB de cada equipe do core e participante do core de cada piloto do F1DB. */
async function f1dbLinks(db: Database) {
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

/** Vínculos do F1DB no core (lidos uma vez por execução, para todas as regras da F1). */
const links = (ctx: QualityContext) => ctx.memo('f1:links', () => f1dbLinks(ctx.db));

/** Pilotos prioritários do F1DB: grid da temporada atual, campeões e os 20 primeiros em vitórias e em GPs. */
const priorityDrivers = (truth: F1dbTruth) => [...truth.drivers.values()].filter((t) => t.tags.length);

/** Os pilotos prioritários como a API os serve (carregado uma vez por execução, para as quatro regras). */
export async function loadServedDrivers(ctx: QualityContext) {
  const truth = await ctx.f1db();
  const { drivers: linked, constructorsOf } = await links(ctx);
  const api = ctx.api!;
  const targets = priorityDrivers(truth);
  const served: ServedDriver[] = [];
  const missing: F1dbDriverTruth[] = [];
  const queue = [...targets];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const id = linked.get(t.id);
      if (!id) {
        missing.push(t);
        continue;
      }
      const [career, team] = await Promise.all([
        api.teamCareer(id, { locale: LOCALE }),
        api.team(id, { locale: LOCALE }),
      ]);
      served.push({ participantId: id, name: team.name, truth: t, career, team });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  served.sort((a, b) => a.name.localeCompare(b.name));
  ctx.log(`F1: ${served.length} pilotos prioritários lidos da API (${missing.length} sem vínculo f1db)`);
  return { truth, served, missing, constructorsOf };
}

/**
 * Piloto prioritário sem participante no core (vínculo `f1db` `driver-<id>`): as outras regras da F1 não o conferem,
 * então a falta de vínculo é falha (senão a auditoria fica verde sem cobrir o piloto).
 */
export function checkDriverLinks(
  truth: F1dbTruth,
  linked: ReadonlyMap<string, string>,
): { checked: number; failures: QualityFailureItem[] } {
  const targets = priorityDrivers(truth);
  const failures = targets
    .filter((t) => !linked.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      key: t.id,
      label: `${t.name} · ${t.tags.join(', ')}`,
      current: 'sem participante no core',
      expected: `vínculo f1db driver-${t.id}`,
    }));
  return { checked: targets.length, failures };
}

const driverLink = (d: ServedDriver) => ({
  type: 'participant',
  id: d.participantId,
  kind: 'driver',
  name: d.name,
});

/** Equipe de cada temporada: o construtor certo e o nome daquela época. */
export function checkSeasonTeams(
  drivers: readonly ServedDriver[],
  constructorsOf: ReadonlyMap<string, string[]>,
): { checked: number; failures: QualityFailureItem[] } {
  let checked = 0;
  const failures: QualityFailureItem[] = [];
  for (const d of drivers)
    for (const s of d.career.seasons) {
      const want = d.truth.seasons.get(s.year);
      if (!want) continue;
      checked += 1;
      const team = s.teams[0];
      const key = `${d.participantId}:${s.year}`;
      const label = `${d.name} · ${s.year}`;
      const got = team ? (constructorsOf.get(team.id) ?? []) : [];
      if (!team || !want.constructorIds.some((c) => got.includes(c)))
        failures.push({
          key,
          label,
          current: team ? `${team.name}${got.length ? ` (${got.join(', ')})` : ''}` : '—',
          expected: want.constructorIds.join(' ou '),
          link: driverLink(d),
        });
      else if (!eraNameOk(team.name, want.names))
        failures.push({
          key,
          label,
          current: team.name,
          expected: [...new Set(want.names)].join(' · '),
          link: driverLink(d),
        });
    }
  return { checked, failures };
}

/** Número de cada temporada: um dos mais usados nas corridas daquele ano. */
export function checkSeasonNumbers(drivers: readonly ServedDriver[]): {
  checked: number;
  failures: QualityFailureItem[];
} {
  let checked = 0;
  const failures: QualityFailureItem[] = [];
  for (const d of drivers)
    for (const s of d.career.seasons) {
      const want = d.truth.seasons.get(s.year)?.numbers ?? [];
      if (!want.length) continue;
      checked += 1;
      if (s.number == null || !want.includes(s.number))
        failures.push({
          key: `${d.participantId}:${s.year}`,
          label: `${d.name} · ${s.year}`,
          current: String(s.number ?? '—'),
          expected: want.join(' ou '),
          link: driverLink(d),
        });
    }
  return { checked, failures };
}

/** Títulos (quantidade e anos), vitórias e GPs largados. */
export function checkCareerTotals(drivers: readonly ServedDriver[]): {
  checked: number;
  failures: QualityFailureItem[];
} {
  const failures: QualityFailureItem[] = [];
  for (const d of drivers) {
    const t = d.career.totals;
    const fields: [string, string, string][] = [
      [
        'títulos',
        `${t.titles}: ${d.career.titles.join(', ') || '—'}`,
        `${d.truth.titles.length}: ${d.truth.titles.join(', ') || '—'}`,
      ],
      ['vitórias', String(t.wins), String(d.truth.wins)],
      ['GPs', String(t.races), String(d.truth.starts)],
    ];
    for (const [field, current, expected] of fields)
      if (current !== expected)
        failures.push({
          key: `${d.participantId}:${field}`,
          label: `${d.name} · ${field}`,
          current,
          expected,
          link: driverLink(d),
        });
  }
  return { checked: drivers.length, failures };
}

/** Nome do país no idioma da página (a mesma tabela do navegador). */
export function countryLabel(code: string, locale = LOCALE): string | null {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'region' }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/**
 * País do piloto: o código da nacionalidade do F1DB e, nos códigos ambíguos (GB, UA), o nome do país inteiro (GB é o
 * Reino Unido, nunca Gales). Nos demais, o nome é o da nossa tabela ("Holanda" e "Países Baixos" valem).
 */
export function checkDriverCountry(drivers: readonly ServedDriver[]): {
  checked: number;
  failures: QualityFailureItem[];
} {
  const failures: QualityFailureItem[] = [];
  let checked = 0;
  for (const d of drivers) {
    const want = d.truth.nationality;
    if (!want) continue;
    checked += 1;
    const got = d.team.country_ref;
    const canonical = AMBIGUOUS_COUNTRIES[want]?.[LOCALE];
    const label = canonical ?? countryLabel(want) ?? want;
    if (!got || got.code !== want || (canonical !== undefined && norm(got.name) !== norm(canonical)))
      failures.push({
        key: d.participantId,
        label: d.name,
        current: got ? `${got.code} ${got.name}` : '—',
        expected: `${want} ${label}`,
        link: driverLink(d),
      });
  }
  return { checked, failures };
}

const served = (ctx: QualityContext) => ctx.memo('f1:served', () => loadServedDrivers(ctx));

export const F1_RULES: QualityRule[] = [
  {
    id: 'f1.driver-link',
    sport: 'formula-1',
    area: 'f1',
    severity: 'high',
    description: {
      'pt-BR':
        'Todo piloto prioritário do F1DB (grid atual, campeões, 20 primeiros em vitórias e em GPs) tem participante no core com vínculo f1db',
      en: 'Every priority F1DB driver (current grid, champions, top 20 in wins and starts) has a core participant linked to F1DB',
      es: 'Todo piloto prioritario de F1DB (parrilla actual, campeones, 20 primeros en victorias y en GP) tiene participante en el core vinculado a F1DB',
    },
    needs: ['f1db'],
    check: async (ctx) => checkDriverLinks(await ctx.f1db(), (await links(ctx)).drivers),
  },
  {
    id: 'f1.season-team',
    sport: 'formula-1',
    area: 'f1',
    severity: 'critical',
    description: {
      'pt-BR': 'A equipe de cada temporada do piloto é o construtor daquele ano no F1DB, com o nome da época',
      en: "Each season's team is that year's constructor in F1DB, with the era's name",
      es: 'El equipo de cada temporada es el constructor de ese año en F1DB, con el nombre de la época',
    },
    origin: `${ORIGIN_OWNER}: Fangio em 1958 como "Mercedes-AMG Petronas"`,
    needs: ['api', 'f1db'],
    check: async (ctx) => {
      const { served: drivers, constructorsOf } = await served(ctx);
      return checkSeasonTeams(drivers, constructorsOf);
    },
  },
  {
    id: 'f1.season-number',
    sport: 'formula-1',
    area: 'f1',
    severity: 'high',
    description: {
      'pt-BR': 'O número de cada temporada é o mais usado pelo piloto nas corridas daquele ano',
      en: "Each season's car number is the one the driver used most in that year's races",
      es: 'El número de cada temporada es el que el piloto más usó en las carreras de ese año',
    },
    origin: `${ORIGIN_OWNER}: número do herói fora da temporada selecionada`,
    needs: ['api', 'f1db'],
    check: async (ctx) => checkSeasonNumbers((await served(ctx)).served),
  },
  {
    id: 'f1.career-totals',
    sport: 'formula-1',
    area: 'f1',
    severity: 'critical',
    description: {
      'pt-BR': 'Títulos (quantidade e anos), vitórias e GPs largados batem com o F1DB',
      en: 'Titles (count and years), wins and race starts match F1DB',
      es: 'Títulos (cantidad y años), victorias y GP largados coinciden con F1DB',
    },
    needs: ['api', 'f1db'],
    check: async (ctx) => checkCareerTotals((await served(ctx)).served),
  },
  {
    id: 'f1.driver-country',
    sport: 'formula-1',
    area: 'geo',
    severity: 'critical',
    description: {
      'pt-BR':
        'O país do piloto é o da nacionalidade no F1DB; GB é o Reino Unido, nunca Gales, Escócia ou Inglaterra',
      en: "The driver's country is the F1DB nationality; GB is the United Kingdom, never Wales, Scotland or England",
      es: 'El país del piloto es el de la nacionalidad en F1DB; GB es el Reino Unido, nunca Gales, Escocia o Inglaterra',
    },
    origin: `${ORIGIN_OWNER}: Hamilton com "GB Wales"`,
    needs: ['api', 'f1db'],
    check: async (ctx) => checkDriverCountry((await served(ctx)).served),
  },
];
