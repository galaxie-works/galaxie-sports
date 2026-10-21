/** Utilitários das CLIs dos agentes: banco, cliente LLM opcional, flags e relatório. */
import { createDb, type Database } from '@galaxie/db';
import type { AgentRunReport } from '../context/run.js';
import { isAgentLocale, type AgentLocale } from '../guardrails/index.js';
import type { LlmClient } from '../llm/types.js';

export function dbFromEnv(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definida (veja .env.example).');
  return createDb(url, { max: 4 });
}

/** Fábricas de cliente LLM procuradas no módulo `src/llm` (implementado à parte, por provedor). */
const FACTORY_NAMES = ['createLlmClientFromEnv', 'createLlmClient', 'llmClientFromEnv'];
const MODULES = ['../llm/index.js', '../llm/client.js', '../llm/factory.js'];

/**
 * Carrega o cliente LLM configurado por ambiente (AI_PROVIDER + chaves). Sem módulo, sem chave
 * ou com erro de configuração devolve null: os agentes seguem só com texto determinístico.
 */
export async function loadLlmClient(): Promise<{ client: LlmClient | null; reason?: string }> {
  for (const spec of MODULES) {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(new URL(spec, import.meta.url).href)) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const name of FACTORY_NAMES) {
      const factory = mod[name];
      if (typeof factory !== 'function') continue;
      try {
        const client = (await (factory as () => unknown)()) as LlmClient | null;
        if (client && typeof client.generateJson === 'function') return { client };
      } catch (err) {
        return { client: null, reason: err instanceof Error ? err.message : String(err) };
      }
    }
  }
  return { client: null, reason: 'nenhuma fábrica de cliente LLM encontrada em src/llm' };
}

export async function llmOrNull(disabled: boolean | undefined): Promise<LlmClient | null> {
  if (disabled) {
    console.log('LLM desligado (--sem-llm): usando apenas texto determinístico.');
    return null;
  }
  const { client, reason } = await loadLlmClient();
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
