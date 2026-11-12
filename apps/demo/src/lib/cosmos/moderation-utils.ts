/** Regras puras da moderação da Cosmos para a tela (sem banco): as mesmas que o servidor usa para validar (#997). */
export {
  AUTONOMY_STEPS,
  HIDDEN_NOTICE_MAX,
  LOCKED_CATEGORIES,
  MODERATION_ACTIONS,
  MODERATION_CATEGORIES,
  MODERATION_FEATURES,
  MODERATION_LEVEL_MAX,
  maxStepFor,
  stepAllowed,
  type AutonomyStep,
  type ModerationAction,
  type ModerationConfig,
  type ModerationLevel,
} from '@galaxie/cosmos/moderation-rules';
export { TENANT_ROLES } from '@galaxie/engage';

/** Tamanho máximo da mensagem do "testar com uma mensagem" (#999). */
export const PREVIEW_MAX = 2000;
export { CONTENT_KINDS, type ContentKind } from '@galaxie/cosmos/moderation-engine';
