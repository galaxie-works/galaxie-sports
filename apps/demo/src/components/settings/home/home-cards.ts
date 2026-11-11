/**
 * Cartões do Início de Ajustes (#1073): cada um junta uma contagem que já existe nos dados das páginas atuais (fila
 * da Revisão, pedidos das operadoras, jobs, status, credenciais e gasto de IA). Puro: o servidor busca as fontes
 * (`data.ts`) e o teste confere as contas. As mesmas contagens alimentam os `Badge` do menu (#1068).
 */
import { settingDef } from '@galaxie/runtime-config';

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

/** Segredos do registro que o contêiner de referência não tem. */
export const missingCredentials = (ops: Pick<OpsSnapshot, 'settings'>) =>
  ops.settings.filter((s) => settingDef(s.key)?.type === 'secret' && !s.configured).length;

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
