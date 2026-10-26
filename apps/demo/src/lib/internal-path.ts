/**
 * Caminhos internos vindos de fora (`?voltar=` do login, trilha mandada pelo navegador): só valem se
 * continuarem na própria origem depois de resolvidos como o navegador resolveria. Checar só o prefixo
 * não basta: `/\evil.com`, `/<tab>/evil.com` e `/.//evil.com` começam com uma barra só, mas o navegador
 * troca `\` por `/`, descarta tab e quebra de linha e resolve `.` e `..`, e o resultado aponta para outro
 * domínio (ou vira `//evil.com`, que o próximo `router.replace` levaria para fora).
 *
 * Módulo puro: serve ao login (navegador), às rotas e aos testes.
 */

/** Origem fictícia para resolver o caminho quando não importa a origem real (só se ele sai dela). */
const PLACEHOLDER_ORIGIN = 'http://demo.invalid';

/**
 * O caminho normalizado (pathname + query + hash) se `value` é um caminho da própria origem; senão,
 * `null`.
 */
export function internalPath(value: unknown, origin: string = PLACEHOLDER_ORIGIN): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  let base: URL;
  let url: URL;
  try {
    base = new URL(origin);
    url = new URL(value, base);
  } catch {
    return null;
  }
  if (url.origin !== base.origin || url.pathname.startsWith('//')) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
