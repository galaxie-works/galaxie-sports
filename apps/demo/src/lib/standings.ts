/** Aproveitamento do futebol americano: (vitórias + ½ empate) ÷ jogos, no formato ".765" (1.000 invicto). */
export function winPct(won: number, drawn: number, played: number): string {
  if (played <= 0) return '—';
  return ((won + drawn / 2) / played).toFixed(3).replace(/^0(?=\.)/, '');
}
