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
 * Temporada em destaque no heading da lenda: a mais marcante. A foto do carro da temporada não pesa na
 * escolha (o fundo só usa o carro de destaque do acervo, ver `heroPhotos`), então a equipe, a cor e o número
 * do heading são sempre os da temporada mais forte.
 *
 * Ordem: curadoria (`curated`, quando houver) → título com mais vitórias → mais vitórias → a mais recente.
 */
export function heroSeason(career: RaceCareer, curated?: number | null): CareerSeason | null {
  const raced = career.seasons.filter((s) => s.races > 0 || s.position != null);
  const picked = curated != null ? raced.find((s) => s.year === curated) : undefined;
  if (picked) return picked;
  const ranked = [...raced].sort(
    (a, b) => Number(isTitle(b)) - Number(isTitle(a)) || b.wins - a.wins || b.year - a.year,
  );
  return ranked[0] ?? null;
}

/** Temporada corrente de quem está no grid (o heading fica na equipe e no número de hoje); null para as lendas. */
export function currentSeason(career: RaceCareer): CareerSeason | null {
  const year = career.current_season;
  return year == null ? null : (career.seasons.find((s) => s.year === year) ?? null);
}

/**
 * Fotos do heading e a temporada em destaque. O fundo nunca é CC BY-SA (`coverable`); sem foto compatível, fica a
 * cor da equipe. O heading não mostra crédito: as duas fotos entram na galeria da página, com o crédito da licença.
 *
 * O fundo é só o carro de destaque do acervo (`highlight`): a importação o escolhe pela nota do Gemini para o
 * fundo (ou pela curadoria). A foto do carro da temporada (`season.car`) fica na tabela e na galeria, mas não vai ao
 * fundo: sem a nota, pode ser um close ou um detalhe. Sem destaque, fica a cor da equipe.
 *
 * - Quem está no grid: a temporada atual (equipe, cor e número de hoje). O fundo é o destaque, se for desta
 *   temporada ou da mesma equipe — nunca o carro de outra equipe sob a cor de hoje.
 * - Lenda: o destaque e a temporada dele.
 * - Temporada escolhida no seletor (`year`): é ela no lugar da atual, com a equipe, a cor e o número daquele ano
 *   (Fangio em 1958 é Maserati e 2, não a Mercedes do destaque; Farina em 1955 é Ferrari, não a Alfa do título).
 */
export function heroPhotos(
  career: RaceCareer,
  year?: number | null,
): {
  season: CareerSeason | null;
  car: Photo | null;
  portrait: Photo | null;
} {
  const portrait = career.portrait?.url ? career.portrait : null;
  const highlight = coverable(career.highlight?.car) ? career.highlight : null;
  const current =
    (year != null ? career.seasons.find((s) => s.year === year) : undefined) ?? currentSeason(career);
  if (current) {
    const team = current.teams[0]?.id;
    const sameTeam = (s: CareerSeason | undefined) => !!team && s?.teams[0]?.id === team;
    const highlightSeason = career.seasons.find((s) => s.year === highlight?.season);
    const car =
      highlight && (highlight.season === current.year || sameTeam(highlightSeason)) ? highlight.car : null;
    return { season: current, car, portrait };
  }
  // lenda: carro de destaque do acervo e a temporada dele
  const season = heroSeason(career, highlight?.season);
  const car = highlight && season?.year === highlight.season ? highlight.car : null;
  return { season, car, portrait };
}

/** Primeiro e último ano de corrida ("1984–1994"; um ano só quando a carreira cabe numa temporada). */
export function careerSpan(career: RaceCareer): { from: number; to: number } | null {
  const years = career.seasons.filter((s) => s.races > 0).map((s) => s.year);
  if (!years.length) return null;
  return { from: Math.min(...years), to: Math.max(...years) };
}

/** Luminância relativa (WCAG) de um hex `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/**
 * Cor do fundo do heading: a pintura da equipe na temporada (curadoria por época) ou, sem ela, a cor do escudo.
 * Pintura clara demais para o texto branco (a Williams branca e verde da Saudia) usa a secundária quando ela é
 * mais escura; senão o fundo escurece a primária (`color-mix` no componente).
 */
export function heroColor(season: CareerSeason | null): string | null {
  const team = season?.teams[0];
  const livery = team?.livery;
  if (livery) {
    const light = luminance(livery.primary) > 0.6;
    if (light && livery.secondary && luminance(livery.secondary) < luminance(livery.primary))
      return livery.secondary;
    return livery.primary;
  }
  return team?.colors?.primary ?? null;
}

/** Número do carro no heading: o da temporada em destaque (o da época, nas lendas) ou o permanente. */
export function heroNumber(career: RaceCareer, season: CareerSeason | null): number | null {
  return season?.number ?? career.profile?.number ?? null;
}

/** Nome em duas linhas (primeiro nome leve, sobrenome grande): o do perfil ou, sem ele, a última palavra. */
export function nameParts(career: RaceCareer, name: string): { first: string; last: string } {
  if (career.profile?.last_name) return { first: career.profile.first_name, last: career.profile.last_name };
  const i = name.trim().lastIndexOf(' ');
  return i > 0 ? { first: name.slice(0, i), last: name.slice(i + 1) } : { first: '', last: name };
}
