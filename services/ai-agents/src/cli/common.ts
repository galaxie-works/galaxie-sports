/** Utilitários das CLIs dos agentes: banco, cliente LLM opcional, flags e relatório. */
import { createDb, readRuntimeOverrides, type Database } from '@galaxie/db';
import { DEFAULT_P0_MIN_AUDIENCE, ledgerSettingsFromEnv } from '@galaxie/ai-ledger';
import { EXIT_BUDGET_SKIPPED, applyOverrides } from '@galaxie/runtime-config';
import type { AgentRunReport } from '../context/run.js';
import { isAgentLocale, type AgentLocale } from '../guardrails/index.js';
import { agentStatusFromEnv, aiStatusFromEnv } from '../llm/config.js';
import { LlmError } from '../llm/errors.js';
import { createLlmClient, createLlmClientFromEnv, type LlmRuntime } from '../llm/factory.js';
import { priorityResolver, type PriorityResolver } from '../llm/priority.js';
import type { LlmClient } from '../llm/types.js';

export function dbFromEnv(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida (veja .env.example).');
  return createDb(url, { max: 4 });
}

type Env = Record<string, string | undefined>;

/**
 * Env do processo com as sobrescritas do painel por cima (ops.runtime_setting), o mesmo que o scheduler
 * entrega aos jobs: uma CLI rodada à mão respeita, por exemplo, o AI_STATUS=off gravado no painel.
 * Sobrescrita antiga convertida (ex.: AI_DAILY_USD_BUDGET=0 → AI_STATUS=off) sai no log. Sem a tabela
 * (banco antigo, testes), segue com o env.
 */
export async function runtimeEnv(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  try {
    const applied = applyOverrides(env, await readRuntimeOverrides(db));
    for (const c of applied.converted)
      console.warn(
        `Configuração antiga do painel convertida: ${c.key}=${c.from} → ${Object.entries(c.to)
          .map(([k, v]) => `${k}=${v ?? '(padrão)'}`)
          .join(', ')}.`,
      );
    return applied.env;
  } catch {
    return env;
  }
}

/** Motivo de a IA não rodar para o agente (global ou do agente desligado); null = ligada. */
export function aiOffReason(env: Env, agent?: string): string | null {
  if (aiStatusFromEnv(env) === 'off') return 'IA desligada (AI_STATUS=off)';
  if (agent && agentStatusFromEnv(env)[agent] === 'off')
    return `IA desligada para ${agent} (AI_AGENT_STATUS)`;
  return null;
}

/**
 * Cliente de um agente com o env do painel aplicado. Com a IA desligada (global ou do agente) lança
 * LlmError com o motivo, antes de montar o provedor: a CLI cai no mesmo caminho do "sem LLM", sem
 * chamar nada nem marcar falha.
 */
export async function createAgentLlm(
  db: Database,
  agent: string,
  envFor: (env: Env) => Env = (env) => env,
): Promise<LlmRuntime> {
  const env = envFor(await runtimeEnv(db));
  const off = aiOffReason(env, agent);
  if (off) throw new LlmError(off, 'config', false);
  return createLlmClient({ db, env });
}

/**
 * Cliente LLM do ambiente (AI_PROVIDER + chave) **com o orçamento diário de tokens** no ledger
 * compartilhado `ops.llm_usage` (`createLlmClientFromEnv(env, { db })`): todos os agentes e processos
 * descontam do mesmo AI_DAILY_TOKEN_BUDGET. Sem chave, com configuração inválida ou com a IA desligada
 * devolve null — o agente segue só com o texto/algoritmo determinístico.
 */
export function loadLlmClient(
  db: Database,
  env: Env = process.env,
  agent?: string,
): { client: LlmClient | null; reason?: string } {
  try {
    // desligada, o motivo é esse (e não, por exemplo, a falta da chave do provedor)
    const off = aiOffReason(env, agent);
    if (off) return { client: null, reason: off };
    return { client: createLlmClientFromEnv(env, { db }) };
  } catch (err) {
    return { client: null, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Cliente das CLIs de agente (env com o painel); null com --sem-llm, IA desligada ou sem configuração. */
export async function llmOrNull(
  disabled: boolean | undefined,
  db: Database,
  agent?: string,
): Promise<LlmClient | null> {
  if (disabled) {
    console.log('LLM desligado (--sem-llm): usando apenas texto determinístico.');
    return null;
  }
  const { client, reason } = loadLlmClient(db, await runtimeEnv(db), agent);
  if (!client) console.log(`LLM indisponível (${reason}): usando apenas texto determinístico.`);
  return client;
}

/**
 * Prioridade por competição (#357) com o corte do painel (AI_P0_MIN_AUDIENCE) e config/ai-policy.yaml:
 * a fila do resumo e do cenário sai em P0 → P1 → resto, e só P0 e P1 chamam o LLM.
 */
export async function priorityFor(db: Database): Promise<PriorityResolver> {
  const env = await runtimeEnv(db);
  let minAudience = DEFAULT_P0_MIN_AUDIENCE;
  try {
    minAudience = ledgerSettingsFromEnv(env).p0MinAudience;
  } catch {
    // configuração da IA inválida: o LLM já fica de fora (llmOrNull); a fila usa o corte padrão
  }
  return priorityResolver({ minAudience, env });
}

export function intFlag(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${flag} precisa ser um inteiro ≥ 0 (recebido: ${String(value)}).`);
  return n;
}

export function localesFlag(value: unknown): AgentLocale[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const list = value.split(',').map((v) => v.trim());
  const bad = list.filter((l) => !isAgentLocale(l));
  if (bad.length) throw new Error(`Locale(s) inválido(s): ${bad.join(', ')}.`);
  return list as AgentLocale[];
}

const ACTION_LABEL: Record<string, string> = {
  generated: 'gerado',
  planned: 'geraria',
  skipped: 'pulado',
  error: 'erro',
};

export function printAgentReport(report: AgentRunReport, plan: boolean): void {
  const rows = report.items.map((i) => ({
    evento: i.eventId,
    jogo: i.label,
    inicio: i.startsAt.slice(0, 16).replace('T', ' '),
    acao: ACTION_LABEL[i.action] ?? i.action,
    prioridade: i.priority ?? '',
    detalhe: i.reason ?? i.summary ?? '',
    llm: i.origins ? `${i.origins.llm}/${i.origins.llm + i.origins.fallback}` : '',
  }));
  if (rows.length) console.table(rows);
  else console.log('Nenhum evento candidato na janela.');
  if (plan) {
    console.log(
      `Plano (${report.agent}): ${report.items.filter((i) => i.action === 'planned').length} evento(s) seriam gerados. Nada foi gravado.`,
    );
    return;
  }
  const u = report.usage;
  console.log(
    `${report.agent}: ${report.generated} evento(s) gerado(s) · ${report.llmCalls} chamada(s) ao LLM · ` +
      `${u.inputTokens}+${u.outputTokens} tokens · US$ ${u.costUsd.toFixed(4)}`,
  );
  if (report.items.some((i) => i.action === 'error')) process.exitCode = 1;
  else if (report.budgetSkipped) {
    // faixa (ou teto) esgotada: o texto determinístico foi gravado; o scheduler registra `budget_skipped`
    console.log(
      `status: budget_skipped · ${report.budgetSkipped} evento(s) com o texto determinístico (orçamento de IA recusou)`,
    );
    process.exitCode = EXIT_BUDGET_SKIPPED;
  }
}
