/** Moldura do app: sidebar, menu do usuário, cabeçalho/trilha, estado vazio e seletor de idioma. */
import { defineMessages } from '../define';

export default defineMessages(
  {
    sidebar: {
      sports: 'Esportes',
      countries: 'Países',
      docs: 'Documentação',
      client: 'Cliente',
    },
    userMenu: {
      admin: 'Admin',
      guest: 'Convidado',
      client: 'Cliente',
      clientPanel: 'Painel do cliente',
      users: 'Usuários e convites',
      operations: 'Operação',
      language: 'Idioma',
      signOut: 'Sair',
    },
    trail: {
      showFullPath: 'Mostrar o caminho completo',
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
      },
      userMenu: {
        admin: 'Admin',
        guest: 'Guest',
        client: 'Client',
        clientPanel: 'Client panel',
        users: 'Users and invites',
        operations: 'Operations',
        language: 'Language',
        signOut: 'Sign out',
      },
      trail: {
        showFullPath: 'Show the full path',
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
      },
      userMenu: {
        admin: 'Admin',
        guest: 'Invitado',
        client: 'Cliente',
        clientPanel: 'Panel del cliente',
        users: 'Usuarios e invitaciones',
        operations: 'Operación',
        language: 'Idioma',
        signOut: 'Cerrar sesión',
      },
      trail: {
        showFullPath: 'Mostrar el recorrido completo',
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
