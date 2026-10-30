# @galaxie/ai-agents

Agentes de IA e a camada de LLM independente de provedor. Os fatos vêm da fonte de dados; os agentes decidem onde buscar
o que a fonte não tem e como contar, sempre com validação determinística antes de publicar.

Detalhes, guardrails e avaliação: [docs/07](../../docs/07-ia-tempo-real-e-enriquecimento.md).

## Agentes

| Comando | Agente |
|---|---|
| `wtw:run` · `wtw:audit` · `wtw:rights` · `wtw:rights:compare` · `wtw:channel` | Onde assistir: pesquisa de transmissão por país, auditoria, direitos por competição e canais |
| `context:run` | Cenário pré-jogo ("quem precisa de quê"), a partir de `@galaxie/rules` |
| `recap:run` | Resumo pós-jogo factual |
| `curator:run --dry-run` | Curador semântico: propõe mudanças na base com fontes |
| `review:suggestions` | Decide as sugestões de edição da base semântica ([docs/06 §2.1.1](../../docs/06-semantica-e-conteudo.md#211-sugestões-decididas-pela-ia-job-review-suggestions)) |
| `related:run` · `related:canais` | Vídeos relacionados por evento (YouTube) — [docs/12](../../docs/12-conteudo-relacionado.md) |
| `lineups:research` · `lineups:pages` · `lineups:curate` · `channels:match` | Grades de canais das plataformas (usa o `lineup-render` para páginas com JavaScript) |
| `f1:bio` | Biografias editoriais de pilotos da F1 |
| `eval:report` · `ai:status` | Custo, qualidade e estado da IA |

Sem chave de LLM, os agentes seguem só com a parte determinística.

## Como rodar

```bash
pnpm build                                     # na raiz
pnpm --filter @galaxie/ai-agents ai:status          # provedor, orçamento e estado de cada agente
pnpm --filter @galaxie/ai-agents curator:run --dry-run
```

Em produção eles não têm processo próprio: o scheduler do [ingestor](../ingestor/README.md) com
`SCHEDULER_PROFILE=agents` chama estes CLIs (`cwd: ../ai-agents`), e a imagem do ingestor leva este pacote junto.

## Organização

`src/llm` é a camada de LLM (`AI_PROVIDER`: OpenAI, Anthropic ou Gemini, schema JSON estrito, orçamento, `FakeLlmClient` para
testes); `src/guardrails` são as regras de publicação; cada agente tem sua pasta (`wtw`, `context`, `recap`, `curator`,
`review`, `related`, `lineups`, `channels`, `f1bio`); `src/cli` são os comandos.

## Depende de

- **Pacotes**: `db`, `ai-ledger` (teto diário em tokens e US$ antes de cada chamada), `runtime-config`, `where-to-watch`,
  `knowledge`, `rules`, `providers`, `geo`, `contracts`, `net-guard` (toda busca de URL de terceiro).
- **Serviços**: Postgres, provedor de LLM (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY` ou `GEMINI_API_KEY`), YouTube (`YOUTUBE_API_KEY`) e o
  `lineup-render` (`LINEUP_RENDER_WS`).
- **Arquivos**: `config/ai-policy.yaml` (`AI_POLICY_FILE`), `config/broadcasters`, `config/broadcast-rights`,
  `config/related-content`, `data/knowledge`.

Testes nunca fazem chamada real: usam `FakeLlmClient` e SDKs falsos.
