/**
 * Conversor da base de escudos organizada por país (layout de 2026-10-29) para o layout de pacote do
 * acervo (docs/runbooks/acervo-de-logos.md). Entrada:
 *
 *   <origem>/<País>/Times/<Time>/Original/svg/Escudo - <Time>.svg
 *   <origem>/<País>/Times/<Time>/Original/png/x512 - Escudo - <Time>.png        (x64...x512: vale o maior)
 *   <origem>/<País>/Times/<Time>/Original/webp/x512 - Escudo - <Time>.webp      (idem)
 *   <origem>/<País>/Seleções/<Seleção>/Original/...                              seleção principal do país
 *   <origem>/<País>/Campeonatos/<Competição>/Original/.../Logo - <Competição>.*  logo da competição
 *   <origem>/<País>/Entidades/<Entidade>/...                                     (fora: não há alvo na base)
 *   <origem>/Internacionais/...                                                  torneios e seleções sem país
 *
 * O nome de exibição é o da pasta do time; o nome do arquivo só identifica o formato e o tamanho. Só a
 * variante `Original` entra por enquanto (as demais vão para o relatório). Logo de uma edição
 * ("Eurocopa 1960") fica de fora: o alvo é a competição, e cada edição tem o seu. Saída (fora do git):
 *
 *   <saída>/acervo.yaml                              acervo, grupos (pasta → país) e nomes
 *   <saída>/teams/<país>/<slug>.svg|png|webp         clubes; seleções em teams/<país>/selecao-<slug>
 *   <saída>/competitions/<país>/<slug>.svg|png|webp  competições
 *
 * A origem é entrada não confiável, com as mesmas regras do conversor por competição (convert-folders.ts):
 * só SVG, PNG e WebP, assinatura e tamanho conferidos, SVG com conteúdo ativo recusado e nomes saneados.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeName } from '@galaxie/knowledge';
import { stringify } from 'yaml';
import {
  isWebp,
  listDir,
  PNG_SIGNATURE,
  readLimited,
  sha,
  slugify,
  type ConvertOptions,
  type ConvertReport,
} from './convert-folders.js';
import type { AcervoGroup } from './scan.js';
import { unsafeSvgReason } from './svg-safety.js';

type Kind = 'team' | 'national' | 'competition' | 'entity';
const TYPE_DIRS: Record<string, Kind> = {
  times: 'team',
  clubes: 'team',
  selecoes: 'national',
  campeonatos: 'competition',
  competicoes: 'competition',
  entidades: 'entity',
};
const INTERNATIONAL = new Set(['internacionais', 'internacional', 'mundial', 'mundo', 'world']);
const FILE_RE = /^(?:x(\d+) - )?(Escudo|Logo|Bandeira) - .+\.(svg|png|webp)$/i;
/** "Eurocopa 1960", "Copa do Mundo 2014": logo de uma edição. */
const EDITION_RE = /\s(?:18|19|20)\d\d$/;

export interface CountryConvertReport extends ConvertReport {
  /** Logos de competição gravados. */
  competitions: number;
  /** Entidades (FIFA, CONMEBOL...): sem alvo na base. */
  entities: string[];
  /** Logos de edição ("Eurocopa 1960"). */
  editions: string[];
  /** Variantes além de `Original` (ainda não publicadas). */
  otherVariants: string[];
}

/** A base está no layout por país? (alguma pasta de país com Times, Seleções ou Campeonatos). */
export function isCountryLayout(source: string): boolean {
  return listDir(source).some((country) =>
    listDir(join(source, country)).some((t) => {
      const kind = TYPE_DIRS[normalizeName(t)];
      return kind !== undefined && kind !== 'entity';
    }),
  );
}

interface Crest {
  svg?: Buffer;
  png?: { path: string; size: number; body: Buffer };
  webp?: { path: string; size: number; body: Buffer };
}

function readCrest(dir: string, rel: string, report: CountryConvertReport): Crest {
  const crest: Crest = {};
  for (const format of ['svg', 'png', 'webp'] as const) {
    for (const file of listDir(join(dir, format))) {
      const m = FILE_RE.exec(file);
      if (!m || m[3]!.toLowerCase() !== format) {
        report.ignored.push(`${rel}/${format}/${file}`);
        continue;
      }
      // bandeira não é escudo (ex.: a pasta da seleção só com a bandeira do país)
      if (m[2]!.toLowerCase() === 'bandeira') {
        if (format === 'svg') report.flags.push(rel);
        continue;
      }
      const path = join(dir, format, file);
      const body = readLimited(path);
      if (format === 'svg') {
        const reason = !body ? 'arquivo grande demais' : unsafeSvgReason(body);
        if (reason || !body)
          report.rejected.push({ file: `${rel}/svg/${file}`, reason: reason ?? 'ilegível' });
        else crest.svg ??= body;
        continue;
      }
      const ok =
        format === 'png' ? !!body && PNG_SIGNATURE.every((b, i) => body[i] === b) : !!body && isWebp(body);
      if (!ok) {
        report.ignored.push(`${rel}/${format}/${file}`);
        continue;
      }
      const size = Number(m[1] ?? 0);
      const current = crest[format];
      if (!current || current.size < size) crest[format] = { path, size, body: body! };
    }
  }
  return crest;
}

export function convertCountries(options: ConvertOptions): CountryConvertReport {
  const { source, out } = options;
  if (existsSync(out) && readdirSync(out).length && !existsSync(join(out, 'acervo.yaml')))
    throw new Error(`a pasta de saída já tem arquivos e não é um pacote: ${out}`);
  // reconverter: o pacote anterior sai inteiro (nada de sobra de um nome antigo)
  for (const d of ['teams', 'competitions']) rmSync(join(out, d), { recursive: true, force: true });
  const report: CountryConvertReport = {
    folders: 0,
    logos: 0,
    svg: 0,
    webp: 0,
    pngOnly: 0,
    national: 0,
    competitions: 0,
    flags: [],
    rejected: [],
    duplicates: [],
    ignored: [],
    entities: [],
    editions: [],
    otherVariants: [],
  };
  const groups: Record<string, AcervoGroup> = {};
  const logos: Record<string, { name: string; national?: boolean }> = {};
  const seen = new Map<string, string>(); // sha do arquivo servido → onde entrou

  for (const country of listDir(source)) {
    const countryDir = join(source, country);
    if (!statSync(countryDir).isDirectory()) continue;
    const types = listDir(countryDir).filter((t) => TYPE_DIRS[normalizeName(t)]);
    if (!types.length) {
      report.ignored.push(country);
      continue;
    }
    report.folders += 1;
    const group = slugify(country);
    groups[group] = { country: INTERNATIONAL.has(normalizeName(country)) ? 'Mundial' : country };
    for (const type of types) {
      const kind = TYPE_DIRS[normalizeName(type)]!;
      for (const name of listDir(join(countryDir, type))) {
        const rel = `${country}/${type}/${name}`;
        const itemDir = join(countryDir, type, name);
        if (!statSync(itemDir).isDirectory()) {
          report.ignored.push(rel);
          continue;
        }
        if (kind === 'entity') {
          report.entities.push(rel);
          continue;
        }
        if (kind === 'competition' && EDITION_RE.test(name.trim())) {
          report.editions.push(rel);
          continue;
        }
        const variants = listDir(itemDir);
        const original = variants.find((v) => normalizeName(v) === 'original');
        for (const v of variants) if (v !== original) report.otherVariants.push(`${rel}/${v}`);
        if (!original) {
          report.ignored.push(rel);
          continue;
        }
        const crest = readCrest(join(itemDir, original), `${rel}/${original}`, report);
        const served = crest.svg ?? crest.png?.body ?? crest.webp?.body;
        if (!served) continue; // só arquivo recusado ou fora do padrão
        const hash = sha(served);
        const keptIn = seen.get(hash);
        if (keptIn) {
          report.duplicates.push({ file: rel, keptIn });
          continue;
        }
        seen.set(hash, rel);

        const base = `${kind === 'competition' ? 'competitions' : 'teams'}/${group}`;
        const baseSlug = `${kind === 'national' ? 'selecao-' : ''}${slugify(name)}`;
        let slug = baseSlug;
        for (let i = 2; logos[`${base}/${slug}`]; i++) slug = `${baseSlug}-${i}`;
        const dir = join(out, base);
        mkdirSync(dir, { recursive: true });
        if (crest.svg) {
          writeFileSync(join(dir, `${slug}.svg`), crest.svg);
          report.svg += 1;
        } else if (crest.png) report.pngOnly += 1;
        if (crest.png) copyFileSync(crest.png.path, join(dir, `${slug}.png`));
        if (crest.webp) {
          copyFileSync(crest.webp.path, join(dir, `${slug}.webp`));
          report.webp += 1;
        }
        const display = name.trim();
        logos[`${base}/${slug}`] = { name: display, ...(kind === 'national' ? { national: true } : {}) };
        report.logos += 1;
        if (kind === 'national') report.national += 1;
        if (kind === 'competition') report.competitions += 1;
      }
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
