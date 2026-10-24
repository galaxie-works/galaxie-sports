import type { CareerSeason, Photo, RaceCareer } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import {
  careerSpan,
  coverable,
  heroColor,
  heroNumber,
  heroPhotos,
  heroSeason,
  nameParts,
} from './driver-hero';

const car = { url: 'https://cdn/car.jpg', credit: { share_alike: false } } as Photo;

function season(year: number, o: Partial<CareerSeason> = {}): CareerSeason {
  return {
    year,
    position: null,
    final: true,
    points: 0,
    races: 16,
    wins: 0,
    poles: 0,
    podiums: 0,
    fastest_laps: 0,
    top10: 0,
    dnfs: 0,
    sprint: { races: 0, points: 0, wins: 0, podiums: 0, poles: 0, top10: 0 },
    number: null,
    teams: [],
    car: null,
    ...o,
  };
}

const career = (seasons: CareerSeason[]) => ({ seasons }) as RaceCareer;

describe('temporada do carro no heading do piloto', () => {
  // Senna: títulos em 1988 (8 vitórias), 1990 (6) e 1991 (7)
  const senna = career([
    season(1993, { position: 2, wins: 5, car }),
    season(1991, { position: 1, wins: 7, car }),
    season(1990, { position: 1, wins: 6, car }),
    season(1988, { position: 1, wins: 8, car }),
    season(1984, { position: 9, car }),
  ]);

  it('título com mais vitórias', () => {
    expect(heroSeason(senna)?.year).toBe(1988);
  });

  it('a curadoria vence', () => {
    expect(heroSeason(senna, 1991)?.year).toBe(1991);
    expect(heroSeason(senna, 2001)?.year).toBe(1988);
  });

  it('sem título: a de mais vitórias; sem vitórias: a mais recente', () => {
    expect(heroSeason(career([season(2010, { wins: 1, car }), season(2012, { wins: 3, car })]))?.year).toBe(
      2012,
    );
    expect(heroSeason(career([season(2010, { car }), season(2012, { car })]))?.year).toBe(2012);
  });

  it('pula temporada sem foto do carro', () => {
    const c = career([season(1988, { position: 1, wins: 8 }), season(1990, { position: 1, wins: 6, car })]);
    expect(heroSeason(c)?.year).toBe(1990);
  });

  it('sem foto nenhuma, fica a mais marcante (para a cor da equipe)', () => {
    const c = career([season(2011, { wins: 0 }), season(2012, { wins: 2 })]);
    expect(heroSeason(c)?.year).toBe(2012);
    expect(heroSeason(career([]))).toBeNull();
  });

  it('fotos do heading (vão para a galeria com o crédito)', () => {
    const portrait = { url: 'https://cdn/senna.jpg' } as Photo;
    const shots = heroPhotos({ ...senna, portrait });
    expect(shots.season?.year).toBe(1988);
    expect(shots.car).toBe(car);
    expect(shots.portrait).toBe(portrait);
    expect(heroPhotos({ ...career([season(2012)]), portrait: null })).toMatchObject({
      car: null,
      portrait: null,
    });
  });

  it('carro de destaque do acervo (curadoria): a temporada e a foto dele, com o piloto', () => {
    const withSenna = { url: 'https://cdn/mp4-4-senna.jpg', credit: { share_alike: false } } as Photo;
    const shots = heroPhotos({ ...senna, portrait: null, highlight: { season: 1991, car: withSenna } });
    expect(shots.season?.year).toBe(1991);
    expect(shots.car).toBe(withSenna);
    // destaque sem foto (url nula): volta à regra da página
    const noUrl = { url: null } as unknown as Photo;
    expect(
      heroPhotos({ ...senna, portrait: null, highlight: { season: 1991, car: noUrl } }).season?.year,
    ).toBe(1988);
  });

  describe('fundo só com foto que pode ser recortada (sem CC BY-SA)', () => {
    const bySa = { url: 'https://cdn/sa.jpg', season: 1988, credit: { share_alike: true } } as Photo;
    const by = { url: 'https://cdn/by.jpg', season: 1990, credit: { share_alike: false } } as Photo;

    it('coverable', () => {
      expect(coverable(by)).toBe(true);
      expect(coverable(bySa)).toBe(false);
      expect(coverable(null)).toBe(false);
    });

    it('regra: pula o carro BY-SA e vai para a próxima temporada', () => {
      const c = career([
        season(1988, { position: 1, wins: 8, car: bySa }),
        season(1990, { position: 1, wins: 6, car: by }),
      ]);
      expect(heroSeason(c)?.year).toBe(1990);
      expect(heroPhotos({ ...c, portrait: null, highlight: null }).car).toBe(by);
    });

    it('só carros BY-SA: sem foto de fundo (fica a cor da equipe da temporada marcante)', () => {
      const c = career([season(1988, { position: 1, wins: 8, car: bySa })]);
      const shots = heroPhotos({ ...c, portrait: null, highlight: null });
      expect(shots.car).toBeNull();
      expect(shots.season?.year).toBe(1988);
    });

    it('carro de destaque BY-SA é ignorado e vale a regra', () => {
      const c = career([season(1990, { position: 1, wins: 6, car: by })]);
      const shots = heroPhotos({ ...c, portrait: null, highlight: { season: 1988, car: bySa } });
      expect(shots.car).toBe(by);
      expect(shots.season?.year).toBe(1990);
    });
  });

  it('anos de carreira', () => {
    expect(careerSpan(senna)).toEqual({ from: 1984, to: 1993 });
    expect(careerSpan(career([season(2026, { races: 0 })]))).toBeNull();
  });

  describe('quem está no grid: a temporada atual', () => {
    const mercedes = { id: 'mer', name: 'Mercedes', logo: null };
    const ferrari = { id: 'fer', name: 'Ferrari', logo: null };
    const old = { url: 'https://cdn/w11.jpg', credit: { share_alike: false } } as Photo;

    it('equipe e carro de hoje; sem foto do carro de hoje, o mais recente da mesma equipe', () => {
      const c = {
        ...career([
          season(2026, { teams: [mercedes], number: 12 }),
          season(2025, { teams: [mercedes], car }),
        ]),
        current_season: 2026,
        portrait: null,
        highlight: null,
      };
      const shots = heroPhotos(c);
      expect(shots.season?.year).toBe(2026);
      expect(shots.car).toBe(car);
    });

    it('nunca o carro de outra equipe sob a cor de hoje (Hamilton na Ferrari)', () => {
      const c = {
        ...career([
          season(2026, { teams: [ferrari] }),
          season(2020, { teams: [mercedes], position: 1, wins: 11, car: old }),
        ]),
        current_season: 2026,
        portrait: null,
        highlight: { season: 2020, car: old },
      };
      expect(heroPhotos(c)).toMatchObject({ season: { year: 2026 }, car: null });
    });
  });

  it('cor do heading: a pintura da época; clara demais, a secundária; sem pintura, o escudo', () => {
    const livery = (primary: string, secondary: string | null) => ({
      primary,
      secondary,
      gradient: '',
      source: 'https://example.org',
    });
    const team = (o: object) => season(1988, { teams: [{ id: 't', name: 'T', logo: null, ...o }] });
    expect(heroColor(team({ livery: livery('#e4002b', '#ffffff') }))).toBe('#e4002b');
    // Williams da Saudia: branca com verde
    expect(heroColor(team({ livery: livery('#ffffff', '#00843d') }))).toBe('#00843d');
    expect(
      heroColor(
        team({
          livery: null,
          colors: { primary: '#123456', secondary: null, monochrome: false, gradient: '' },
        }),
      ),
    ).toBe('#123456');
    expect(heroColor(season(1988))).toBeNull();
  });

  it('número da época (Senna #12 em 1988) ou o permanente; nome em duas partes', () => {
    const profile = {
      first_name: 'Kimi',
      last_name: 'Antonelli',
      number: 12,
      birth_date: null,
      birth_place: null,
      birth_country: null,
    };
    expect(heroNumber(career([]), season(1988, { number: 12 }))).toBe(12);
    expect(heroNumber({ ...career([]), profile }, season(2024))).toBe(12);
    expect(heroNumber({ ...career([]), profile: null }, null)).toBeNull();
    expect(nameParts({ ...career([]), profile }, 'Kimi Antonelli')).toEqual({
      first: 'Kimi',
      last: 'Antonelli',
    });
    expect(nameParts({ ...career([]), profile: null }, 'Ayrton Senna')).toEqual({
      first: 'Ayrton',
      last: 'Senna',
    });
  });
});
