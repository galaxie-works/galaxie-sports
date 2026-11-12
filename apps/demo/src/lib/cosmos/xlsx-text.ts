/**
 * Texto de uma planilha .xlsx (só no servidor), sem biblioteca: o .xlsx é um zip de XML. Lê a primeira aba (ou todas,
 * até o teto) e devolve uma linha por linha da planilha, com as células separadas por tabulação. Serve à lista de
 * canais da Cosmos (#1008): o modelo lê o texto, não o arquivo.
 */
import { inflateRawSync } from 'node:zlib';

/** Teto do XML descompactado de cada parte (contra zip bomba). */
const PART_MAX_BYTES = 8 * 1024 * 1024;
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

const entity = (code: number) => (code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�');

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d{1,8});/g, (_, d: string) => entity(Number(d)))
    .replace(/&#x([0-9a-f]{1,8});/gi, (_, h: string) => entity(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

interface Block {
  /** Atributos da marca de abertura. */
  attrs: string;
  /** Conteúdo entre a abertura e o fechamento ('' na marca vazia `<x/>`). */
  body: string;
}

/**
 * Elementos `<tag …>…</tag>` (ou `<tag …/>`) em ordem, numa varredura linear com indexOf. Sem regex com `[\s\S]*?`:
 * num XML sem fechamento, a regex volta ao fim do texto a cada abertura (tempo quadrático, um .xlsx de 30 KB trava o
 * servidor). Aqui, abertura sem fechamento encerra a varredura.
 */
function* blocks(xml: string, tag: string): Generator<Block> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  for (;;) {
    const at = xml.indexOf(open, i);
    if (at < 0) return;
    const next = xml.charCodeAt(at + open.length);
    // `<row` não pode casar `<rowBreaks`: depois do nome vem espaço, `>` ou `/`
    if (next !== 0x3e && next !== 0x2f && next !== 0x20 && next !== 0x09 && next !== 0x0a && next !== 0x0d) {
      i = at + open.length;
      continue;
    }
    const gt = xml.indexOf('>', at);
    if (gt < 0) return;
    const attrs = xml.slice(at + open.length, xml.charCodeAt(gt - 1) === 0x2f ? gt - 1 : gt);
    if (xml.charCodeAt(gt - 1) === 0x2f) {
      yield { attrs, body: '' };
      i = gt + 1;
      continue;
    }
    const end = xml.indexOf(close, gt + 1);
    if (end < 0) return;
    yield { attrs, body: xml.slice(gt + 1, end) };
    i = end + close.length;
  }
}

/** Texto de um `<si>` ou `<is>`: junta os `<t>` (inclusive os de rich text; o fonético `<rPh>` fica de fora). */
function runs(xml: string): string {
  let plain = '';
  let i = 0;
  for (;;) {
    const at = xml.indexOf('<rPh', i);
    if (at < 0) break;
    plain += xml.slice(i, at);
    const end = xml.indexOf('</rPh>', at);
    if (end < 0) return decodeRuns(plain);
    i = end + 6;
  }
  return decodeRuns(plain + xml.slice(i));
}

function decodeRuns(xml: string): string {
  let text = '';
  for (const t of blocks(xml, 't')) text += decode(t.body);
  return text;
}

/**
 * Linhas de texto da planilha (células separadas por tabulação); null se não for um .xlsx legível. Limites: as abas
 * vão pela ordem do nome do arquivo (sheet1, sheet2…), célula vazia omitida não abre coluna e marca com prefixo de
 * namespace (`<x:row>`) não é lida. Para uma lista de nomes de canais, basta.
 */
export function xlsxText(buf: Buffer, maxChars = 60_000): string | null {
  const entries = zipEntries(buf);
  if (!entries) return null;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const shared: string[] = [];
  const sst = byName.get('xl/sharedStrings.xml');
  if (sst) {
    const xml = readEntry(buf, sst);
    if (xml === null) return null;
    for (const si of blocks(xml, 'si')) shared.push(runs(si.body));
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
    for (const row of blocks(xml, 'row')) {
      const cells: string[] = [];
      for (const c of blocks(row.body, 'c')) {
        const type = /\bt="([^"]+)"/.exec(c.attrs)?.[1];
        const v = blocks(c.body, 'v').next().value?.body;
        let text = '';
        if (type === 's' && v !== undefined) text = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') text = runs(c.body);
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
