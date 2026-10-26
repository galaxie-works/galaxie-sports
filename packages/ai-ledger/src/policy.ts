/**
 * Política de execução versionada (config/ai-policy.yaml, #357): a faixa de orçamento de cada agente e as
 * exceções de prioridade por competição. As porcentagens das faixas, o teto global, o corte P0/P1 e a virada
 * do dia ficam nas runtime settings (painel); aqui fica o que muda com o código, por PR.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AI_CALL_BANDS, type AiCallBand } from '@galaxie/runtime-config';
import { parse } from 'yaml';
import { LlmError } from './errors.js';
import { agentKey } from './state.js';

/** Faixa de um agente: fixa, ou `priority` (a prioridade da competição da chamada: p0, p1 ou rest). */
export type AgentBand = AiCallBand | 'priority';

/** Prioridade de uma chamada pela competição (`rest` = fora do futebol que o produto prioriza). */
export type AiPriority = 'p0' | 'p1' | 'rest';

export interface AiPolicy {
  agents: Record<string, AgentBand>;
  /** Faixa do agente fora da lista. */
  defaultBand: AiCallBand;
  /** Exceções por competição (slug), acima da regra da audiência. */
  competitions: { p0: readonly string[]; p1: readonly string[] };
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** Arquivo da política: AI_POLICY_FILE (imagem) ou config/ai-policy.yaml do repositório. */
export function defaultAiPolicyFile(env: Record<string, string | undefined> = process.env): string {
  return (
    env.AI_POLICY_FILE?.trim() || fileURLToPath(new URL('../../../config/ai-policy.yaml', import.meta.url))
  );
}

const invalid = (why: string) => new LlmError(`config/ai-policy.yaml inválido: ${why}.`, 'config', false);

/** Valida o YAML já interpretado. */
export function parseAiPolicy(raw: unknown): AiPolicy {
  const doc = raw as {
    schema_version?: unknown;
    agents?: unknown;
    default_band?: unknown;
    competitions?: unknown;
  } | null;
  if (!doc || typeof doc !== 'object') throw invalid('o arquivo precisa ser um objeto');
  if (doc.schema_version !== 1) throw invalid('schema_version precisa ser 1');
  const bands: readonly string[] = AI_CALL_BANDS;
  const agents: Record<string, AgentBand> = {};
  if (!doc.agents || typeof doc.agents !== 'object')
    throw invalid('agents precisa ser um mapa agente: faixa');
  for (const [name, band] of Object.entries(doc.agents as Record<string, unknown>)) {
    if (typeof band !== 'string' || (band !== 'priority' && !bands.includes(band)))
      throw invalid(`agents.${name}: use priority ou uma faixa (${AI_CALL_BANDS.join(', ')})`);
    agents[agentKey(name)] = band as AgentBand;
  }
  const defaultBand = doc.default_band ?? 'rest';
  if (typeof defaultBand !== 'string' || !bands.includes(defaultBand))
    throw invalid(`default_band: use uma faixa (${AI_CALL_BANDS.join(', ')})`);
  const comps = (doc.competitions ?? {}) as Record<string, unknown>;
  const list = (key: 'p0' | 'p1'): string[] => {
    const v = comps[key] ?? [];
    if (!Array.isArray(v) || v.some((s) => typeof s !== 'string' || !SLUG.test(s)))
      throw invalid(`competitions.${key} precisa ser uma lista de slugs`);
    return v as string[];
  };
  const p0 = list('p0');
  const p1 = list('p1');
  const both = p0.filter((s) => p1.includes(s));
  if (both.length) throw invalid(`competição em p0 e p1 ao mesmo tempo: ${both.join(', ')}`);
  for (const key of Object.keys(comps))
    if (key !== 'p0' && key !== 'p1') throw invalid(`competitions.${key}: só p0 e p1`);
  return { agents, defaultBand: defaultBand as AiCallBand, competitions: { p0, p1 } };
}

/**
 * Política vazia: todo agente cai em `default_band` (`rest`) e nenhuma competição é exceção. É o que vale
 * quando config/ai-policy.yaml falta ou é inválido (`loadAiPolicyOrEmpty`): os jobs seguem e gravam o
 * determinístico, em vez de sair com erro.
 */
export const EMPTY_AI_POLICY: AiPolicy = {
  agents: {},
  defaultBand: 'rest',
  competitions: { p0: [], p1: [] },
};

/** Lê e valida a política; sem o arquivo, ou com ele inválido, lança LlmError `config`. */
export function loadAiPolicy(file = defaultAiPolicyFile()): AiPolicy {
  if (!existsSync(file))
    throw new LlmError(`Política de IA não encontrada: ${file} (AI_POLICY_FILE).`, 'config', false);
  return parseAiPolicy(parse(readFileSync(file, 'utf8')));
}

const warnedPolicy = new Set<string>();

/**
 * Como `loadAiPolicy`, mas sem derrubar quem chama: arquivo ausente ou inválido sai no log (uma vez por
 * processo e arquivo) e vale a política vazia (`EMPTY_AI_POLICY`).
 */
export function loadAiPolicyOrEmpty(file = defaultAiPolicyFile()): AiPolicy {
  try {
    return loadAiPolicy(file);
  } catch (err) {
    if (!warnedPolicy.has(file)) {
      warnedPolicy.add(file);
      console.warn(
        `[política de IA] ${err instanceof Error ? err.message : String(err)} Seguindo com a política vazia: todo agente na faixa rest, sem exceções por competição.`,
      );
    }
    return EMPTY_AI_POLICY;
  }
}

/**
 * Faixa da chamada: execução fora do scheduler cai em `manual`; agente `priority` usa a prioridade da
 * competição (sem competição, `rest`); agente com faixa fixa usa a dele; fora da lista, `defaultBand`.
 */
export function bandFor(
  policy: AiPolicy,
  agent: string,
  priority: AiPriority | undefined,
  manual: boolean,
): AiCallBand {
  if (manual) return 'manual';
  const band = policy.agents[agentKey(agent)] ?? policy.defaultBand;
  return band === 'priority' ? (priority ?? 'rest') : band;
}
