import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { pairKey } from '../jobs/fixtures.js';
import type { RawSource } from '../jobs/runtime/raw-source.js';
import { teamIndexFromRaw, teamMatchKey } from '../jobs/teams.js';

/** Time da base semântica (data/knowledge/football/teams/*.yaml e national-teams.yaml). */
export interface KnowledgeTeam {
  slug: string;
  teamId: number | null;
  match: { name: string; country: string } | null;
}

/** Clássico da base semântica (data/knowledge/football/derbies/*.yaml). */
export interface DerbyDef {
  slug: string;
  name: string;
  teams: [string, string];
  intensity: number;
}

export interface Knowledge {
  teams: Map<string, KnowledgeTeam>;
  derbies: DerbyDef[];
}

/** Clássico com os dois IDs da api-sports resolvidos. */
export interface DerbyPair {
  slug: string;
  name: string;
  teamIds: [number, number];
  /** "menor-maior" — mesma chave usada no h2h. */
  key: string;
}

interface TeamYaml {
  teams?: {
    slug: string;
    api_sports?: { team_id?: number | null; match?: { name?: string; country?: string } | null };
  }[];
}

interface DerbyYaml {
  derbies?: { slug: string; name: string; teams?: string[]; intensity?: number }[];
}

async function yamlFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.yaml')).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** Lê times, seleções e clássicos da base semântica versionada (`data/knowledge`). */
export async function loadKnowledge(knowledgeDir: string): Promise<Knowledge> {
  const football = join(knowledgeDir, 'football');
  const teams = new Map<string, KnowledgeTeam>();
  const teamFiles = [...(await yamlFiles(join(football, 'teams'))), join(football, 'national-teams.yaml')];
  for (const file of teamFiles) {
    let doc: TeamYaml;
    try {
      doc = parse(await readFile(file, 'utf8')) as TeamYaml;
    } catch {
      continue;
    }
    for (const t of doc.teams ?? []) {
      const m = t.api_sports?.match;
      teams.set(t.slug, {
        slug: t.slug,
        teamId: t.api_sports?.team_id ?? null,
        match: m?.name && m.country ? { name: m.name, country: m.country } : null,
      });
    }
  }

  const derbies: DerbyDef[] = [];
  for (const file of await yamlFiles(join(football, 'derbies'))) {
    const doc = parse(await readFile(file, 'utf8')) as DerbyYaml;
    for (const d of doc.derbies ?? []) {
      if (d.teams?.length !== 2) continue;
      derbies.push({
        slug: d.slug,
        name: d.name,
        teams: [d.teams[0]!, d.teams[1]!],
        intensity: d.intensity ?? 3,
      });
    }
  }
  derbies.sort((a, b) => b.intensity - a.intensity || a.slug.localeCompare(b.slug));
  return { teams, derbies };
}

export interface DerbyResolution {
  pairs: DerbyPair[];
  unresolved: { slug: string; missing: string[] }[];
}

/**
 * Resolve os IDs dos dois times de cada clássico: primeiro o `team_id` verificado da base;
 * se nulo, o nome+país (`match`) contra as listas de times já gravadas no raw — só quando há um único ID.
 */
export function resolveDerbies(k: Knowledge, index: Map<string, Set<number>>): DerbyResolution {
  const idOf = (slug: string): number | undefined => {
    const t = k.teams.get(slug);
    if (!t) return undefined;
    if (t.teamId != null) return t.teamId;
    if (!t.match) return undefined;
    const ids = index.get(teamMatchKey(t.match.name, t.match.country));
    return ids?.size === 1 ? [...ids][0] : undefined;
  };
  const pairs: DerbyPair[] = [];
  const unresolved: DerbyResolution['unresolved'] = [];
  const seen = new Set<string>();
  for (const d of k.derbies) {
    const a = idOf(d.teams[0]);
    const b = idOf(d.teams[1]);
    if (a === undefined || b === undefined) {
      unresolved.push({ slug: d.slug, missing: d.teams.filter((_, i) => (i === 0 ? a : b) === undefined) });
      continue;
    }
    const key = pairKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ slug: d.slug, name: d.name, teamIds: [a, b], key });
  }
  return { pairs, unresolved };
}

/** Clássicos com IDs resolvidos (base semântica + listas de times do raw) — zero cota. */
export async function resolveDerbiesFromRaw(knowledgeDir: string, raw: RawSource): Promise<DerbyResolution> {
  return resolveDerbies(await loadKnowledge(knowledgeDir), await teamIndexFromRaw(raw));
}
