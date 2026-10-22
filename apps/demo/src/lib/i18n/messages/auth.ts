/** Acesso: tela de login por código (OTP), moldura das telas de acesso e erros do servidor de auth. */
import { defineMessages } from '../define';

export default defineMessages(
  {
    shell: {
      // Tagline no tom da marca (o inglês curto do galaxie.works), igual nos três idiomas.
      title: 'Sports from another universe.',
      subtitle: 'Enter the Galaxie and start exploring.',
      footer: 'Acesso por convite · Galaxie Works',
      logoAlt: 'Galaxie Works',
    },
    meta: {
      title: 'Entrar',
    },
    email: {
      label: 'E-mail',
      placeholder: 'voce@empresa.com',
      help: 'Enviaremos um código de acesso para este e-mail. Não é preciso senha.',
      submit: 'Enviar código',
      sending: 'Enviando…',
    },
    code: {
      sent: 'Se <email>{email}</email> tiver acesso à demo, enviamos um código de {length} dígitos. Ele vale por {minutes} minutos.',
      label: 'Código de acesso',
      submit: 'Entrar',
      submitting: 'Entrando…',
      changeEmail: 'Usar outro e-mail',
      resend: 'Reenviar código',
      resendIn: 'Reenviar código ({seconds}s)',
      resent: 'Enviamos um novo código. O anterior deixou de valer.',
    },
    errors: {
      expired: 'Seu acesso à demo expirou. Fale com quem te convidou para renovar.',
      invalidOtp: 'Código incorreto. Confira o e-mail e tente de novo.',
      otpExpired: 'Este código expirou. Peça um novo.',
      tooManyAttempts: 'Muitas tentativas com este código. Peça um novo.',
      rateLimited: 'Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.',
      resendTooSoon: 'Aguarde um pouco para pedir outro código.',
      banned: 'Seu acesso à demo foi desativado. Fale com quem te convidou.',
      sendFailed: 'Não foi possível enviar o código agora. Tente de novo.',
      signInFailed: 'Não foi possível entrar agora. Tente de novo.',
    },
  },
  {
    en: {
      shell: {
        title: 'Sports from another universe.',
        subtitle: 'Enter the Galaxie and start exploring.',
        footer: 'Invitation-only access · Galaxie Works',
        logoAlt: 'Galaxie Works',
      },
      meta: {
        title: 'Sign in',
      },
      email: {
        label: 'Email',
        placeholder: 'you@company.com',
        help: "We'll send an access code to this email. No password needed.",
        submit: 'Send code',
        sending: 'Sending…',
      },
      code: {
        sent: 'If <email>{email}</email> has access to the demo, we sent a {length}-digit code. It is valid for {minutes} minutes.',
        label: 'Access code',
        submit: 'Sign in',
        submitting: 'Signing in…',
        changeEmail: 'Use another email',
        resend: 'Resend code',
        resendIn: 'Resend code ({seconds}s)',
        resent: 'We sent a new code. The previous one no longer works.',
      },
      errors: {
        expired: 'Your access to the demo has expired. Ask the person who invited you to renew it.',
        invalidOtp: 'Wrong code. Check your email and try again.',
        otpExpired: 'This code has expired. Request a new one.',
        tooManyAttempts: 'Too many attempts with this code. Request a new one.',
        rateLimited: 'Too many attempts in a short time. Wait a minute and try again.',
        resendTooSoon: 'Wait a moment before requesting another code.',
        banned: 'Your access to the demo has been disabled. Talk to the person who invited you.',
        sendFailed: "We couldn't send the code right now. Try again.",
        signInFailed: "We couldn't sign you in right now. Try again.",
      },
    },
    'es-AR': {
      shell: {
        title: 'Sports from another universe.',
        subtitle: 'Enter the Galaxie and start exploring.',
        footer: 'Acceso por invitación · Galaxie Works',
        logoAlt: 'Galaxie Works',
      },
      meta: {
        title: 'Ingresar',
      },
      email: {
        label: 'E-mail',
        placeholder: 'vos@empresa.com',
        help: 'Te vamos a mandar un código de acceso a este e-mail. No necesitás contraseña.',
        submit: 'Enviar código',
        sending: 'Enviando…',
      },
      code: {
        sent: 'Si <email>{email}</email> tiene acceso a la demo, te mandamos un código de {length} dígitos. Vale por {minutes} minutos.',
        label: 'Código de acceso',
        submit: 'Ingresar',
        submitting: 'Ingresando…',
        changeEmail: 'Usar otro e-mail',
        resend: 'Reenviar código',
        resendIn: 'Reenviar código ({seconds}s)',
        resent: 'Te mandamos un código nuevo. El anterior ya no sirve.',
      },
      errors: {
        expired: 'Tu acceso a la demo venció. Hablá con quien te invitó para renovarlo.',
        invalidOtp: 'Código incorrecto. Revisá el e-mail y probá de nuevo.',
        otpExpired: 'Este código venció. Pedí uno nuevo.',
        tooManyAttempts: 'Demasiados intentos con este código. Pedí uno nuevo.',
        rateLimited: 'Demasiados intentos en poco tiempo. Esperá un minuto y probá de nuevo.',
        resendTooSoon: 'Esperá un poco para pedir otro código.',
        banned: 'Tu acceso a la demo fue desactivado. Hablá con quien te invitó.',
        sendFailed: 'No pudimos enviar el código ahora. Probá de nuevo.',
        signInFailed: 'No pudimos hacerte ingresar ahora. Probá de nuevo.',
      },
    },
  },
);
