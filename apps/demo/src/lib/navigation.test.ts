import { describe, expect, it } from 'vitest';

import { getDictionary } from './i18n/dictionary';
import {
  FALLBACK_COUNTRIES,
  SPORTS,
  confederationLabel,
  countryGroups,
  countryHref,
  countryName,
  eventCompetitionHref,
  idFromSlug,
  participantHref,
  sportParent,
} from './navigation';

describe('links de navegação', () => {
  it('país só ganha link com código de país (ISO2 ou extensão como GB-ENG)', () => {
    expect(countryHref('BR')).toBe('/countries/br');
    expect(countryHref('GB-ENG')).toBe('/countries/gb-eng');
    expect(countryHref('World')).toBeNull();
    expect(countryHref(null)).toBeNull();
  });

  it('competição a partir do jogo abre nos jogos, na rodada e na temporada do jogo', () => {
    const href = eventCompetitionHref({
      competition: { slug: 'brasileirao-serie-a' },
      stage: { name: 'Rodada 32' },
      starts_at: '2026-10-23T20:00:00-03:00',
    });
    expect(href).toBe('/competitions/brasileirao-serie-a?tab=matches&date=2026-10-23&round=Rodada+32');
    expect(eventCompetitionHref({ competition: null, stage: null, starts_at: '2026-10-23' })).toBeNull();
  });

  it('esporte pai é a família do menu, com o rótulo dela', () => {
    expect(sportParent('formula-1', getDictionary('pt-BR'))).toEqual({
      path: '/sports/motorsport',
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

  it('piloto e lutador ganham slug com o id no fim; os demais ficam em /teams', () => {
    expect(participantHref(max, 'driver')).toBe(
      '/drivers/max-verstappen-01a16675-379b-7b21-bf12-33042e33ebad',
    );
    expect(participantHref({ id: max.id, name: 'José Aldo' }, 'fighter')).toBe(
      '/fighters/jose-aldo-01a16675-379b-7b21-bf12-33042e33ebad',
    );
    expect(participantHref(max, 'club')).toBe('/teams/01a16675-379b-7b21-bf12-33042e33ebad');
    expect(participantHref(max)).toBe('/teams/01a16675-379b-7b21-bf12-33042e33ebad');
  });

  it('o id sai do fim do slug (ou do id puro)', () => {
    expect(idFromSlug('max-verstappen-01a16675-379b-7b21-bf12-33042e33ebad')).toBe(max.id);
    expect(idFromSlug(max.id)).toBe(max.id);
    expect(idFromSlug('max-verstappen')).toBeNull();
  });
});

describe('países da navegação: do banco (resposta da API), não da lista fixa', () => {
  // a resposta como a API monta: os países com liga nacional no catálogo, por confederação, na ordem dela
  const summary = {
    confederations: [
      { code: 'CONMEBOL', name: 'CONMEBOL (América do Sul)', countries: ['BR', 'AR', 'VE'] },
      { code: 'CONCACAF', name: 'CONCACAF', countries: ['MX', 'US'] },
      { code: 'UEFA', name: 'UEFA (Europa)', countries: ['GB-ENG', 'PT', 'NL'] },
      { code: 'AFC', name: 'AFC (Ásia)', countries: ['SA'] },
    ],
  };

  it('a lista e os grupos vêm da resposta, inclusive países fora da lista de reserva (EUA, Holanda)', () => {
    const groups = countryGroups(summary);
    expect(groups.map((g) => [g.code, g.countries.map((c) => c.code)])).toEqual([
      ['CONMEBOL', ['BR', 'AR', 'VE']],
      ['CONCACAF', ['MX', 'US']],
      ['UEFA', ['GB-ENG', 'PT', 'NL']],
      ['AFC', ['SA']],
    ]);
    const all = groups.flatMap((g) => g.countries);
    // não é a constante: tem país que ela não tem e não tem os que a resposta não trouxe
    expect(all.map((c) => c.code)).not.toEqual(FALLBACK_COUNTRIES.map((c) => c.code));
    expect(all.find((c) => c.code === 'US')).toEqual({
      code: 'US',
      group: 'CONCACAF',
      href: '/countries/us',
    });
    expect(all.find((c) => c.code === 'NL')).toEqual({ code: 'NL', group: 'UEFA', href: '/countries/nl' });
    expect(all.some((c) => c.code === 'UY')).toBe(false);
  });

  it('sem a API, a lista de reserva nas três confederações de sempre', () => {
    const groups = countryGroups(null);
    expect(groups.map((g) => g.code)).toEqual(['CONMEBOL', 'CONCACAF', 'UEFA']);
    expect(groups.flatMap((g) => g.countries)).toHaveLength(FALLBACK_COUNTRIES.length);
  });

  it('nome: o do dicionário, senão o da API, senão o do navegador; confederações novas têm subtítulo', () => {
    const pt = getDictionary('pt-BR');
    expect(countryName(pt, 'pt-BR', 'GB-ENG', 'England')).toBe('Inglaterra');
    expect(countryName(pt, 'pt-BR', 'NL', 'Holanda')).toBe('Holanda');
    expect(countryName(getDictionary('es-AR'), 'es-AR', 'US')).toBe('Estados Unidos');
    expect(countryName(pt, 'pt-BR', 'GB-SCT')).toBe('GB-SCT');
    for (const locale of ['pt-BR', 'en', 'es-AR'] as const)
      for (const code of ['CONMEBOL', 'CONCACAF', 'UEFA', 'AFC', 'CAF', 'OFC'])
        expect(confederationLabel(getDictionary(locale), code), `${locale} ${code}`).toBeTruthy();
  });
});
