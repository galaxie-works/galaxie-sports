/**
 * Processamento da lista do cliente, ponta a ponta e sem banco: normaliza, casa pelo dicionário,
 * manda só as sobras para a IA (quando há uma), valida a saída dela e aplica as correções do cliente.
 */
import type { WtwConfig } from '../config/directory.js';
import type { WtwCountry } from '../config/types.js';
import { normalizeName } from '../normalize.js';
import { aiBatches, validateAiMatches, type AiBatch } from './ai.js';
import { analyzeChannel } from './analyze.js';
import {
  ChannelDictionary,
  matchDeterministic,
  mergeMatches,
  noChannel,
  resolveChannels,
  universeRights,
  type ResolvedChannel,
} from './match.js';
import { matchBase, rightKey, type ChannelRight, type ClientChannel, type RightMatch } from './types.js';

/** Correção do cliente num direito: os canais (pela chave do nome) que levam a emissora; [] = nenhum. */
export interface ChannelOverride {
  country: WtwCountry;
  broadcasterId: string;
  channelKeys: string[];
}

/** Chave estável de um canal entre versões da lista (o índice muda; o nome não). */
export const clientChannelKey = (name: string) => normalizeName(name);

export interface ProcessInput {
  channels: ClientChannel[];
  rights: ChannelRight[];
  dict: ChannelDictionary;
  defaultCountry?: WtwCountry | null;
  overrides?: ChannelOverride[];
}

export interface ProcessResult {
  matches: RightMatch[];
  resolved: ResolvedChannel[];
  /** Pedidos que iriam (ou foram) para a IA. */
  batches: AiBatch[];
  violations: string[];
}

/** Aplica as correções do cliente: os canais escolhidos, `exato` no país e `feed_generico` fora dele. */
function overrideMatches(
  rights: ChannelRight[],
  resolved: ResolvedChannel[],
  overrides: ChannelOverride[],
): RightMatch[] {
  const byKey = new Map<string, ResolvedChannel[]>();
  for (const c of resolved) {
    const k = clientChannelKey(c.facts.name);
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }
  const rightsByKey = new Map(rights.map((r) => [rightKey(r), r]));
  return overrides.flatMap((o) => {
    const r = rightsByKey.get(rightKey(o));
    if (!r) return [];
    const chosen = o.channelKeys.flatMap((k) => byKey.get(k) ?? []);
    if (!chosen.length) return [noChannel(r, 'cliente', 'Sem canal na lista, pelo cliente.')];
    const sameCountry = chosen.every((c) => c.country === r.country);
    return [
      {
        ...matchBase(r),
        match: sameCountry ? ('exato' as const) : ('feed_generico' as const),
        channels: chosen.map((c) => c.facts.idx),
        origin: 'cliente' as const,
        note: 'Corrigido pelo cliente.',
      },
    ];
  });
}

/**
 * Casamento da lista. Sem `ai`, as sobras ficam `sem_canal_na_lista` e `batches` diz o que a IA ainda
 * tem a conferir; com `ai`, cada pedido é validado antes de entrar. Correções do cliente vencem tudo e
 * não vão para a IA.
 */
export async function processChannelList(
  input: ProcessInput,
  ai?: (batch: AiBatch) => Promise<unknown>,
): Promise<ProcessResult> {
  const { dict, rights } = input;
  const overrides = input.overrides ?? [];
  const facts = input.channels.map((c) => analyzeChannel(c, input.defaultCountry ?? null));
  const resolved = resolveChannels(facts, dict);
  const fixed = new Set(overrides.map(rightKey));
  const open = rights.filter((r) => !fixed.has(rightKey(r)));
  const det = matchDeterministic(open, resolved, dict);
  const batches = aiBatches(det.leftoverRights, det.leftoverChannels, dict);
  const violations: string[] = [];
  const fromAi: RightMatch[] = [];
  if (ai)
    for (const batch of batches) {
      const v = validateAiMatches(batch, await ai(batch), dict);
      fromAi.push(...v.matches);
      violations.push(...v.violations);
    }
  return {
    matches: mergeMatches(rights, det.decided, fromAi, overrideMatches(rights, resolved, overrides)),
    resolved,
    batches,
    violations,
  };
}

const dictionaries = new WeakMap<WtwConfig, ChannelDictionary>();

/** Dicionário de casamento da configuração (montado uma vez por configuração). */
export function channelDictionary(config: WtwConfig): ChannelDictionary {
  let d = dictionaries.get(config);
  if (!d) dictionaries.set(config, (d = new ChannelDictionary(config)));
  return d;
}

/** Países dos direitos: os mercados do tenant que o onde assistir cobre (vazio = todos). */
export function rightsMarkets(config: WtwConfig, tenantMarkets: readonly string[]): WtwCountry[] {
  const wanted = tenantMarkets.map((m) => m.toUpperCase());
  return config.countries.filter((c) => !wanted.length || wanted.includes(c));
}

/**
 * Casamento por código da lista de um tenant contra todas as emissoras dos mercados dele (sem IA):
 * o que a API e o portal gravam no envio, na correção e no reprocessamento. `aiPending` = há sobras
 * com candidato para o job `channel-lists` conferir.
 */
export async function proposeChannelMatches(
  config: WtwConfig,
  input: {
    channels: ClientChannel[];
    tenantMarkets: readonly string[];
    defaultCountry: WtwCountry | null;
    overrides: ChannelOverride[];
  },
): Promise<{ matches: RightMatch[]; aiPending: boolean; markets: WtwCountry[] }> {
  const markets = rightsMarkets(config, input.tenantMarkets);
  const res = await processChannelList({
    channels: input.channels,
    rights: universeRights(config, markets),
    dict: channelDictionary(config),
    defaultCountry: input.defaultCountry,
    overrides: input.overrides,
  });
  return { matches: res.matches, aiPending: res.batches.length > 0, markets };
}
