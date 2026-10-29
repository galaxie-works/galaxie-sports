/**
 * Conversor de uma base de escudos organizada por competição para o layout de pacote do acervo
 * (docs/runbooks/acervo-de-logos.md). Entrada:
 *
 *   <origem>/<País> - <Competição>/svg/Escudo - <Time>.svg
 *   <origem>/<País> - <Competição>/png/x512 - Escudo - <Time>.png   (vários tamanhos: x128, x256...)
 *   <origem>/<País> - <Competição>/webp/x512 - Escudo - <Time>.webp  (idem; vale o maior)
 *
 * Seleções vêm como "Escudo - Seleção - <País>"; "Bandeira - <País>" não é escudo e fica de fora.
 * Saída (fora do git):
 *
 *   <saída>/acervo.yaml                          acervo, grupos (pasta → país e ligas da api-sports) e nomes
 *   <saída>/teams/<pasta>/<slug>.svg             o SVG (ou o maior PNG, quando não há SVG)
 *   <saída>/teams/<pasta>/<slug>.png             o maior PNG, fonte da paleta
 *   <saída>/teams/<pasta>/<slug>.webp            o maior WebP
 *
 * Os três formatos são publicados pela API (`logo_formats`). A origem é entrada não confiável: só lê SVG,
 * PNG e WebP, confere a assinatura do PNG e do WebP e o tamanho, recusa SVG
 * com conteúdo ativo (cai no PNG) e grava só com nomes saneados ([a-z0-9-]) — nunca com o nome do arquivo
 * original. O mesmo escudo (mesmo arquivo) em mais de uma pasta entra uma vez só, de preferência na pasta
 * da liga nacional.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { normalizeName } from '@galaxie/knowledge';
import { stringify } from 'yaml';
import type { AcervoInfo } from './manifest.js';
import type { AcervoGroup } from './scan.js';
import { unsafeSvgReason } from './svg-safety.js';

/** Teto por arquivo: escudo não passa disso; acima é lixo ou ataque. */
const MAX_BYTES = 5 * 1024 * 1024;
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SVG_RE = /^(Escudo|Bandeira) - (.+)\.svg$/i;
const PNG_RE = /^x(\d+) - (Escudo|Bandeira) - (.+)\.png$/i;
const WEBP_RE = /^(?:x(\d+) - )?(Escudo|Bandeira) - (.+)\.webp$/i;
const NATIONAL_RE = /^Sele[çc][ãa]o\s*-\s*/i;
const INTERNATIONAL = new Set(['europa', 'mundial', 'mundo', 'world']);

/**
 * Ligas da api-sports de cada pasta (pelo nome normalizado "<país> <competição>"): o mapeamento casa
 * entre os times que jogam nelas. Pasta fora da tabela casa só pelo país.
 */
export const FOLDER_LEAGUES: Readonly<Record<string, readonly number[]>> = {
  'alemanha bundesliga': [78],
  'argentina primeira divisao': [128],
  'arabia saudita liga profissional': [307],
  'brasil campeonato brasileiro serie a': [71],
  'brasil campeonato brasileiro serie b': [72],
  'belgica pro league': [144],
  'escocia premiership': [179],
  'espanha la liga': [140],
  'espanha la liga 2': [141],
  'estados unidos mls': [253],
  'europa liga conferencia da uefa': [848],
  'europa liga europa da uefa': [3],
  'europa liga das nacoes da uefa': [5],
  'europa liga dos campeoes da uefa': [2],
  'franca ligue 1': [61],
  'franca ligue 2': [62],
  'inglaterra efl championship': [40],
  'inglaterra premier league': [39],
  'italia serie a': [135],
  'italia serie b': [136],
  'mundial copa do mundo': [1],
  'paises baixos eredivisie': [88],
  'portugal primeira liga': [94],
  'romenia liga 1': [283],
  'russia premier league': [235],
  'turquia 2 lig': [204, 205],
  'turquia super lig': [203],
  'austria 2 liga': [219],
};

/** "Atlético de Madrid" → "atletico-de-madrid". */
export function slugify(value: string): string {
  return normalizeName(value).replace(/\s+/g, '-').slice(0, 80) || 'sem-nome';
}

export interface ConvertOptions {
  source: string;
  out: string;
  info: AcervoInfo;
}

export interface ConvertReport {
  folders: number;
  /** Escudos gravados (um por time e pasta, sem as cópias idênticas). */
  logos: number;
  svg: number;
  /** Escudos com WebP. */
  webp: number;
  /** Escudos só com PNG (sem SVG, ou com o SVG recusado). */
  pngOnly: number;
  national: number;
  /** "Bandeira - ..." (não é escudo). */
  flags: string[];
  /** SVG recusados (conteúdo ativo, tamanho, não é SVG). */
  rejected: { file: string; reason: string }[];
  /** O mesmo arquivo já entrou por outra pasta. */
  duplicates: { file: string; keptIn: string }[];
  /** Pastas fora do formato "<País> - <Competição>" e arquivos fora do padrão. */
  ignored: string[];
}

interface Candidate {
  name: string;
  national: boolean;
  svg?: { path: string; body: Buffer };
  png?: { path: string; size: number; body: Buffer };
  webp?: { path: string; size: number; body: Buffer };
}

/** "RIFF" + tamanho + "WEBP". */
export const isWebp = (b: Buffer) =>
  b.length >= 16 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';

export const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function readLimited(path: string): Buffer | null {
  const st = statSync(path);
  if (!st.isFile() || st.size > MAX_BYTES) return null;
  return readFileSync(path);
}

export function listDir(path: string): string[] {
  return existsSync(path) && statSync(path).isDirectory() ? readdirSync(path).sort() : [];
}

export function convertFolders(options: ConvertOptions): ConvertReport {
  const { source, out } = options;
  if (existsSync(out) && readdirSync(out).length && !existsSync(join(out, 'acervo.yaml')))
    throw new Error(`a pasta de saída já tem arquivos e não é um pacote: ${out}`);
  // reconverter: o pacote anterior sai inteiro (nada de sobra de um nome antigo)
  rmSync(join(out, 'teams'), { recursive: true, force: true });
  const report: ConvertReport = {
    folders: 0,
    logos: 0,
    svg: 0,
    webp: 0,
    pngOnly: 0,
    national: 0,
    flags: [],
    rejected: [],
    duplicates: [],
    ignored: [],
  };
  const groups: Record<string, AcervoGroup> = {};
  const logos: Record<string, { name: string; national?: boolean }> = {};
  const seen = new Map<string, string>(); // sha do arquivo servido → pasta onde entrou

  const folders = listDir(source)
    .filter((f) => statSync(join(source, f)).isDirectory())
    .map((f) => ({ f, parts: f.split(' - ') }))
    // liga nacional antes dos torneios internacionais: o duplicado fica na pasta nacional
    .sort(
      (a, b) =>
        Number(INTERNATIONAL.has(normalizeName(a.parts[0] ?? ''))) -
          Number(INTERNATIONAL.has(normalizeName(b.parts[0] ?? ''))) || a.f.localeCompare(b.f),
    );

  for (const { f, parts } of folders) {
    if (parts.length < 2) {
      report.ignored.push(f);
      continue;
    }
    report.folders += 1;
    const country = parts[0]!.trim();
    const competitionName = parts.slice(1).join(' - ').trim();
    const group = slugify(f);
    const leagues = FOLDER_LEAGUES[normalizeName(f)];
    groups[group] = {
      country,
      competition: competitionName,
      ...(leagues ? { api_sports_leagues: [...leagues] } : {}),
    };

    const byName = new Map<string, Candidate>();
    const candidate = (raw: string) => {
      const national = NATIONAL_RE.test(raw);
      const name = raw.replace(NATIONAL_RE, '').trim();
      const k = `${national ? 'n' : 'c'}:${normalizeName(name)}`;
      const c = byName.get(k) ?? { name, national };
      byName.set(k, c);
      return c;
    };
    for (const file of listDir(join(source, f, 'svg'))) {
      const m = SVG_RE.exec(file);
      if (!m) {
        report.ignored.push(`${f}/svg/${file}`);
        continue;
      }
      if (m[1]!.toLowerCase() === 'bandeira') {
        report.flags.push(`${f}/${m[2]}`);
        continue;
      }
      const path = join(source, f, 'svg', file);
      const body = readLimited(path);
      const reason = !body ? 'arquivo grande demais' : unsafeSvgReason(body);
      if (reason || !body) {
        report.rejected.push({ file: `${f}/svg/${file}`, reason: reason ?? 'ilegível' });
        candidate(m[2]!);
        continue;
      }
      candidate(m[2]!).svg = { path, body };
    }
    for (const file of listDir(join(source, f, 'png'))) {
      const m = PNG_RE.exec(file);
      if (!m) {
        report.ignored.push(`${f}/png/${file}`);
        continue;
      }
      if (m[2]!.toLowerCase() === 'bandeira') continue;
      const size = Number(m[1]);
      const c = candidate(m[3]!);
      if (c.png && c.png.size >= size) continue;
      const path = join(source, f, 'png', file);
      const body = readLimited(path);
      if (!body || !PNG_SIGNATURE.every((b, i) => body[i] === b)) {
        report.ignored.push(`${f}/png/${file}`);
        continue;
      }
      c.png = { path, size, body };
    }
    for (const file of listDir(join(source, f, 'webp'))) {
      const m = WEBP_RE.exec(file);
      if (!m) {
        report.ignored.push(`${f}/webp/${file}`);
        continue;
      }
      if (m[2]!.toLowerCase() === 'bandeira') continue;
      const size = Number(m[1] ?? 0);
      const c = candidate(m[3]!);
      if (c.webp && c.webp.size >= size) continue;
      const path = join(source, f, 'webp', file);
      const body = readLimited(path);
      if (!body || !isWebp(body)) {
        report.ignored.push(`${f}/webp/${file}`);
        continue;
      }
      c.webp = { path, size, body };
    }

    for (const c of byName.values()) {
      const served = c.svg?.body ?? c.png?.body ?? c.webp?.body;
      if (!served) continue; // só bandeira ou só arquivo recusado
      const hash = sha(served);
      const keptIn = seen.get(hash);
      if (keptIn) {
        report.duplicates.push({ file: `${f}/${c.name}`, keptIn });
        continue;
      }
      seen.set(hash, f);
      const slug = `${c.national ? 'selecao-' : ''}${slugify(c.name)}`;
      const dir = join(out, 'teams', group);
      mkdirSync(dir, { recursive: true });
      if (c.svg) {
        writeFileSync(join(dir, `${slug}.svg`), c.svg.body);
        report.svg += 1;
      } else if (c.png) report.pngOnly += 1;
      if (c.png) copyFileSync(c.png.path, join(dir, `${slug}.png`));
      if (c.webp) {
        copyFileSync(c.webp.path, join(dir, `${slug}.webp`));
        report.webp += 1;
      }
      logos[`teams/${group}/${slug}`] = { name: c.name, ...(c.national ? { national: true } : {}) };
      report.logos += 1;
      if (c.national) report.national += 1;
    }
  }

  mkdirSync(out, { recursive: true });
  const header = '# Pacote gerado por `assets:acervo --converter` (não versionar os binários desta pasta).\n';
  writeFileSync(
    join(out, 'acervo.yaml'),
    header + stringify({ acervo: options.info, groups, logos }, { lineWidth: 0 }),
  );
  return report;
}
