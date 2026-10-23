import type { CareerSeason, Photo, RaceCareer } from '@galaxie/contracts';
import { describe, expect, it } from 'vitest';

import { careerSpan, heroPhotos, heroSeason } from './driver-hero';

const car = { url: 'https://cdn/car.jpg' } as Photo;

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

  it('a foto da curadoria vence a regra (Senna: Phoenix 1991)', () => {
    const phoenix = { url: 'https://cdn/phoenix.jpg', season: 1991, role: 'action' } as Photo;
    const shots = heroPhotos({ ...senna, portrait: null, highlight: phoenix });
    expect(shots.car).toBe(phoenix);
    expect(shots.season?.year).toBe(1991);
  });

  it('anos de carreira', () => {
    expect(careerSpan(senna)).toEqual({ from: 1984, to: 1993 });
    expect(careerSpan(career([season(2026, { races: 0 })]))).toBeNull();
  });
});
