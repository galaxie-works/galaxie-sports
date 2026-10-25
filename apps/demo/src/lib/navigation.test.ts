import { describe, expect, it } from 'vitest';

import { getDictionary } from './i18n/dictionary';
import {
  SPORTS,
  countryHref,
  eventCompetitionHref,
  idFromSlug,
  participantHref,
  sportParent,
} from './navigation';

describe('links de navegação', () => {
  it('país só ganha link com código de país (ISO2 ou extensão como GB-ENG)', () => {
    expect(countryHref('BR')).toBe('/paises/br');
    expect(countryHref('GB-ENG')).toBe('/paises/gb-eng');
    expect(countryHref('World')).toBeNull();
    expect(countryHref(null)).toBeNull();
  });

  it('competição a partir do jogo abre nos jogos, na rodada e na temporada do jogo', () => {
    const href = eventCompetitionHref({
      competition: { slug: 'brasileirao-serie-a' },
      stage: { name: 'Rodada 32' },
      starts_at: '2026-10-23T20:00:00-03:00',
    });
    expect(href).toBe('/competicoes/brasileirao-serie-a?aba=jogos&data=2026-10-23&rodada=Rodada+32');
    expect(eventCompetitionHref({ competition: null, stage: null, starts_at: '2026-10-23' })).toBeNull();
  });

  it('esporte pai é a família do menu, com o rótulo dela', () => {
    expect(sportParent('formula-1', getDictionary('pt-BR'))).toEqual({
      path: '/esportes/automobilismo',
      label: 'Automobilismo',
      kind: 'esporte',
    });
    expect(sportParent('curling', getDictionary('pt-BR'))).toBeNull();
  });
});

describe('ícones dos esportes', () => {
  const icon = (slug: string) => SPORTS.find((s) => s.slug === slug)?.icon;

  it('cada esporte tem um ícone próprio, exceto NBA (o do basquete) e AFL (o do rúgbi)', () => {
    expect(icon('nba')).toBe(icon('basketball'));
    expect(icon('afl')).toBe(icon('rugby'));
    const own = SPORTS.filter((s) => s.slug !== 'nba' && s.slug !== 'afl').map((s) => s.icon);
    expect(new Set(own).size).toBe(own.length);
  });
});

describe('rotas de piloto e lutador', () => {
  const max = { id: '01a16675-379b-7b21-bf12-33042e33ebad', name: 'Max Verstappen' };

  it('piloto e lutador ganham slug com o id no fim; os demais ficam em /times', () => {
    expect(participantHref(max, 'driver')).toBe(
      '/pilotos/max-verstappen-01a16675-379b-7b21-bf12-33042e33ebad',
    );
    expect(participantHref({ id: max.id, name: 'José Aldo' }, 'fighter')).toBe(
      '/lutadores/jose-aldo-01a16675-379b-7b21-bf12-33042e33ebad',
    );
    expect(participantHref(max, 'club')).toBe('/times/01a16675-379b-7b21-bf12-33042e33ebad');
    expect(participantHref(max)).toBe('/times/01a16675-379b-7b21-bf12-33042e33ebad');
  });

  it('o id sai do fim do slug (ou do id puro)', () => {
    expect(idFromSlug('max-verstappen-01a16675-379b-7b21-bf12-33042e33ebad')).toBe(max.id);
    expect(idFromSlug(max.id)).toBe(max.id);
    expect(idFromSlug('max-verstappen')).toBeNull();
  });
});
