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

/** Pasta do pacote → código do país: "br", "gb-eng", "world" ou o nome ("brazil", "england"). */
export function resolveCountry(folder: string, countries: CountryRow[]): string | null {
  const upper = folder.toUpperCase();
  if (upper === 'WORLD' || upper === 'INTERNATIONAL' || upper === 'TOURNAMENTS') return 'WORLD';
  if (countries.some((c) => c.code === upper)) return upper;
  const wanted = normalizeName(folder);
  const hits = countries.filter((c) => c.names.some((n) => normalizeName(n) === wanted));
  return hits.length === 1 ? hits[0]!.code : null;
}

export interface PlanResult {
  manifest: AcervoManifest;
  /** Pastas de país que não se resolveram (os logos delas ficam `unmatched`). */
  unknownCountries: string[];
}

export function planManifest(
  scan: ScanResult,
  targets: MatchTarget[],
  countries: CountryRow[],
  previous: AcervoManifest | undefined,
  now: Date,
  options: MatchOptions = {},
): PlanResult {
  const prev = new Map((previous?.logos ?? []).map((l) => [l.key, l]));
  const targetName = new Map(targets.map((t) => [`${t.kind}:${t.id}`, t.name]));
  const unknown = new Set<string>();
  const logos: AcervoLogo[] = scan.logos.map((s) => {
    const country = resolveCountry(s.countryFolder, countries);
    if (!country) unknown.add(s.countryFolder);
    const base = {
      key: s.key,
      kind: s.kind,
      country: country ?? s.countryFolder.toUpperCase(),
      name: s.name,
      file: s.file,
      ...(s.paletteFile ? { palette_file: s.paletteFile } : {}),
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
    const r = matchLogo({ key: s.key, kind: s.kind, country, name: s.name }, targets, options);
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
    for (const l of autos) {
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
