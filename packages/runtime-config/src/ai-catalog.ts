/**
 * Catálogo dos provedores de IA (#1437): a única lista de provedores, a variável da chave de cada um, o prefixo dos
 * nomes de modelo e o modelo padrão por nível. Agentes internos (services/ai-agents), ingestor, scheduler (checagem
 * de crédito), ledger (preços), Cosmos e o painel de Ajustes leem daqui.
 *
 * Mora no registro, e não num yaml, porque o painel (navegador) também o lê: os padrões daqui são os "padrão do
 * código" das chaves AI_PROVIDER e AI_MODEL_*, e o valor gravado em Ajustes vale por cima.
 *
 * Provedor novo: entra aqui, ganha cliente em packages/llm e preço em packages/ai-ledger (os testes cobram os três).
 */

export const AI_PROVIDERS = ['openai', 'anthropic', 'gemini', 'deepseek'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * Níveis de modelo:
 * - `light`: classificação, priorização, microcopy (barato e rápido);
 * - `standard`: redação de cenário/resumo a partir de fatos;
 * - `research`: pesquisa com busca na web (onde assistir, curadoria).
 */
export const AI_TIERS = ['light', 'standard', 'research'] as const;
export type AiTier = (typeof AI_TIERS)[number];

export const isAiProvider = (value: unknown): value is AiProvider =>
  typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);

/** Variável de ambiente (e segredo do painel) com a chave de cada provedor. */
export const AI_PROVIDER_KEY_ENV: Readonly<Record<AiProvider, string>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

/** Prefixo dos modelos de cada provedor: modelo de um provedor chamado no outro sempre falha. */
export const AI_PROVIDER_MODEL_PREFIX: Readonly<Record<AiProvider, string>> = {
  openai: 'gpt-',
  anthropic: 'claude-',
  gemini: 'gemini-',
  deepseek: 'deepseek-',
};

/** Provedor do modelo pelo prefixo do nome; undefined fora dos provedores conhecidos. */
export function providerOfModel(model: string): AiProvider | undefined {
  return AI_PROVIDERS.find((p) => model.startsWith(AI_PROVIDER_MODEL_PREFIX[p]));
}

/**
 * Modelos padrão por nível e provedor (conferidos nas páginas oficiais de modelos e preços em 2026-10-21; DeepSeek em
 * 2026-11-11). Sobrescritos em Ajustes por AI_MODEL_LIGHT / AI_MODEL_STANDARD / AI_MODEL_RESEARCH.
 *
 * OpenAI (padrão):
 * - light → `gpt-6-luna`: o modelo mais eficiente para tarefas focadas e de alto volume (US$ 0,10/0,50 por MTok).
 * - standard → `gpt-6.1-sol`: equilíbrio capacidade × custo, perto do topo de linha (US$ 2/10).
 * - research → `gpt-6.1-sol`: suporta web_search com filtro de domínios e saída estruturada; o topo
 *   de linha (`gpt-6-astra`, US$ 10/50) custa 5× mais sem ganho claro para "achar e citar a grade".
 * Anthropic:
 * - light → `claude-haiku-5-5` (US$ 0,10/0,50) · standard/research → `claude-sonnet-5-5` (US$ 2/10),
 *   o modelo indicado em docs/07 §5 para o onde assistir.
 * Gemini (API Interactions; saída estruturada + Grounding with Google Search só no Gemini 3+):
 * - light → `gemini-3.5-flash-lite` (US$ 0,30/2,50) · standard/research → `gemini-3.8-flash`
 *   (US$ 0,75/3,75 até 31/12/2026), + US$ 14 por 1.000 consultas de busca.
 * DeepSeek (API compatível com a da OpenAI, sem busca na web):
 * - light/standard → `deepseek-flash` (US$ 0,30/1,20 no pico) · research → `deepseek-v4-pro`
 *   (US$ 1,32/3,96 no pico). Agente que pede busca na web não roda no DeepSeek (erro de configuração).
 */
export const AI_DEFAULT_MODELS = {
  light: {
    openai: 'gpt-6-luna',
    anthropic: 'claude-haiku-5-5',
    gemini: 'gemini-3.5-flash-lite',
    deepseek: 'deepseek-flash',
  },
  standard: {
    openai: 'gpt-6.1-sol',
    anthropic: 'claude-sonnet-5-5',
    gemini: 'gemini-3.8-flash',
    deepseek: 'deepseek-flash',
  },
  research: {
    openai: 'gpt-6.1-sol',
    anthropic: 'claude-sonnet-5-5',
    gemini: 'gemini-3.8-flash',
    deepseek: 'deepseek-v4-pro',
  },
} as const satisfies Record<AiTier, Record<AiProvider, string>>;

/** Modelo padrão do provedor no nível. */
export const defaultModelOf = (provider: AiProvider, tier: AiTier): string =>
  AI_DEFAULT_MODELS[tier][provider];

/** Os três modelos padrão de um provedor, por nível. */
export function defaultModelsOf(provider: AiProvider): Record<AiTier, string> {
  return {
    light: AI_DEFAULT_MODELS.light[provider],
    standard: AI_DEFAULT_MODELS.standard[provider],
    research: AI_DEFAULT_MODELS.research[provider],
  };
}
