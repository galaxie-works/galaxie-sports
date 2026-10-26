/** Aproveitamento do futebol americano: (vitórias + ½ empate) ÷ jogos, no formato ".765" (1.000 invicto). */
export function winPct(won: number, drawn: number, played: number): string {
  if (played <= 0) return '—';
  return ((won + drawn / 2) / played).toFixed(3).replace(/^0(?=\.)/, '');
}

/**
 * Cor de cada zona da tabela, uma por degrau: vaga direta (primária), vaga pela fase prévia (céu),
 * segunda copa continental (laranja), terceira (verde), repescagem contra a queda (amarelo) e queda (vermelho).
 */
const ZONE_TONE: Record<string, string> = {
  libertadores: 'bg-primary',
  libertadores_group_stage: 'bg-primary',
  champions_league: 'bg-primary',
  round_of_16: 'bg-primary',
  promotion: 'bg-primary',
  libertadores_qualifying: 'bg-sky-400',
  champions_league_qualifying: 'bg-sky-400',
  knockout_playoff: 'bg-sky-400',
  playoff: 'bg-sky-400',
  sudamericana: 'bg-orange-500',
  sudamericana_knockout_playoff: 'bg-orange-500',
  europa_league: 'bg-orange-500',
  europa_league_knockout_playoff: 'bg-orange-500',
  conference_league: 'bg-success',
  relegation_playoff: 'bg-warning',
  relegation: 'bg-destructive',
  elimination: 'bg-destructive',
};

/**
 * Código da zona: a tabela calculada já traz o id da regra (`libertadores_group_stage`); a do fornecedor
 * traz texto livre ("Promotion - CONMEBOL Libertadores"), reduzido aqui ao código mais próximo. Uma palavra
 * só que não é código conhecido ("Rebaixamento", "Descenso") também passa pelo texto livre.
 */
function zoneCode(description: string): string {
  const d = description.trim().toLowerCase();
  if (/^[a-z0-9_]+$/.test(d) && ZONE_TONE[d]) return d;
  if (/relegation|rebaix|descenso/.test(d)) return /play/.test(d) ? 'relegation_playoff' : 'relegation';
  if (/sudamericana|sul-americana/.test(d)) return 'sudamericana';
  if (d.includes('europa')) return 'europa_league';
  if (d.includes('conference')) return 'conference_league';
  if (/libertadores|champions/.test(d) && /qualif|prelim/.test(d)) return 'libertadores_qualifying';
  if (/libertadores|champions|promotion/.test(d)) return 'libertadores';
  return d;
}

/** Classe da faixa de classificação (vaga, rebaixamento…); zona desconhecida fica neutra. */
export function zoneClass(description: string | null | undefined): string {
  if (!description?.trim()) return 'bg-transparent';
  return ZONE_TONE[zoneCode(description)] ?? 'bg-muted-foreground';
}

/** Nome da zona na legenda pelo código; o que o dicionário não conhece vira texto ("knockout_round" → "Knockout round"). */
export function zoneLabel(description: string, labels: Record<string, string>): string {
  const text = description.trim();
  const label = labels[text.toLowerCase()];
  if (label) return label;
  const words = text.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
