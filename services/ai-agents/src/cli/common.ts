/** Utilitários das CLIs dos agentes: banco, cliente LLM opcional, flags e relatório. */
import { createDb, type Database } from '@galaxie/db';
import type { AgentRunReport } from '../context/run.js';
import { isAgentLocale, type AgentLocale } from '../guardrails/index.js';
import { aiStatusFromEnv } from '../llm/config.js';
import { createLlmClientFromEnv } from '../llm/factory.js';
import type { LlmClient } from '../llm/types.js';

export function dbFromEnv(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida (veja .env.example).');
  return createDb(url, { max: 4 });
}

/**
 * Cliente LLM do ambiente (AI_PROVIDER + chave) **com o orçamento diário de tokens** no ledger
 * compartilhado `ops.llm_usage` (`createLlmClientFromEnv(env, { db })`): todos os agentes e processos
 * descontam do mesmo AI_DAILY_TOKEN_BUDGET. Sem chave ou com configuração inválida devolve null — o
 * agente segue só com o texto/algoritmo determinístico.
 */
export function loadLlmClient(
  db: Database,
  env: Record<string, string | undefined> = process.env,
): { client: LlmClient | null; reason?: string } {
  try {
    // desligada, o motivo é esse (e não, por exemplo, a falta da chave do provedor)
    if (aiStatusFromEnv(env) === 'off') return { client: null, reason: 'IA desligada (AI_STATUS=off)' };
    return { client: createLlmClientFromEnv(env, { db }) };
  } catch (err) {
    return { client: null, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function llmOrNull(disabled: boolean | undefined, db: Database): LlmClient | null {
  if (disabled) {
    console.log('LLM desligado (--sem-llm): usando apenas texto determinístico.');
    return null;
  }
  const { client, reason } = loadLlmClient(db);
  if (!client) console.log(`LLM indisponível (${reason}): usando apenas texto determinístico.`);
  return client;
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
}
