/** Ajustes → Vídeos relacionados: bloqueio dos canais nos vídeos relacionados (vitrine e pesquisa). */
import { defineMessages } from '../define';

export default defineMessages(
  {
    meta: { title: 'Vídeos relacionados' },
    page: {
      title: 'Vídeos relacionados',
      description:
        'Canais dos vídeos relacionados. Quando o player do YouTube recusa um vídeo (embed bloqueado pelo dono do conteúdo, removido ou privado), ele sai na hora da vitrine do cliente que relatou (na demo, para todos os usuários da demo) e da de todos quando outro cliente confirma; com {threshold} vídeos recusados, o canal inteiro sai do mesmo jeito. Aqui você bloqueia um canal na mão, libera um que o automático tirou ou limpa as recusas (confirmadas e relatadas). O Onde Assistir não muda.',
    },
    filters: {
      search: 'Buscar canal',
      all: 'Todos',
      blocked: 'Bloqueados',
      refused: 'Com recusas',
    },
    columns: {
      channel: 'Canal',
      published: 'Na vitrine',
      refused: 'Recusas confirmadas',
      reported: 'Relatadas por cliente',
      status: 'Estado',
      control: 'Controle',
    },
    status: {
      active: 'Ativo',
      autoBlocked: 'Bloqueado (automático)',
      manualBlocked: 'Bloqueado (manual)',
      allowed: 'Liberado (manual)',
    },
    modes: {
      auto: 'Automático',
      block: 'Bloquear',
      allow: 'Liberar',
    },
    lastRefused: 'última em {date}',
    ruleBy: 'por {who} em {date}',
    clear: 'Limpar recusas',
    clearConfirm:
      'Apagar as recusas de {count} vídeos do canal (confirmadas e relatadas por cliente)? Os vídeos voltam à vitrine de todos e o automático recomeça a contar.',
    saved: 'Canal atualizado. {events} jogos avisados.',
    cleared: 'Recusas de {count} vídeos apagadas.',
    empty: 'Nenhum canal com vídeos relacionados.',
    errors: {
      invalid: 'Canal inválido.',
      generic: 'Não deu para salvar. Tente de novo.',
    },
  },
  {
    en: {
      meta: { title: 'Related videos' },
      page: {
        title: 'Related videos',
        description:
          'Channels of the related videos. When the YouTube player refuses a video (embed blocked by the content owner, removed or private), it leaves the showcase of the client that reported it right away (in the demo, for every demo user) and everyone else’s once another client confirms; after {threshold} refused videos, the whole channel leaves the same way. Here you block a channel by hand, release one the automatic rule removed or clear the refusals (confirmed and reported). Where to watch does not change.',
      },
      filters: {
        search: 'Search channel',
        all: 'All',
        blocked: 'Blocked',
        refused: 'With refusals',
      },
      columns: {
        channel: 'Channel',
        published: 'In the showcase',
        refused: 'Confirmed refusals',
        reported: 'Reported by a client',
        status: 'Status',
        control: 'Control',
      },
      status: {
        active: 'Active',
        autoBlocked: 'Blocked (automatic)',
        manualBlocked: 'Blocked (manual)',
        allowed: 'Released (manual)',
      },
      modes: {
        auto: 'Automatic',
        block: 'Block',
        allow: 'Release',
      },
      lastRefused: 'last on {date}',
      ruleBy: 'by {who} on {date}',
      clear: 'Clear refusals',
      clearConfirm:
        'Delete the refusals of {count} videos of this channel (confirmed and reported by clients)? The videos return to everyone’s showcase and the automatic rule starts counting again.',
      saved: 'Channel updated. {events} games notified.',
      cleared: 'Refusals of {count} videos deleted.',
      empty: 'No channel with related videos.',
      errors: {
        invalid: 'Invalid channel.',
        generic: 'Could not save. Try again.',
      },
    },
    'es-AR': {
      meta: { title: 'Videos relacionados' },
      page: {
        title: 'Videos relacionados',
        description:
          'Canales de los videos relacionados. Cuando el reproductor de YouTube rechaza un video (embed bloqueado por el dueño del contenido, eliminado o privado), sale en el acto de la vitrina del cliente que lo reportó (en la demo, para todos sus usuarios) y de la de todos cuando otro cliente lo confirma; con {threshold} videos rechazados, sale el canal entero de la misma forma. Acá bloqueás un canal a mano, liberás uno que sacó la regla automática o borrás los rechazos (confirmados y reportados). Dónde ver no cambia.',
      },
      filters: {
        search: 'Buscar canal',
        all: 'Todos',
        blocked: 'Bloqueados',
        refused: 'Con rechazos',
      },
      columns: {
        channel: 'Canal',
        published: 'En la vitrina',
        refused: 'Rechazos confirmados',
        reported: 'Reportados por un cliente',
        status: 'Estado',
        control: 'Control',
      },
      status: {
        active: 'Activo',
        autoBlocked: 'Bloqueado (automático)',
        manualBlocked: 'Bloqueado (manual)',
        allowed: 'Liberado (manual)',
      },
      modes: {
        auto: 'Automático',
        block: 'Bloquear',
        allow: 'Liberar',
      },
      lastRefused: 'el último el {date}',
      ruleBy: 'por {who} el {date}',
      clear: 'Borrar rechazos',
      clearConfirm:
        '¿Borrar los rechazos de {count} videos del canal (confirmados y reportados por clientes)? Los videos vuelven a la vitrina de todos y la regla automática vuelve a contar.',
      saved: 'Canal actualizado. {events} partidos avisados.',
      cleared: 'Rechazos de {count} videos borrados.',
      empty: 'Ningún canal con videos relacionados.',
      errors: {
        invalid: 'Canal inválido.',
        generic: 'No se pudo guardar. Probá de nuevo.',
      },
    },
  },
);
