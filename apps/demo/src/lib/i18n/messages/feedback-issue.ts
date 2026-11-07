/**
 * Textos da issue aberta pelo "Sugerir ou reportar algo" (só no servidor). Sempre em pt-BR, qualquer que seja o
 * idioma da tela: são os rótulos e a ficha que a equipe lê no GitHub. O rótulo é o assunto escolhido e é criado na
 * primeira vez que aparece (cor de `FEEDBACK_LABEL_COLORS`).
 */
import type { FeedbackSubject } from '@/lib/feedback/rules';

export const FEEDBACK_LABELS: Record<FeedbackSubject, string> = {
  bug: 'Reportar um problema',
  feature: 'Sugerir um recurso',
  content: 'Sugerir correção de um conteúdo',
  data: 'Pedir um dado ou cobertura',
  question: 'Tirar uma dúvida',
  other: 'Outro assunto',
};

export const FEEDBACK_LABEL_COLORS: Record<FeedbackSubject, string> = {
  bug: 'd73a4a',
  feature: 'a2eeef',
  content: 'fbca04',
  data: '0e8a16',
  question: 'd876e3',
  other: 'c5def5',
};

export const FEEDBACK_ISSUE_TEXT = {
  labelDescription: 'Enviado pelo app (Sugerir ou reportar algo)',
  message: 'Mensagem',
  details: 'Detalhes',
  subject: 'Assunto',
  email: 'E-mail',
  tenant: 'Tenant',
  role: 'Papel',
  page: 'Página',
  locale: 'Idioma',
  viewport: 'Tela',
  userAgent: 'Navegador',
  version: 'Versão',
  sentAt: 'Enviado em',
  attachments: 'Anexos',
  footer:
    'Aberta pelo formulário "Sugerir ou reportar algo" do app; e-mail e tenant parcialmente mascarados.',
  timeZoneSuffix: '(Brasília)',
} as const;
