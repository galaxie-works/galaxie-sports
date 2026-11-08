import { defineMessages } from '../define';

/** Kit de blocos das telas de configuração (`components/settings/`): textos comuns a todas as páginas. */
export default defineMessages(
  {
    option: {
      details: 'Detalhes de {name}',
      allows: 'O que esta opção permite?',
      locks: 'Travas',
      lockedByParent: 'Ligue a opção principal para mudar as travas.',
    },
    safety: { label: 'Nota de segurança' },
    notice: { info: 'Informação', warning: 'Atenção', error: 'Erro' },
    usage: {
      of: '{used} de {total}',
      percent: '{percent}% usado',
      unlimited: 'Sem limite',
    },
    steps: {
      progress: 'Passo {current} de {total}',
      back: 'Voltar',
      next: 'Seguir',
      finish: 'Concluir',
      cancel: 'Cancelar',
    },
    menu: {
      open: 'Abrir o menu',
    },
  },
  {
    en: {
      option: {
        details: '{name} details',
        allows: 'What does this option allow?',
        locks: 'Locks',
        lockedByParent: 'Turn the main option on to change the locks.',
      },
      safety: { label: 'Safety note' },
      notice: { info: 'Information', warning: 'Warning', error: 'Error' },
      usage: {
        of: '{used} of {total}',
        percent: '{percent}% used',
        unlimited: 'No limit',
      },
      steps: {
        progress: 'Step {current} of {total}',
        back: 'Back',
        next: 'Next',
        finish: 'Finish',
        cancel: 'Cancel',
      },
      menu: {
        open: 'Open the menu',
      },
    },
    'es-AR': {
      option: {
        details: 'Detalles de {name}',
        allows: '¿Qué permite esta opción?',
        locks: 'Trabas',
        lockedByParent: 'Activá la opción principal para cambiar las trabas.',
      },
      safety: { label: 'Nota de seguridad' },
      notice: { info: 'Información', warning: 'Atención', error: 'Error' },
      usage: {
        of: '{used} de {total}',
        percent: '{percent}% usado',
        unlimited: 'Sin límite',
      },
      steps: {
        progress: 'Paso {current} de {total}',
        back: 'Volver',
        next: 'Seguir',
        finish: 'Terminar',
        cancel: 'Cancelar',
      },
      menu: {
        open: 'Abrir el menú',
      },
    },
  },
);
