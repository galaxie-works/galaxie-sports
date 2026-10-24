/**
 * Manifesto versionado do acervo de fotos da F1 (config/assets/commons/f1.yaml), no mesmo esquema do acervo de
 * logos: para cada alvo (piloto ou carro numa temporada), o item do Wikidata, a categoria da Commons e as fotos
 * escolhidas com licença, autor, página de origem, data e dimensões. Os binários nunca entram no git.
 *
 * Curadoria (sobrevive a novas varreduras): `match: manual` numa foto a mantém mesmo que as regras ou a IA
 * deixem de escolhê-la; `match: rejected` a tira para sempre (a varredura não a escolhe de novo). No piloto,
 * `highlight_car` aponta o carro de destaque (heading da página); com `match: manual`, a escolha do curador fica.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import type { CommonsLicense } from './license.js';
import type { ChosenPhoto, PhotoRole } from './select.js';
import type { Discovery } from './discover.js';
import { targetKey, type CommonsTarget } from './scope.js';

export const COMMONS_MANIFEST_VERSION = 1;
export const COMMONS_ACERVO_ID = 'commons-f1';

export type PhotoMatch = 'auto' | 'manual' | 'rejected';

export interface ManifestPhoto {
  /** Título do arquivo na Commons ("File:…"). */
  file: string;
  role: PhotoRole;
  season: number | null;
  rank: number;
  match: PhotoMatch;
  selected_by: 'rules' | 'gemini' | 'manual';
  page_url: string;
  license: string;
  license_url: string | null;
  author: string | null;
  author_url: string | null;
  credit: string | null;
  attribution_required: boolean;
  share_alike: boolean;
  date: string | null;
  width: number;
  height: number;
  reason?: string | null;
}

export interface ManifestEntry {
  /** Alvo: `driver/<id do F1DB>` ou `car/<construtor>/<ano>`. */
  target: string;
  kind: 'driver' | 'car';
  /** Piloto ou construtor no F1DB. */
  f1db_id: string;
  name: string;
  season?: number;
  wikidata: string | null;
  category: string | null;
  note?: string | null;
  /**
   * Piloto: carro de destaque (`car/<construtor>/<ano>`, outro alvo do manifesto). `auto` vem da regra
   * (`highlightSeason`); `manual` é curadoria e não muda nas próximas varreduras.
   */
  highlight_car?: HighlightCar | null;
  /** Ordem do Gemini (passo da VPS): modelo, data e quantas candidatas foram avaliadas. Sem isso, só regras. */
  ranking?: { by: 'gemini'; model: string; at: string; pool: number } | null;
  photos: ManifestPhoto[];
}

export interface HighlightCar {
  target: string;
  season: number;
  reason: string;
  match: 'auto' | 'manual';
}

export interface CommonsManifest {
  schema_version: number;
  acervo: { id: string; name: string; source: string; revision: string };
  generated_at: string;
  entries: ManifestEntry[];
}

export function emptyManifest(revision: string): CommonsManifest {
  return {
    schema_version: COMMONS_MANIFEST_VERSION,
    acervo: {
      id: COMMONS_ACERVO_ID,
      name: 'Fotos da Fórmula 1 — Wikimedia Commons (licenças livres)',
      source: 'https://commons.wikimedia.org',
      revision,
    },
    generated_at: new Date().toISOString(),
    entries: [],
  };
}

export function readManifest(path: string): CommonsManifest | null {
  if (!existsSync(path)) return null;
  const data = parse(readFileSync(path, 'utf8')) as CommonsManifest;
  if (data?.schema_version !== COMMONS_MANIFEST_VERSION) throw new Error(`${path}: schema_version inválida`);
  return { ...data, entries: data.entries ?? [] };
}

export function writeManifest(path: string, manifest: CommonsManifest): void {
  const header =
    '# Acervo de fotos da F1 (Wikimedia Commons, licenças livres) — gerado por `assets:commons --mapear`.\n' +
    '# Curadoria: `match: manual` mantém a foto; `match: rejected` tira para sempre. Ver docs/runbooks/fotos-commons.md.\n';
  writeFileSync(path, header + stringify(manifest, { lineWidth: 0 }));
}

const photoOf = (c: ChosenPhoto, license: CommonsLicense): ManifestPhoto => {
  const f = c.eligible.candidate.file;
  return {
    file: f.title,
    role: c.role,
    season: c.eligible.year,
    rank: c.rank,
    match: 'auto',
    selected_by: c.selectedBy,
    page_url: f.pageUrl,
    license: license.license,
    license_url: license.licenseUrl,
    author: license.author,
    author_url: license.authorUrl,
    credit: license.credit,
    attribution_required: license.attributionRequired,
    share_alike: license.shareAlike,
    date: license.dateTaken,
    width: f.width,
    height: f.height,
    ...(c.reason ? { reason: c.reason } : {}),
  };
};

/**
 * Nova entrada do alvo, mantendo a curadoria da anterior: fotos `manual` ficam (na frente), `rejected` ficam
 * registradas e não voltam, e as escolhas automáticas são as da varredura nova.
 */
export function mergeEntry(
  target: CommonsTarget,
  discovery: Discovery,
  chosen: ChosenPhoto[],
  previous: ManifestEntry | undefined,
): ManifestEntry {
  const curated = (previous?.photos ?? []).filter((p) => p.match !== 'auto');
  const highlight: HighlightCar | null =
    previous?.highlight_car?.match === 'manual'
      ? previous.highlight_car
      : target.kind === 'driver' && target.highlight
        ? {
            target: target.highlight.target,
            season: target.highlight.year,
            reason: target.highlight.reason,
            match: 'auto',
          }
        : null;
  const rejected = new Set(curated.filter((p) => p.match === 'rejected').map((p) => p.file));
  const manual = curated.filter((p) => p.match === 'manual');
  const auto = chosen
    .filter((c) => !rejected.has(c.eligible.candidate.file.title))
    .filter((c) => !manual.some((m) => m.file === c.eligible.candidate.file.title && m.role === c.role))
    .map((c) => photoOf(c, c.eligible.license));
  return {
    target: targetKey(target),
    kind: target.kind,
    f1db_id: target.f1dbId,
    name: target.kind === 'driver' ? target.name : `${target.constructorName} ${target.year}`,
    ...(target.kind === 'car' ? { season: target.year } : {}),
    wikidata: discovery.wikidata,
    category: discovery.category,
    ...(discovery.note ? { note: discovery.note } : {}),
    ...(highlight ? { highlight_car: highlight } : {}),
    photos: [...manual, ...auto, ...curated.filter((p) => p.match === 'rejected')],
  };
}
