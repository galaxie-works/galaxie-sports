/**
 * Páginas públicas: moldura (cabeçalho, rodapé, empresa), metadados, termos de uso e política de
 * privacidade. O conteúdo da apresentação fica em `landing.ts`. Texto real e indexável: é o que filtros web corporativos e buscadores leem para
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
      features: 'Recursos',
      sports: 'Esportes',
      markets: 'Mercados',
      access: 'Acesso',
      menu: 'Seções da página',
      legal: 'Institucional',
      skip: 'Ir para o conteúdo',
      terms: 'Termos de uso',
      privacy: 'Privacidade',
      status: 'Status',
    },
    footer: {
      product: 'Galaxie Sports é um produto da Galaxie Works.',
    },
    legal: {
      updated: 'Atualizado em 25 de outubro de 2026',
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
          youtube: {
            title: 'Vídeos do YouTube',
            body: 'Os vídeos de conteúdo relacionado vêm do YouTube e são exibidos no player oficial. O Galaxie Sports usa os serviços de API do YouTube: ao usar o Galaxie Sports, você concorda com os <ytterms>Termos de Serviço do YouTube</ytterms>.',
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
            body: 'Usamos só cookies necessários: o de sessão, que mantém você conectado, e os de preferência de idioma e fuso horário. Não usamos cookies de publicidade nem de rastreamento de terceiros. O player do YouTube só grava cookies do YouTube quando você reproduz um vídeo.',
          },
          use: {
            title: 'Para que usamos',
            body: 'Para enviar o código de acesso, manter a sessão, aplicar o prazo do convite, proteger o serviço contra abuso e melhorar a demonstração.',
          },
          sharing: {
            title: 'Compartilhamento',
            body: 'Não vendemos nem alugamos dados pessoais. Eles passam só pelos fornecedores de infraestrutura que operam o serviço (hospedagem e envio de e-mail), para essa finalidade.',
          },
          youtube: {
            title: 'Vídeos do YouTube',
            body: 'Os vídeos de conteúdo relacionado são exibidos com o player do YouTube, pelos serviços de API do YouTube, no modo de privacidade aprimorada (youtube-nocookie.com). Não acessamos, não coletamos e não guardamos dados da sua conta do YouTube. Para exibir cada vídeo, guardamos o identificador e dados públicos dele (título, trecho da descrição, miniatura, canal, data, duração e estatísticas). Revalidamos esses dados enquanto o jogo é recente, e o vídeo que deixa de estar disponível nesse período sai do site. Apagamos tudo o que veio do YouTube (inclusive o identificador) 30 dias depois de obtido. Ao reproduzir um vídeo, o YouTube e o Google tratam dados conforme a <gprivacy>Política de Privacidade do Google</gprivacy> e os <ytterms>Termos de Serviço do YouTube</ytterms>.',
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
        features: 'Features',
        sports: 'Sports',
        markets: 'Markets',
        access: 'Access',
        menu: 'Page sections',
        legal: 'Company',
        skip: 'Skip to content',
        terms: 'Terms of use',
        privacy: 'Privacy',
        status: 'Status',
      },
      footer: {
        product: 'Galaxie Sports is a product of Galaxie Works.',
      },
      legal: {
        updated: 'Updated on October 25, 2026',
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
            youtube: {
              title: 'YouTube videos',
              body: 'Related videos come from YouTube and play in the official YouTube player. Galaxie Sports uses the YouTube API Services: by using Galaxie Sports, you agree to the <ytterms>YouTube Terms of Service</ytterms>.',
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
              body: 'We only use necessary cookies: the session cookie, which keeps you signed in, and the language and time zone preference cookies. We do not use advertising or third-party tracking cookies. The YouTube player only sets YouTube cookies when you play a video.',
            },
            use: {
              title: 'How we use it',
              body: 'To send the access code, keep the session, apply the invitation’s expiry, protect the service against abuse and improve the demo.',
            },
            sharing: {
              title: 'Sharing',
              body: 'We do not sell or rent personal data. It only goes through the infrastructure providers that run the service (hosting and email delivery), for that purpose.',
            },
            youtube: {
              title: 'YouTube videos',
              body: 'Related videos are shown with the YouTube player, through the YouTube API Services, in privacy-enhanced mode (youtube-nocookie.com). We do not access, collect or store data from your YouTube account. To display each video, we keep its ID and public data (title, description excerpt, thumbnail, channel, date, duration and statistics). We refresh that data while the match is recent, and a video that becomes unavailable during that period is removed from the site. We delete everything that came from YouTube (the ID included) 30 days after it was obtained. When you play a video, YouTube and Google process data under the <gprivacy>Google Privacy Policy</gprivacy> and the <ytterms>YouTube Terms of Service</ytterms>.',
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
        features: 'Recursos',
        sports: 'Deportes',
        markets: 'Mercados',
        access: 'Acceso',
        menu: 'Secciones de la página',
        legal: 'Institucional',
        skip: 'Ir al contenido',
        terms: 'Términos de uso',
        privacy: 'Privacidad',
        status: 'Estado',
      },
      footer: {
        product: 'Galaxie Sports es un producto de Galaxie Works.',
      },
      legal: {
        updated: 'Actualizado el 25 de octubre de 2026',
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
            youtube: {
              title: 'Videos de YouTube',
              body: 'Los videos de contenido relacionado vienen de YouTube y se reproducen en el reproductor oficial. Galaxie Sports usa los servicios de API de YouTube: al usar Galaxie Sports, aceptás las <ytterms>Condiciones del Servicio de YouTube</ytterms>.',
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
              body: 'Usamos solo cookies necesarias: la de sesión, que te mantiene conectado, y las de preferencia de idioma y huso horario. No usamos cookies publicitarias ni de seguimiento de terceros. El reproductor de YouTube solo guarda cookies de YouTube cuando reproducís un video.',
            },
            use: {
              title: 'Para qué los usamos',
              body: 'Para enviar el código de acceso, mantener la sesión, aplicar el vencimiento de la invitación, proteger el servicio contra abusos y mejorar la demo.',
            },
            sharing: {
              title: 'Datos compartidos',
              body: 'No vendemos ni alquilamos datos personales. Solo pasan por los proveedores de infraestructura que operan el servicio (hosting y envío de e-mails), con esa finalidad.',
            },
            youtube: {
              title: 'Videos de YouTube',
              body: 'Los videos de contenido relacionado se muestran con el reproductor de YouTube, a través de los servicios de API de YouTube, en modo de privacidad mejorada (youtube-nocookie.com). No accedemos, no recopilamos ni guardamos datos de tu cuenta de YouTube. Para mostrar cada video, guardamos su identificador y datos públicos (título, extracto de la descripción, miniatura, canal, fecha, duración y estadísticas). Revalidamos esos datos mientras el partido es reciente, y el video que deja de estar disponible en ese período sale del sitio. Borramos todo lo que vino de YouTube (incluido el identificador) 30 días después de obtenido. Al reproducir un video, YouTube y Google tratan datos según la <gprivacy>Política de Privacidad de Google</gprivacy> y las <ytterms>Condiciones del Servicio de YouTube</ytterms>.',
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
