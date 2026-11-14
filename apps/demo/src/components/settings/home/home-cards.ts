/**
 * Cartões do Início de Ajustes (#1073): cada um junta uma contagem que já existe nos dados das páginas atuais (fila
 * da Revisão, pedidos das operadoras, jobs, status, credenciais e gasto de IA). Puro: o servidor busca as fontes
 * (`data.ts`) e o teste confere as contas. As mesmas contagens alimentam os `Badge` do menu (#1068).
 */
import { AI_PROVIDER_KEY_ENV, AI_PROVIDERS, SETTINGS, settingDef } from '@galaxie/runtime-config';

import { settingsHref } from '@/lib/ops/settings-items';
import type { OpsSnapshot } from '@/lib/ops/types';

/** Ordem dos cartões na página (fixa: a página tem sempre a mesma forma). */
export const HOME_CARDS = [
  'review',
  'requests',
  'failedJobs',
  'alerts',
  'credentials',
  'aiCeiling',
  'signups',
] as const;
export type HomeCardId = (typeof HOME_CARDS)[number];

/** A IA "perto do teto" a partir desta fração do teto diário em US$. */
export const AI_NEAR_CEILING = 0.8;

/**
 * Para onde cada cartão leva, nos itens do menu de Ajustes (#1068): Dados → Revisão do catálogo; Produtos → Grades e
 * ofertas (aba Pedidos); Plataforma → Tarefas, Status dos serviços e Credenciais; Inteligência → IA interna; Clientes →
 * Cadastros e trials (ainda "Em breve": leva à página de espera).
 */
export const HOME_LINKS: Record<HomeCardId, string | null> = {
  review: settingsHref('review'),
  requests: `${settingsHref('lineup')}?aba=pedidos`,
  failedJobs: settingsHref('tasks'),
  alerts: settingsHref('status'),
  credentials: settingsHref('credentials'),
  aiCeiling: settingsHref('ai'),
  signups: settingsHref('signups'),
};

/** Fontes do Início; `null` = a fonte não respondeu (tabela ainda não migrada, banco fora). */
export interface HomeSources {
  /** Fila da Revisão do catálogo: itens em `needs_review`. */
  review: { pending: number } | null;
  /** Pedidos das operadoras com status `open`. */
  requests: { open: number } | null;
  ops: Pick<OpsSnapshot, 'jobs' | 'services' | 'credit' | 'settings' | 'llm' | 'history'> | null;
}

/**
 * `pending`: há o que fazer (contagem > 0); `clear`: nada pendente (cartão neutro, não some); `unavailable`: a fonte
 * não respondeu; `soon`: a feature ainda não existe (F2/F3).
 */
export type HomeCardState = 'pending' | 'clear' | 'unavailable' | 'soon';
/** Cor do selo (`Badge` `-light`) quando há pendência. */
export type HomeCardTone = 'destructive' | 'warning' | 'info';

export interface HomeCard {
  id: HomeCardId;
  state: HomeCardState;
  tone: HomeCardTone;
  href: string | null;
  /** Quantos pedem ação (`aiCeiling`: 1 quando perto do teto). */
  count: number;
  /** Só `aiCeiling`: % do teto já gasto hoje (inteiro); null = sem teto. */
  percent?: number | null;
}

const TONES: Record<HomeCardId, HomeCardTone> = {
  review: 'info',
  requests: 'info',
  failedJobs: 'destructive',
  alerts: 'destructive',
  credentials: 'warning',
  aiCeiling: 'warning',
  signups: 'info',
};

/** Jobs com alguma falha nas últimas 24 h (`errors24h` vem de `ops.job_run`). */
export const failedJobs = (ops: Pick<OpsSnapshot, 'jobs'>) => ops.jobs.filter((j) => j.errors24h > 0).length;

/**
 * Alertas abertos do Status: serviço que já relatou e está sem sinal, mais a conta de IA reprovada na verificação de
 * crédito. Serviço que nunca relatou não conta (não está ligado neste ambiente).
 */
export const openAlerts = (ops: Pick<OpsSnapshot, 'services' | 'credit'>) =>
  ops.services.filter((s) => s.reportedAt !== null && !s.alive).length +
  (ops.credit?.status === 'fail' ? 1 : 0);

/**
 * Segredos opcionais: sem eles a plataforma funciona e só uma feature fica indisponível ou cai num padrão. Não contam
 * no "Credencial faltando":
 * - `FEEDBACK_GITHUB_TOKEN`: as sugestões do app abrem issue no GitHub só se alguém configurar (e o token pode estar
 *   no painel, não no env);
 * - `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET`: sem eles a compra da Cosmos AI fica indisponível, o resto segue;
 * - `DIDIT_*`: sem eles a verificação de idade da Galaxie (#1109) responde 503, o resto segue;
 * - `METRICS_TOKEN`: só protege o `/metrics`; sem ele as métricas ficam abertas na rede interna;
 * - `QUALITY_API_KEY`: a qualidade dos dados cai na `GALAXIE_DEMO_KEY`.
 */
export const OPTIONAL_SECRETS: ReadonlySet<string> = new Set([
  'FEEDBACK_GITHUB_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'DIDIT_API_KEY',
  'DIDIT_WORKFLOW_ID',
  'DIDIT_WEBHOOK_SECRET',
  'METRICS_TOKEN',
  'QUALITY_API_KEY',
]);

/** Chave de cada provedor de IA (a mesma tabela que o servidor usa ao salvar AI_PROVIDER). */
const AI_PROVIDER_KEY = AI_PROVIDER_KEY_ENV;

/** Ajustes que escolhem um provedor de IA (`AI_PROVIDER`, `AI_REVIEW_PROVIDER`…), lidos do registro. */
const PROVIDER_SETTINGS = SETTINGS.filter(
  (d) => d.type === 'enum' && d.key.endsWith('_PROVIDER') && d.options === AI_PROVIDERS,
).map((d) => d.key);

/** Valor efetivo no retrato; sem a linha (ou vazia), o padrão do registro. */
function effectiveValue(ops: Pick<OpsSnapshot, 'settings'>, key: string): string | null {
  const row = ops.settings.find((s) => s.key === key);
  return row?.value ?? row?.defaultValue ?? settingDef(key)?.default ?? null;
}

/**
 * Segredo sem o qual a plataforma não funciona como está configurada:
 * - os opcionais (`OPTIONAL_SECRETS`) nunca contam;
 * - a chave de um provedor de IA só conta com a IA ligada (`AI_STATUS`) e quando algum `*_PROVIDER` usa esse
 *   provedor (com a IA desligada, ou sem ninguém usando o provedor, a chave dele não faz falta);
 * - todo o resto (fornecedor, armazenamento, login, e-mail, chaves da API, YouTube) conta.
 */
export function requiredSecret(ops: Pick<OpsSnapshot, 'settings'>, key: string): boolean {
  if (OPTIONAL_SECRETS.has(key)) return false;
  const provider = (Object.keys(AI_PROVIDER_KEY) as (keyof typeof AI_PROVIDER_KEY)[]).find(
    (p) => AI_PROVIDER_KEY[p] === key,
  );
  if (!provider) return true;
  if (effectiveValue(ops, 'AI_STATUS') === 'off') return false;
  return PROVIDER_SETTINGS.some((k) => effectiveValue(ops, k) === provider);
}

/** Segredos obrigatórios (`requiredSecret`) que o contêiner de referência não tem. */
export const missingCredentials = (ops: Pick<OpsSnapshot, 'settings'>) =>
  ops.settings.filter(
    (s) => settingDef(s.key)?.type === 'secret' && !s.configured && requiredSecret(ops, s.key),
  ).length;

/** % do teto diário em US$ gasto hoje; null sem teto (ou IA desligada). */
export function aiCeilingPercent(ops: Pick<OpsSnapshot, 'llm'>): number | null {
  const { usdBudget, totals, status } = ops.llm;
  if (status === 'off' || usdBudget === null || usdBudget <= 0) return null;
  return Math.floor((totals.costUsd / usdBudget) * 100);
}

/** Os sete cartões, na ordem de `HOME_CARDS`. */
export function buildHomeCards(
  sources: HomeSources,
  links: Record<HomeCardId, string | null> = HOME_LINKS,
): HomeCard[] {
  const card = (id: HomeCardId, count: number | null, extra: Partial<HomeCard> = {}): HomeCard => ({
    id,
    tone: TONES[id],
    href: links[id],
    state: count === null ? 'unavailable' : count > 0 ? 'pending' : 'clear',
    count: count ?? 0,
    ...extra,
  });
  const { ops } = sources;
  const percent = ops ? aiCeilingPercent(ops) : null;
  return [
    card('review', sources.review?.pending ?? null),
    card('requests', sources.requests?.open ?? null),
    card('failedJobs', ops ? failedJobs(ops) : null),
    card('alerts', ops ? openAlerts(ops) : null),
    card('credentials', ops ? missingCredentials(ops) : null),
    card('aiCeiling', ops ? (percent !== null && percent >= AI_NEAR_CEILING * 100 ? 1 : 0) : null, {
      percent,
    }),
    { id: 'signups', state: 'soon', tone: TONES.signups, href: links.signups, count: 0 },
  ];
}

/** Total que pede ação (o selo do item Início no menu). */
export const homePendingTotal = (cards: readonly HomeCard[]) =>
  cards.reduce((n, c) => n + (c.state === 'pending' ? c.count : 0), 0);

/** As últimas mudanças do histórico do painel (o histórico já vem do mais novo ao mais velho). */
export const recentChanges = (ops: Pick<OpsSnapshot, 'history'> | null, limit = 5) =>
  ops ? ops.history.slice(0, limit) : [];
