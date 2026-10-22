/**
 * Stakes da partida pelo motor de regras. A implementação mora em `@galaxie/rules/db` (compartilhada com
 * o recálculo da importância no ingestor); aqui só o reexport para o Cenário.
 */
export {
  computeEventStakes,
  KNOCKOUT_STAGE_KINDS,
  LEAGUE_STAGE_KINDS,
  StakesCache,
  type EventStakes,
  type KnockoutContext,
  type LeagueContext,
  type StakesEventRef,
  type StakesOptions,
} from '@galaxie/rules/db';
