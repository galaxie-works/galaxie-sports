/**
 * Texto de uma planilha .xlsx (só no servidor), sem biblioteca: o .xlsx é um zip de XML. Lê a primeira aba (ou todas,
 * até o teto) e devolve uma linha por linha da planilha, com as células separadas por tabulação. Serve à lista de
 * canais da Cosmos (#1008): o modelo lê o texto, não o arquivo.
 */
import { inflateRawSync } from 'node:zlib';

/** Teto do XML descompactado de cada parte (contra zip bomba). */
const PART_MAX_BYTES = 20 * 1024 * 1024;
const SHEETS_MAX = 5;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

/** Entradas do diretório central do zip; null se não for um zip legível. */
function zipEntries(buf: Buffer): ZipEntry[] | null {
  // fim do diretório central: assinatura 0x06054b50, nos últimos 64 KiB + 22 bytes
  const from = Math.max(0, buf.length - 65_557);
  let end = -1;
  for (let i = buf.length - 22; i >= from; i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) return null;
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nameLen), method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readEntry(buf: Buffer, e: ZipEntry): string | null {
  if (e.size > PART_MAX_BYTES) return null;
  const p = e.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) return null;
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  try {
    if (e.method === 0) return data.toString('utf8');
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: PART_MAX_BYTES }).toString('utf8');
  } catch {
    return null;
  }
  return null;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/** Texto de um `<si>` ou `<is>`: junta os `<t>` (inclusive os de rich text). */
const runs = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('');

/** Linhas de texto da planilha (células separadas por tabulação); null se não for um .xlsx legível. */
export function xlsxText(buf: Buffer, maxChars = 60_000): string | null {
  const entries = zipEntries(buf);
  if (!entries) return null;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const shared: string[] = [];
  const sst = byName.get('xl/sharedStrings.xml');
  if (sst) {
    const xml = readEntry(buf, sst);
    if (xml === null) return null;
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runs(m[1]!));
  }
  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(a.name.match(/\d+/)![0]) - Number(b.name.match(/\d+/)![0]))
    .slice(0, SHEETS_MAX);
  if (!sheets.length) return null;
  const lines: string[] = [];
  let size = 0;
  for (const sheet of sheets) {
    const xml = readEntry(buf, sheet);
    if (xml === null) continue;
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? '';
        const body = c[2] ?? '';
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let text = '';
        if (type === 's' && v !== undefined) text = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') text = runs(body);
        else if (v !== undefined) text = decode(v);
        cells.push(text.trim());
      }
      const line = cells.join('\t').replace(/\t+$/, '');
      if (!line.trim()) continue;
      size += line.length + 1;
      if (size > maxChars) return lines.join('\n');
      lines.push(line);
    }
  }
  return lines.join('\n');
}
