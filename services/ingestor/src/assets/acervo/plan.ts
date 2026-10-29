/**
 * Varredura → manifesto: resolve o país de cada pasta, casa cada logo com os alvos do banco e mescla com
 * o manifesto anterior, preservando a curadoria (`manual`, `rejected`). Função pura sobre os dados já
 * carregados (os testes não precisam de banco).
 */
import { normalizeName } from '@galaxie/knowledge';
import { ACERVO_SCHEMA_VERSION, type AcervoLogo, type AcervoManifest } from './manifest.js';
import { matchLogo, type MatchOptions, type MatchTarget } from './match.js';
import type { ScanResult } from './scan.js';

export interface CountryRow {
  code: string;
  /** Nomes em qualquer idioma (core.country.name). */
  names: string[];
}

const INTERNATIONAL = new Set(['world', 'international', 'tournaments', 'europa', 'mundial', 'mundo']);

/** Nomes de país em português que o cadastro (core.country) escreve de outro jeito. */
const COUNTRY_ALIASES: Record<string, string> = {
  'paises baixos': 'NL',
  'republica tcheca': 'CZ',
  tchequia: 'CZ',
  'bosnia e herzegovina': 'BA',
  'macedonia do norte': 'MK',
  'irlanda do norte': 'GB-NIR',
  escocia: 'GB-SCT',
  'pais de gales': 'GB-WLS',
  inglaterra: 'GB-ENG',
  'emirados arabes unidos': 'AE',
  'rd congo': 'CD',
  'republica democratica do congo': 'CD',
  curacao: 'CW',
  'cabo verde': 'CV',
};

/** Pasta do pacote (ou nome de seleção) → código do país: "br", "gb-eng", "world" ou o nome ("brazil", "Brasil"). */
export function resolveCountry(folder: string, countries: CountryRow[]): string | null {
  const upper = folder.toUpperCase();
  const wanted = normalizeName(folder);
  if (INTERNATIONAL.has(wanted)) return 'WORLD';
  if (countries.some((c) => c.code === upper)) return upper;
  // empate (o cadastro tem o mesmo nome em dois países): vale o que casa em mais idiomas
  const hits = countries
    .map((c) => ({ code: c.code, n: c.names.filter((n) => normalizeName(n) === wanted).length }))
    .filter((h) => h.n > 0)
    .sort((x, y) => y.n - x.n);
  if (hits.length && (hits.length === 1 || hits[0]!.n > hits[1]!.n)) return hits[0]!.code;
  const alias = COUNTRY_ALIASES[wanted];
  return alias && countries.some((c) => c.code === alias) ? alias : null;
}

export interface PlanResult {
  manifest: AcervoManifest;
  /** Pastas de país que não se resolveram (os logos delas ficam `unmatched`). */
  unknownCountries: string[];
}

export interface PlanOptions extends MatchOptions {
  /** Liga da api-sports → id da competição (core.provider_map), para os grupos do pacote. */
  leagueCompetitions?: ReadonlyMap<number, string>;
}

export function planManifest(
  scan: ScanResult,
  targets: MatchTarget[],
  countries: CountryRow[],
  previous: AcervoManifest | undefined,
  now: Date,
  options: PlanOptions = {},
): PlanResult {
  const prev = new Map((previous?.logos ?? []).map((l) => [l.key, l]));
  const targetName = new Map(targets.map((t) => [`${t.kind}:${t.id}`, t.name]));
  const unknown = new Set<string>();
  const logos: AcervoLogo[] = scan.logos.map((s) => {
    const group = scan.groups[s.countryFolder];
    const folderCountry = group?.country ?? s.countryFolder;
    const country = resolveCountry(folderCountry, countries);
    if (!country) unknown.add(folderCountry);
    const competitionIds = (group?.api_sports_leagues ?? [])
      .map((id) => options.leagueCompetitions?.get(id))
      .filter((id): id is string => !!id);
    const base = {
      key: s.key,
      kind: s.kind,
      country: country ?? folderCountry.toUpperCase(),
      ...(group
        ? { group: group.competition ? `${folderCountry} - ${group.competition}` : s.countryFolder }
        : {}),
      name: s.name,
      ...(s.national ? { national: true } : {}),
      file: s.file,
      ...(s.paletteFile ? { palette_file: s.paletteFile } : {}),
      ...(s.formats && Object.keys(s.formats).length ? { formats: s.formats } : {}),
      sha256: s.sha256,
    };
    const old = prev.get(s.key);
    // curadoria manda: o id escolhido à mão (ou a recusa) atravessa novas varreduras
    if (old && (old.match === 'manual' || old.match === 'rejected'))
      return {
        ...base,
        target_id: old.match === 'manual' ? old.target_id : null,
        ...(old.match === 'manual' && old.target_id
          ? { target_name: targetName.get(`${s.kind}:${old.target_id}`) ?? old.target_name }
          : {}),
        match: old.match,
      };
    if (!country) return { ...base, target_id: null, match: 'unmatched' };
    const r = matchLogo(
      {
        key: s.key,
        kind: s.kind,
        country,
        name: s.name,
        ...(s.national ? { national: true, nationalCountry: resolveCountry(s.name, countries) } : {}),
        ...(competitionIds.length ? { competitionIds } : {}),
      },
      targets,
      options,
    );
    return {
      ...base,
      target_id: r.targetId,
      ...(r.targetName ? { target_name: r.targetName } : {}),
      match: r.status,
      ...(r.confidence !== null ? { confidence: r.confidence } : {}),
      ...(r.candidates.length ? { candidates: r.candidates } : {}),
    };
  });

  // um alvo só pode ter um logo: dois automáticos no mesmo time viram ambíguos (a curadoria escolhe)
  const owners = new Map<string, AcervoLogo[]>();
  for (const l of logos)
    if (l.target_id)
      owners.set(`${l.kind}:${l.target_id}`, [...(owners.get(`${l.kind}:${l.target_id}`) ?? []), l]);
  for (const list of owners.values()) {
    if (list.length < 2) continue;
    // com um manual no alvo, os automáticos saem; sem manual, só dois ou mais automáticos disputam
    const manual = list.some((l) => l.match === 'manual');
    const autos = list.filter((l) => l.match === 'auto');
    if (!manual && autos.length < 2) continue;
    // o mesmo time na pasta da liga nacional e na de um torneio internacional: vale o da liga nacional
    const domestic = autos.filter((l) => l.country !== 'WORLD');
    if (!manual && domestic.length === 1) {
      for (const l of autos.filter((x) => x !== domestic[0])) {
        l.match = 'duplicate';
        l.candidates = [
          { id: l.target_id!, name: l.target_name ?? l.target_id!, confidence: l.confidence ?? 0 },
        ];
        l.target_id = null;
        delete l.target_name;
      }
      continue;
    }
    // um vence com folga ("Independiente" 1,0 × "Independiente Rivadavia" 0,85): fica ele, o outro vai à curadoria
    const byConfidence = [...autos].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const winner =
      !manual && (byConfidence[0]!.confidence ?? 0) - (byConfidence[1]!.confidence ?? 0) >= 0.1 - 1e-9
        ? byConfidence[0]
        : undefined;
    for (const l of autos) {
      if (l === winner) continue;
      l.candidates = [
        { id: l.target_id!, name: l.target_name ?? l.target_id!, confidence: l.confidence ?? 0 },
      ];
      l.match = 'ambiguous';
      l.target_id = null;
      delete l.target_name;
    }
  }

  return {
    manifest: {
      schema_version: ACERVO_SCHEMA_VERSION,
      acervo: scan.info,
      generated_at: now.toISOString(),
      logos,
    },
    unknownCountries: [...unknown].sort(),
  };
}
