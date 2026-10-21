import type { EventCore } from '../context/event-core.js';
import type { AgentLocale } from '../guardrails/index.js';

/**
 * Amostras para testes: jogo de volta Palmeiras × Corinthians (ida 1 × 2 para o Palmeiras, como
 * visitante), o exemplo de docs/07 §2.3, e textos fiéis por locale.
 */
export function sampleCore(overrides: Partial<EventCore> = {}): EventCore {
  return {
    id: '00000000-0000-7000-8000-000000000001',
    sport: 'football',
    status: 'scheduled',
    statusDetail: 'NS',
    startsAt: new Date('2026-10-28T23:30:00Z'),
    score: null,
    competition: {
      id: '00000000-0000-7000-8000-0000000000c1',
      slug: 'conmebol-libertadores',
      name: 'CONMEBOL Libertadores',
      tier: 1,
      labels: { 'pt-BR': 'Libertadores', es: 'Libertadores' },
    },
    season: { id: '00000000-0000-7000-8000-0000000000s1', year: 2026, label: '2026' },
    stage: {
      id: '00000000-0000-7000-8000-0000000000e1',
      kind: 'quarter_final',
      name: { 'pt-BR': 'Quartas de final', es: 'Cuartos de final', en: 'Quarter-finals' },
      providerLabel: 'Quarter-finals',
    },
    venue: { name: 'Allianz Parque', city: 'São Paulo' },
    derby: null,
    home: { id: 'home-id', side: 'home', name: 'Palmeiras', shortName: 'PAL', aliases: [], labels: {} },
    away: { id: 'away-id', side: 'away', name: 'Corinthians', shortName: 'COR', aliases: [], labels: {} },
    ...overrides,
  };
}

const ES =
  'Palmeiras ganó la ida 2 a 1 y avanza con cualquier victoria o empate. ' +
  'Corinthians necesita ganar por dos goles para avanzar directo; si gana por uno, la serie se define por penales.';

/** Textos fiéis ao cenário da amostra (passam no validador). */
export const GOOD_SCENARIO: Record<AgentLocale, string[]> = {
  'pt-BR': [
    'O Palmeiras venceu a ida por 2 a 1 e avança com qualquer vitória ou empate.',
    'O Corinthians precisa vencer por dois gols de diferença para avançar direto; vitória por um gol leva a decisão aos pênaltis.',
  ],
  'es-AR': ES.split(/(?<=\.) /),
  'es-MX': ES.split(/(?<=\.) /),
  'es-CO': ES.split(/(?<=\.) /),
  'es-CL': ES.split(/(?<=\.) /),
  'es-PE': ES.split(/(?<=\.) /),
  'es-UY': ES.split(/(?<=\.) /),
  'es-EC': ES.split(/(?<=\.) /),
};

export function llmTexts(map: Partial<Record<AgentLocale, string[]>>, locales?: readonly string[]) {
  return {
    texts: Object.entries(map)
      .filter(([l]) => !locales || locales.includes(l))
      .map(([locale, sentences]) => ({ locale, sentences })),
  };
}

/** Locales pedidos numa requisição do writer (lidos da mensagem do usuário). */
export function requestedLocales(content: string): string[] {
  return /Locales: ([^\n]+)/.exec(content)?.[1]?.split(', ') ?? [];
}
