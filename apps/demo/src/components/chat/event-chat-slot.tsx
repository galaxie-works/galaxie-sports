import { MessagesSquare } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/reui/alert';
import { isStaffRole } from '@/lib/auth/roles';
import { readClientContext } from '@/lib/client/session';
import { demoKeyAccess } from '@/lib/galaxie/demo-modules';
import { getI18n } from '@/lib/i18n/server';
import { fill } from '@/lib/i18n/text';

import { EventLiveChat } from './event-live-chat';
import { OpenDemoPlans } from './open-demo-plans';

/**
 * Lugar do chat ao vivo na página do jogo (#1389). A decisão sai no servidor, antes de montar o widget: o chat só
 * aparece quando a chave da demo (o tenant com que o widget fala com a API) tem o módulo `live_chat`. Sem o módulo, a
 * API devolveria 403 e o widget mostraria o texto de integração; aqui o chat simplesmente não aparece, e a equipe
 * Galaxie (quem abre Ajustes) vê um aviso discreto que leva a Planos e módulos do tenant da chave. Sem resposta da
 * API, nada.
 */
export async function EventChatSlot({ eventId, market }: { eventId: string; market?: string | undefined }) {
  const access = await demoKeyAccess();
  if (access?.modules.includes('live_chat')) return <EventLiveChat eventId={eventId} market={market} />;
  // a API não respondeu: não dá para dizer que o módulo está desligado
  if (!access) return null;
  const ctx = await readClientContext();
  if (!ctx || !isStaffRole(ctx.role)) return null;
  const { t } = await getI18n();
  const T = t.event.chat.moduleOff;
  // o botão só aparece quando dá para pôr o tenant da chave em foco (Planos e módulos age sobre o tenant em foco)
  const tenant = ctx.tenants.find((x) => x.id === access.tenantId);
  return (
    <Alert variant="info" role="status" data-chat-module="off">
      <MessagesSquare aria-hidden />
      <AlertTitle>{T.title}</AlertTitle>
      <AlertDescription>
        <p>{fill(T.description, { tenant: tenant?.name ?? access.tenantName })}</p>
        {tenant ? (
          <OpenDemoPlans
            tenant={{ id: tenant.id, name: tenant.name, isGalaxie: tenant.isGalaxie }}
            focused={ctx.tenant?.id === tenant.id}
            label={T.action}
          />
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
