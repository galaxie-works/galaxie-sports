/**
 * Tipos de widgets e chaves publicáveis, de `@galaxie/db` (só tipos: este módulo serve também ao
 * navegador, sem levar o cliente do banco junto).
 */
export type {
  PublishableKeySummary as PublishableKey,
  Widget,
  WidgetConfig,
  WidgetDefaults,
  WidgetKind,
  WidgetTheme,
} from '@galaxie/db/widgets';

/** Entidade que serve de padrão para um widget (vira `defaults.competitionId/teamId/eventId`). */
export type WidgetEntityType = 'competition' | 'team' | 'event';
