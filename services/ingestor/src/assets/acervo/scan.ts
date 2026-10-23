/**
 * Varredura da pasta de um pacote de logos (fora do git). Layout esperado:
 *
 *   <pasta>/acervo.yaml                      id, nome, autor, licença, revisão (e nomes opcionais)
 *   <pasta>/teams/<país>/<slug>.svg|png      escudos de clubes e seleções
 *   <pasta>/competitions/<país|world>/<slug>.svg|png
 *
 * `<país>` é o código (br, gb-eng), o nome (brazil, england, Brasil) ou um grupo declarado em `groups`
 * no acervo.yaml — a pasta de uma competição, com o país e as ligas da api-sports dela (o mapeamento
 * casa entre os times que jogam nelas). Variantes do mesmo logo (palmeiras.svg, palmeiras.png,
 * palmeiras@512.png) viram um item só: serve o SVG, ou o maior PNG; a paleta sai do maior PNG quando
 * houver. SVG com conteúdo ativo é recusado (svg-safety.ts) e o logo cai no PNG. O nome vem de `logos`
 * (ou `names`) no acervo.yaml, ou do slug do arquivo.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { parse } from 'yaml';
import { imageInfo } from '../image-info.js';
import { validateAcervoInfo, type AcervoInfo, type AcervoKind } from './manifest.js';
import { unsafeSvgReason } from './svg-safety.js';

export interface ScannedLogo {
  key: string;
  kind: AcervoKind;
  /** Pasta do país como veio no pacote (br, brazil, world). */
  countryFolder: string;
  name: string;
  file: string;
  paletteFile?: string | undefined;
  sha256: string;
  /** Escudo de seleção (o nome é o do país). */
  national?: boolean | undefined;
}

/** Pasta de competição declarada no acervo.yaml. */
export interface AcervoGroup {
  /** País (código ou nome; "Europa"/"Mundial" = internacional). */
  country?: string | undefined;
  /** Nome da competição no pacote (só para o relatório). */
  competition?: string | undefined;
  /** Ligas da api-sports da pasta: os candidatos são os times que jogam nelas. */
  api_sports_leagues?: number[] | undefined;
}

export interface ScanResult {
  info: AcervoInfo;
  logos: ScannedLogo[];
  groups: Record<string, AcervoGroup>;
  /** Arquivos fora do layout ou que não são SVG/PNG. */
  ignored: string[];
  /** SVG recusados por conteúdo ativo (arquivo → motivo). */
  rejected: Record<string, string>;
}

interface PackageYaml {
  acervo?: Partial<AcervoInfo>;
  groups?: Record<string, AcervoGroup>;
  /** Por chave (teams/br/sao-paulo): nome de exibição e se é seleção. */
  logos?: Record<string, { name?: string; national?: boolean }>;
  /** Formato antigo: só o nome de exibição por chave. */
  names?: Record<string, string>;
}

const KIND_DIRS: Record<string, AcervoKind> = { teams: 'team', competitions: 'competition' };
const VARIANT_RE = /^(.+?)(?:@(\d+)x?)?\.(svg|png)$/i;

/** "sao-paulo" → "Sao Paulo" (o nome bom vem do acervo.yaml; isto é só o recurso). */
export function nameFromSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sha256 = (buf: Uint8Array) => createHash('sha256').update(buf).digest('hex');

export function scanAcervo(dir: string): ScanResult {
  const yamlPath = join(dir, 'acervo.yaml');
  if (!existsSync(yamlPath)) throw new Error(`pacote sem acervo.yaml: ${dir}`);
  const pkg = (parse(readFileSync(yamlPath, 'utf8')) ?? {}) as PackageYaml;
  const info = validateAcervoInfo(pkg.acervo);

  const groups = new Map<
    string,
    { kind: AcervoKind; country: string; svg?: string; pngs: { file: string; width: number }[] }
  >();
  const ignored: string[] = [];
  const rejected: Record<string, string> = {};
  for (const full of walk(dir).sort()) {
    const rel = relative(dir, full).split(sep).join(posix.sep);
    if (rel === 'acervo.yaml') continue;
    const parts = rel.split('/');
    const kind = KIND_DIRS[parts[0] ?? ''];
    const variant = VARIANT_RE.exec(parts[2] ?? '');
    if (!kind || parts.length !== 3 || !variant) {
      ignored.push(rel);
      continue;
    }
    const key = `${parts[0]}/${parts[1]!.toLowerCase()}/${variant[1]!.toLowerCase()}`;
    const group = groups.get(key) ?? { kind, country: parts[1]!.toLowerCase(), pngs: [] };
    if (variant[3]!.toLowerCase() === 'svg') {
      const reason = unsafeSvgReason(readFileSync(full));
      if (reason) rejected[rel] = reason;
      else group.svg = rel;
    } else {
      const head = readFileSync(full).subarray(0, 32);
      group.pngs.push({ file: rel, width: imageInfo(head).width ?? 0 });
    }
    groups.set(key, group);
  }

  const logos: ScannedLogo[] = [];
  for (const [key, g] of groups) {
    const largestPng = g.pngs.sort((a, b) => b.width - a.width)[0]?.file;
    const file = g.svg ?? largestPng;
    if (!file) continue; // só um SVG recusado, sem PNG
    const hint = pkg.logos?.[key];
    logos.push({
      key,
      kind: g.kind,
      countryFolder: g.country,
      name: hint?.name ?? pkg.names?.[key] ?? nameFromSlug(key.split('/').pop()!),
      file,
      ...(largestPng && largestPng !== file ? { paletteFile: largestPng } : {}),
      sha256: sha256(readFileSync(join(dir, file))),
      ...(hint?.national ? { national: true } : {}),
    });
  }
  // grupos com chave em minúsculas, como as pastas
  const declared = Object.fromEntries(
    Object.entries(pkg.groups ?? {}).map(([k, v]) => [k.toLowerCase(), v ?? {}]),
  );
  return { info, logos, groups: declared, ignored, rejected };
}
