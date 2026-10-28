import type { I18nText, StageKind } from '../../model.js';

/** Ordem das fases dentro da temporada (milhar) — a rodada/número entra nas unidades. */
const PHASE_RANK: Readonly<Record<StageKind, number>> = {
  friendly: 0,
  qualifying: 1,
  regular: 2,
  league_phase: 2,
  group: 2,
  other: 2,
  relegation: 3,
  playoff: 4,
  knockout_round: 5,
  round_of_128: 6,
  round_of_64: 7,
  round_of_32: 8,
  round_of_16: 9,
  quarter_final: 10,
  semi_final: 11,
  third_place: 12,
  final: 13,
  race_weekend: 2,
  fight_card: 2,
};

export interface ParsedRound {
  kind: StageKind;
  name: I18nText;
  order: number;
  /** Número da rodada ("Regular Season - 12" → 12), quando houver. */
  number: number | null;
}

function classify(prefix: string, hasNumber: boolean): StageKind {
  const p = prefix.toLowerCase().trim();
  if (/^(3rd|third) place/.test(p)) return 'third_place';
  if (p === 'final' || p === 'finals') return 'final';
  if (/^semi[- ]?finals?$/.test(p)) return 'semi_final';
  if (/^quarter[- ]?finals?$/.test(p)) return 'quarter_final';
  if (p === 'round of 16' || p === '8th finals') return 'round_of_16';
  if (p === 'round of 32' || p === '16th finals') return 'round_of_32';
  if (p === 'round of 64' || p === '32nd finals') return 'round_of_64';
  if (p === 'round of 128' || p === '64th finals') return 'round_of_128';
  if (/relegation/.test(p)) return 'relegation';
  if (/qualif|preliminary/.test(p)) return 'qualifying';
  if (/play-?offs?/.test(p)) return 'playoff';
  if (/^league (phase|stage)$/.test(p)) return 'league_phase';
  if (/group/.test(p)) return 'group';
  if (/friendl/.test(p)) return 'friendly';
  if (/^\d+(st|nd|rd|th) round$/.test(p)) return 'knockout_round';
  if (/regular season|apertura|clausura|^rs$/.test(p)) return 'regular';
  return hasNumber ? 'regular' : 'other';
}

function withRound(base: { pt: string; es: string }, n: number | null): { pt: string; es: string } {
  return n == null ? base : { pt: `${base.pt} · Rodada ${n}`, es: `${base.es} · Fecha ${n}` };
}

function names(
  kind: StageKind,
  prefix: string,
  n: number | null,
  ordinal: number | null,
): {
  pt: string;
  es: string;
} {
  switch (kind) {
    case 'regular':
      if (/^regular season$|^rs$/i.test(prefix))
        return n == null
          ? { pt: 'Fase regular', es: 'Fase regular' }
          : { pt: `Rodada ${n}`, es: `Fecha ${n}` };
      return withRound({ pt: prefix, es: prefix }, n);
    case 'league_phase':
      return withRound({ pt: 'Fase de liga', es: 'Fase de liga' }, n);
    case 'group': {
      const g = /group\s+([a-z0-9]+)/i.exec(prefix)?.[1];
      const base =
        g && g.toLowerCase() !== 'stage'
          ? { pt: `Grupo ${g.toUpperCase()}`, es: `Grupo ${g.toUpperCase()}` }
          : { pt: 'Fase de grupos', es: 'Fase de grupos' };
      return withRound(base, n);
    }
    case 'qualifying':
      if (ordinal != null) return { pt: `${ordinal}ª fase preliminar`, es: `${ordinal}ª fase previa` };
      return withRound({ pt: 'Fase preliminar', es: 'Fase previa' }, n);
    case 'relegation':
      return withRound({ pt: 'Fase de rebaixamento', es: 'Fase por la permanencia' }, n);
    case 'playoff':
      return withRound({ pt: 'Playoffs', es: 'Playoffs' }, n);
    case 'knockout_round':
      return { pt: `${ordinal ?? n ?? ''}ª fase`.trim(), es: `${ordinal ?? n ?? ''}ª ronda`.trim() };
    case 'round_of_128':
      return { pt: '64 avos de final', es: '64avos de final' };
    case 'round_of_64':
      return { pt: '32 avos de final', es: '32avos de final' };
    case 'round_of_32':
      return { pt: '16 avos de final', es: 'Dieciseisavos de final' };
    case 'round_of_16':
      return { pt: 'Oitavas de final', es: 'Octavos de final' };
    case 'quarter_final':
      return { pt: 'Quartas de final', es: 'Cuartos de final' };
    case 'semi_final':
      return { pt: 'Semifinal', es: 'Semifinales' };
    case 'third_place':
      return { pt: 'Disputa do 3º lugar', es: 'Tercer puesto' };
    case 'final':
      return { pt: 'Final', es: 'Final' };
    case 'friendly':
      return { pt: 'Amistosos', es: 'Amistosos' };
    case 'race_weekend':
      return { pt: prefix, es: prefix };
    default:
      return withRound({ pt: prefix, es: prefix }, n);
  }
}

/**
 * Traduz o texto de rodada da api-sports ("Regular Season - 12", "Group B - 3", "Round of 16",
 * "2nd Preliminary Round"...) em fase canônica (`core.stage.kind`), nome localizado e ordem.
 */
/** Fases de mata-mata que podem vir depois do nome do torneio ("Apertura - Quarter-finals"). */
const TOURNAMENT_KNOCKOUT: ReadonlySet<StageKind> = new Set([
  'playoff',
  'round_of_32',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'third_place',
  'final',
]);

export function parseRound(label: string): ParsedRound {
  // torneio curto com mata-mata próprio (Liguilla da Liga MX, playoffs do Apertura argentino): o mata-mata
  // vem depois do nome do torneio; sem isso, "Apertura - Quarter-finals" viraria rodada de pontos corridos
  const knockout = /^(.+?)\s+-\s+([^\d].*)$/.exec(label.trim());
  if (knockout) {
    const kind = classify(knockout[2]!, false);
    if (TOURNAMENT_KNOCKOUT.has(kind)) {
      const n = names(kind, knockout[2]!.trim(), null, null);
      const tournament = knockout[1]!.trim();
      return {
        kind,
        name: { 'pt-BR': `${tournament} · ${n.pt}`, es: `${tournament} · ${n.es}`, en: label },
        order: PHASE_RANK[kind] * 1000,
        number: null,
      };
    }
  }
  const m = /^(.*?)\s+-\s+(\d+)$/.exec(label.trim());
  const prefix = (m?.[1] ?? label).trim();
  const number = m ? Number(m[2]) : null;
  const ordinalMatch = /(\d+)(st|nd|rd|th)\b/i.exec(prefix);
  const ordinal = ordinalMatch ? Number(ordinalMatch[1]) : null;
  const kind = classify(prefix, number != null);
  const n = names(kind, prefix, number, ordinal);
  return {
    kind,
    name: { 'pt-BR': n.pt, es: n.es, en: label },
    order: PHASE_RANK[kind] * 1000 + (number ?? ordinal ?? 0),
    number,
  };
}
