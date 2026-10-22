/** E-mails de acesso (convite e código), no idioma de quem recebe. */
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
    },
  },
);
