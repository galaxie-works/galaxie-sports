/**
 * Páginas públicas: apresentação (/sobre, e a raiz para quem não tem sessão), termos de uso e política
 * de privacidade. Texto real e indexável: é o que filtros web corporativos e buscadores leem para
 * classificar o domínio. Só no servidor (não vai ao navegador).
 */
import { defineMessages } from '../define';

export default defineMessages(
  {
    meta: {
      title: 'Galaxie Sports · API de dados esportivos para TV e streaming',
      description:
        'API B2B de dados esportivos para operadoras de TV e streaming da América Latina: agenda, resultados, ao vivo, estatísticas, onde assistir e contexto editorial em português e espanhol.',
    },
    nav: {
      home: 'Galaxie Sports, página inicial',
      logoAlt: 'Galaxie Works',
      signIn: 'Entrar',
      about: 'Sobre',
      terms: 'Termos de uso',
      privacy: 'Privacidade',
    },
    hero: {
      eyebrow: 'API B2B de dados esportivos',
      title: 'Dados esportivos para operadoras de TV e streaming da América Latina.',
      lead: 'A Galaxie Sports entrega, numa única API, a agenda, os resultados, o ao vivo, as estatísticas e onde assistir de cada jogo, com o contexto editorial que a torcida reconhece: clássicos, apelidos e o que está em jogo.',
      cta: 'Entrar na demo',
      invite: 'Acesso só por convite.',
    },
    features: {
      title: 'O que a API entrega',
      items: {
        schedule: {
          title: 'Agenda',
          body: 'Jogos dos próximos dias por esporte, competição, país e time, no fuso de cada mercado.',
        },
        results: {
          title: 'Resultados e tabelas',
          body: 'Placares finais, classificação e a campanha de cada time nas competições da temporada.',
        },
        live: {
          title: 'Ao vivo',
          body: 'Placar e minuto a minuto durante a partida: gols, cartões, substituições e outros lances.',
        },
        stats: {
          title: 'Estatísticas',
          body: 'Números do jogo, do time e do jogador, com códigos estáveis para grafismo e guias de programação.',
        },
        whereToWatch: {
          title: 'Onde assistir',
          body: 'Em que canal ou plataforma cada jogo passa, país a país.',
        },
        context: {
          title: 'Contexto editorial',
          body: 'Clássicos, apelidos, rivalidades e o que está em jogo em cada partida, na voz de cada país, com enriquecimento por inteligência artificial.',
        },
      },
    },
    sports: {
      title: 'Esportes cobertos',
      lead: 'Do futebol ao automobilismo, no mesmo formato de dados.',
      items: {
        football: 'Futebol',
        basketball: 'Basquete',
        nba: 'NBA',
        volleyball: 'Vôlei',
        handball: 'Handebol',
        hockey: 'Hóquei no gelo',
        rugby: 'Rúgbi',
        americanFootball: 'Futebol americano',
        baseball: 'Beisebol',
        afl: 'Futebol australiano (AFL)',
        mma: 'MMA',
        formula1: 'Fórmula 1',
        equestrian: 'Hipismo',
      },
    },
    markets: {
      title: 'Mercados',
      lead: 'Conteúdo em português e espanhol, com a voz e o fuso de cada país.',
    },
    audience: {
      title: 'Para quem é',
      body: 'Para operadoras de TV por assinatura, plataformas de streaming e equipes de produto, grafismo e programação que precisam de dados esportivos confiáveis em português e espanhol. É um serviço B2B: não há venda ao público final.',
    },
    access: {
      title: 'Como funciona o acesso',
      steps: {
        invite: 'O acesso é só por convite: a Galaxie Works libera cada pessoa pelo e-mail corporativo.',
        login:
          'Para entrar na demo, a pessoa informa o e-mail e recebe um código de uso único. Não há senha nem cadastro aberto.',
        api: 'A integração com a API usa uma chave por cliente, com os módulos do plano contratado.',
      },
      noAccess: 'Ainda não tem acesso? Escreva para <email>{email}</email>.',
    },
    company: {
      title: 'A empresa',
      body: 'A Galaxie Sports é um produto da Galaxie Works, empresa de tecnologia que cria soluções de software e dados para empresas.',
      site: 'Site da empresa',
      contact: 'Contato',
    },
    footer: {
      product: 'Galaxie Sports é um produto da Galaxie Works.',
    },
    legal: {
      updated: 'Atualizado em 23 de outubro de 2026',
      back: 'Voltar para a apresentação',
      terms: {
        title: 'Termos de uso',
        description: 'Condições de uso do site e da demonstração da API Galaxie Sports.',
        intro:
          'Estes termos valem para o site sports.galaxie.works e para a demonstração da API Galaxie Sports, oferecidos pela Galaxie Works. Ao entrar, você concorda com eles.',
        sections: {
          access: {
            title: 'Acesso por convite',
            body: 'O uso é restrito a pessoas convidadas, em geral profissionais de empresas clientes ou em avaliação. O convite é pessoal e não pode ser compartilhado. Ele pode ter prazo e pode ser desativado a qualquer momento.',
          },
          use: {
            title: 'Uso permitido',
            body: 'A demonstração serve para conhecer e avaliar os dados e a API. Não é permitido copiar a base em massa, automatizar o acesso às páginas, tentar burlar a autenticação nem revender o conteúdo sem contrato.',
          },
          content: {
            title: 'Conteúdo',
            body: 'Dados esportivos podem ter atrasos ou erros vindos das fontes. Textos de contexto gerados com apoio de inteligência artificial podem conter imprecisões. Marcas, escudos e nomes de competições pertencem aos seus titulares e aparecem só para identificação.',
          },
          changes: {
            title: 'Disponibilidade e mudanças',
            body: 'A demonstração pode mudar, ficar fora do ar ou ser encerrada sem aviso. Estes termos podem ser atualizados; a data no topo mostra a versão em vigor.',
          },
          contact: {
            title: 'Contato',
            body: 'Dúvidas sobre estes termos: <email>{email}</email>.',
          },
        },
      },
      privacy: {
        title: 'Política de privacidade',
        description: 'Que dados a Galaxie Sports coleta, para quê e como pedir acesso ou exclusão.',
        intro:
          'Esta política explica que dados pessoais o site sports.galaxie.works trata e por quê. Coletamos o mínimo necessário para controlar o acesso por convite.',
        sections: {
          collected: {
            title: 'O que coletamos',
            body: 'O e-mail usado no login (e o nome, quando informado no convite), o idioma escolhido, o endereço IP e o navegador de cada sessão, e registros de uso, como data, hora e páginas visitadas.',
          },
          cookies: {
            title: 'Cookies',
            body: 'Usamos só cookies necessários: o de sessão, que mantém você conectado, e os de preferência de idioma e fuso horário. Não usamos cookies de publicidade nem de rastreamento de terceiros.',
          },
          use: {
            title: 'Para que usamos',
            body: 'Para enviar o código de acesso, manter a sessão, aplicar o prazo do convite, proteger o serviço contra abuso e melhorar a demonstração.',
          },
          sharing: {
            title: 'Compartilhamento',
            body: 'Não vendemos nem alugamos dados pessoais. Eles passam só pelos fornecedores de infraestrutura que operam o serviço (hospedagem e envio de e-mail), para essa finalidade.',
          },
          retention: {
            title: 'Retenção',
            body: 'Mantemos os dados enquanto o acesso estiver ativo e pelo tempo necessário para segurança e obrigações legais. Depois, eles são apagados ou anonimizados.',
          },
          rights: {
            title: 'Seus direitos',
            body: 'Você pode pedir acesso, correção ou exclusão dos seus dados, ou o fim do seu acesso, a qualquer momento, pelo e-mail <email>{email}</email>. Atendemos de acordo com a LGPD e as demais leis de proteção de dados aplicáveis.',
          },
        },
      },
    },
  },
  {
    en: {
      meta: {
        title: 'Galaxie Sports · Sports data API for TV and streaming',
        description:
          'B2B sports data API for TV and streaming operators in Latin America: schedules, results, live data, statistics, where to watch and editorial context in Portuguese and Spanish.',
      },
      nav: {
        home: 'Galaxie Sports, home page',
        logoAlt: 'Galaxie Works',
        signIn: 'Sign in',
        about: 'About',
        terms: 'Terms of use',
        privacy: 'Privacy',
      },
      hero: {
        eyebrow: 'B2B sports data API',
        title: 'Sports data for TV and streaming operators in Latin America.',
        lead: 'Galaxie Sports delivers, through a single API, the schedule, results, live data, statistics and where to watch for every match, with the editorial context fans recognize: derbies, nicknames and what is at stake.',
        cta: 'Sign in to the demo',
        invite: 'Invitation-only access.',
      },
      features: {
        title: 'What the API delivers',
        items: {
          schedule: {
            title: 'Schedule',
            body: 'Upcoming matches by sport, competition, country and team, in each market’s time zone.',
          },
          results: {
            title: 'Results and standings',
            body: 'Final scores, standings and each team’s run in the season’s competitions.',
          },
          live: {
            title: 'Live',
            body: 'Score and play-by-play during the match: goals, cards, substitutions and other incidents.',
          },
          stats: {
            title: 'Statistics',
            body: 'Match, team and player numbers, with stable codes for on-air graphics and program guides.',
          },
          whereToWatch: {
            title: 'Where to watch',
            body: 'Which channel or platform carries each match, country by country.',
          },
          context: {
            title: 'Editorial context',
            body: 'Derbies, nicknames, rivalries and what is at stake in each match, in each country’s voice, enriched with artificial intelligence.',
          },
        },
      },
      sports: {
        title: 'Sports covered',
        lead: 'From football to motorsport, in the same data format.',
        items: {
          football: 'Football (soccer)',
          basketball: 'Basketball',
          nba: 'NBA',
          volleyball: 'Volleyball',
          handball: 'Handball',
          hockey: 'Ice hockey',
          rugby: 'Rugby',
          americanFootball: 'American football',
          baseball: 'Baseball',
          afl: 'Australian football (AFL)',
          mma: 'MMA',
          formula1: 'Formula 1',
          equestrian: 'Equestrian',
        },
      },
      markets: {
        title: 'Markets',
        lead: 'Content in Portuguese and Spanish, with each country’s voice and time zone.',
      },
      audience: {
        title: 'Who it is for',
        body: 'For pay-TV operators, streaming platforms and the product, graphics and programming teams that need reliable sports data in Portuguese and Spanish. It is a B2B service: there are no sales to end consumers.',
      },
      access: {
        title: 'How access works',
        steps: {
          invite: 'Access is by invitation only: Galaxie Works enables each person by their corporate email.',
          login:
            'To sign in to the demo, the person enters their email and receives a one-time code. There is no password and no open sign-up.',
          api: 'API integration uses one key per customer, with the modules of the contracted plan.',
        },
        noAccess: 'No access yet? Write to <email>{email}</email>.',
      },
      company: {
        title: 'The company',
        body: 'Galaxie Sports is a product of Galaxie Works, a technology company that builds software and data solutions for businesses.',
        site: 'Company website',
        contact: 'Contact',
      },
      footer: {
        product: 'Galaxie Sports is a product of Galaxie Works.',
      },
      legal: {
        updated: 'Updated on October 23, 2026',
        back: 'Back to the overview',
        terms: {
          title: 'Terms of use',
          description: 'Terms for using the Galaxie Sports website and API demo.',
          intro:
            'These terms apply to the sports.galaxie.works website and to the Galaxie Sports API demo, provided by Galaxie Works. By signing in, you agree to them.',
          sections: {
            access: {
              title: 'Invitation-only access',
              body: 'Use is restricted to invited people, usually professionals from customer companies or companies evaluating the service. Invitations are personal and cannot be shared. They may have an expiry date and can be disabled at any time.',
            },
            use: {
              title: 'Permitted use',
              body: 'The demo is for getting to know and evaluating the data and the API. Bulk copying of the database, automated access to the pages, attempts to bypass authentication and reselling the content without a contract are not allowed.',
            },
            content: {
              title: 'Content',
              body: 'Sports data may contain delays or errors from its sources. Context texts produced with the help of artificial intelligence may contain inaccuracies. Trademarks, crests and competition names belong to their owners and appear for identification only.',
            },
            changes: {
              title: 'Availability and changes',
              body: 'The demo may change, go offline or be discontinued without notice. These terms may be updated; the date at the top shows the version in force.',
            },
            contact: {
              title: 'Contact',
              body: 'Questions about these terms: <email>{email}</email>.',
            },
          },
        },
        privacy: {
          title: 'Privacy policy',
          description: 'What data Galaxie Sports collects, why, and how to request access or deletion.',
          intro:
            'This policy explains what personal data the sports.galaxie.works website processes and why. We collect the minimum needed to control invitation-only access.',
          sections: {
            collected: {
              title: 'What we collect',
              body: 'The email used to sign in (and the name, when given in the invitation), the chosen language, the IP address and browser of each session, and usage records such as date, time and pages visited.',
            },
            cookies: {
              title: 'Cookies',
              body: 'We only use necessary cookies: the session cookie, which keeps you signed in, and the language and time zone preference cookies. We do not use advertising or third-party tracking cookies.',
            },
            use: {
              title: 'How we use it',
              body: 'To send the access code, keep the session, apply the invitation’s expiry, protect the service against abuse and improve the demo.',
            },
            sharing: {
              title: 'Sharing',
              body: 'We do not sell or rent personal data. It only goes through the infrastructure providers that run the service (hosting and email delivery), for that purpose.',
            },
            retention: {
              title: 'Retention',
              body: 'We keep the data while access is active and for as long as needed for security and legal obligations. After that, it is deleted or anonymized.',
            },
            rights: {
              title: 'Your rights',
              body: 'You can request access to, correction or deletion of your data, or the end of your access, at any time, by emailing <email>{email}</email>. We handle requests under Brazil’s LGPD and other applicable data protection laws.',
            },
          },
        },
      },
    },
    'es-AR': {
      meta: {
        title: 'Galaxie Sports · API de datos deportivos para TV y streaming',
        description:
          'API B2B de datos deportivos para operadores de TV y streaming de América Latina: agenda, resultados, en vivo, estadísticas, dónde ver y contexto editorial en portugués y español.',
      },
      nav: {
        home: 'Galaxie Sports, página de inicio',
        logoAlt: 'Galaxie Works',
        signIn: 'Ingresar',
        about: 'Acerca de',
        terms: 'Términos de uso',
        privacy: 'Privacidad',
      },
      hero: {
        eyebrow: 'API B2B de datos deportivos',
        title: 'Datos deportivos para operadores de TV y streaming de América Latina.',
        lead: 'Galaxie Sports entrega, en una sola API, la agenda, los resultados, el en vivo, las estadísticas y dónde ver cada partido, con el contexto editorial que la hinchada reconoce: clásicos, apodos y lo que está en juego.',
        cta: 'Ingresar a la demo',
        invite: 'Acceso solo por invitación.',
      },
      features: {
        title: 'Qué entrega la API',
        items: {
          schedule: {
            title: 'Agenda',
            body: 'Partidos de los próximos días por deporte, competición, país y equipo, en el huso horario de cada mercado.',
          },
          results: {
            title: 'Resultados y tablas',
            body: 'Marcadores finales, posiciones y la campaña de cada equipo en las competiciones de la temporada.',
          },
          live: {
            title: 'En vivo',
            body: 'Marcador y minuto a minuto durante el partido: goles, tarjetas, cambios y otras jugadas.',
          },
          stats: {
            title: 'Estadísticas',
            body: 'Números del partido, del equipo y del jugador, con códigos estables para gráfica en pantalla y guías de programación.',
          },
          whereToWatch: {
            title: 'Dónde ver',
            body: 'En qué canal o plataforma se transmite cada partido, país por país.',
          },
          context: {
            title: 'Contexto editorial',
            body: 'Clásicos, apodos, rivalidades y lo que está en juego en cada partido, con la voz de cada país, enriquecido con inteligencia artificial.',
          },
        },
      },
      sports: {
        title: 'Deportes cubiertos',
        lead: 'Del fútbol al automovilismo, en el mismo formato de datos.',
        items: {
          football: 'Fútbol',
          basketball: 'Básquet',
          nba: 'NBA',
          volleyball: 'Vóley',
          handball: 'Handball',
          hockey: 'Hockey sobre hielo',
          rugby: 'Rugby',
          americanFootball: 'Fútbol americano',
          baseball: 'Béisbol',
          afl: 'Fútbol australiano (AFL)',
          mma: 'MMA',
          formula1: 'Fórmula 1',
          equestrian: 'Hípica',
        },
      },
      markets: {
        title: 'Mercados',
        lead: 'Contenido en portugués y español, con la voz y el huso horario de cada país.',
      },
      audience: {
        title: 'Para quién es',
        body: 'Para operadores de TV paga, plataformas de streaming y equipos de producto, gráfica y programación que necesitan datos deportivos confiables en portugués y español. Es un servicio B2B: no hay venta al público final.',
      },
      access: {
        title: 'Cómo funciona el acceso',
        steps: {
          invite:
            'El acceso es solo por invitación: Galaxie Works habilita a cada persona por su e-mail corporativo.',
          login:
            'Para ingresar a la demo, la persona escribe su e-mail y recibe un código de un solo uso. No hay contraseña ni registro abierto.',
          api: 'La integración con la API usa una clave por cliente, con los módulos del plan contratado.',
        },
        noAccess: '¿Todavía sin acceso? Escribinos a <email>{email}</email>.',
      },
      company: {
        title: 'La empresa',
        body: 'Galaxie Sports es un producto de Galaxie Works, empresa de tecnología que crea soluciones de software y datos para empresas.',
        site: 'Sitio de la empresa',
        contact: 'Contacto',
      },
      footer: {
        product: 'Galaxie Sports es un producto de Galaxie Works.',
      },
      legal: {
        updated: 'Actualizado el 23 de octubre de 2026',
        back: 'Volver a la presentación',
        terms: {
          title: 'Términos de uso',
          description: 'Condiciones de uso del sitio y de la demo de la API Galaxie Sports.',
          intro:
            'Estos términos se aplican al sitio sports.galaxie.works y a la demo de la API Galaxie Sports, ofrecidos por Galaxie Works. Al ingresar, los aceptás.',
          sections: {
            access: {
              title: 'Acceso por invitación',
              body: 'El uso está restringido a personas invitadas, en general profesionales de empresas clientes o en evaluación. La invitación es personal y no se puede compartir. Puede tener vencimiento y puede desactivarse en cualquier momento.',
            },
            use: {
              title: 'Uso permitido',
              body: 'La demo sirve para conocer y evaluar los datos y la API. No está permitido copiar la base en forma masiva, automatizar el acceso a las páginas, intentar eludir la autenticación ni revender el contenido sin contrato.',
            },
            content: {
              title: 'Contenido',
              body: 'Los datos deportivos pueden tener demoras o errores de origen. Los textos de contexto generados con apoyo de inteligencia artificial pueden contener imprecisiones. Las marcas, escudos y nombres de competiciones pertenecen a sus titulares y aparecen solo para identificarlos.',
            },
            changes: {
              title: 'Disponibilidad y cambios',
              body: 'La demo puede cambiar, quedar fuera de línea o cerrarse sin aviso. Estos términos pueden actualizarse; la fecha de arriba indica la versión vigente.',
            },
            contact: {
              title: 'Contacto',
              body: 'Consultas sobre estos términos: <email>{email}</email>.',
            },
          },
        },
        privacy: {
          title: 'Política de privacidad',
          description: 'Qué datos recopila Galaxie Sports, para qué y cómo pedir acceso o eliminación.',
          intro:
            'Esta política explica qué datos personales trata el sitio sports.galaxie.works y por qué. Recopilamos lo mínimo necesario para controlar el acceso por invitación.',
          sections: {
            collected: {
              title: 'Qué recopilamos',
              body: 'El e-mail usado para ingresar (y el nombre, si figura en la invitación), el idioma elegido, la dirección IP y el navegador de cada sesión, y registros de uso como fecha, hora y páginas visitadas.',
            },
            cookies: {
              title: 'Cookies',
              body: 'Usamos solo cookies necesarias: la de sesión, que te mantiene conectado, y las de preferencia de idioma y huso horario. No usamos cookies publicitarias ni de seguimiento de terceros.',
            },
            use: {
              title: 'Para qué los usamos',
              body: 'Para enviar el código de acceso, mantener la sesión, aplicar el vencimiento de la invitación, proteger el servicio contra abusos y mejorar la demo.',
            },
            sharing: {
              title: 'Datos compartidos',
              body: 'No vendemos ni alquilamos datos personales. Solo pasan por los proveedores de infraestructura que operan el servicio (hosting y envío de e-mails), con esa finalidad.',
            },
            retention: {
              title: 'Conservación',
              body: 'Conservamos los datos mientras el acceso esté activo y el tiempo necesario por seguridad y obligaciones legales. Después, se eliminan o se anonimizan.',
            },
            rights: {
              title: 'Tus derechos',
              body: 'Podés pedir acceso, corrección o eliminación de tus datos, o el fin de tu acceso, en cualquier momento, escribiendo a <email>{email}</email>. Atendemos los pedidos según la LGPD de Brasil y las demás leyes de protección de datos aplicables.',
            },
          },
        },
      },
    },
  },
);
