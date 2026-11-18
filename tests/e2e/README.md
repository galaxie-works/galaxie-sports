# tests/e2e

Testes de ponta a ponta no navegador (Playwright, só Chromium): a API e a demo em build de produção, contra um banco
descartável, com login de verdade por código lido de um SMTP falso. Plano da frente e cenários: [docs/qa/README.md](../../docs/qa/README.md)
(épico #1315; esta pasta nasceu na onda 0, #1317).

## Por que é um pacote à parte

Como o `tests/integration`, é uma folha do grafo: depende só do que precisa para semear o banco (`@galaxie/db`,
`@galaxie/billing`), ninguém depende dele e nenhuma imagem o inclui (`infra/ops/image-inputs.mjs`). Fala com a API e
com a demo **só por HTTP**; não importa `apps/*` (`pnpm lint:deps`). O `@playwright/test` fica na mesma versão do
`lineup-render` e do `services/ai-agents` (`node infra/lineup-render/versions.mjs` confere).

## O que roda

`pnpm --filter @galaxie/e2e-tests e2e` (ou `pnpm e2e` na raiz) chama o executor `src/run.ts`, que:

1. cria o banco `galaxie_e2e_<hex>` no servidor da `DATABASE_URL` e aplica todas as migrations;
2. grava o seed mínimo (`src/seed.ts`): a organização da Galaxie com uma marca `enterprise` ativa (a chave dela é a
   `GALAXIE_DEMO_KEY` da demo), a organização e a marca de referência `marca-e2e` em `trial` no plano Fan Experience,
   com uma chave `gs_test_…`, e o cadastro ligado em `ops.runtime_setting`;
3. roda o `playwright test`, que sobe a API (`apps/api/dist`) e a demo (`next start`, `APP_ROLE` vazio) nas portas
   8180 e 3100, apontadas para esse banco, com IA, YouTube e api-sports desligados;
4. apaga o banco no fim, passe ou falhe o teste (e no Ctrl+C).

Projetos do Playwright (`playwright.config.ts`):

| Projeto | O quê |
| --- | --- |
| `setup` | O admin (`e2e.admin@galaxie.test`, o primeiro admin da demo) entra pelo código, cria o cliente de referência (`e2e.cliente@galaxie.test`, papel `client` na `marca-e2e`) e o cliente entra; as sessões ficam em `.auth/` |
| `api` | `GET /v1/account` com a chave semeada responde 200; sem chave, 401 |
| `chromium` | A home pública abre; o admin vê Ajustes; o cliente vê o console (falha conhecida, ver abaixo) |

As chaves e o segredo do login só existem no banco descartável e no ambiente do processo do Playwright; nada vai para
arquivo versionado nem para o log.

## Como rodar na máquina

```bash
pnpm infra:up          # Postgres na 5433 e Valkey (ou o .env apontando para o Postgres de desenvolvimento do NAS)
pnpm e2e:mail          # o Mailpit (SMTP falso) do perfil e2e do infra/docker-compose.yml: SMTP 1025, API e tela 8025
pnpm build             # a API e a demo de produção; a demo embute NEXT_PUBLIC_* no build (ver abaixo)
pnpm --filter @galaxie/e2e-tests exec playwright install chromium   # uma vez por versão do Playwright
pnpm e2e
```

- `DATABASE_URL` vem do ambiente ou do `.env` da raiz (só ela). O executor nunca escreve no banco dessa URL: cria e
  apaga o `galaxie_e2e_<hex>` ao lado. Num worktree sem `.env`, exporte a variável antes.
- O resto do `.env` da raiz não chega aos servidores de teste: o que parece chave, senha, endereço ou porta sai vazio no
  ambiente deles (a demo carrega o `.env` no `next.config.ts`), e o Valkey usa um prefixo só da execução.
- Para a demo chamar a API do teste também pelo navegador, construa com
  `NEXT_PUBLIC_GALAXIE_API_URL=http://localhost:8180 NEXT_PUBLIC_SITE_URL=http://localhost:3100`, como o CI faz. As
  páginas do servidor usam `GALAXIE_API_URL`, que o teste define sozinho.
- Um teste só: `pnpm e2e -- tests/ui/smoke.spec.ts`; com a janela do navegador: `pnpm e2e -- --headed`; passo a passo:
  `pnpm e2e -- --debug`. Outras portas: `E2E_API_PORT`, `E2E_DEMO_PORT`. Mailpit em outro lugar: `E2E_SMTP_HOST`,
  `E2E_SMTP_PORT`, `E2E_MAILPIT_URL`.
- Os e-mails que a demo mandou ficam em <http://localhost:8025>.

## Como depurar uma falha

- **Relatório**: `pnpm --filter @galaxie/e2e-tests e2e:report` abre o `playwright-report/` da última execução.
- **Trace**: no CI cada teste que falha roda de novo uma vez com trace (`trace: 'on-first-retry'`). O relatório HTML e
  os traces sobem como artefato `e2e-playwright-report` do job `e2e` (só em falha, 14 dias). Baixe, descompacte e rode
  `pnpm --filter @galaxie/e2e-tests exec playwright show-trace <arquivo trace.zip>`: DOM, rede, console e capturas de
  cada passo.
- **Servidores**: a saída da API e da demo aparece no log do job com os prefixos `[API]` e `[demo]` (nível `warn`;
  `E2E_SERVER_LOG_LEVEL=info` para mais).
- **Limite do login**: a demo aceita um pedido de código a cada 45 s por e-mail e 3 por minuto por IP. Cada papel entra
  uma vez, no `setup`; um cenário que precise de outra conta usa um e-mail próprio (`<cenário>-<hex>@galaxie.test`).
