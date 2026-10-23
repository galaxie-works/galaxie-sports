/**
 * Acervo oficial de logos de canais (Figma) → biblioteca de emissoras. O manifesto versionado fica
 * em config/broadcasters/_official_logos.yaml (com os ids dos nós, para reimportar); os arquivos não
 * vão para o git: os SVGs exportados do Figma (um por símbolo, `<nó com hífen>.svg`) são limpos,
 * gravados no bucket (`broadcasters/<sha256[0..16]>.svg`, o mesmo padrão dos outros logos) e
 * registrados em core.asset (kind `broadcaster_logo`, `sourceUrl = acervo-oficial://<nó>`). A
 * sincronização da biblioteca (`syncBroadcasterLibrary`) liga esses assets às emissoras.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { systemClock, type Clock } from '@galaxie/apisports-client';
import { asset, type Database } from '@galaxie/db';
import {
  officialLogoSourceUrl,
  type OfficialLogoComponent,
  type OfficialLogoManifest,
} from '@galaxie/where-to-watch';
import { logoStorageKey } from './broadcaster-logos.js';
import type { ObjectStore } from './object-store.js';

// ─── metadados do Figma ──────────────────────────────────────────────────────────────────────────

/** Atributo de uma tag XML (sem decodificar entidades). */
function attr(tag: string, name: string): string | null {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
}

/** Texto de atributo XML com entidades decodificadas. */
export function decodeXmlText(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Desfaz o UTF-8 lido como Latin-1 ("AmÃ©rica" → "América"), como vem nos ids do SVG exportado.
 * Texto que não é desse tipo volta como está.
 */
export function fixMojibake(value: string): string {
  const latin1 = [...value].every((ch) => ch.codePointAt(0)! <= 0xff);
  // primeiro byte de uma sequência UTF-8 de 2 bytes (Â..ô) seguido de um byte de continuação
  if (!latin1 || !/[\xc2-\xf4][\x80-\xbf]/.test(value)) return value;
  const fixed = Buffer.from(value, 'latin1').toString('utf8');
  return fixed.includes('\uFFFD') ? value : fixed;
}

/**
 * Componentes do frame "Channel Logos" a partir do XML do `get_metadata` do Figma: cada frame com
 * símbolos (`Theme=Light`/`Theme=Dark`, ou uma versão só) é um canal; a letra é o frame-filho de
 * "Middle" que o contém.
 */
export function parseFigmaChannelFrames(xml: string): OfficialLogoComponent[] {
  const out: OfficialLogoComponent[] = [];
  const stack: { id: string; name: string; symbols: { id: string; name: string; y: number }[] }[] = [];
  const tags = xml.matchAll(/<(\/?)(frame|symbol|instance|canvas|[a-z-]+)\b([^>]*?)(\/?)>/g);
  const letterOf = () => {
    const middle = stack.findIndex((f) => f.name === 'Middle');
    return middle >= 0 ? (stack[middle + 1]?.name ?? '') : '';
  };
  for (const [, closing, tagName, attrs, selfClosing] of tags) {
    if (tagName === 'symbol' && !closing) {
      stack.at(-1)?.symbols.push({
        id: attr(attrs!, 'id') ?? '',
        name: decodeXmlText(attr(attrs!, 'name') ?? ''),
        y: Number(attr(attrs!, 'y') ?? 0),
      });
      continue;
    }
    if (tagName !== 'frame') continue;
    if (!closing) {
      const f = {
        id: attr(attrs!, 'id') ?? '',
        name: decodeXmlText(attr(attrs!, 'name') ?? ''),
        symbols: [],
      };
      if (selfClosing) continue;
      stack.push(f);
      continue;
    }
    const letter = letterOf();
    const f = stack.pop();
    if (!f?.symbols.length) continue;
    // tema pelo nome do símbolo; sem nome que diga (dois "Theme=Default"), a linha de cima é a clara
    // e a de baixo, a escura — o layout do acervo
    const symbols = [...f.symbols].sort((a, b) => a.y - b.y);
    const light =
      symbols.find((s) => /(^|,\s*)(Theme|Property \d+)=(Light|Default)\b/.test(s.name)) ?? symbols[0]!;
    const dark =
      symbols.find((s) => s !== light && /=Dark\b/.test(s.name)) ??
      symbols.find((s) => s !== light && s.y > light.y && !/=Light\b/.test(s.name)) ??
      null;
    out.push({ node: f.id, name: f.name, letter, light: light.id, dark: dark?.id ?? null });
  }
  return out;
}

// ─── SVG exportado ───────────────────────────────────────────────────────────────────────────────

/** Fim (índice após o `>`) do elemento que começa em `start` (uma tag de abertura), com aninhamento. */
function elementEnd(svg: string, start: number): number {
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(svg); m; m = re.exec(svg)) {
    if (m[3] === '/') {
      if (depth === 0) return re.lastIndex;
      continue;
    }
    depth += m[1] ? -1 : 1;
    if (depth === 0) return re.lastIndex;
  }
  return -1;
}

/** Filhos diretos de um elemento (`inner` = conteúdo entre as tags). */
function childElements(inner: string): string[] {
  const out: string[] = [];
  const re = /<([a-zA-Z][\w:-]*)\b/g;
  for (let m = re.exec(inner); m; m = re.exec(inner)) {
    const end = elementEnd(inner, m.index);
    if (end < 0) break;
    out.push(inner.slice(m.index, end));
    re.lastIndex = end;
  }
  return out;
}

const refsOf = (s: string) => new Set([...s.matchAll(/(?:url\(#|href="#)([^)"]+)/g)].map((m) => m[1]!));

export interface CleanedFigmaSvg {
  svg: string;
  /** Nome do componente ("A/América"), quando o SVG o traz. */
  componentName: string | null;
}

/**
 * O export do Figma desenha o símbolo dentro do contexto da página: fundo da página, o frame
 * escuro do acervo e a borda tracejada do conjunto de componentes. Fica só o grupo do símbolo
 * (`Theme=...`) e as definições que ele usa (gradientes, máscaras, imagens) — o logo no fundo
 * transparente, no tamanho do símbolo (64×48).
 */
export function cleanFigmaSvg(raw: string): CleanedFigmaSvg {
  const root = raw.match(/<svg\b[^>]*>/);
  if (!root) throw new Error('SVG sem a tag <svg>.');
  const width = attr(root[0], 'width');
  const height = attr(root[0], 'height');
  const viewBox = attr(root[0], 'viewBox') ?? `0 0 ${width} ${height}`;
  const component = [...raw.matchAll(/<g\b[^>]*\sid="([^"]*\/[^"]*)"[^>]*>/g)].at(-1);
  const componentName = component ? fixMojibake(decodeXmlText(component[1]!)) : null;
  const after = component ? component.index + component[0].length : 0;
  const symbolStart = raw.slice(after).search(/<g\b/);
  if (!component || symbolStart < 0) throw new Error('SVG sem o grupo do símbolo (Theme=...).');
  const start = after + symbolStart;
  const end = elementEnd(raw, start);
  if (end < 0) throw new Error('SVG mal formado (grupo do símbolo sem fechamento).');
  const body = raw.slice(start, end);
  const defsMatch = raw.match(/<defs>([\s\S]*)<\/defs>/);
  // definições usadas pelo símbolo (e, transitivamente, pelas próprias definições: padrão → imagem)
  const defs = defsMatch ? childElements(defsMatch[1]!) : [];
  const byId = new Map(defs.map((d) => [attr(d, 'id') ?? '', d]));
  const keep = new Set<string>();
  const queue = [...refsOf(body)];
  while (queue.length) {
    const id = queue.pop()!;
    if (keep.has(id) || !byId.has(id)) continue;
    keep.add(id);
    queue.push(...refsOf(byId.get(id)!));
  }
  const usedDefs = defs.filter((d) => keep.has(attr(d, 'id') ?? ''));
  const xlink = /xlink:href=/.test(body + usedDefs.join(''))
    ? ' xmlns:xlink="http://www.w3.org/1999/xlink"'
    : '';
  const svg = [
    `<svg width="${width}" height="${height}" viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg"${xlink}>`,
    body,
    ...(usedDefs.length ? ['<defs>', ...usedDefs, '</defs>'] : []),
    '</svg>',
    '',
  ].join('\n');
  return { svg, componentName };
}

/** Arquivo do símbolo na pasta exportada: `335:20142` → `335-20142.svg`. */
export function officialLogoFile(node: string): string {
  return `${node.replace(':', '-')}.svg`;
}

// ─── importação ──────────────────────────────────────────────────────────────────────────────────

export interface OfficialLogoImportReport {
  /** Símbolos do manifesto (versões clara e escura de todos os componentes). */
  symbols: number;
  stored: number;
  unchanged: number;
  missing: string[];
  failed: { node: string; reason: string }[];
}

/**
 * Sobe os SVGs do acervo para o bucket e registra/atualiza o asset de cada símbolo (idempotente:
 * mesmo conteúdo = mesma chave; arquivo novo no Figma = nova chave no mesmo asset).
 */
export async function runOfficialLogoImport(options: {
  db: Database;
  objects: ObjectStore;
  manifest: OfficialLogoManifest;
  dir: string;
  clock?: Clock;
  dryRun?: boolean;
}): Promise<OfficialLogoImportReport> {
  const clock = options.clock ?? systemClock;
  const nodes = options.manifest.logos.flatMap((l) => [l.light, ...(l.dark ? [l.dark] : [])]);
  const report: OfficialLogoImportReport = {
    symbols: nodes.length,
    stored: 0,
    unchanged: 0,
    missing: [],
    failed: [],
  };
  const urls = nodes.map(officialLogoSourceUrl);
  const current = new Map(
    (
      await options.db
        .select({ sourceUrl: asset.sourceUrl, sha256: asset.sha256, storageKey: asset.storageKey })
        .from(asset)
        .where(inArray(asset.sourceUrl, urls))
    ).map((r) => [r.sourceUrl, r]),
  );
  for (const node of nodes) {
    const path = join(options.dir, officialLogoFile(node));
    if (!existsSync(path)) {
      report.missing.push(node);
      continue;
    }
    let svg: string;
    try {
      svg = cleanFigmaSvg(readFileSync(path, 'utf8')).svg;
    } catch (err) {
      report.failed.push({ node, reason: (err as Error).message });
      continue;
    }
    const body = Buffer.from(svg, 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const sourceUrl = officialLogoSourceUrl(node);
    const prev = current.get(sourceUrl);
    if (prev?.sha256 === sha256 && prev.storageKey) {
      report.unchanged++;
      continue;
    }
    if (options.dryRun) {
      report.stored++;
      continue;
    }
    const key = logoStorageKey(sha256, 'image/svg+xml');
    await options.objects.put(key, body, 'image/svg+xml', sha256);
    const size = svg.match(/<svg\b[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/);
    const values = {
      storageKey: key,
      sha256,
      bytes: body.length,
      width: size ? Math.round(Number(size[1])) : null,
      height: size ? Math.round(Number(size[2])) : null,
      fetchedAt: new Date(clock.now()),
    };
    await options.db
      .insert(asset)
      .values({ kind: 'broadcaster_logo', sourceUrl, ...values })
      .onConflictDoUpdate({ target: asset.sourceUrl, set: values });
    report.stored++;
  }
  return report;
}

/** Quantos assets do acervo já estão no storage (para o resumo do CLI). */
export async function countStoredOfficialLogos(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(asset)
    .where(sql`${asset.sourceUrl} like 'acervo-oficial://%' and ${asset.storageKey} is not null`);
  return row?.n ?? 0;
}
