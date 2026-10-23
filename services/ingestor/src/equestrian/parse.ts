/**
 * Interpretação conservadora dos campos publicados no hipismo: só converte o que é explícito.
 * Qualquer coisa ambígua volta `null` (ausente não é zero) e o valor bruto continua preservado pelo chamador.
 */

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

/** Entidades HTML que a fonte deixou no texto ("CAMPEON&#39;S" → "CAMPEON'S"). */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Texto não vazio, aparado e sem entidades HTML; `null` para vazio/ausente. */
export function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = decodeEntities(String(v)).trim();
  return s ? s : null;
}

/** Número finito a partir de texto publicado ("22,500" → 22500; "5.93" → 5.93); `null` se não for número. */
export function num(v: unknown): number | null {
  const s = text(v);
  if (s === null) return null;
  const clean = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/** Inteiro publicado ("60" → 60); posições como "EL" ou "60=" ficam `null` (o bruto fica em `position_raw`). */
export function int(v: unknown): number | null {
  const s = text(v);
  if (s === null || !/^\d+$/.test(s)) return null;
  return Number(s);
}

/** Data de calendário real (rejeita 31/02, mês 13...). */
function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * "04/10/2026 15:30" | "07/10/1985" | "2026-10-04" → "2026-10-04". Formato desconhecido ou data impossível
 * (ex.: "2026-13-40", "31/02/2026") → `null`: o valor bruto continua preservado pelo chamador.
 */
export function isoDate(v: unknown): string | null {
  const s = text(v);
  if (s === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s) ?? /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (!m) return null;
  const [y, mo, d] = m[1]!.length === 4 ? [m[1]!, m[2]!, m[3]!] : [m[3]!, m[2]!, m[1]!];
  return validDate(Number(y), Number(mo), Number(d)) ? `${y}-${mo}-${d}` : null;
}

/** Status FEI de uma classificação a partir da posição publicada. */
export function statusFromPosition(positionRaw: unknown, published?: unknown): string {
  const p = text(published);
  if (p && p !== 'classified') return normalizeStatus(p);
  if (p === 'classified') return 'classified';
  const raw = text(positionRaw);
  if (raw === null) return 'unknown';
  if (/^\d+=?$/.test(raw)) return 'classified';
  return normalizeStatus(raw);
}

function normalizeStatus(s: string): string {
  const up = s.toUpperCase();
  return ['EL', 'RET', 'WD', 'DSQ', 'NS'].includes(up) ? up : 'unknown';
}

/** Estrelas (1–5) quando o nível as publica: "CSIO4*-W" → 4, "CSIYH1*" → 1. */
export function stars(level: string | null): number | null {
  const m = level ? /(\d)\*/.exec(level) : null;
  return m ? Number(m[1]) : null;
}

/** Família do nível publicado. */
export function levelKind(level: string | null): string | null {
  if (!level) return null;
  const l = level.toUpperCase();
  if (l.startsWith('OLYMPIC')) return 'olympic_games';
  if (l.startsWith('WEG') || l.startsWith('CH-M')) return 'world_championship';
  if (l.includes('PAN') || l.startsWith('G-')) return 'continental_games';
  if (l.startsWith('CH-')) return 'championship';
  if (l.startsWith('CSIO')) return 'csio';
  if (l.startsWith('CSI')) return 'csi';
  if (l.startsWith('CDI')) return 'cdi';
  if (l.startsWith('CCI') || l.startsWith('CIC')) return 'cci';
  return 'other';
}

/** Código do artigo no início do texto publicado ("220.2.1.2-GP - Table A..." → "220.2.1.2"). */
export function articleCode(article: string | null): string | null {
  const m = article ? /^(\d{3}(?:\.\d+)*)/.exec(article.trim()) : null;
  if (m) return m[1]!;
  return article && /^hist/i.test(article.trim()) ? 'Hist' : null;
}

/** Tipo de julgamento a partir do texto do artigo (só palavras-chave explícitas). */
export function judging(article: string | null): string | null {
  if (!article) return null;
  const a = article.toLowerCase();
  if (a.startsWith('hist')) return 'historical';
  if (a.includes('nations cup') || /^264\./.test(a)) return 'nations_cup';
  if (a.includes('table c') || /^(225|239)\b/.test(a)) return 'table_c';
  if (a.includes('two-phase') || a.includes('two phases') || /^(222|274)\./.test(a)) return 'two_phases';
  if (a.includes('2 rounds') || a.includes('two rounds') || /^(221|273)\./.test(a)) return 'two_rounds';
  if (a.includes('jump-off')) return 'jump_off';
  if (a.includes('against the clock')) return 'faults_time';
  return 'other';
}

export function isGrandPrix(name: string | null, article: string | null): boolean {
  return /(-GP\b|grand prix|gran premio|\bGP\b)/i.test(`${name ?? ''} ${article ?? ''}`);
}

const PARTICLES = new Set([
  'de',
  'da',
  'das',
  'do',
  'dos',
  'del',
  'la',
  'las',
  'los',
  'van',
  'von',
  'der',
  'den',
  'du',
  'le',
  'y',
  'e',
]);

/** "WERTHEIN" → "Werthein"; "DE LA FUENTE" → "de la Fuente" (partícula no meio); palavras mistas ficam. */
function titleCase(words: string, first: boolean): string {
  return words
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => {
      if (w !== w.toUpperCase()) return w;
      const lower = w.toLowerCase();
      if (PARTICLES.has(lower) && !(first && i === 0)) return lower;
      return lower.replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
    })
    .join(' ');
}

/**
 * Nome de exibição a partir das formas publicadas pela FEI:
 * "WERTHEIN, Lucas" → "Lucas Werthein"; "Karl COOK (USA)" → "Karl Cook"; "Rodrigo Pessoa" fica igual.
 */
export function displayName(published: string): string {
  const s = published.replace(/\s*\([A-Z]{3}\)\s*$/, '').trim();
  const comma = s.indexOf(',');
  if (comma > 0) {
    const family = s.slice(0, comma).trim();
    const given = s.slice(comma + 1).trim();
    return [titleCase(given, true), titleCase(family, false)].filter(Boolean).join(' ');
  }
  return titleCase(s, true);
}

/** Código de país publicado entre parênteses no fim do nome ("Karl COOK (USA)" → "USA"). */
export function countryFromName(published: string | null): string | null {
  const m = published ? /\(([A-Z]{3})\)\s*$/.exec(published) : null;
  return m ? m[1]! : null;
}

/** Gênero do cavalo: Female → mare; Male castrado → gelding; Male não castrado → stallion; senão o publicado. */
export function horseGender(gender: string | null, castrated: string | null): string | null {
  const g = gender?.toLowerCase() ?? null;
  const c = castrated?.toLowerCase() ?? null;
  if (g === 'female' || g === 'mare') return 'mare';
  if (g === 'male' || g === 'stallion' || g === 'gelding') {
    if (c === 'yes' || g === 'gelding') return 'gelding';
    if (c === 'no' || g === 'stallion') return 'stallion';
    return 'male';
  }
  return g;
}
