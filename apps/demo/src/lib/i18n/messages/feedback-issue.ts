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
  data: 'Reportar informação faltando ou incompleta',
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
  user: 'Usuário',
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
    'Aberta pelo formulário "Sugerir ou reportar algo" do app. Usuário e tenant vão como referência opaca; quem tem o BETTER_AUTH_SECRET confere com feedbackRef (docs/runbooks/sugestoes-do-app.md).',
  timeZoneSuffix: '(Brasília)',
  /** Comentário com a resposta de quem enviou, quando a issue está em "Necessita mais informações". */
  userReply: 'Resposta de quem enviou (pela caixa de entrada do app)',
} as const;

/**
 * Comentário da issue que vai para a caixa de entrada de quem enviou: o que vem depois deste comando, no começo do
 * comentário. Qualquer outro comentário fica só entre a equipe.
 */
export const FEEDBACK_REPLY_COMMAND = '/responder';

/**
 * Colunas do projeto "Customer Voice" (campo Status), como aparecem no GitHub, e a chave de cada uma no app. Renomear
 * uma coluna no GitHub exige mudar aqui: coluna desconhecida não vira aviso (fica no log do job).
 */
export const FEEDBACK_STATUS_COLUMNS = {
  Backlog: 'backlog',
  'Em revisão': 'review',
  'Selecionado para desenvolvimento': 'selected',
  'Necessita mais informações': 'needsInfo',
  'Em desenvolvimento': 'inProgress',
  Entregue: 'delivered',
} as const;
