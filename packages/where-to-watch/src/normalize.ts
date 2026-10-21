/** Normalização de nomes e URLs usada pelo dicionário, pelo validador e pela blocklist. */

/**
 * Chave de comparação de nomes: sem acento, minúsculas, `+` → "plus", só [a-z0-9].
 * "Disney+ Premium" e "disney plus premium" viram a mesma chave; "TV Globo" ≠ "Globo".
 */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

/** Host em minúsculas, sem `www.`; null para URL inválida ou esquema que não seja http(s). */
export function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** URL http(s) bem formada. */
export function isHttpUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && hostOf(url) !== null;
}

/**
 * A URL pertence ao domínio do dicionário? `domain` pode ter caminho (`youtube.com/@CazeTV`):
 * o host casa por sufixo (subdomínios incluídos) e o caminho por prefixo, sem diferenciar caixa.
 */
export function matchesDomain(url: string, domain: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  const [d, ...rest] = domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/');
  const dHost = d!.replace(/^www\./, '');
  if (host !== dHost && !host.endsWith(`.${dHost}`)) return false;
  if (!rest.length) return true;
  const prefix = `/${rest.join('/')}`.replace(/\/$/, '');
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
  } catch {
    return false;
  }
}

/** Só o host de um domínio do dicionário (para listas de busca, que não aceitam caminho). */
export function domainHost(domain: string): string {
  return domain
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]!
    .replace(/^www\./, '');
}

/** Sufixos de segundo nível usados na região (com.br, com.ar...). */
const SECOND_LEVEL = new Set(['com', 'org', 'net', 'gob', 'gov', 'edu', 'co', 'tv', 'uol']);

/**
 * Domínio registrável aproximado (sem lista pública de sufixos): `ge.globo.com` → `globo.com`,
 * `www.lance.com.br` → `lance.com.br`. Usado para decidir se duas fontes são independentes.
 */
export function registrableDomain(host: string): string {
  const parts = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  if (parts.length <= 2) return parts.join('.');
  const tld = parts.at(-1)!;
  const second = parts.at(-2)!;
  if (tld.length === 2 && SECOND_LEVEL.has(second)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

/** Corta o trecho de evidência em `max` caracteres (direitos autorais: só trechos curtos). */
export function clipExcerpt(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}
