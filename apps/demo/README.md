# @galaxie/demo

App Next.js (shadcn/ui + ReUI) que reúne, num só deploy:

- o **site público** e a página de exemplo (`/[locale]/sobre`, `/[locale]/exemplo`, termos e privacidade);
- a **demonstração** para clientes: Meu dia, agenda, ao vivo, competições, eventos com onde assistir, times, pessoas,
  clássicos, multiesporte, hipismo e a documentação da API (`/docs`);
- o **portal do cliente** (`/cliente`): grade de canais, chaves e o **Builder** de widgets;
- os **ajustes da operação** (`/ajustes`): esportes, grades e logos de canais, vídeos relacionados, painel de cota;
- o **embed** dos widgets (`/embed.js`, `/e/[id]`, `/r/[id]`) a partir de `@galaxie/widgets`.

Telas e decisões: [docs/09-app-demonstracao.md](../../docs/09-app-demonstracao.md).

## Como rodar

```bash
# na raiz: infra, migrations e a API rodando (ver apps/api/README.md)
pnpm --filter @galaxie/demo dev    # http://localhost:3000
```

Precisa de `GALAXIE_API_URL` (servidor) e `NEXT_PUBLIC_GALAXIE_API_URL` (navegador) apontando para a API, de
`GALAXIE_DEMO_KEY` (chave do tenant da demo) e, para o login, de `DEMO_DATABASE_URL` (ou `DATABASE_URL`),
`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` e do SMTP (`SMTP_*`). Login local: [runbook](../../docs/runbooks/demo-login.md).

## De onde vêm os dados

| Dado | Origem |
|---|---|
| Esportivo (eventos, tabelas, times, onde assistir, contexto) | **Sempre a API Galaxie** (`src/lib/galaxie`, cliente de `@galaxie/contracts`). Nunca direto do banco nem da api-sports. |
| Login, convites, papéis, atividade e cache do change feed | Schema próprio `demo_auth` no Postgres, criado pela app em `src/lib/auth/setup.ts` |
| Ajustes da operação (grades, vídeos relacionados, widgets do Builder) | `@galaxie/db` (`/lineups`, `/related`, `/widgets`, `/channel-lists`), com o validador de `@galaxie/where-to-watch` |
| Painel de operação (cota, jobs) | Tabelas `ops` lidas em `src/lib/ops` |
| Logos enviados | Bucket S3 (`S3_*`) |

A regra que vale manter: dado esportivo só pela API. O acesso direto ao banco fica restrito a login e ao console da
operação. Ver [docs/15 §5](../../docs/15-organizacao-do-monorepo.md#5-fronteiras-confusas-hoje).

## Depende de

`@galaxie/contracts`, `@galaxie/widgets`, `@galaxie/where-to-watch`, `@galaxie/runtime-config` e `@galaxie/db`;
a API Galaxie no ar; Postgres e S3 para login e ajustes.

## Convenções

- Filtros e listas em ordem alfabética pt-BR (`src/lib/alphabetical.ts`).
- Componentes de `src/components/ui`, `reui`, `animate-ui` e `smoothui` ficam como o registro entrega (fora do Prettier).
- Esta versão do Next tem mudanças grandes; leia [AGENTS.md](AGENTS.md) antes de mexer.

## Deploy

Imagem `galaxie-sports-demo` (`Dockerfile`, build a partir da raiz). Na VPS roda como `demo` e `demo-candidate`,
atrás do Traefik (`DEMO_DOMAIN`).
