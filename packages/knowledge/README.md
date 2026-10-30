# @galaxie/knowledge

Base semântica versionada em [`data/knowledge`](../../data/knowledge/SCHEMA.md): valida o YAML contra o JSON Schema,
carrega no Postgres (`semantic`), resolve IDs da api-sports, detecta clássicos e escolhe a copy por mercado com as regras
de linguagem segura.

## Como usar

```bash
pnpm knowledge:validate     # na raiz: schema + referências (também no CI)
pnpm db:seed:semantic       # carrega a base no banco
pnpm resolve:ids            # liga times e competições aos IDs da api-sports
pnpm knowledge:i18n         # cobertura de traduções
pnpm --filter @galaxie/knowledge review:export [--gravar]   # leva as edições aprovadas no banco para o YAML
```

Conceitos: [docs/06](../../docs/06-semantica-e-conteudo.md). A pasta é lida de `KNOWLEDGE_DIR`.

## Depende de

`@galaxie/db`.

## Usado por

`apps/api`, `services/ingestor`, `services/ai-agents`.
