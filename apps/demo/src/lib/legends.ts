import type { CareerSeason, Photo, RaceLegend } from '@galaxie/contracts';

import { heroColor } from './driver-hero';

/**
 * Anos dos títulos em poucas palavras: três ou mais seguidos viram faixa ("2000–2004"); dois seguidos ficam
 * listados. Schumacher → "1994, 1995, 2000–2004".
 */
export function yearRanges(years: readonly number[]): string {
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const y of sorted) {
    const run = runs.at(-1);
    if (run && y === run.at(-1)! + 1) run.push(y);
    else runs.push([y]);
  }
  return runs.flatMap((run) => (run.length >= 3 ? [`${run[0]}–${run.at(-1)}`] : run.map(String))).join(', ');
}

/**
 * Cor do card: a pintura da equipe na temporada marcante, com a mesma regra do heading do piloto (pintura clara
 * demais para o texto branco usa a secundária mais escura); sem pintura curada, a cor do escudo.
 */
export function legendColor(legend: RaceLegend): string | null {
  const team = legend.highlight?.team;
  if (!team) return null;
  return heroColor({ teams: [team] } as Pick<CareerSeason, 'teams'> as CareerSeason);
}

/** Fundo do card: a cor da equipe pura no alto (atrás do carro e do número) e escurecida embaixo, onde fica o texto. */
export function legendBackdrop(color: string | null): string {
  if (!color) return 'linear-gradient(180deg, #3f3f46 0%, #27272a 55%, #18181b 100%)';
  return `linear-gradient(180deg, ${color} 0%, color-mix(in oklab, ${color} 70%, #050505) 50%, color-mix(in oklab, ${color} 35%, #050505) 100%)`;
}

/**
 * Fotos que o carrossel mostra, para a lista de créditos logo abaixo dele (a licença pede a atribuição). Uma foto por
 * linha: o carro de uma temporada pode ser o de dois companheiros de equipe (os dois nomes vão juntos).
 */
export function legendPhotos(legends: readonly RaceLegend[]) {
  const byUrl = new Map<string, { photo: Photo; names: string[] }>();
  for (const l of legends)
    for (const photo of [l.highlight?.car, l.portrait]) {
      if (!photo?.url) continue;
      const entry = byUrl.get(photo.url) ?? { photo, names: [] };
      if (!entry.names.includes(l.name)) entry.names.push(l.name);
      byUrl.set(photo.url, entry);
    }
  return [...byUrl.values()];
}
