/**
 * Licença de um arquivo da Wikimedia Commons, lida do `extmetadata` da API (`prop=imageinfo&iiprop=extmetadata`).
 * A decisão é por regra verificável, nunca por IA: só entram licenças que permitem uso comercial —
 * domínio público, CC0, CC BY e CC BY-SA. NC, ND, "fair use", não livre e sem licença clara ficam de fora.
 */

export type ExtMetadata = Record<string, { value?: unknown } | undefined>;

export interface CommonsLicense {
  /** Nome curto como a Commons publica ("CC BY-SA 4.0", "Public domain"). */
  license: string;
  licenseUrl: string | null;
  author: string | null;
  authorUrl: string | null;
  /** Campo `Credit`: na prática a fonte do arquivo ("Own work", link do Flickr), não a atribuição. */
  credit: string | null;
  /** Atribuição pedida pelo autor (`Attribution`), em texto: a linha que a licença manda exibir. */
  attribution: string | null;
  attributionRequired: boolean;
  shareAlike: boolean;
  dateTaken: string | null;
}

export type LicenseVerdict = { ok: true; value: CommonsLicense } | { ok: false; reason: string };

const value = (meta: ExtMetadata, key: string): string | null => {
  const v = meta[key]?.value;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
};

/** HTML da Commons → texto ("<a href=…>Fulano</a>" → "Fulano"), sem entidades. */
export function plainText(html: string | null): string | null {
  if (!html) return null;
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

/** Primeiro link do HTML do autor (página de usuário ou site), absoluto. */
export function firstHref(html: string | null): string | null {
  const m = html ? /href="([^"]+)"/i.exec(html) : null;
  if (!m) return null;
  const href = m[1]!.replace(/&amp;/g, '&');
  if (href.startsWith('//')) return `https:${href}`;
  if (href.startsWith('/')) return `https://commons.wikimedia.org${href}`;
  return /^https?:\/\//.test(href) ? href : null;
}

/** Código da licença (`License`: "cc-by-sa-4.0", "pd", "cc0") → permitida e se é share-alike. */
export function classifyLicense(
  code: string | null,
  shortName: string | null,
): {
  allowed: boolean;
  shareAlike: boolean;
  reason?: string;
} {
  const c = (code ?? '').toLowerCase().trim();
  const name = (shortName ?? '').toLowerCase();
  const text = `${c} ${name}`;
  if (!c && !name) return { allowed: false, shareAlike: false, reason: 'sem licença' };
  if (/\bnc\b|-nc-|noncommercial|non-commercial/.test(text))
    return { allowed: false, shareAlike: false, reason: 'não comercial (NC)' };
  if (/\bnd\b|-nd-|-nd$|noderiv/.test(text))
    return { allowed: false, shareAlike: false, reason: 'sem derivadas (ND)' };
  if (/fair use|non-free|nonfree/.test(text))
    return { allowed: false, shareAlike: false, reason: 'não livre' };
  if (/^cc0\b|^cc-zero|^cc0-1\.0|\bcc0\b/.test(text)) return { allowed: true, shareAlike: false };
  if (/^pd\b|^pd-|public domain|^pdm/.test(text)) return { allowed: true, shareAlike: false };
  if (/^cc-by-sa-\d|\bcc by-sa \d/.test(text)) return { allowed: true, shareAlike: true };
  if (/^cc-by-\d|\bcc by \d/.test(text)) return { allowed: true, shareAlike: false };
  return { allowed: false, shareAlike: false, reason: `licença fora da lista (${shortName ?? code})` };
}

/** Atribuição pedida pelo autor (`Attribution` do `extmetadata`), sem HTML; null quando o arquivo não pede. */
export const readAttribution = (meta: ExtMetadata): string | null => plainText(value(meta, 'Attribution'));

/** Lê e valida a licença do `extmetadata`. */
export function readLicense(meta: ExtMetadata): LicenseVerdict {
  if (value(meta, 'NonFree') === 'true') return { ok: false, reason: 'marcado como não livre' };
  const shortName = value(meta, 'LicenseShortName');
  const code = value(meta, 'License');
  const verdict = classifyLicense(code, shortName);
  if (!verdict.allowed) return { ok: false, reason: verdict.reason ?? 'licença não aceita' };
  const artistHtml = value(meta, 'Artist');
  const author = plainText(artistHtml);
  const attributionRequired = value(meta, 'AttributionRequired') !== 'false';
  // CC BY e CC BY-SA exigem o autor: sem autor identificável, não dá para cumprir a licença
  if (attributionRequired && !author && !/^pd|cc0/.test((code ?? '').toLowerCase()))
    return { ok: false, reason: 'licença exige atribuição, mas o autor não é informado' };
  return {
    ok: true,
    value: {
      license: shortName ?? code!,
      licenseUrl: value(meta, 'LicenseUrl'),
      author,
      authorUrl: firstHref(artistHtml),
      credit: plainText(value(meta, 'Credit')),
      attribution: readAttribution(meta),
      attributionRequired,
      shareAlike: verdict.shareAlike,
      dateTaken: plainText(value(meta, 'DateTimeOriginal')),
    },
  };
}

/** Ano da foto pelo texto da data ("1988-07-10 14:00", "July 1990", "circa 1985"). */
export function yearOf(date: string | null): number | null {
  const m = date ? /\b(19\d{2}|20\d{2})\b/.exec(date) : null;
  return m ? Number(m[1]) : null;
}
