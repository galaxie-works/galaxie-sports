/** E-mails do painel (convite, código, pedido de créditos da Cosmos e boas-vindas da marca), no idioma de quem recebe. */
import { defineMessages } from '../define';

export default defineMessages(
  {
    greeting: 'Olá, {name}!',
    greetingNoName: 'Olá!',
    signature: 'Galaxie Works',
    invite: {
      subject: 'Você foi convidado(a) para a demo da Galaxie Sports',
      intro:
        'Você foi convidado(a) para a demo da Galaxie Sports: metadados esportivos navegáveis, de países e competições até times, clássicos e partidas.',
      how: 'Para entrar, informe este e-mail na tela de acesso e digite o código de 6 dígitos que enviaremos na hora. Não é preciso criar senha.',
      validUntil: 'Seu acesso vale até {date}.',
      noExpiry: 'Seu acesso não tem data para expirar.',
      action: 'Acessar a demo',
      ignore: 'Se você não esperava este e-mail, pode ignorá-lo.',
    },
    otp: {
      subject: '{code} é o seu código de acesso · Galaxie Sports',
      intro: 'Use o código abaixo para entrar na demo da Galaxie Sports:',
      validity: 'O código vale por {minutes} minutos e só pode ser usado uma vez.',
      ignore: 'Se não foi você, ignore este e-mail: ninguém entra sem o código.',
    },
    creditRequest: {
      subject: 'Novo pedido de créditos da Cosmos AI',
      intro: '{requester} pediu mais créditos da Cosmos AI para {tenant}.',
      reason: 'Justificativa escrita por quem pediu: “{reason}”',
      how: 'Aprove para abrir a compra ou recuse com uma nota. Quem pediu vê a sua resposta na tela da Cosmos.',
      action: 'Ver o pedido',
    },
    welcome: {
      subject: 'Bem-vindo(a) à Galaxie Sports: {brand} está pronta',
      intro:
        'A marca {brand} está provisionada em modo de teste até {date}, com os módulos do Fan Experience e dado de produção.',
      introNoDate:
        'A marca {brand} está provisionada em modo de teste, com os módulos do Fan Experience e dado de produção.',
      checklistIntro:
        'Os quatro passos da primeira sessão estão no topo do console; cada um se marca sozinho quando acontece:',
      steps: {
        call: 'Primeira chamada: rode o curl pronto com a sua chave de teste.',
        widget: 'Um widget no ar: instale o embed do widget de exemplo numa página do seu site.',
        invite: 'Convide alguém: a pessoa aceita o convite por e-mail.',
        plan: 'Escolha o plano: Planos e módulos mostra o preço previsto e os módulos para testar.',
      },
      action: 'Abrir o console',
      footnote:
        'As chaves secretas apareceram uma única vez, no fim do cadastro. Guarde-as num cofre; a chave de teste não conta na cota de produção.',
    },
  },
  {
    en: {
      greeting: 'Hi, {name}!',
      greetingNoName: 'Hi!',
      signature: 'Galaxie Works',
      invite: {
        subject: "You're invited to the Galaxie Sports demo",
        intro:
          "You're invited to the Galaxie Sports demo: browsable sports metadata, from countries and competitions to teams, derbies and matches.",
        how: "To sign in, enter this email on the access screen and type the 6-digit code we'll send right away. No password needed.",
        validUntil: 'Your access is valid until {date}.',
        noExpiry: 'Your access has no expiration date.',
        action: 'Open the demo',
        ignore: "If you weren't expecting this email, you can ignore it.",
      },
      otp: {
        subject: '{code} is your access code · Galaxie Sports',
        intro: 'Use the code below to sign in to the Galaxie Sports demo:',
        validity: 'The code is valid for {minutes} minutes and can only be used once.',
        ignore: "If this wasn't you, ignore this email: no one gets in without the code.",
      },
      creditRequest: {
        subject: 'New Cosmos AI credit request',
        intro: '{requester} asked for more Cosmos AI credits for {tenant}.',
        reason: 'Reason written by the requester: “{reason}”',
        how: 'Approve to open the purchase or decline with a note. The requester sees your answer on the Cosmos page.',
        action: 'See the request',
      },
      welcome: {
        subject: 'Welcome to Galaxie Sports: {brand} is ready',
        intro:
          '{brand} is provisioned in trial mode until {date}, with the Fan Experience modules and production data.',
        introNoDate:
          '{brand} is provisioned in trial mode, with the Fan Experience modules and production data.',
        checklistIntro:
          'The four first-session steps are at the top of the console; each one is checked off on its own when it happens:',
        steps: {
          call: 'First call: run the ready-made curl with your test key.',
          widget: 'A widget live: install the sample widget embed on a page of your site.',
          invite: 'Invite someone: they accept the invitation by email.',
          plan: 'Choose your plan: Plans and modules shows the expected price and the modules you can try.',
        },
        action: 'Open the console',
        footnote:
          'The secret keys were shown only once, at the end of sign-up. Keep them in a vault; the test key does not count against the production quota.',
      },
    },
    'es-AR': {
      greeting: '¡Hola, {name}!',
      greetingNoName: '¡Hola!',
      signature: 'Galaxie Works',
      invite: {
        subject: 'Te invitaron a la demo de Galaxie Sports',
        intro:
          'Te invitaron a la demo de Galaxie Sports: metadatos deportivos navegables, desde países y competencias hasta equipos, clásicos y partidos.',
        how: 'Para ingresar, escribí este e-mail en la pantalla de acceso y poné el código de 6 dígitos que te mandamos en el momento. No hace falta crear contraseña.',
        validUntil: 'Tu acceso vale hasta el {date}.',
        noExpiry: 'Tu acceso no tiene fecha de vencimiento.',
        action: 'Entrar a la demo',
        ignore: 'Si no esperabas este e-mail, podés ignorarlo.',
      },
      otp: {
        subject: '{code} es tu código de acceso · Galaxie Sports',
        intro: 'Usá este código para ingresar a la demo de Galaxie Sports:',
        validity: 'El código vale por {minutes} minutos y se puede usar una sola vez.',
        ignore: 'Si no fuiste vos, ignorá este e-mail: nadie entra sin el código.',
      },
      creditRequest: {
        subject: 'Nuevo pedido de créditos de Cosmos AI',
        intro: '{requester} pidió más créditos de Cosmos AI para {tenant}.',
        reason: 'Justificación escrita por quien pidió: “{reason}”',
        how: 'Aprobá para abrir la compra o rechazá con una nota. Quien pidió ve tu respuesta en la pantalla de Cosmos.',
        action: 'Ver el pedido',
      },
      welcome: {
        subject: 'Bienvenido(a) a Galaxie Sports: {brand} está lista',
        intro:
          'La marca {brand} está provisionada en modo de prueba hasta el {date}, con los módulos de Fan Experience y datos de producción.',
        introNoDate:
          'La marca {brand} está provisionada en modo de prueba, con los módulos de Fan Experience y datos de producción.',
        checklistIntro:
          'Los cuatro pasos de la primera sesión están en la parte superior de la consola; cada uno se marca solo cuando ocurre:',
        steps: {
          call: 'Primera llamada: ejecuta el curl listo con tu clave de prueba.',
          widget: 'Un widget en el aire: instala el embed del widget de ejemplo en una página de tu sitio.',
          invite: 'Invita a alguien: la persona acepta la invitación por e-mail.',
          plan: 'Elige el plan: Planes y módulos muestra el precio previsto y los módulos para probar.',
        },
        action: 'Abrir la consola',
        footnote:
          'Las claves secretas aparecieron una sola vez, al final del registro. Guárdalas en una bóveda; la clave de prueba no cuenta en la cuota de producción.',
      },
    },
  },
);
