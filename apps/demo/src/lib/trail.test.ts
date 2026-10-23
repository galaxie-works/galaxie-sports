import { describe, expect, it } from 'vitest';

import { ancestorsOf, applyVisit, MAX_TRAIL, originOf, type TrailEntry, type TrailState } from './trail';

const portugal = { path: '/paises/pt', label: 'Portugal', kind: 'país' } as const;
const liga = { path: '/competicoes/94', label: 'Primeira Liga', kind: 'competição' } as const;
const porto = { path: '/times/212', label: 'FC Porto', kind: 'time' } as const;
const evento = { path: '/eventos/1', label: 'FC Porto x Benfica', kind: 'evento' } as const;

/** Visita as páginas em sequência, como a navegação faria. */
function walk(...visits: Parameters<typeof applyVisit>[1][]): TrailEntry[] {
  return visits.reduce<TrailEntry[]>((entries, v) => applyVisit({ entries, pendingRoot: null }, v), []);
}

const labels = (entries: TrailEntry[]) => entries.map((e) => e.label);

describe('trilha de navegação', () => {
  it('acrescenta cada página nova no fim, com a profundidade', () => {
    const entries = walk(portugal, liga, porto);
    expect(labels(entries)).toEqual(['Portugal', 'Primeira Liga', 'FC Porto']);
    expect(entries.map((e) => e.depth)).toEqual([1, 2, 3]);
  });

  it('voltar a uma página da trilha corta até ela (clique no item, Voltar)', () => {
    const entries = applyVisit({ entries: walk(portugal, liga, porto, evento), pendingRoot: null }, liga);
    expect(labels(entries)).toEqual(['Portugal', 'Primeira Liga']);
    expect(entries.at(-1)?.depth).toBe(2);
  });

  it('mudança só de query string substitui o último item', () => {
    const entries = applyVisit(
      { entries: walk(portugal, liga), pendingRoot: null },
      { ...liga, path: '/competicoes/94?temporada=2024' },
    );
    expect(entries).toHaveLength(2);
    expect(entries.at(-1)?.path).toBe('/competicoes/94?temporada=2024');
  });

  it('destino de topo da sidebar começa trilha nova', () => {
    const trail: TrailState = { entries: walk(portugal, liga, porto), pendingRoot: '/esportes/football' };
    const entries = applyVisit(trail, { path: '/esportes/football', label: 'Futebol', kind: 'esporte' });
    expect(labels(entries)).toEqual(['Futebol']);
    expect(entries[0]?.depth).toBe(1);
  });

  it('guarda no máximo MAX_TRAIL itens, mas a profundidade continua contando', () => {
    const pages = Array.from({ length: MAX_TRAIL + 3 }, (_, i) => ({
      path: `/times/${i}`,
      label: `Time ${i}`,
      kind: 'time' as const,
    }));
    const entries = walk(...pages);
    expect(entries).toHaveLength(MAX_TRAIL);
    expect(entries.at(-1)?.depth).toBe(MAX_TRAIL + 3);
  });

  it('página de topo começa trilha nova mesmo sem clique na sidebar', () => {
    const entries = applyVisit(
      { entries: walk(portugal, liga, porto), pendingRoot: null },
      { path: '/ao-vivo', label: 'Ao vivo', kind: 'ao vivo' },
    );
    expect(labels(entries)).toEqual(['Ao vivo']);
  });

  it('página interna de um tipo de topo mantém o pai que informa (usuário dentro de Ajustes)', () => {
    const usuarios = { path: '/ajustes/usuarios', label: 'Usuários', kind: 'ajustes' } as const;
    const entries = applyVisit(
      { entries: walk(usuarios), pendingRoot: null },
      { path: '/ajustes/usuarios/1', label: 'Ana', kind: 'ajustes' },
      [usuarios],
    );
    expect(labels(entries)).toEqual(['Usuários', 'Ana']);
  });

  it('trilha vazia (link direto, aba nova) começa pelos pais da página', () => {
    const futebol = { path: '/esportes/football', label: 'Futebol', kind: 'esporte' } as const;
    const entries = applyVisit({ entries: [], pendingRoot: null }, evento, [futebol, liga]);
    expect(labels(entries)).toEqual(['Futebol', 'Primeira Liga', 'FC Porto x Benfica']);
    expect(entries.map((e) => e.depth)).toEqual([1, 2, 3]);
  });

  it('com caminho percorrido, os pais não entram: vale o caminho de quem navegou', () => {
    const futebol = { path: '/esportes/football', label: 'Futebol', kind: 'esporte' } as const;
    const entries = applyVisit({ entries: walk(portugal, porto), pendingRoot: null }, evento, [
      futebol,
      liga,
    ]);
    expect(labels(entries)).toEqual(['Portugal', 'FC Porto', 'FC Porto x Benfica']);
  });

  it('origem: o jogo aberto pelo Ao vivo volta para o Ao vivo', () => {
    const aoVivo = { path: '/ao-vivo', label: 'Ao vivo', kind: 'ao vivo' } as const;
    const trail: TrailState = { entries: walk(aoVivo), pendingRoot: null };
    expect(originOf(trail, evento, [portugal, liga])?.label).toBe('Ao vivo');
  });

  it('origem: vindo de um pai (a competição), não há botão — a trilha já leva a ele', () => {
    const trail: TrailState = {
      entries: walk(portugal, { ...liga, path: '/competicoes/94?aba=jogos' }),
      pendingRoot: null,
    };
    expect(originOf(trail, evento, [portugal, liga])).toBeNull();
  });

  it('origem: link direto (sem caminho) não tem origem', () => {
    expect(originOf({ entries: [], pendingRoot: null }, evento, [portugal, liga])).toBeNull();
    expect(originOf({ entries: [], pendingRoot: null }, evento)).toBeNull();
  });

  it('esqueleto carregando mostra o caminho até a página', () => {
    const trail: TrailState = { entries: walk(portugal, liga, porto), pendingRoot: null };
    expect(labels(ancestorsOf(trail, '/eventos/1'))).toEqual(['Portugal', 'Primeira Liga', 'FC Porto']);
    expect(labels(ancestorsOf(trail, '/competicoes/94'))).toEqual(['Portugal']);
  });
});
