/**
 * Tipos de widgets e chaves publicáveis, de `@galaxie/db` (só tipos: este módulo serve também ao
 * navegador, sem levar o cliente do banco junto).
 */
import type { WidgetTheme } from '@galaxie/db/widgets';

export type {
  PublishableKeySummary as PublishableKey,
  Widget,
  WidgetBrandTheme,
  WidgetBrandThemeSummary,
  WidgetConfig,
  WidgetDefaults,
  WidgetKind,
  WidgetTheme,
} from '@galaxie/db/widgets';

/** Entidade que serve de padrão para um widget (vira `defaults.competitionId/teamId/eventId`). */
export type WidgetEntityType = 'competition' | 'team' | 'event';

/** Tema da marca como vai para o navegador (lista do editor e da aba Temas). */
export interface BrandThemeItem {
  id: string;
  name: string;
  theme: WidgetTheme;
  /** Widgets ativos que seguem o tema. */
  widgetCount: number;
}
