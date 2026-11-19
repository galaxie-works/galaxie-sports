import { isStaffRole } from '@/lib/auth/roles';

/**
 * As ações do painel do Chat ao vivo valem neste tenant? Para o cliente, só com o módulo `live_chat` (sem ele, a página
 * mostra "Módulo fora do plano"). A equipe Galaxie entra em qualquer tenant para corrigir, configurar e monitorar
 * (regra do dono, #1392).
 */
export const hasLiveChat = (ctx: { role: string; tenant: { modules: readonly string[] } }): boolean =>
  isStaffRole(ctx.role) || ctx.tenant.modules.includes('live_chat');
