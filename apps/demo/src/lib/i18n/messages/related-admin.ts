/** Ajustes → Vídeos relacionados: bloqueio dos canais nos vídeos relacionados (vitrine e pesquisa). */
import { defineMessages } from '../define';

export default defineMessages(
  {
    meta: { title: 'Vídeos relacionados' },
    page: {
      title: 'Vídeos relacionados',
      description:
        'Canais dos vídeos relacionados. Quando o player do YouTube recusa um vídeo (embed bloqueado pelo dono do conteúdo, removido ou privado), ele sai da vitrine; com {threshold} recusas, o canal inteiro sai. Aqui você bloqueia um canal na mão ou libera um que o automático tirou. O Onde Assistir não muda.',
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
      refused: 'Recusas do player',
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
      'Apagar as {count} recusas do canal? Os vídeos voltam à vitrine e o automático recomeça a contar.',
    saved: 'Canal atualizado. {events} jogos avisados.',
    cleared: '{count} recusas apagadas.',
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
          'Channels of the related videos. When the YouTube player refuses a video (embed blocked by the content owner, removed or private), it leaves the showcase; after {threshold} refusals, the whole channel leaves. Here you block a channel by hand or release one the automatic rule removed. Where to watch does not change.',
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
        refused: 'Player refusals',
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
        'Delete the {count} refusals of this channel? The videos return to the showcase and the automatic rule starts counting again.',
      saved: 'Channel updated. {events} games notified.',
      cleared: '{count} refusals deleted.',
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
          'Canales de los videos relacionados. Cuando el reproductor de YouTube rechaza un video (embed bloqueado por el dueño del contenido, eliminado o privado), sale de la vitrina; con {threshold} rechazos, sale el canal entero. Acá bloqueás un canal a mano o liberás uno que sacó la regla automática. Dónde ver no cambia.',
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
        refused: 'Rechazos del reproductor',
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
        '¿Borrar los {count} rechazos del canal? Los videos vuelven a la vitrina y la regla automática vuelve a contar.',
      saved: 'Canal actualizado. {events} partidos avisados.',
      cleared: '{count} rechazos borrados.',
      empty: 'Ningún canal con videos relacionados.',
      errors: {
        invalid: 'Canal inválido.',
        generic: 'No se pudo guardar. Probá de nuevo.',
      },
    },
  },
);
