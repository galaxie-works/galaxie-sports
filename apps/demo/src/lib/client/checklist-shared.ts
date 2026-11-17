/**
 * Checklist da primeira sessão (plataforma comercial F3, decisão 10; doc 02 §Primeira sessão: o checklist), parte pura.
 * Sem tabela própria: os quatro passos são derivados do que já existe, e cada um traz a própria prova:
 *
 * 1. **Primeira chamada**: alguma chave secreta `test` da marca com `last_used_at`;
 * 2. **Um widget no ar**: alguma chave publicável ativa com `last_used_at` (o embed do widget de exemplo que o
 *    provisionamento criou, ou, sem ele, o Builder);
 * 3. **Convide alguém**: alguma pessoa com cargo aceito (marca ou organização) além de quem criou a marca;
 * 4. **Escolha o plano**: `state = 'active'` (até lá o passo leva a Planos e módulos).
 *
 * A dispensa fica no `localStorage` do navegador (`checklistStorageKey`), não no banco. Sem banco aqui: o componente de
 * cliente (`components/client/first-session-checklist.tsx`) importa este módulo; a leitura mora em `checklist.ts`.
 */
import type { TenantState } from '@galaxie/db/schema';

export type ChecklistStepId = 'call' | 'widget' | 'invite' | 'plan';

/** O que o banco diz sobre a marca (lido em `checklist.ts`). */
export interface ChecklistFacts {
  state: TenantState;
  /** Chave secreta `test` ativa (a mais usada, ou a mais antiga); null = nenhuma. */
  testKey: { prefix: string; used: boolean } | null;
  /** Chave publicável ativa (a mais usada, ou a mais antiga); null = nenhuma. */
  publishableKey: { prefix: string; used: boolean } | null;
  /** Pessoas com cargo aceito, na marca ou na organização, além de quem criou a marca. */
  acceptedOthers: number;
  /** Widget de exemplo (o mais antigo não arquivado da marca); null = a marca não tem widget. */
  sampleWidgetId: string | null;
}

export interface ChecklistStep {
  id: ChecklistStepId;
  done: boolean;
  /** Área do console que resolve o passo. */
  href: string;
}

/** Estados em que o checklist aparece: a conta usa o produto (em teste ou paga). */
export const CHECKLIST_STATES: readonly TenantState[] = ['trial', 'active'];

export const CHECKLIST_HREFS: Record<ChecklistStepId, string> = {
  call: '/client/keys',
  widget: '/client/builder',
  invite: '/client/users',
  plan: '/client/plans',
};

/** Os quatro passos, na ordem do doc 02, com a prova de cada um. */
export function checklistSteps(facts: ChecklistFacts): ChecklistStep[] {
  return [
    { id: 'call', done: Boolean(facts.testKey?.used), href: CHECKLIST_HREFS.call },
    { id: 'widget', done: Boolean(facts.publishableKey?.used), href: CHECKLIST_HREFS.widget },
    { id: 'invite', done: facts.acceptedOthers > 0, href: CHECKLIST_HREFS.invite },
    { id: 'plan', done: facts.state === 'active', href: CHECKLIST_HREFS.plan },
  ];
}

/** O checklist mora no topo da visão geral enquanto algum passo falta e a conta está em teste ou ativa. */
export function checklistVisible(facts: ChecklistFacts, steps = checklistSteps(facts)): boolean {
  return CHECKLIST_STATES.includes(facts.state) && steps.some((s) => !s.done);
}

/** O que o componente de cliente recebe (sem segredo: só prefixos e ids). */
export interface ChecklistView {
  tenantId: string;
  steps: ChecklistStep[];
  /** `curl` pronto da primeira chamada; null sem chave `test` ativa. */
  curl: string | null;
  /** Embed do widget de exemplo; null sem widget (o passo leva ao Builder). */
  embed: string | null;
}

/** Chave do `localStorage` da dispensa, por marca (a pessoa pode ter mais de uma). */
export const checklistStorageKey = (tenantId: string) => `galaxie-checklist:${tenantId}`;

/**
 * O `curl` pronto da primeira chamada: o prefixo da chave `test` (12 hex, em claro no banco) e um marcador no lugar
 * do resto, que só apareceu uma vez, no provisionamento. Formato da chave: `gs_test_<prefixo>_<segredo>_<checksum>`.
 */
export function testKeyCurl(apiBase: string, prefix: string, placeholder: string): string {
  return `curl "${apiBase.replace(/\/+$/, '')}/v1/sports" -H "x-galaxie-key: gs_test_${prefix}_${placeholder}"`;
}

/**
 * O embed do widget de exemplo com o prefixo da chave publicável no lugar da chave (o texto inteiro também só
 * apareceu uma vez). Sem chave publicável, o marcador genérico do Builder.
 */
export function sampleWidgetEmbed(
  registryBase: string,
  widgetId: string,
  publishablePrefix: string | null,
): string {
  const base = registryBase.replace(/\/+$/, '');
  const key = publishablePrefix ? `${publishablePrefix}…` : 'gs_pk_live_…';
  return [
    `<script src="${base}/embed.js" async></script>`,
    `<galaxie-widget widget="${widgetId}" key="${key}"></galaxie-widget>`,
  ].join('\n');
}
