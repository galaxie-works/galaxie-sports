/**
 * O que o assistente da Cosmos (#1003) sabe da tela: rota, título, o texto visível da área principal e os
 * destinos do menu. Lido do DOM no navegador, na hora de perguntar; o servidor corta de novo antes de usar.
 * Nada de campos de formulário nem do próprio painel do assistente.
 */
import type { ScreenContext } from '@galaxie/cosmos';

export const VISIBLE_MAX = 6000;
const DESTINATIONS_MAX = 20;

/** Rota sem o prefixo de idioma (`/en/cliente` → `/cliente`), que é o que a documentação e o menu usam. */
export function routeOf(pathname: string): string {
  const stripped = pathname.replace(/^\/(en|es-AR|pt-BR)(?=\/|$)/, '');
  return stripped || '/';
}

/** Grupo de sugestões pela rota. */
export type SuggestionGroup = 'cosmos' | 'docs' | 'general';
export function suggestionGroup(route: string): SuggestionGroup {
  if (route.startsWith('/cliente/cosmos')) return 'cosmos';
  if (route === '/docs' || route.startsWith('/docs/')) return 'docs';
  return 'general';
}

const squeeze = (s: string) =>
  s
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

/** Lê a tela atual. `doc` vem por parâmetro para os testes. */
export function readScreenContext(doc: Document = document): ScreenContext {
  const route = routeOf(doc.location?.pathname ?? '/');
  const title = squeeze(doc.querySelector('header h1')?.textContent ?? doc.title ?? '');
  const main = doc.querySelector('main') ?? doc.body;
  let visible = '';
  if (main) {
    const copy = main.cloneNode(true) as HTMLElement;
    // fora do contexto: o próprio assistente, campos de formulário, scripts e o que está escondido
    copy
      .querySelectorAll(
        '[data-cosmos-assistant], script, style, input, textarea, select, [hidden], [aria-hidden="true"]',
      )
      .forEach((el) => el.remove());
    visible = squeeze(copy.innerText ?? copy.textContent ?? '').slice(0, VISIBLE_MAX);
  }
  const seen = new Set<string>();
  const destinations: { label: string; href: string }[] = [];
  doc.querySelectorAll<HTMLAnchorElement>('[data-sidebar="menu"] a[href]').forEach((a) => {
    const href = routeOf(a.getAttribute('href') ?? '');
    const label = squeeze(a.textContent ?? '');
    if (!href.startsWith('/') || !label || seen.has(href) || destinations.length >= DESTINATIONS_MAX) return;
    seen.add(href);
    destinations.push({ label: label.slice(0, 80), href });
  });
  return { route, title, visible, destinations };
}
