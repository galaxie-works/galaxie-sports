import type { SearchResult } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { docGuides } from '../docs';
import { getDictionary } from '../i18n/dictionary';
import { docsEntries, filterEntries, groupResults, resultHref } from './entries';
import { addRecent, clearRecents, getRecents, MAX_RECENTS } from './recents';

const result = (over: Partial<SearchResult>): SearchResult => ({
  type: 'team',
  id: '01a15fba-ec17-7d8b-90d7-47b3ccbe967e',
  slug: null,
  name: 'Palmeiras',
  matched: null,
  match: 'exact',
  sport: 'football',
  country: 'BR',
  image: null,
  detail: 'Brasil',
  event: null,
  ...over,
});

describe('busca global — entradas', () => {
  it('leva cada tipo à página da demo', () => {
    expect(resultHref(result({}))).toBe('/times/01a15fba-ec17-7d8b-90d7-47b3ccbe967e');
    expect(resultHref(result({ type: 'competition', id: 'x', slug: 'brasileirao-serie-a' }))).toBe(
      '/competicoes/brasileirao-serie-a',
    );
    expect(resultHref(result({ type: 'country', id: 'GB-ENG' }))).toBe('/paises/gb-eng');
    expect(resultHref(result({ type: 'venue', id: 'v1' }))).toBe('/locais/v1');
    expect(resultHref(result({ type: 'person', id: 'p1' }))).toBe('/pessoas/p1');
    expect(resultHref(result({ type: 'event', id: 'e1' }))).toBe('/eventos/e1');
  });

  it('agrupa por tipo; pessoas e estádios descem um nível no empate', () => {
    const groups = groupResults([
      result({ type: 'person', id: 'p', name: 'Boca', match: 'exact' }),
      result({ type: 'team', id: 't', name: 'Boca Juniors', match: 'prefix' }),
      result({ type: 'event', id: 'e', name: 'Boca Juniors x River Plate', match: 'prefix' }),
      result({ type: 'venue', id: 'v', name: 'Estádio Boca do Lobo', match: 'prefix' }),
    ]);
    expect(groups.map(([type]) => type)).toEqual(['team', 'event', 'person', 'venue']);
    expect(groups[0]![1][0]).toMatchObject({ key: 'team:t', href: '/times/t', label: 'Boca Juniors' });
  });

  it('documentação: páginas, seções e endpoints, filtrados sem acento', () => {
    const docs = docsEntries(docGuides(getDictionary('pt-BR')), [
      { method: 'get', route: '/v1/search', summary: 'Busca global', tag: 'Busca', anchor: 'get-v1-search' },
    ]);
    const en = docsEntries(docGuides(getDictionary('en')), []);
    expect(filterEntries(en, 'getting')[0]).toMatchObject({ href: '/docs', label: 'Getting started' });
    expect(docs.find((d) => d.kind === 'doc' && d.href === '/docs')?.topLevel).toBe(true);
    // o título da seção vem antes da página que só cita o termo na descrição
    expect(filterEntries(docs, 'etag').map((d) => d.href)).toEqual([
      '/docs/conceitos#cache',
      '/docs/conceitos',
    ]);
    expect(filterEntries(docs, 'autenticacao')[0]?.href).toBe('/docs/autenticacao');
    expect(filterEntries(docs, '/v1/search')[0]).toMatchObject({
      kind: 'endpoint',
      href: '/docs/referencia#get-v1-search',
      method: 'get',
    });
    expect(filterEntries(docs, '', 2)).toHaveLength(2);
  });

  it('recentes: mais novo primeiro, sem repetir, no máximo 6 (sem storage, em memória)', () => {
    clearRecents();
    for (let i = 0; i < MAX_RECENTS + 2; i++) {
      addRecent({
        key: `team:${i}`,
        kind: 'team',
        href: `/times/${i}`,
        label: `Time ${i}`,
        detail: null,
        image: null,
        sport: null,
      });
    }
    addRecent({
      key: 'team:5',
      kind: 'team',
      href: '/times/5',
      label: 'Time 5',
      detail: null,
      image: null,
      sport: null,
    });
    expect(getRecents().map((e) => e.key)).toEqual([
      'team:5',
      'team:7',
      'team:6',
      'team:4',
      'team:3',
      'team:2',
    ]);
  });
});
