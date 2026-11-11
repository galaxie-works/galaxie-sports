/**
 * Provedor e modelo de cada função da Cosmos (#1088). A equipe Galaxie escolhe por função, no catálogo
 * (`cosmos.function_def`); sem escolha, vale o padrão. O preço vem da tabela do ai-ledger, e o crédito sai do custo
 * real: trocar para um modelo mais barato baixa os créditos cobrados sem mexer nos pacotes.
 */
import { MODEL_PRICES } from '@galaxie/ai-ledger/pricing';
import { COSMOS_PROVIDERS, type CosmosProvider } from '@galaxie/db/schema';
import { AI_DEFAULT_MODELS } from '@galaxie/runtime-config';

export { COSMOS_PROVIDERS, type CosmosProvider };

/** Provedor das funções sem escolha. */
export const COSMOS_DEFAULT_PROVIDER: CosmosProvider = 'anthropic';

/** Modelo leve de cada provedor (o mesmo nível dos agentes internos); o DeepSeek ainda fora do registro. */
const LIGHT_MODELS: Record<CosmosProvider, string> = {
  anthropic: AI_DEFAULT_MODELS.light.anthropic,
  openai: AI_DEFAULT_MODELS.light.openai,
  gemini: AI_DEFAULT_MODELS.light.gemini,
  deepseek: 'deepseek-chat',
};

export const defaultModelFor = (provider: CosmosProvider): string => LIGHT_MODELS[provider];

export const isCosmosProvider = (value: unknown): value is CosmosProvider =>
  typeof value === 'string' && (COSMOS_PROVIDERS as readonly string[]).includes(value);

/** Provedor e modelo efetivos de uma função. */
export interface FunctionModel {
  provider: CosmosProvider;
  model: string;
}

/** O que está gravado na função (null = padrão) vira o provedor e o modelo que a chamada usa. */
export function resolveFunctionModel(row: {
  provider: CosmosProvider | null;
  model: string | null;
}): FunctionModel {
  const provider = row.provider ?? COSMOS_DEFAULT_PROVIDER;
  return { provider, model: row.model?.trim() || defaultModelFor(provider) };
}

const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,80}$/;
const DATED = /-\d{4}-\d{2}-\d{2}$/;

/**
 * O modelo pode ser cobrado? Precisa ter preço próprio na tabela do ai-ledger: o nome exato ou um snapshot datado
 * dele (`modelo-AAAA-MM-DD`). Sem preço, o custo sairia zero; casar por prefixo cobraria um modelo novo pelo preço
 * de outro.
 */
export function isPricedModel(model: string): boolean {
  if (!MODEL_ID.test(model)) return false;
  if (MODEL_PRICES[model]) return true;
  return DATED.test(model) && Boolean(MODEL_PRICES[model.replace(DATED, '')]);
}

/** Prefixo dos modelos de cada provedor: modelo de um provedor chamado no outro sempre falha. */
const PROVIDER_PREFIX: Record<CosmosProvider, string> = {
  anthropic: 'claude-',
  deepseek: 'deepseek-',
  gemini: 'gemini-',
  openai: 'gpt-',
};

export const modelMatchesProvider = (model: string, provider: CosmosProvider): boolean =>
  model.startsWith(PROVIDER_PREFIX[provider]);

/** Variável com a chave da Cosmos no provedor (separada das chaves da IA interna). */
export const cosmosApiKeyEnv = (provider: CosmosProvider) => `COSMOS_${provider.toUpperCase()}_API_KEY`;

/** Chave da Cosmos no provedor; null = esse provedor está indisponível para a Cosmos. */
export function cosmosApiKey(
  provider: CosmosProvider,
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env[cosmosApiKeyEnv(provider)]?.trim() || null;
}
