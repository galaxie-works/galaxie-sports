# @galaxie/llm

Clientes dos provedores de IA (OpenAI, Anthropic, Gemini e DeepSeek) atrás de um contrato só, usados pelos agentes
internos e pela Cosmos AI. Cada chamada devolve o uso de tokens (com o cache lido e gravado, quando o provedor informa)
e o custo estimado pela tabela de preços do `@galaxie/ai-ledger`; erros saem como `LlmError` com `kind` (`auth`,
`rate_limit`, `quota`, `timeout`, `provider`, ...) e a decisão de retentativa.

## Como usar

- **Texto livre, inteiro ou em streaming** (`CompletionClient`):
  `createCompletionClient('deepseek', { apiKey })` e depois `complete({ model, system, messages })` ou
  `for await (const ev of client.stream(req))`, com eventos `{ type: 'text', delta }` e
  `{ type: 'usage', usage, final }` (o último é o uso final, com `finishReason`).
- **Saída JSON com schema** (`LlmClient.generateJson`, com busca na web onde o provedor tem):
  `OpenAiLlmClient`, `AnthropicLlmClient`, `GeminiLlmClient` e `DeepSeekLlmClient` (sem busca). O orçamento diário e o
  registro em `ops.llm_usage` ficam em quem chama (`BudgetedLlmClient` em `services/ai-agents`).
- **Preços**: a tabela vive em `@galaxie/ai-ledger` (`MODEL_PRICES`); a flag `AI_MODEL_PRICES` vale por cima dela sem
  deploy (`modelo=entrada/cache/saída[/gravação]`, US$ por 1 milhão de tokens). Processo de vida longa que resolve a
  flag pelo banco chama `setModelPriceOverrides(valor)`.

## Depende de

`@galaxie/ai-ledger` (erros base e preços), SDKs da OpenAI e da Anthropic (agentes internos) e `ajv`.

## Usado por

`services/ai-agents` (e a Cosmos AI).
