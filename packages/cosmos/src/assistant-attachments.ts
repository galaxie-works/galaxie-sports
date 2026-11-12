/**
 * Anexos na pergunta ao assistente da Cosmos (#1065): imagem, PDF ou texto. Puro (sem banco nem Node), para o
 * painel e o servidor lerem o arquivo com a mesma regra: o painel recusa e estima antes de mandar, o servidor
 * confere de novo antes de reservar.
 *
 * - O tipo sai dos bytes, não do nome nem do `type` que o navegador diz (JPEG, PNG, WebP e PDF pela assinatura;
 *   texto quando é UTF-8 válido, sem byte nulo, com extensão de texto).
 * - Imagem e PDF vão para o modelo como arquivo (`CompletionAttachment` do `@galaxie/llm`); texto entra na pergunta,
 *   delimitado, como dado.
 * - Nada é guardado: o anexo vive só durante a pergunta. O extrato leva só o tipo e o tamanho.
 */

/** Limites por anexo e por pergunta. Ajustar é mudar estes números. */
export const ASSISTANT_ATTACHMENT_LIMITS = {
  /** Anexos por pergunta. */
  maxFiles: 3,
  /** Imagem: o teto dos provedores é 5 MB em base64, que dá 3,75 MB de arquivo. */
  maxImageBytes: 3_750_000,
  /** PDF: o mesmo teto da imagem, para o pedido inteiro caber nos provedores. */
  maxPdfBytes: 3_750_000,
  /** Páginas por PDF (cada página conta como texto e como imagem para o modelo). */
  maxPdfPages: 20,
  /** Texto (código, log, CSV, Markdown). */
  maxTextBytes: 100_000,
  /** Soma dos anexos de uma pergunta. */
  maxTotalBytes: 6_000_000,
  /** Tokens de entrada contados por imagem (o provedor reduz a imagem grande para perto de 1,15 megapixel). */
  imageInputTokens: 1600,
  /** Tokens de entrada contados por página de PDF (texto extraído e a imagem da página). */
  pdfPageInputTokens: 3000,
} as const;

export type AttachmentKind = 'image' | 'pdf' | 'text';

/** Tipos de arquivo que o modelo lê como arquivo (os do `@galaxie/llm`). */
export type AttachmentFileType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

/** Extensões aceitas como texto. */
export const TEXT_EXTENSIONS = ['txt', 'md', 'csv', 'json', 'log', 'xml', 'yaml', 'yml'] as const;

/** `accept` do campo de arquivo no painel. */
export const ATTACHMENT_ACCEPT = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  ...TEXT_EXTENSIONS.map((e) => `.${e}`),
].join(',');

/** O que a estimativa precisa saber de um anexo (sem o conteúdo). */
export interface AttachmentMeta {
  kind: AttachmentKind;
  bytes: number;
  /** Páginas, para PDF. */
  pages?: number;
}

export interface ReadAttachment extends AttachmentMeta {
  name: string;
  /** Imagem e PDF. */
  mediaType?: AttachmentFileType;
  /** Texto do arquivo, para `kind: 'text'`. */
  text?: string;
}

export type AttachmentError =
  /** Tipo que o assistente não lê. */
  | 'type'
  /** Arquivo maior que o limite do tipo. */
  | 'size'
  /** PDF com mais páginas que o limite. */
  | 'pages'
  /** Mais anexos que o limite, ou a soma passou do teto. */
  | 'count'
  | 'total';

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** Tipo do arquivo pela assinatura dos bytes (JPEG, PNG, WebP ou PDF); null para o resto. */
export function sniffFileType(b: Uint8Array): AttachmentFileType | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return 'image/webp';
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

/**
 * Páginas de um PDF, pelos objetos `/Type /Page` (sem contar `/Pages`, a árvore). Conta aproximada, que basta para o
 * limite e a estimativa; um PDF sem nenhum objeto legível (comprimido em fluxo de objetos) conta como 1 página por
 * 100 KB, para não sair de graça.
 */
export function pdfPageCount(b: Uint8Array): number {
  let text = '';
  // latin1: cada byte vira um caractere, sem falhar em binário
  for (let i = 0; i < b.length; i += 0x8000) text += String.fromCharCode(...b.subarray(i, i + 0x8000));
  const pages = text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  return pages || Math.max(1, Math.ceil(b.length / 100_000));
}

const extension = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

/** UTF-8 estrito (o decodificador já tira a marca de ordem do começo); null para binário. */
function decodeText(b: Uint8Array): string | null {
  if (b.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return null;
  }
}

/** Nome mostrado e mandado ao modelo: sem caminho, sem quebra de linha nem aspas, curto. */
export function attachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = Array.from(base)
    .filter((c) => c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f && !'"<>'.includes(c))
    .join('');
  return clean.trim().slice(0, 120) || 'arquivo';
}

/** Lê um arquivo: o tipo pelos bytes, o tamanho e as páginas, conferidos contra os limites do tipo. */
export function readAttachment(
  name: string,
  b: Uint8Array,
): { ok: true; file: ReadAttachment } | { ok: false; error: AttachmentError } {
  const L = ASSISTANT_ATTACHMENT_LIMITS;
  const clean = attachmentName(name);
  const type = sniffFileType(b);
  if (type === 'application/pdf') {
    if (b.length > L.maxPdfBytes) return { ok: false, error: 'size' };
    const pages = pdfPageCount(b);
    if (pages > L.maxPdfPages) return { ok: false, error: 'pages' };
    return { ok: true, file: { name: clean, kind: 'pdf', bytes: b.length, pages, mediaType: type } };
  }
  if (type) {
    if (b.length > L.maxImageBytes) return { ok: false, error: 'size' };
    return { ok: true, file: { name: clean, kind: 'image', bytes: b.length, mediaType: type } };
  }
  if (!(TEXT_EXTENSIONS as readonly string[]).includes(extension(clean))) return { ok: false, error: 'type' };
  if (b.length > L.maxTextBytes) return { ok: false, error: 'size' };
  const text = decodeText(b);
  if (text === null || !text.trim()) return { ok: false, error: 'type' };
  return { ok: true, file: { name: clean, kind: 'text', bytes: b.length, text } };
}

/** Quantidade e soma dos anexos de uma pergunta; null = cabe. */
export function checkAttachments(files: readonly Pick<AttachmentMeta, 'bytes'>[]): AttachmentError | null {
  const L = ASSISTANT_ATTACHMENT_LIMITS;
  if (files.length > L.maxFiles) return 'count';
  if (files.reduce((s, f) => s + f.bytes, 0) > L.maxTotalBytes) return 'total';
  return null;
}

/**
 * Limites conferidos só pelo tipo, tamanho e páginas (sem o conteúdo): a última trava antes de reservar, que vale
 * mesmo para quem chama sem passar pelo painel. null = cabe.
 */
export function attachmentMetaError(files: readonly AttachmentMeta[]): AttachmentError | null {
  const L = ASSISTANT_ATTACHMENT_LIMITS;
  for (const f of files) {
    const max = f.kind === 'image' ? L.maxImageBytes : f.kind === 'pdf' ? L.maxPdfBytes : L.maxTextBytes;
    if (f.bytes > max) return 'size';
    if (f.kind === 'pdf' && (f.pages ?? 1) > L.maxPdfPages) return 'pages';
  }
  return checkAttachments(files);
}

/** Tokens de entrada que os anexos somam na estimativa (o texto, pelos ≈ 4 caracteres por token). */
export function attachmentInputTokens(files: readonly AttachmentMeta[]): number {
  const L = ASSISTANT_ATTACHMENT_LIMITS;
  return files.reduce((sum, f) => {
    if (f.kind === 'image') return sum + L.imageInputTokens;
    if (f.kind === 'pdf') return sum + Math.max(1, f.pages ?? 1) * L.pdfPageInputTokens;
    return sum + Math.ceil(f.bytes / 4) + 20;
  }, 0);
}

/** Lê o que o navegador manda como meta de anexo (só para a estimativa); descarta o que não for. */
export function parseAttachmentMetas(raw: unknown): AttachmentMeta[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > ASSISTANT_ATTACHMENT_LIMITS.maxFiles) return null;
  const out: AttachmentMeta[] = [];
  for (const m of raw) {
    const kind = (m as { kind?: unknown })?.kind;
    const bytes = Number((m as { bytes?: unknown })?.bytes);
    const pages = Number((m as { pages?: unknown })?.pages);
    if (kind !== 'image' && kind !== 'pdf' && kind !== 'text') return null;
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    out.push({
      kind,
      bytes: Math.min(bytes, ASSISTANT_ATTACHMENT_LIMITS.maxTotalBytes),
      ...(kind === 'pdf'
        ? { pages: Math.min(Math.max(1, Math.floor(pages) || 1), ASSISTANT_ATTACHMENT_LIMITS.maxPdfPages) }
        : {}),
    });
  }
  return checkAttachments(out) ? null : out;
}

/** Texto dos anexos de texto, delimitado, para ir junto da pergunta como dado. */
export function attachmentTextBlock(files: readonly ReadAttachment[]): string {
  return files
    .filter((f) => f.kind === 'text' && f.text)
    .map((f) => `<anexo nome="${f.name}">\n${f.text!.replaceAll('</anexo>', '</ anexo>')}\n</anexo>`)
    .join('\n\n');
}
