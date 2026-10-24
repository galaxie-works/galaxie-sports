/**
 * Job `channel-lists` (docs/07 §2.2.3): para cada lista de canais com sobras, refaz o casamento por
 * código, manda só as sobras de cada país para o modelo (Gemini por padrão), passa a saída pelo
 * validador determinístico e grava. Falha do provedor não perde nada: a lista fica `failed` com o
 * casamento por código e volta no próximo job com `--repetir-falhas`.
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
  universeRights,
  type AiBatch,
  type ChannelMatchOutput,
  type ChannelOverride,
  type ClientChannel,
  type WtwConfig,
  type WtwCountry,
} from '@galaxie/where-to-watch';
import type { LlmClient } from '../llm/types.js';

export interface ChannelListOutcome {
  tenantId: string;
  outcome: 'done' | 'failed' | 'stale';
  /** Pedidos ao modelo (um por país com sobras). */
  batches: number;
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
  log?: (msg: string) => void;
}

/** Listas que o job pegaria (sem chamar o modelo). */
export function pendingChannelLists(
  db: Database,
  opts: Pick<ChannelListRunOptions, 'max' | 'tenantIds' | 'retryFailed'> = {},
): Promise<TenantChannelList[]> {
  return listChannelListsForAi(db, {
    limit: opts.max ?? 10,
    retryFailed: opts.retryFailed ?? false,
    ...(opts.tenantIds?.length ? { tenantIds: opts.tenantIds } : {}),
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

/** Um pedido ao modelo por país: só índices e enums na saída (o validador confere depois). */
export function channelMatcher(
  llm: LlmClient,
  tenantId: string,
  onCall: (costUsd: number | undefined) => void = () => {},
): (batch: AiBatch) => Promise<ChannelMatchOutput> {
  return async (batch) => {
    const result = await llm.generateJson<ChannelMatchOutput>({
      tier: 'standard',
      system: CHANNEL_MATCH_SYSTEM,
      messages: [{ role: 'user', content: channelMatchInput(batch) }],
      schema: channelMatchSchema(batch),
      schemaName: CHANNEL_MATCH_SCHEMA_NAME,
      maxOutputTokens: 4_000,
      temperature: 0,
      purpose: `${CHANNEL_MATCH_PROMPT_VERSION}:${tenantId}:${batch.country}`,
    });
    onCall(result.usage.costUsd);
    return result.data;
  };
}

export async function runChannelLists(opts: ChannelListRunOptions): Promise<ChannelListOutcome[]> {
  const log = opts.log ?? (() => {});
  const dict = new ChannelDictionary(opts.config);
  const rows = await pendingChannelLists(opts.db, opts);
  const outcomes: ChannelListOutcome[] = [];
  for (const row of rows) {
    let cost: number | null = null;
    let calls = 0;
    const ai = channelMatcher(opts.llm, row.tenantId, (usd) => {
      calls++;
      if (usd !== undefined) cost = (cost ?? 0) + usd;
    });
    const input = processInputOf(row, opts.config, dict);
    try {
      const res = await processChannelList(input, ai);
      const omitted = res.batches.reduce((n, b) => n + b.omittedChannels, 0);
      const note = [
        res.batches.length ? `prompt ${CHANNEL_MATCH_PROMPT_VERSION}` : null,
        res.violations.length
          ? `${res.violations.length} violação(ões) do validador: ${res.violations.slice(0, 3).join('; ')}`
          : null,
        omitted ? `${omitted} canal(is) acima do limite por pedido ficaram de fora` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const saved = await saveChannelListAi(opts.db, row.tenantId, {
        processedAt: row.processedAt,
        proposed: res.matches,
        aiStatus: 'done',
        aiNote: note || null,
      });
      const matchedByAi = res.matches.filter((m) => m.origin === 'ia' && m.channels.length).length;
      outcomes.push({
        tenantId: row.tenantId,
        outcome: saved ? 'done' : 'stale',
        batches: calls,
        matchedByAi,
        violations: res.violations,
        costUsd: cost,
      });
      log(
        `${row.tenantId}: ${saved ? 'gravado' : 'lista mudou no meio, nada gravado'} — ${calls} pedido(s), ` +
          `${matchedByAi} casado(s) pela IA, ${res.violations.length} violação(ões)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // o casamento por código continua valendo; a IA tenta de novo depois
      const fallback = await processChannelList(input);
      await saveChannelListAi(opts.db, row.tenantId, {
        processedAt: row.processedAt,
        proposed: fallback.matches,
        aiStatus: 'failed',
        aiNote: `IA indisponível: ${message.slice(0, 300)}`,
      });
      outcomes.push({
        tenantId: row.tenantId,
        outcome: 'failed',
        batches: calls,
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
