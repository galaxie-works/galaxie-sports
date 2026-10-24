import type { CareerSeason, Photo, RaceCareer } from '@galaxie/contracts';

const isTitle = (s: CareerSeason) => s.final && s.position === 1;

/**
 * Foto que pode ir ao fundo do heading: o fundo recorta a foto no navegador (cover), o que é uma adaptação. CC BY,
 * CC0 e domínio público permitem; CC BY-SA não (fica na galeria, inteira e com crédito).
 */
export function coverable(photo: Photo | null | undefined): photo is Photo {
  return !!photo?.url && !photo.credit.share_alike;
}

/**
 * Temporada do carro no heading do piloto: a mais marcante que tenha foto do carro que possa ir ao fundo
 * (`coverable`: sem CC BY-SA).
 *
 * Ordem: curadoria (`curated`, quando houver) → título com mais vitórias → mais vitórias → a mais recente.
 * Sem foto em nenhuma, fica a mais marcante, e o heading usa a cor da equipe dela. Quando o acervo ganha a
 * foto dessa temporada, o heading troca sozinho.
 */
export function heroSeason(career: RaceCareer, curated?: number | null): CareerSeason | null {
  const raced = career.seasons.filter((s) => s.races > 0 || s.position != null);
  const picked = curated != null ? raced.find((s) => s.year === curated) : undefined;
  if (picked) return picked;
  const ranked = [...raced].sort(
    (a, b) => Number(isTitle(b)) - Number(isTitle(a)) || b.wins - a.wins || b.year - a.year,
  );
  return ranked.find((s) => coverable(s.car)) ?? ranked[0] ?? null;
}

/**
 * Fotos do heading: o carro de destaque do acervo (ou o da temporada marcante, quando há) e o retrato. O fundo
 * nunca é CC BY-SA (`coverable`); sem foto compatível, fica a cor da equipe. O heading não mostra crédito: as
 * duas entram na galeria da página, com o crédito da licença.
 */
export function heroPhotos(career: RaceCareer): {
  season: CareerSeason | null;
  car: Photo | null;
  portrait: Photo | null;
} {
  // carro de destaque do acervo (`highlight`, curadoria): a temporada e a foto dele, de preferência com o piloto
  const highlight = coverable(career.highlight?.car) ? career.highlight : null;
  const season = heroSeason(career, highlight?.season);
  const car =
    highlight && season?.year === highlight.season
      ? highlight.car
      : coverable(season?.car)
        ? season.car
        : null;
  return {
    season,
    car,
    portrait: career.portrait?.url ? career.portrait : null,
  };
}

/** Primeiro e último ano de corrida ("1984–1994"; um ano só quando a carreira cabe numa temporada). */
export function careerSpan(career: RaceCareer): { from: number; to: number } | null {
  const years = career.seasons.filter((s) => s.races > 0).map((s) => s.year);
  if (!years.length) return null;
  return { from: Math.min(...years), to: Math.max(...years) };
}
