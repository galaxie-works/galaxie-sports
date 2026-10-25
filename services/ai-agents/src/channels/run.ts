/**
 * Job `channel-lists` (docs/07 §2.2.3): para cada lista de canais com sobras, refaz o casamento por
 * código, manda só as sobras de cada país para o modelo (Gemini por padrão), passa a saída pelo
 * validador determinístico e grava. Falha do provedor não perde nada: a lista fica `failed` com o
 * casamento por código e volta no próximo job com `--repetir-falhas`. Cada lista faz no máximo
 * `CHANNEL_LIST_MAX_BATCHES` pedidos por rodada: o resto fica para a próxima (a lista segue
 * `pending`, com as decisões já feitas gravadas e reaproveitadas).
 */
import { listChannelListsForAi, saveChannelListAi, type Database, type TenantChannelList } from '@galaxie/db';
import {
  CHANNEL_MATCH_PROMPT_VERSION,
  CHANNEL_MATCH_SCHEMA_NAME,
  CHANNEL_MATCH_SYSTEM,
  ChannelDictionary,
  channelMatchInput,
  channelMatchSchema,
  processChannelList,
  rightKey,
  universeRights,
  validateAiMatches,
  type AiBatch,
  type ChannelMatchOutput,
  type ChannelOverride,
  type ClientChannel,
  type RightMatch,
  type WtwConfig,
  type WtwCountry,
} from '@galaxie/where-to-watch';
import type { LlmClient } from '../llm/types.js';

export interface ChannelListOutcome {
  tenantId: string;
  /** `partial` = gravada, mas com pedidos para a próxima rodada (segue `pending`). */
  outcome: 'done' | 'partial' | 'failed' | 'stale';
  /** Pedidos ao modelo nesta rodada (um ou mais por país com sobras, até o teto por lista). */
  batches: number;
  /** Pedidos que passaram do teto e ficaram para a próxima rodada. */
  deferred: number;
  /** Direitos que a IA casou com canal (depois do validador). */
  matchedByAi: number;
  violations: string[];
  costUsd: number | null;
  error?: string;
}

export interface ChannelListRunOptions {
  db: Database;
  llm: LlmClient;
  config: WtwConfig;
  max?: number;
  tenantIds?: string[];
  retryFailed?: boolean;
  /** Teto de pedidos ao modelo por lista nesta rodada (padrão `CHANNEL_LIST_MAX_BATCHES`). */
  maxBatches?: number;
  log?: (msg: string) => void;
}

/** Pedidos ao modelo por lista numa rodada (lista enorme não come a rodada nem o orçamento do dia). */
export const CHANNEL_LIST_MAX_BATCHES = 6;

/**
 * Listas que o job pegaria (sem chamar o modelo). Com `--tenant`, a falha volta na hora (sem o
 * intervalo mínimo entre tentativas do job agendado).
 */
export function pendingChannelLists(
  db: Database,
  opts: Pick<ChannelListRunOptions, 'max' | 'tenantIds' | 'retryFailed'> = {},
): Promise<TenantChannelList[]> {
  return listChannelListsForAi(db, {
    limit: opts.max ?? 10,
    retryFailed: opts.retryFailed ?? false,
    ...(opts.tenantIds?.length ? { tenantIds: opts.tenantIds, failedRetryAfterMs: 0 } : {}),
  });
}

const isCountry = (config: WtwConfig, c: string | null): c is WtwCountry => !!c && config.has(c);

/** Entrada do processamento a partir da linha do banco. */
export function processInputOf(row: TenantChannelList, config: WtwConfig, dict: ChannelDictionary) {
  return {
    channels: row.channels as ClientChannel[],
    rights: universeRights(config, row.markets),
    dict,
    defaultCountry: isCountry(config, row.defaultCountry) ? row.defaultCountry : null,
    overrides: row.overrides as ChannelOverride[],
  };
}

/**
 * Um pedido ao modelo por lote (as sobras de um país, ou parte delas acima do limite de canais): só
 * índices e enums na saída (o validador confere depois). O `purpose` leva o país e o índice do lote
 * na lista de sobras (`plan.batches`, estável entre rodadas: `:CO:0`, `:CO:1`, `:MX:2`), para cada
 * pedido ter a sua linha no ops.llm_usage. Sem o índice (processChannelList chama todos os lotes em
 * ordem), vale a ordem da chamada, que é a mesma.
 */
export function channelMatcher(
  llm: LlmClient,
  tenantId: string,
  onCall: (costUsd: number | undefined) => void = () => {},
): (batch: AiBatch, lot?: number) => Promise<ChannelMatchOutput> {
  let calls = 0;
  return async (batch, lot) => {
    const n = lot ?? calls;
    calls++;
    const result = await llm.generateJson<ChannelMatchOutput>({
      tier: 'standard',
      system: CHANNEL_MATCH_SYSTEM,
      messages: [{ role: 'user', content: channelMatchInput(batch) }],
      schema: channelMatchSchema(batch),
      schemaName: CHANNEL_MATCH_SCHEMA_NAME,
      maxOutputTokens: 4_000,
      temperature: 0,
      purpose: `${CHANNEL_MATCH_PROMPT_VERSION}:${tenantId}:${batch.country}:${n}`,
    });
    onCall(result.usage.costUsd);
    return result.data;
  };
}

export async function runChannelLists(opts: ChannelListRunOptions): Promise<ChannelListOutcome[]> {
  const log = opts.log ?? (() => {});
  const dict = new ChannelDictionary(opts.config);
  const cap = Math.max(1, opts.maxBatches ?? CHANNEL_LIST_MAX_BATCHES);
  const rows = await pendingChannelLists(opts.db, opts);
  const outcomes: ChannelListOutcome[] = [];
  for (const row of rows) {
    let cost: number | null = null;
    let calls = 0;
    const ai = channelMatcher(opts.llm, row.tenantId, (usd) => {
      calls++;
      if (usd !== undefined) cost = (cost ?? 0) + usd;
    });
    // código e correções do cliente, sem IA: as sobras saem em `plan.batches`
    const plan = await processChannelList(processInputOf(row, opts.config, dict));
    const leftover = new Set(plan.batches.flatMap((b) => b.rights.map(rightKey)));
    // decisões da IA já gravadas nas sobras (rodada que parou no teto, ou correção que reabriu a
    // lista): valem, e só os lotes com direito ainda sem decisão vão ao modelo
    const fromAi = new Map(
      row.proposed
        .filter((m) => m.origin === 'ia' && leftover.has(rightKey(m)))
        .map((m) => [rightKey(m), m as RightMatch]),
    );
    const todo = plan.batches.filter((b) => b.rights.some((r) => !fromAi.has(rightKey(r))));
    const batches = todo.slice(0, cap);
    const deferred = todo.length - batches.length;
    const merged = () => plan.matches.map((m) => fromAi.get(rightKey(m)) ?? m);
    try {
      const violations: string[] = [];
      for (const batch of batches) {
        const v = validateAiMatches(batch, await ai(batch, plan.batches.indexOf(batch)), dict);
        for (const m of v.matches) fromAi.set(rightKey(m), m);
        violations.push(...v.violations);
      }
      const omitted = plan.batches.reduce((n, b) => n + b.omittedChannels, 0);
      const note = [
        plan.batches.length ? `prompt ${CHANNEL_MATCH_PROMPT_VERSION}` : null,
        violations.length
          ? `${violations.length} violação(ões) do validador: ${violations.slice(0, 3).join('; ')}`
          : null,
        omitted ? `${omitted} canal(is) acima do limite por direito ficaram de fora` : null,
        deferred ? `${deferred} pedido(s) para a próxima rodada` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const matches = merged();
      const saved = await saveChannelListAi(opts.db, row.tenantId, {
        processedAt: row.processedAt,
        revision: row.revision,
        proposed: matches,
        aiStatus: deferred ? 'pending' : 'done',
        aiNote: note || null,
      });
      const matchedByAi = matches.filter((m) => m.origin === 'ia' && m.channels.length).length;
      outcomes.push({
        tenantId: row.tenantId,
        outcome: saved ? (deferred ? 'partial' : 'done') : 'stale',
        batches: calls,
        deferred,
        matchedByAi,
        violations,
        costUsd: cost,
      });
      log(
        `${row.tenantId}: ${saved ? 'gravado' : 'lista mudou no meio, nada gravado'} — ${calls} pedido(s), ` +
          `${matchedByAi} casado(s) pela IA, ${violations.length} violação(ões)` +
          (deferred ? `; ${deferred} pedido(s) acima do teto de ${cap} ficaram para a próxima rodada` : ''),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // o casamento por código (e o que a IA já tinha decidido) continua valendo; a IA tenta de novo depois
      await saveChannelListAi(opts.db, row.tenantId, {
        processedAt: row.processedAt,
        revision: row.revision,
        proposed: merged(),
        aiStatus: 'failed',
        aiNote: `IA indisponível: ${message.slice(0, 300)}`,
      });
      outcomes.push({
        tenantId: row.tenantId,
        outcome: 'failed',
        batches: calls,
        deferred,
        matchedByAi: 0,
        violations: [],
        costUsd: cost,
        error: message,
      });
      log(`${row.tenantId}: falhou — ${message}`);
    }
  }
  return outcomes;
}
