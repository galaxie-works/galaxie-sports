import type { CompetitionRules, ZoneKind } from '../config/types.js';
import type { Stake, StakeFamily } from './codes.js';

/**
 * Sinais de jogo decisivo do score de importância (docs/06 §3), derivados dos stakes da tabela.
 * Mesmos valores de `DecisiveFlag` em `@galaxie/providers` (o pacote de regras não depende dele).
 */
export type StakeDecisiveFlag = 'title' | 'relegation' | 'elimination' | 'qualification';

/**
 * Família → sinal. Ficam de fora o que já está resolvido (campeão, rebaixado, eliminado ou classificado
 * matematicamente, salvo do rebaixamento): nada mais está em jogo para aquele time.
 */
const FAMILY_FLAG: Partial<Record<StakeFamily, StakeDecisiveFlag | 'zone'>> = {
  // título
  decides_title: 'title',
  clinches_title_with_draw: 'title',
  clinches_title_with_win: 'title',
  can_clinch_title: 'title',
  in_title_race: 'title',
  // rebaixamento
  relegated_unless_wins: 'relegation',
  relegated_if_loses: 'relegation',
  can_be_relegated: 'relegation',
  at_risk_of_relegation: 'relegation',
  secures_safety_with_draw: 'relegation',
  secures_safety_with_win: 'relegation',
  can_secure_safety: 'relegation',
  // eliminação em fase de grupos / fase de liga
  eliminated_unless_wins: 'elimination',
  eliminated_if_loses: 'elimination',
  can_be_eliminated: 'elimination',
  at_risk_of_elimination: 'elimination',
  // vagas: o tipo da zona do regulamento decide (vaga, acesso, playoff, rebaixamento)
  clinches_zone_with_draw: 'zone',
  clinches_zone_with_win: 'zone',
  can_clinch_zone: 'zone',
  can_qualify_for_zone: 'zone',
};

const ZONE_FLAG: Record<ZoneKind, StakeDecisiveFlag> = {
  qualification: 'qualification',
  promotion: 'qualification',
  playoff: 'qualification',
  relegation_playoff: 'relegation',
  relegation: 'relegation',
  elimination: 'elimination',
};

const ORDER: readonly StakeDecisiveFlag[] = ['title', 'relegation', 'elimination', 'qualification'];

/**
 * Sinais decisivos de uma lista de stakes (qualquer lado), sem repetição e em ordem estável.
 * Zona desconhecida no regulamento conta como vaga (`qualification`).
 */
export function decisiveFlagsFromStakes(
  stakes: readonly Stake[],
  rules: Pick<CompetitionRules, 'league'> | null,
): StakeDecisiveFlag[] {
  const out = new Set<StakeDecisiveFlag>();
  for (const s of stakes) {
    const flag = FAMILY_FLAG[s.family];
    if (!flag) continue;
    if (flag !== 'zone') {
      out.add(flag);
      continue;
    }
    const kind = rules?.league?.zones.find((z) => z.id === s.params?.zone)?.kind;
    out.add(kind ? ZONE_FLAG[kind] : 'qualification');
  }
  return ORDER.filter((f) => out.has(f));
}
