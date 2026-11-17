/**
 * Textos dos e-mails do ciclo de vida do tenant (plataforma comercial F3, decisão 11), nos três idiomas: inglês,
 * espanhol neutro (sem voseo) e português do Brasil. Moram aqui, e não no dicionário da demo, porque o worker não
 * importa a demo. O idioma é o da organização (`billing.organization.locale`); `mailLocale` reduz qualquer tag a um dos
 * três. Variáveis entre chaves (`{brand}`, `{date}`, `{days}`, `{day}`, `{module}`) são preenchidas por `fill`.
 */
export const MAIL_LOCALES = ['pt-BR', 'en', 'es'] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

/** `pt-BR`, `en`, `es-AR`, `es-MX`… → um dos três; desconhecido ou nulo → pt-BR. */
export function mailLocale(locale: string | null | undefined): MailLocale {
  const lower = (locale ?? '').trim().toLowerCase();
  if (!lower) return 'pt-BR';
  const language = lower.split('-')[0];
  if (language === 'en') return 'en';
  if (language === 'es') return 'es';
  return 'pt-BR';
}

export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Um e-mail do ciclo de vida: assunto (singular e plural quando há `{days}`), parágrafos, passos e o botão. */
export interface LifecycleMailText {
  subject: string;
  /** Assunto quando `{days}` é 1 (ausente = o mesmo). */
  subjectOne?: string;
  intro: string;
  /** Abertura sem a data (quando o prazo não existe); ausente = `intro`. */
  introNoDate?: string;
  body: string;
  /** Passos numerados depois do corpo (o checklist das boas-vindas). */
  steps?: string[];
  /** Rótulo do botão principal; `store` leva à loja, `console` ao console. */
  action: 'store' | 'console';
}

export interface MailTexts {
  greeting: string;
  greetingNoName: string;
  signature: string;
  actions: { console: string; store: string };
  welcome: LifecycleMailText;
  trial_reminder: LifecycleMailText;
  trial_expired: LifecycleMailText;
  module_trial_ending: LifecycleMailText;
  suspended: LifecycleMailText;
  cancelled: LifecycleMailText;
}

export const MAIL_TEXTS: Record<MailLocale, MailTexts> = {
  'pt-BR': {
    greeting: 'Olá, {name}!',
    greetingNoName: 'Olá!',
    signature: 'Galaxie Works',
    actions: { console: 'Abrir o console', store: 'Ver planos e módulos' },
    // o mesmo conteúdo das boas-vindas do console (apps/demo/src/lib/i18n/messages/email.ts › welcome)
    welcome: {
      subject: 'Bem-vindo(a) à Galaxie Sports: {brand} está pronta',
      intro:
        'A marca {brand} está provisionada em modo de teste até {date}, com os módulos do Fan Experience e dado de produção.',
      introNoDate:
        'A marca {brand} está provisionada em modo de teste, com os módulos do Fan Experience e dado de produção.',
      body: 'Os quatro passos da primeira sessão estão no topo do console; cada um se marca sozinho quando acontece:',
      steps: [
        'Primeira chamada: rode o curl pronto com a sua chave de teste.',
        'Um widget no ar: instale o embed do widget de exemplo numa página do seu site.',
        'Convide alguém: a pessoa aceita o convite por e-mail.',
        'Escolha o plano: Planos e módulos mostra o preço previsto e os módulos para testar.',
      ],
      action: 'console',
    },
    trial_reminder: {
      subject: 'O teste da marca {brand} termina em {days} dias',
      subjectOne: 'O teste da marca {brand} termina amanhã',
      intro: 'A marca {brand} está no dia {day} do teste da Galaxie Sports; o prazo termina em {date}.',
      body: 'Para seguir com a API e os widgets depois do prazo, escolha um plano em Planos e módulos. Sem plano, as chaves e os widgets param de responder quando o teste termina; os dados ficam guardados.',
      action: 'store',
    },
    trial_expired: {
      subject: 'O teste da marca {brand} terminou',
      intro:
        'O prazo do teste da marca {brand} venceu em {date}. As chaves respondem com o aviso de teste encerrado e os widgets estão congelados.',
      body: 'Escolha um plano em Planos e módulos para voltar ao ar com tudo como estava: nada foi apagado.',
      action: 'store',
    },
    module_trial_ending: {
      subject: 'O teste do módulo {module} termina em {days} dias',
      subjectOne: 'O teste do módulo {module} termina amanhã',
      intro: 'O teste do módulo {module} na marca {brand} termina em {date}.',
      body: 'Contrate o módulo antes do fim para ele não sair dos seus direitos. O resto da conta continua como está.',
      action: 'store',
    },
    suspended: {
      subject: 'A conta da marca {brand} foi suspensa',
      intro:
        'A marca {brand} está suspensa desde {date}: as chaves respondem com o aviso de assinatura suspensa e os widgets estão congelados.',
      body: 'Regularize em Planos e módulos ou fale com o time da Galaxie para reativar a conta. Nada foi apagado.',
      action: 'store',
    },
    cancelled: {
      subject: 'A conta da marca {brand} foi cancelada',
      intro:
        'A marca {brand} foi cancelada em {date}. Nada foi apagado: os dados ficam guardados pelo prazo da política de retenção.',
      body: 'Para voltar, fale com o time da Galaxie pelo console.',
      action: 'console',
    },
  },
  en: {
    greeting: 'Hi, {name}!',
    greetingNoName: 'Hi!',
    signature: 'Galaxie Works',
    actions: { console: 'Open the console', store: 'See plans and modules' },
    welcome: {
      subject: 'Welcome to Galaxie Sports: {brand} is ready',
      intro:
        '{brand} is provisioned in trial mode until {date}, with the Fan Experience modules and production data.',
      introNoDate:
        '{brand} is provisioned in trial mode, with the Fan Experience modules and production data.',
      body: 'The four first-session steps are at the top of the console; each one is checked off on its own when it happens:',
      steps: [
        'First call: run the ready-made curl with your test key.',
        'A widget live: install the sample widget embed on a page of your site.',
        'Invite someone: they accept the invitation by email.',
        'Choose your plan: Plans and modules shows the expected price and the modules you can try.',
      ],
      action: 'console',
    },
    trial_reminder: {
      subject: "{brand}'s trial ends in {days} days",
      subjectOne: "{brand}'s trial ends tomorrow",
      intro: '{brand} is on day {day} of its Galaxie Sports trial; it ends on {date}.',
      body: 'To keep the API and the widgets running after that, choose a plan in Plans and modules. Without a plan, the keys and widgets stop responding when the trial ends; your data is kept.',
      action: 'store',
    },
    trial_expired: {
      subject: "{brand}'s trial has ended",
      intro:
        "{brand}'s trial ended on {date}. The keys now answer with the trial-ended notice and the widgets are frozen.",
      body: 'Choose a plan in Plans and modules to come back exactly as you were: nothing was deleted.',
      action: 'store',
    },
    module_trial_ending: {
      subject: 'The {module} module trial ends in {days} days',
      subjectOne: 'The {module} module trial ends tomorrow',
      intro: 'The {module} module trial on {brand} ends on {date}.',
      body: 'Subscribe to the module before then so it stays in your entitlements. The rest of the account goes on as it is.',
      action: 'store',
    },
    suspended: {
      subject: "{brand}'s account has been suspended",
      intro:
        '{brand} has been suspended since {date}: the keys answer with the subscription-suspended notice and the widgets are frozen.',
      body: 'Settle it in Plans and modules or contact the Galaxie team to reactivate the account. Nothing was deleted.',
      action: 'store',
    },
    cancelled: {
      subject: "{brand}'s account has been cancelled",
      intro:
        '{brand} was cancelled on {date}. Nothing was deleted: the data is kept for the retention period.',
      body: 'To come back, contact the Galaxie team through the console.',
      action: 'console',
    },
  },
  es: {
    greeting: '¡Hola, {name}!',
    greetingNoName: '¡Hola!',
    signature: 'Galaxie Works',
    actions: { console: 'Abrir la consola', store: 'Ver planes y módulos' },
    welcome: {
      subject: 'Bienvenido(a) a Galaxie Sports: {brand} está lista',
      intro:
        'La marca {brand} está provisionada en modo de prueba hasta el {date}, con los módulos de Fan Experience y datos de producción.',
      introNoDate:
        'La marca {brand} está provisionada en modo de prueba, con los módulos de Fan Experience y datos de producción.',
      body: 'Los cuatro pasos de la primera sesión están en la parte superior de la consola; cada uno se marca solo cuando ocurre:',
      steps: [
        'Primera llamada: ejecuta el curl listo con tu clave de prueba.',
        'Un widget en el aire: instala el embed del widget de ejemplo en una página de tu sitio.',
        'Invita a alguien: la persona acepta la invitación por e-mail.',
        'Elige el plan: Planes y módulos muestra el precio previsto y los módulos para probar.',
      ],
      action: 'console',
    },
    trial_reminder: {
      subject: 'La prueba de la marca {brand} termina en {days} días',
      subjectOne: 'La prueba de la marca {brand} termina mañana',
      intro:
        'La marca {brand} está en el día {day} de la prueba de Galaxie Sports; el plazo termina el {date}.',
      body: 'Para seguir con la API y los widgets después del plazo, elige un plan en Planes y módulos. Sin plan, las claves y los widgets dejan de responder cuando la prueba termina; los datos quedan guardados.',
      action: 'store',
    },
    trial_expired: {
      subject: 'La prueba de la marca {brand} terminó',
      intro:
        'El plazo de la prueba de la marca {brand} venció el {date}. Las claves responden con el aviso de prueba terminada y los widgets están congelados.',
      body: 'Elige un plan en Planes y módulos para volver al aire con todo como estaba: nada fue borrado.',
      action: 'store',
    },
    module_trial_ending: {
      subject: 'La prueba del módulo {module} termina en {days} días',
      subjectOne: 'La prueba del módulo {module} termina mañana',
      intro: 'La prueba del módulo {module} en la marca {brand} termina el {date}.',
      body: 'Contrata el módulo antes del final para que no salga de tus derechos. El resto de la cuenta sigue como está.',
      action: 'store',
    },
    suspended: {
      subject: 'La cuenta de la marca {brand} fue suspendida',
      intro:
        'La marca {brand} está suspendida desde el {date}: las claves responden con el aviso de suscripción suspendida y los widgets están congelados.',
      body: 'Regulariza en Planes y módulos o habla con el equipo de Galaxie para reactivar la cuenta. Nada fue borrado.',
      action: 'store',
    },
    cancelled: {
      subject: 'La cuenta de la marca {brand} fue cancelada',
      intro:
        'La marca {brand} fue cancelada el {date}. Nada fue borrado: los datos quedan guardados por el plazo de la política de retención.',
      body: 'Para volver, habla con el equipo de Galaxie desde la consola.',
      action: 'console',
    },
  },
};

/** Fuso das datas por idioma (o e-mail não sabe o fuso de cada pessoa): o do mercado do idioma. */
export const MAIL_TIME_ZONE: Record<MailLocale, string> = {
  'pt-BR': 'America/Sao_Paulo',
  es: 'America/Argentina/Buenos_Aires',
  en: 'America/Argentina/Buenos_Aires',
};

export const longDate = (locale: MailLocale, date: Date): string =>
  new Intl.DateTimeFormat(locale === 'es' ? 'es-419' : locale, {
    dateStyle: 'long',
    timeZone: MAIL_TIME_ZONE[locale],
  }).format(date);
