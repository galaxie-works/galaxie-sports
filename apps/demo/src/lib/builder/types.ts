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
  WidgetShopConfig,
  WidgetShopStore,
  WidgetTheme,
} from '@galaxie/db/widgets';

/** Entidade que serve de padrão para um widget (vira `defaults.competitionId/teamId/eventId/personId`). */
export type WidgetEntityType = 'competition' | 'team' | 'event' | 'person';

/** Tema da marca como vai para o navegador (lista do editor e da aba Temas). */
export interface BrandThemeItem {
  id: string;
  name: string;
  theme: WidgetTheme;
  /** Widgets ativos que seguem o tema. */
  widgetCount: number;
}

/** Loja do Shopping que o cliente pode ligar no widget (só o que a tela precisa; credenciais nunca saem). */
export interface ShopStoreChoice {
  id: string;
  name: string;
  country: string;
  network: string;
  /** Caminhos que a Galaxie libera para clientes nesta loja (#916). */
  clientPaths: ('client_code' | 'subnetwork')[];
}
