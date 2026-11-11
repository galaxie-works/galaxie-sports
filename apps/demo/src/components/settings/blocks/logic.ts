/**
 * Regras puras dos blocos de Ajustes (#1074 a #1078): que controle cada chave do registro usa, quando a linha
 * mostra "alterado", o que o "Desligar todos" grava, a máscara dos segredos e as seções das credenciais. Sem
 * React nem servidor, para os testes.
 */
import {
  APISPORTS_APIS,
  POSTGAME_APIS,
  planKey,
  postgameIntervalKey,
  postgameModeKey,
  type SettingDef,
} from '@galaxie/runtime-config';

import { sortByLabel } from '@/lib/alphabetical';
import { settingsHref } from '@/lib/ops/settings-items';
import type { OpsSetting } from '@/lib/ops/types';

// ── Linha de ajuste (settings-3) ────────────────────────────────────────────────────────────────

/** Controle da linha pelo tipo do registro. */
export type ControlKind = 'switch' | 'toggle' | 'select' | 'markets' | 'input' | 'unit' | 'cron';

/** Liga/desliga literal (`off`/`on`): vira switch. */
export const isOnOff = (def: SettingDef): boolean =>
  def.type === 'enum' &&
  !def.allowEmpty &&
  def.options?.length === 2 &&
  def.options.includes('on') &&
  def.options.includes('off');

/**
 * switch (liga/desliga), toggle-group (2 a 4 opções, sem vazio), select (lista maior ou com "herdar"), seletor de
 * mercados, campo com unidade (minutos, %, US$) ou campo simples. O plano padrão fica no select (rótulos longos).
 */
export function controlKind(def: SettingDef, unit?: string): ControlKind {
  if (isOnOff(def)) return 'switch';
  if (def.type === 'enum') {
    const n = def.options?.length ?? 0;
    return !def.allowEmpty && n >= 2 && n <= 4 && def.key !== 'APISPORTS_PLAN' ? 'toggle' : 'select';
  }
  if (def.type === 'markets') return 'markets';
  if (def.type === 'cron') return 'cron';
  if ((def.type === 'int' || def.type === 'number') && unit) return 'unit';
  return 'input';
}

/** "alterado": o valor efetivo vem do painel (sobrescrita gravada e válida). */
export const isChanged = (s: Pick<OpsSetting, 'source' | 'overrideInvalid'>): boolean =>
  s.source === 'db' && !s.overrideInvalid;

/** "Obrigatório": a chave não tem padrão no código e não aceita vazio. */
export const isRequired = (def: SettingDef): boolean =>
  def.type !== 'secret' && def.default === null && !def.defaultBy && !def.allowEmpty;

/** "Voltar ao padrão do .env" só faz sentido quando há sobrescrita no painel (válida ou não). */
export const canReset = (s: Pick<OpsSetting, 'source' | 'overrideInvalid'>): boolean =>
  s.source === 'db' || s.overrideInvalid;

// ── Links (rotas da navegação nova de Ajustes, #1069) ──────────────────────────────────────────

/** Histórico das mudanças, filtrado na chave (`?chave=`). */
export const historyHref = (key: string): string =>
  `${settingsHref('history')}?chave=${encodeURIComponent(key)}`;

/** Todas as chaves são vistas em Credenciais (A4). */
export const CREDENTIALS_HREF = settingsHref('credentials');

// ── Uma linha por esporte (settings-2) ─────────────────────────────────────────────────────────

export interface SportEntry {
  api: string;
  label: string;
}

/** Esportes em ordem alfabética do idioma (rótulo traduzido), como os grupos e itens do menu. */
export function sportsByLabel(
  apis: readonly string[],
  names: Readonly<Record<string, string>>,
): SportEntry[] {
  return sortByLabel(apis.map((api) => ({ api, label: names[api] ?? api })));
}

/** As chaves do pós-jogo por esporte (modo e intervalo); o teto do dia fica fora. */
export const POSTGAME_SPORT_KEYS: ReadonlySet<string> = new Set(
  POSTGAME_APIS.flatMap((api) => [postgameModeKey(api), postgameIntervalKey(api)]),
);

/**
 * As linhas para o filtro "Alterados no painel" (#1072), que esconde por `id` = chave. O pós-jogo de um esporte é uma
 * linha só com duas chaves (modo e intervalo): o `id` da linha é o do modo (ou o do intervalo, sem o modo) e ela conta
 * como alterada quando qualquer uma das duas foi alterada. Assim a linha some só se nenhuma chave dela mudou, e o
 * intervalo (âncora dentro da linha) não é escondido sozinho.
 */
export function changedFilterRows<T extends { key: string; source: OpsSetting['source'] }>(
  settings: readonly T[],
): { key: string; source: OpsSetting['source'] }[] {
  const byKey = new Map(settings.map((s) => [s.key, s]));
  const merged = new Set<string>();
  const out: { key: string; source: OpsSetting['source'] }[] = [];
  for (const s of settings) {
    if (merged.has(s.key)) continue;
    const api = POSTGAME_APIS.find((a) => postgameModeKey(a) === s.key || postgameIntervalKey(a) === s.key);
    if (!api) {
      out.push({ key: s.key, source: s.source });
      continue;
    }
    const pair = [byKey.get(postgameModeKey(api)), byKey.get(postgameIntervalKey(api))].filter(
      (x): x is T => x !== undefined,
    );
    for (const p of pair) merged.add(p.key);
    out.push({ key: pair[0]!.key, source: pair.some((p) => p.source === 'db') ? 'db' : pair[0]!.source });
  }
  return out;
}

/** Planos por esporte (APISPORTS_PLAN_<API>); o plano padrão fica fora. */
export const PLAN_SPORT_KEYS: ReadonlySet<string> = new Set(APISPORTS_APIS.map((api) => planKey(api)));

/** Modo que o "Ligar" usa: o do .env ou o padrão do código, se não forem `off`; senão o fechamento. */
export function postgameOnValue(s: Pick<OpsSetting, 'envValue' | 'defaultValue'>): string {
  const base = s.envValue ?? s.defaultValue;
  return base && base !== 'off' ? base : 'fechamento';
}

/**
 * "Desligar todos" / "Ligar todos": as chaves de modo que mudam (chave → valor novo), a partir do rascunho atual.
 * Quem já está no estado pedido fica de fora (nada é regravado à toa).
 */
export function bulkPostgameChanges(
  settings: readonly OpsSetting[],
  draft: Readonly<Record<string, string>>,
  on: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const api of POSTGAME_APIS) {
    const key = postgameModeKey(api);
    const s = settings.find((x) => x.key === key);
    if (!s) continue;
    const current = draft[key] ?? s.value ?? '';
    const isOn = current !== 'off';
    if (on && !isOn) out[key] = postgameOnValue(s);
    if (!on && isOn) out[key] = 'off';
  }
  return out;
}

/** Chaves da linha que o "Voltar ao padrão do .env" apaga: só as que têm sobrescrita no painel (válida ou não). */
export const resettableKeys = (settings: readonly OpsSetting[]): string[] =>
  settings.filter(canReset).map((s) => s.key);

/**
 * O que o "Salvar" do plano por esporte faz com cada mudança: "herda o padrão" (vazio) apaga a sobrescrita
 * (`reset`) em vez de gravar texto vazio. Só quando o .env não tem valor próprio: aí apagar voltaria ao do .env, e
 * herdar exige gravar o vazio mesmo.
 */
export function planSaveOps(
  settings: readonly OpsSetting[],
  changes: Readonly<Record<string, string>>,
): { save: Record<string, string>; reset: string[] } {
  const save: Record<string, string> = {};
  const reset: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const s = settings.find((x) => x.key === key);
    if (value === '' && s && canReset(s) && !s.envValue) reset.push(key);
    else save[key] = value;
  }
  return { save, reset };
}

/** Rascunho → só o que difere do valor efetivo (o que o "Salvar" grava, uma chave por vez). */
export function draftChanges(
  settings: readonly OpsSetting[],
  draft: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) {
    const s = settings.find((x) => x.key === key);
    if (s && value !== (s.value ?? '')) out[key] = value;
  }
  return out;
}

// ── Credenciais e status (settings-4) ──────────────────────────────────────────────────────────

/** Nunca mostra o segredo: no máximo os 4 últimos caracteres, depois de pontos. Sem dica, só os pontos. */
export function maskSecret(hint: string | null | undefined): string {
  const tail = (hint ?? '').trim().slice(-4);
  return tail ? `•••• ${tail}` : '••••';
}

export type CredentialGroup = 'sports' | 'ai' | 'infra' | 'payments';
export const CREDENTIAL_GROUPS: readonly CredentialGroup[] = ['sports', 'ai', 'infra', 'payments'];

const GROUP_OF: Readonly<Record<string, CredentialGroup>> = {
  APISPORTS_KEY: 'sports',
  YOUTUBE_API_KEY: 'sports',
  OPENAI_API_KEY: 'ai',
  ANTHROPIC_API_KEY: 'ai',
  GEMINI_API_KEY: 'ai',
  STRIPE_SECRET_KEY: 'payments',
  STRIPE_WEBHOOK_SECRET: 'payments',
};

/** Chave de API do provedor de IA (AI_PROVIDER): é a única que o "Testar" confere (checkAiCreditNow). */
export const aiProviderKey = (provider: string | null | undefined): string | null =>
  provider ? `${provider.toUpperCase()}_API_KEY` : null;

/** Seção da chave em Credenciais: dados esportivos, IA, pagamentos; o resto é infraestrutura. */
export const credentialGroup = (key: string): CredentialGroup => GROUP_OF[key] ?? 'infra';

/** Segredos agrupados nas seções, na ordem fixa delas e, dentro de cada uma, por rótulo. */
export function groupCredentials<T extends { key: string; label: string }>(
  items: readonly T[],
): { group: CredentialGroup; items: T[] }[] {
  return CREDENTIAL_GROUPS.map((group) => ({
    group,
    items: sortByLabel(items.filter((i) => credentialGroup(i.key) === group)),
  })).filter((g) => g.items.length > 0);
}

// ── IA interna (ai-usage-1) ────────────────────────────────────────────────────────────────────

/** Marcas da régua: de `min` a `max` em `count` passos iguais (as pontas incluídas). */
export function rulerMarks(min: number, max: number, count = 5): number[] {
  if (count < 2 || max <= min) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round((min + step * i) * 100) / 100);
}

/** Parte do teto já gasta (0 a 100, arredondada); sem teto, null. */
export function capPercent(spent: number, cap: number | null): number | null {
  if (cap === null || cap <= 0) return null;
  return Math.min(100, Math.round((spent / cap) * 100));
}

/** Os `top` agentes que mais gastaram e o resto somado em "Outros" (os sem gasto ficam de fora). */
export function spendParts(
  agents: readonly { agent: string; costUsd: number }[],
  top = 3,
): { parts: { agent: string; costUsd: number }[]; others: number } {
  const sorted = agents.filter((a) => a.costUsd > 0).sort((a, b) => b.costUsd - a.costUsd);
  const others = sorted.slice(top).reduce((s, a) => s + a.costUsd, 0);
  return { parts: sorted.slice(0, top), others: Math.round(others * 10_000) / 10_000 };
}

/** Agentes com provedor e modelo próprios (as chaves de cada um, na ordem em que aparecem no cartão). */
export const AI_MODEL_AGENTS = [
  { id: 'general', keys: ['AI_PROVIDER', 'AI_MODEL_LIGHT', 'AI_MODEL_STANDARD', 'AI_MODEL_RESEARCH'] },
  { id: 'review', keys: ['AI_REVIEW_PROVIDER', 'AI_REVIEW_MODEL'] },
  { id: 'channels', keys: ['AI_CHANNELS_PROVIDER', 'AI_CHANNELS_MODEL'] },
  { id: 'matchChannel', keys: ['AI_MATCH_CHANNEL_PROVIDER', 'AI_MATCH_CHANNEL_MODEL'] },
  { id: 'rights', keys: ['AI_RIGHTS_PROVIDER', 'AI_RIGHTS_MODEL'] },
] as const;
export type AiModelAgent = (typeof AI_MODEL_AGENTS)[number]['id'];

export const AI_MODEL_KEYS: ReadonlySet<string> = new Set(AI_MODEL_AGENTS.flatMap((a) => [...a.keys]));

// ── Integrações (settings-6) ───────────────────────────────────────────────────────────────────

/**
 * Estado do cartão do GitHub: conectado com repo e token legível; atenção quando o token gravado não abre ou falta
 * uma das duas partes; desconectado sem nenhuma.
 */
export function githubIntegrationState(
  repo: string | null,
  token: { tokenInPanel: boolean; tokenUnreadable: boolean; envTokenConfigured: boolean },
): 'connected' | 'disconnected' | 'attention' {
  const hasToken = (token.tokenInPanel && !token.tokenUnreadable) || token.envTokenConfigured;
  if (token.tokenUnreadable && !token.envTokenConfigured) return 'attention';
  if (repo && hasToken) return 'connected';
  if (repo || hasToken) return 'attention';
  return 'disconnected';
}
