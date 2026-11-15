/**
 * Regras do painel do Chat ao vivo (#973) sem banco: quais punições a tela oferece, a duração de cada uma e a ação da
 * matriz de cargos (#1019) que cada botão exige. O servidor confere de novo a cada ação.
 *
 * A sala, para cargo e punição, é o id do jogo (`fixtureId`): é o que o cliente conhece ("a sala do jogo X") e o que
 * vai no escopo do moderador convidado.
 */
import type { TenantAction } from '@galaxie/engage';

/** Silenciar na sala: 5 min, 1 h, o jogo (3 h) e 24 h. */
export const MUTE_MINUTES = [5, 60, 180, 1_440] as const;
export type MuteMinutes = (typeof MUTE_MINUTES)[number];

/** Suspensão em todas as salas e Comunidades do cliente: 1, 7 e 30 dias. */
export const SUSPEND_DAYS = [1, 7, 30] as const;

export const AUTHOR_ACTIONS = ['mute', 'shadow_mute', 'suspend', 'ban'] as const;
export type AuthorAction = (typeof AUTHOR_ACTIONS)[number];

export const ROOM_ACTIONS = ['freeze', 'open', 'slow_mode'] as const;
export type RoomAction = (typeof ROOM_ACTIONS)[number];

/** Modo lento que a tela oferece (segundos; 0 desliga; `null` volta ao padrão do cliente). */
export const SLOW_MODE_OPTIONS = [0, 3, 10, 30, 60] as const;

export const AUTHOR_ACTION_RULE: Record<AuthorAction, TenantAction> = {
  mute: 'moderation.mute',
  shadow_mute: 'moderation.shadow_mute',
  suspend: 'moderation.suspend',
  ban: 'moderation.ban',
};

/** Congelar, reabrir e modo lento são ações da sala, do mesmo cargo do modo lento. */
export const ROOM_ACTION_RULE: TenantAction = 'moderation.slow_mode';

export const isAuthorAction = (v: unknown): v is AuthorAction =>
  typeof v === 'string' && (AUTHOR_ACTIONS as readonly string[]).includes(v);

/** Duração em segundos da punição pedida, ou `null` quando a duração não é das que a tela oferece. */
export function authorActionSeconds(action: AuthorAction, amount: number | undefined): number | null {
  if (action === 'ban') return 0;
  if (action === 'suspend')
    return (SUSPEND_DAYS as readonly number[]).includes(amount ?? -1) ? amount! * 86_400 : null;
  // silêncio, visível ou oculto: os mesmos prazos (o oculto exige prazo, ADR 0003)
  return (MUTE_MINUTES as readonly number[]).includes(amount ?? -1) ? amount! * 60 : null;
}

/** Nível da Escada (#997) e se é o silêncio oculto. */
export function sanctionOf(action: AuthorAction): { level: 'mute' | 'suspension' | 'ban'; hidden: boolean } {
  switch (action) {
    case 'mute':
      return { level: 'mute', hidden: false };
    case 'shadow_mute':
      return { level: 'mute', hidden: true };
    case 'suspend':
      return { level: 'suspension', hidden: false };
    case 'ban':
      return { level: 'ban', hidden: false };
  }
}

export const isSlowModeOption = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && (SLOW_MODE_OPTIONS as readonly number[]).includes(v));

/** Nome curto do jogo para a lista ("Palmeiras x Botafogo"); sem os times, o id encurtado. */
export const roomTitle = (r: { home: string | null; away: string | null; fixtureId: string }): string =>
  r.home && r.away ? `${r.home} x ${r.away}` : `#${r.fixtureId.slice(0, 8)}`;
