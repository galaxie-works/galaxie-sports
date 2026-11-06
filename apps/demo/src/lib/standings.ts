import { standingsZoneLabel, standingsZoneTone, type StandingsZoneTone } from '@galaxie/widgets';

/** Aproveitamento do futebol americano: (vitórias + ½ empate) ÷ jogos, no formato ".765" (1.000 invicto). */
export function winPct(won: number, drawn: number, played: number): string {
  if (played <= 0) return '—';
  return ((won + drawn / 2) / played).toFixed(3).replace(/^0(?=\.)/, '');
}

/**
 * Cor de cada faixa da tabela, uma por degrau: vaga direta (primária), vaga pela fase prévia (céu),
 * segunda copa continental (laranja), terceira (verde), repescagem contra a queda (amarelo) e queda
 * (vermelho). Qual faixa cada zona ocupa vem de `standingsZoneTone` de `@galaxie/widgets`, o mesmo
 * classificador do widget de tabela: vale para o código das regras e para o texto livre do fornecedor de
 * qualquer campeonato.
 */
const TONE_CLASS: Record<StandingsZoneTone, string> = {
  direct: 'bg-primary',
  qualifying: 'bg-sky-400',
  second: 'bg-orange-500',
  third: 'bg-success',
  relegationPlayoff: 'bg-warning',
  relegation: 'bg-destructive',
};

/** Classe da faixa de classificação (vaga, rebaixamento…); zona desconhecida fica neutra. */
export function zoneClass(description: string | null | undefined): string {
  if (!description?.trim()) return 'bg-transparent';
  const tone = standingsZoneTone(description);
  return tone ? TONE_CLASS[tone] : 'bg-muted-foreground';
}

/** Nome da zona na legenda (o mesmo do widget): código traduzido, texto do fornecedor limpo. */
export const zoneLabel = (description: string, labels: Record<string, string>): string =>
  standingsZoneLabel(description, labels);
