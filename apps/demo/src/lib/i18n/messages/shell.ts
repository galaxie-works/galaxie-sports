/** Moldura do app: sidebar, menu do usuário, cabeçalho/trilha, estado vazio e seletor de idioma. */
import { defineMessages } from '../define';

export default defineMessages(
  {
    sidebar: {
      sports: 'Esportes',
      countries: 'Países',
      docs: 'Documentação',
      client: 'Cliente',
      toggle: 'Abrir ou fechar {label}',
    },
    userMenu: {
      admin: 'Admin',
      guest: 'Convidado',
      client: 'Cliente',
      clientPanel: 'Painel do cliente',
      users: 'Usuários e convites',
      operations: 'Ajustes',
      language: 'Idioma',
      signOut: 'Sair',
      fanProfile: 'Perfil de torcedor',
    },
    fanProfile: {
      title: 'Perfil de torcedor',
      description:
        'Com ele, a demo entra nos recursos do torcedor (chat, bolão) como um site cliente faria. Não pedimos data de nascimento.',
      nickname: 'Apelido',
      nicknameHint: 'É o que aparece para os outros torcedores. Não use seu nome completo nem e-mail.',
      ageBand: 'Faixa etária',
      ageBandHint:
        'De 13 a 17 anos, só leitura e palpites; abaixo de 13, os recursos sociais ficam fechados.',
      country: 'País',
      choose: 'Escolha',
      bands: { under13: 'Menos de 13 anos', '13_17': 'De 13 a 17 anos', '18plus': '18 anos ou mais' },
      invalid: {
        nickname: 'Use de 2 a 32 caracteres, sem e-mail.',
        ageBand: 'Escolha a faixa etária.',
        country: 'Escolha o país.',
      },
      session: 'Sua sessão terminou. Entre de novo.',
      rejected: 'Esse apelido não é permitido. Escolha outro.',
      unavailable: 'Não foi possível salvar agora. Tente de novo.',
      cancel: 'Cancelar',
      save: 'Salvar',
    },
    trail: {
      backTo: 'Voltar para {label}',
    },
    empty: {
      title: 'Nada por aqui ainda',
      description: 'Ainda não há dados para mostrar. Avisaremos quando houver novidade.',
      underConstruction: 'Em construção',
    },
    language: {
      label: 'Idioma',
      changing: 'Trocando o idioma…',
    },
    meta: {
      description: 'Demonstração da API Galaxie Sports: agenda, ao vivo, contexto e onde assistir.',
    },
  },
  {
    en: {
      sidebar: {
        sports: 'Sports',
        countries: 'Countries',
        docs: 'Documentation',
        client: 'Client',
        toggle: 'Expand or collapse {label}',
      },
      userMenu: {
        admin: 'Admin',
        guest: 'Guest',
        client: 'Client',
        clientPanel: 'Client panel',
        users: 'Users and invites',
        operations: 'Settings',
        language: 'Language',
        signOut: 'Sign out',
        fanProfile: 'Fan profile',
      },
      fanProfile: {
        title: 'Fan profile',
        description:
          'With it, the demo joins the fan features (chat, prediction pool) the way a client site would. We never ask for a date of birth.',
        nickname: 'Nickname',
        nicknameHint: "It's what other fans see. Don't use your full name or email.",
        ageBand: 'Age band',
        ageBandHint: '13 to 17: read and predict only; under 13, the social features stay closed.',
        country: 'Country',
        choose: 'Choose',
        bands: { under13: 'Under 13', '13_17': '13 to 17', '18plus': '18 or older' },
        invalid: {
          nickname: 'Use 2 to 32 characters, no email.',
          ageBand: 'Choose the age band.',
          country: 'Choose the country.',
        },
        session: 'Your session ended. Sign in again.',
        rejected: "That nickname isn't allowed. Pick another one.",
        unavailable: "Couldn't save right now. Try again.",
        cancel: 'Cancel',
        save: 'Save',
      },
      trail: {
        backTo: 'Back to {label}',
      },
      empty: {
        title: 'Nothing here yet',
        description: "There's no data to show yet. We'll let you know when something comes up.",
        underConstruction: 'Under construction',
      },
      language: {
        label: 'Language',
        changing: 'Switching language…',
      },
      meta: {
        description: 'Galaxie Sports API demo: schedule, live, context and where to watch.',
      },
    },
    'es-AR': {
      sidebar: {
        sports: 'Deportes',
        countries: 'Países',
        docs: 'Documentación',
        client: 'Cliente',
        toggle: 'Abrir o cerrar {label}',
      },
      userMenu: {
        admin: 'Admin',
        guest: 'Invitado',
        client: 'Cliente',
        clientPanel: 'Panel del cliente',
        users: 'Usuarios e invitaciones',
        operations: 'Ajustes',
        language: 'Idioma',
        signOut: 'Cerrar sesión',
        fanProfile: 'Perfil de hincha',
      },
      fanProfile: {
        title: 'Perfil de hincha',
        description:
          'Con él, la demo entra en las funciones del hincha (chat, prode) como lo haría un sitio cliente. No pedimos fecha de nacimiento.',
        nickname: 'Apodo',
        nicknameHint: 'Es lo que ven los otros hinchas. No uses tu nombre completo ni tu e-mail.',
        ageBand: 'Franja de edad',
        ageBandHint:
          'De 13 a 17 años, solo lectura y pronósticos; por debajo de 13, las funciones sociales quedan cerradas.',
        country: 'País',
        choose: 'Elegí',
        bands: { under13: 'Menos de 13 años', '13_17': 'De 13 a 17 años', '18plus': '18 años o más' },
        invalid: {
          nickname: 'Usá de 2 a 32 caracteres, sin e-mail.',
          ageBand: 'Elegí la franja de edad.',
          country: 'Elegí el país.',
        },
        session: 'Tu sesión terminó. Volvé a entrar.',
        rejected: 'Ese apodo no está permitido. Elegí otro.',
        unavailable: 'No se pudo guardar ahora. Probá de nuevo.',
        cancel: 'Cancelar',
        save: 'Guardar',
      },
      trail: {
        backTo: 'Volver a {label}',
      },
      empty: {
        title: 'Todavía no hay nada acá',
        description: 'Todavía no hay datos para mostrar. Te avisamos cuando haya novedades.',
        underConstruction: 'En construcción',
      },
      language: {
        label: 'Idioma',
        changing: 'Cambiando el idioma…',
      },
      meta: {
        description: 'Demo de la API de Galaxie Sports: agenda, en vivo, contexto y dónde ver.',
      },
    },
  },
);
