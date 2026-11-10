/**
 * Pedido para o sino buscar a caixa de entrada agora (no navegador). Quem gera avisos na própria tela (o "Verificar
 * agora" do painel) dispara este evento, e o `NotificationsProvider` atualiza sem esperar a próxima olhada.
 */
export const INBOX_REFRESH_EVENT = 'galaxie:inbox-refresh';

export function requestInboxRefresh(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(INBOX_REFRESH_EVENT));
}
