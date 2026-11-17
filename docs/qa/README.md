# QA de ponta a ponta e visual

Brief da frente de QA aberta em 17/11/2026, a pedido do dono, como pré-requisito para vender. O repositório tem milhares
de testes unitários e de integração no CI, mas nenhum teste que abra o navegador e percorra o produto como um cliente, e
nenhuma comparação visual das telas. Esta frente fecha essa lacuna.

Este documento é o plano. O código de teste começa depois que a pilha da F3 da plataforma comercial (#1297, #1299,
#1301) entrar na `main`, porque os cenários de cadastro, console e painel dependem do estado do tenant, da loja e do
checklist que ela traz.

Decisões que ficam com o dono estão marcadas com **[Decisão do dono]**; a proposta ao lado é a recomendação da frente.

## Objetivo

Provar, a cada mudança e a cada deploy, que o produto funciona de ponta a ponta do jeito que o cliente usa:

- um cliente novo se cadastra, recebe a marca provisionada, entra no console, cria chave, convida colega, monta um
  widget no Builder e vê esse widget com dados numa página dele;
- a API responde certo com chave secreta e publicável, e recusa certo por estado do tenant e por módulo;
- a equipe aprova, suspende e reativa a marca pelo painel;
- as páginas públicas de esporte abrem nos três idiomas;
- as telas principais não mudam de aparência sem que alguém aprove a mudança;
- depois de cada deploy, a produção responde pelo caminho público (borda, TLS, cache), sem escrever nada.

## O que existe hoje

### Testes no repositório

Contagem aproximada em 17/11/2026, lida do repositório: arquivos `*.test.ts(x)` e casos `it(`/`test(` no início de
linha (um `it.each` conta como um caso).

| Pacote | Arquivos unitários | Casos unitários | Arquivos de integração | Casos de integração |
| --- | ---: | ---: | ---: | ---: |
| `apps/api` | 66 | ~560 | 44 | ~360 |
| `apps/demo` | 160 | ~1.010 | 13 | ~80 |
| `packages/*` (26 pacotes) | 191 | ~2.060 | 48 | ~465 |
| ↳ dos quais `widgets` | 30 | ~350 | 0 | 0 |
| ↳ dos quais `engage` | 18 | ~270 | 0 | 0 |
| ↳ dos quais `rules` | 15 | ~210 | 1 | ~5 |
| ↳ dos quais `db` | 12 | ~80 | 25 | ~210 |
| ↳ dos quais `cosmos` | 14 | ~130 | 14 | ~160 |
| `services/ingestor` | 76 | ~805 | 48 | ~295 |
| `services/ai-agents` | 39 | ~485 | 16 | ~105 |
| `tests/integration` (API + ingestor) | 0 | 0 | 7 | ~105 |
| **Total** | **~530** | **~4.900** | **~180** | **~1.400** |

Os testes de componente da demo e dos widgets (cerca de 50 arquivos `.test.tsx`) rodam no Vitest com DOM simulado:
desenham um componente isolado, sem servidor, sem rota, sem banco e sem navegador de verdade.

### O que o CI já cobre

- **`ci.yml`, job `checks`** (Postgres 17/Valkey 8 e Postgres 18/Valkey 9): formatação, lint, regra de dependência
  (`pnpm lint:deps`), build, typecheck, testes unitários, ordem e drift das migrations, migration destrutiva sem o rótulo
  `contrair` e testes de integração. Cada suíte de integração cria um banco descartável `galaxie_test_<hex>` a partir de
  `DATABASE_URL` e aplica todas as migrations (ver `apps/demo/test/support/auth-db.ts` e `tests/integration/README.md`).
  No PR roda só o que a mudança alcança (`turbo --affected`); na fila de merge e no push para a `main`, tudo.
- **`ci.yml`, jobs `secrets` e `audit`**: gitleaks nos commits do PR e `pnpm audit --prod` (informativo).
- **`docker.yml`**: build das imagens (o `build demo` é obrigatório no PR que muda a demo), validação do compose, dos
  alertas e dos scripts da VPS com binários falsos, o servidor do Playwright do `lineup-render` (só confere que a
  imagem abre uma página; não testa o produto) e backup e restore ponta a ponta do Postgres.
- **`openapi.yml`**: o contrato `/v1` do PR contra o da base; quebra sem o rótulo `quebra-de-contrato` reprova.
- **`deploy.yml` + `infra/vps-telemetry/smoke.mjs`**: smoke de 28 checagens por HTTP, rodado **dentro** dos contêineres
  `site` e `console`, primeiro nos candidatos antes da troca e depois na versão no ar. Confere que a API e a demo
  respondem com dados (time, elenco, jogo, onde assistir, busca, páginas públicas, rotas protegidas, registry dos
  widgets). Falha derruba o deploy e volta a versão.
- **`tests/load`**: cenários k6 rodados à mão, fora do CI.

### O que falta

1. **E2E no navegador**: nenhum teste abre a demo num navegador, faz login, clica, preenche formulário e confere o
   resultado. O cadastro, o console, o Builder, o painel da equipe e o widget embutido numa página de terceiro nunca
   são exercitados juntos.
2. **Teste visual**: nada compara a aparência das telas. Uma regressão de CSS, tema ou tradução que quebra o layout
   passa por todos os checks.
3. **Smoke de fora para dentro**: o smoke do deploy roda dentro da rede da VPS. Ninguém confere, depois do deploy, o
   caminho que o cliente usa: domínio público, borda, TLS, cache e o `embed.js` desenhando um widget no navegador.

Não há Playwright, Cypress nem Storybook no produto hoje (`git grep -i playwright` só acha o `lineup-render` e o
`playwright-core` que o `services/ai-agents` usa para capturar páginas de escalação).

## Ferramenta: Playwright

Recomendação: **Playwright** (`@playwright/test`), com Chromium no CI; WebKit e Firefox só na onda visual, se o dono
quiser.

Motivos:

- **Já está no repositório.** O `lineup-render` e o `services/ai-agents` usam Playwright 1.64; a versão é travada por
  `infra/lineup-render/versions.mjs`. Uma ferramenta só, uma versão só.
- **Visual embutido.** `expect(page).toHaveScreenshot()` compara capturas com tolerância configurável, guarda as
  referências no repositório e gera o diff no relatório. Cypress precisaria de plugin pago ou de terceiro.
- **API e navegador no mesmo teste.** O `request` do Playwright testa a API (cenário 5) sem navegador, com o mesmo
  relatório e o mesmo job.
- **Várias origens.** O cenário do widget precisa de uma página de "portal" numa origem diferente da demo; o Playwright
  abre várias origens e intercepta rotas (`page.route`) sem servidor extra.
- **Trace viewer.** Em falha, o CI guarda o trace (DOM, rede, console, capturas passo a passo): a flakiness se
  investiga sem reproduzir na máquina.
- **TypeScript e ESM**, como o resto do monorepo.

Storybook fica fora: os widgets já têm testes de componente e o Builder já é a vitrine deles; o visual que importa é o
da tela montada, com dados.

## Onde roda

### No CI: banco descartável, como a integração

Pacote novo **`tests/e2e`** (`@galaxie/e2e-tests`), folha do grafo como o `tests/integration`: depende do que precisa
para semear, ninguém depende dele e nenhuma imagem o inclui (`infra/ops/image-inputs.mjs`). Conversa com a API e com a
demo **só por HTTP**; não importa `apps/*` (a regra de dependência continua valendo).

Job **`e2e`** novo no `ci.yml`:

1. Serviços do job: Postgres 17 e Valkey 8 (a linha de produção) e um SMTP falso (ver Autenticação).
2. Banco descartável a partir de `DATABASE_URL`, migrations aplicadas, seed (ver Dados de teste).
3. Build de produção da API e da demo (`next build` + `next start`, não `next dev`): o teste valida o que vai para o
   ar. A demo sobe com `APP_ROLE` vazio (`all`, site e console num processo só).
4. `pnpm --filter @galaxie/e2e-tests e2e`: Playwright com Chromium, `retries: 1` só no CI, `trace: 'on-first-retry'`.
5. Em falha: relatório HTML e traces como artefato do job, por 14 dias.

Tempo-alvo do job: **até 12 minutos** no PR. O build do Next já custa cerca de 90 segundos; o resto é seed e os testes.

**[Decisão do dono] Quando o job roda e se bloqueia.** Proposta: nas duas primeiras semanas, informativo (não
obrigatório) em todo PR que alcança `apps/demo`, `apps/api` ou `packages/widgets`, e sempre na fila de merge; depois,
obrigatório nos mesmos casos. Alternativa mais barata em minutos de CI: só na fila de merge e no push para a `main`. Os
minutos importam se o repositório voltar a ser privado.

### Local

`pnpm infra:up`, `pnpm build` e `pnpm --filter @galaxie/e2e-tests e2e` contra a API e a demo locais; o pacote sobe os
dois pelo `webServer` do Playwright quando não estão no ar. Contra o Postgres local (porta 5433), o seed cria o próprio
banco `galaxie_e2e_<hex>` e não toca no banco de desenvolvimento.

### Como rodar localmente

Implantado na onda 0 (#1317); detalhes, variáveis e depuração em [tests/e2e/README.md](../../tests/e2e/README.md).

```bash
pnpm infra:up          # Postgres e Valkey locais (ou o .env apontando para o Postgres de desenvolvimento)
pnpm e2e:mail          # Mailpit, o SMTP falso (perfil e2e do infra/docker-compose.yml): SMTP 1025, tela e API 8025
pnpm build             # API e demo de produção
pnpm --filter @galaxie/e2e-tests exec playwright install chromium   # uma vez por versão do Playwright
pnpm e2e               # = pnpm --filter @galaxie/e2e-tests e2e
```

O executor (`tests/e2e/src/run.ts`) cria `galaxie_e2e_<hex>` no servidor da `DATABASE_URL`, aplica as migrations, grava o
seed, roda o Playwright (que sobe a API na 8180 e a demo na 3100, apontadas para esse banco) e apaga o banco no fim,
inclusive quando o teste falha. O banco de desenvolvimento não é tocado. Relatório da última execução:
`pnpm --filter @galaxie/e2e-tests e2e:report`.

O que a onda 0 adotou das decisões em aberto (a recomendação do brief em cada uma):

- **Login no teste**: opção A, Mailpit como serviço do job e perfil `e2e` do compose local. O projeto `setup` faz o login
  de verdade do admin e do cliente de referência e guarda as sessões (`storageState`).
- **Quando o job roda**: no PR que alcança a API, a demo ou o `tests/e2e` (o recorte do `turbo --affected`, que inclui os
  pacotes compartilhados de que elas dependem), e sempre na fila de merge e no push para a `main`. Fica fora dos checks
  obrigatórios nas duas primeiras semanas; tornar obrigatório é configuração do repositório, com o dono.

### Em produção: smoke pós-deploy só de leitura

Projeto separado do Playwright (`smoke`), rodado por um job novo no `deploy.yml` depois da troca de versão, contra o
domínio público, de fora da VPS. Regras fixas:

- **Só GET.** Nenhum login, nenhum formulário, nenhum POST, nenhuma chave secreta.
- Sem gastar cota: só rotas servidas do banco ou do cache; nada que dispare chamada ao fornecedor ou a IA.
- URLs base vêm de variáveis do repositório (`SMOKE_SITE_URL`, `SMOKE_API_URL`), não do código.
- Vermelho não derruba nem desfaz o deploy (isso continua sendo papel do `smoke.mjs` interno): manda o aviso por push,
  como o deploy travado já manda.

**[Decisão do dono] Frequência do smoke externo.** Proposta: depois de cada deploy e a cada hora pelo `schedule` do
GitHub Actions. Alternativa: só depois do deploy.

## Autenticação no teste

A demo entra só por código por e-mail (Better Auth, plugin de OTP). Sem SMTP, o código vai para o log do servidor **só
em desenvolvimento**; no build de produção ele nunca é escrito. O `otp-guard` limita um pedido a cada 45 s por e-mail e
trava o e-mail depois de erros demais (`docs/runbooks/demo-login.md`).

Opções:

| Opção | Como | Prós | Contras |
| --- | --- | --- | --- |
| **A. SMTP falso (Mailpit)** | Serviço do job; `SMTP_HOST`/`SMTP_PORT` apontam para ele; o teste lê o código pela API HTTP do Mailpit | Nenhuma linha muda no produto; exercita o envio real do e-mail (código, convite, boas-vindas da F3) | Um serviço a mais no job |
| B. Ler o log do `next dev` | O teste lê o stdout do servidor | Já funciona hoje | Exige `next dev`, lento e diferente do build de produção |
| C. Gancho de teste | Código fixo aceito com uma variável só fora de produção | Mais simples de escrever | Muda o código de autenticação; um erro de configuração abre a produção |

**[Decisão do dono] Login no teste.** Proposta: **opção A**. O login de verdade roda uma vez por papel num projeto
`setup` do Playwright, que guarda a sessão (`storageState`) para os outros testes; cada teste que cria conta usa um
e-mail próprio (`<cenário>-<hex>@galaxie.test`), então o limite de 45 s não atrapalha. A opção B continua servindo para
depurar na máquina. A opção C fica descartada salvo pedido do dono.

## Dados de teste

Tudo semeado no banco descartável a cada execução; nada depende da produção nem da cota.

- **Dado esportivo**: fixture pequena e neutra gravada pelo `@galaxie/core-writer` (`upsertBatch`, o mesmo caminho que
  os testes de integração usam): duas competições de esportes diferentes, quatro times, um jogo encerrado com lances e
  estatísticas, um jogo agendado e um ao vivo congelado. Mais a base semântica (`pnpm db:seed:semantic`) e a geografia
  (`geo:seed`). Nenhuma chamada à api-sports, ao YouTube ou a LLM: `AI_STATUS=off`, `YOUTUBE_SEARCH=off`, sem
  `APISPORTS_KEY`.
- **Equipe**: o primeiro admin vem de `DEMO_ADMIN_EMAIL` (ex.: `e2e.admin@galaxie.test`), como na subida da demo.
- **Tenant de referência**: uma organização e uma marca criadas pelo próprio painel no setup (o mesmo provisionamento
  que o cadastro usa), com chaves `gs_test_…`, uma chave publicável presa à origem do portal de teste e um widget salvo.
  As chaves só existem no banco descartável e no processo do teste; nunca vão para arquivo versionado nem para o
  relatório.
- **Runtime**: `SIGNUP_ENABLED=on` e `SIGNUP_TERMS_VERSION=e2e` gravados em `ops.runtime_setting` no seed; nunca no
  ambiente de produção.
- **Relógio**: os testes que dependem de data (trial, faixas do console) fixam a hora com `page.clock` do Playwright ou
  gravam `trial_ends_at` relativo a agora; nada de data fixa no calendário.

## Cenários mínimos para vender

Em ordem de prioridade. Cada cenário vira uma issue do épico, com os passos e o critério de aceite.

1. **Login por código e troca de idioma.** Pedir código em `/login`, ler no SMTP falso, entrar, cair na área certa
   (equipe em Ajustes, cliente no console). Código errado mostra erro sem entrar. Trocar o idioma no seletor muda a URL
   e os textos (pt-BR, en, es-AR) e a escolha persiste ao navegar.
2. **Cadastro `/signup` com a calculadora e provisionamento.** Com `SIGNUP_ENABLED` ligado: e-mail de trabalho, código,
   organização (país, termos), marca (nome, identificador, esportes, domínio, cor), calculadora de capacidade,
   conclusão. Confere marca em `trial`, chaves mostradas uma vez, tema com a cor, widget de exemplo e e-mail de
   boas-vindas no SMTP falso. Desligado, `/signup` mostra "em breve" sem formulário. E-mail de provedor grátis é
   recusado.
3. **Console do cliente.** Chaves (criar, ver o texto uma vez, revogar), Planos e módulos (estado de cada cartão,
   ativar o teste de um módulo uma única vez), Usuários e cargos (convidar, o convite chega no SMTP falso, o convidado
   entra com o cargo certo, um cargo sem permissão não vê o que não deve), Builder (criar widget e tema, pré-visualizar,
   salvar) e o checklist da primeira sessão.
4. **Widget no ar.** Uma página de "portal" numa origem permitida carrega `/embed.js` e `<galaxie-widget>` com a chave
   publicável e o widget do cenário 3, e desenha dados do seed. Na origem não permitida, o widget mostra o erro e a API
   devolve `ORIGIN_NOT_ALLOWED`.
5. **API com chave secreta e publicável.** 200 com `gs_test_…` em rotas do plano; 401 `INVALID_KEY` sem chave ou com
   chave revogada; 401/402 por estado do tenant (`TENANT_PENDING_REVIEW`, `TENANT_REJECTED`, `TRIAL_EXPIRED`,
   `SUBSCRIPTION_SUSPENDED`, `TENANT_CANCELLED`) com `upgrade_url` quando cabe; 403 `MODULE_NOT_IN_PLAN` por módulo e
   `PUBLISHABLE_KEY_NOT_ALLOWED` em rota de backend; corpo em RFC 9457. Sem navegador (`request` do Playwright).
6. **Painel da equipe.** Ajustes › Organizações: aprovar a revisão de uma marca `pending_review` (vai a `trial`, chaves
   emitidas), recusar, suspender, reativar, cancelar e estender o trial, sempre com motivo; cada ação aparece no
   histórico e muda a resposta da API (cenário 5) e o menu do console (cenário 3).
7. **Páginas públicas de esporte nos três idiomas.** Jogo, time e campeonato do seed em pt-BR, en e es-AR: título,
   placar ou tabela, links entre elas, sem termo interno e sem erro no console do navegador. As rotas antigas em
   português redirecionam para as em inglês.
8. **Visual.** Capturas das telas principais comparadas com `toHaveScreenshot` (ver abaixo).
9. **Smoke pós-deploy em produção (só GET).** `/health` e `/version` da API, `/api/version` da demo (o SHA bate com o
   publicado), uma página pública por idioma com status 200 e conteúdo, `/embed.js` com `content-type` e `etag`, e a
   configuração pública de um widget de referência (`/e/<id>.json`) desenhando no navegador.

### Visual: como funciona

- **Telas**: home pública, página de jogo, time e campeonato (as quatro páginas de `/example` usam um snapshot gravado e
  não mudam com o dado do dia: são a base mais estável), login, `/signup` em cada passo, visão geral do console, Chaves,
  Planos e módulos, Builder com um widget, Ajustes › Organizações e o widget embutido. Em pt-BR e, para as públicas,
  também em en e es-AR; desktop (1440×900) e celular (390×844).
- **Estabilidade**: fonte e fuso fixos no contexto, `page.clock` congelado, animações desligadas
  (`animations: 'disabled'`), regiões que mudam sozinhas (relógio, "há N minutos", ao vivo) mascaradas com `mask`.
- **Tolerância**: `maxDiffPixelRatio: 0.01` e `threshold: 0.2` por padrão; mais apertado nas telas de marca (cores do
  tema) se gerar falso positivo, nunca mais frouxo que 2 %.
- **Referências**: guardadas em `tests/e2e/visual/__screenshots__/`, geradas **só no Linux do CI**, dentro da imagem
  oficial do Playwright na mesma versão do `lineup-render`, porque a renderização de fonte muda entre sistemas.
- **Atualizar**: a mudança visual intencional é aprovada assim: o PR roda o workflow manual de atualização
  (`workflow_dispatch`, que executa o Playwright com `--update-snapshots` no mesmo contêiner) e o commit das referências
  novas entra no próprio PR, com as imagens antes e depois na descrição. Ninguém atualiza referência gerada na própria
  máquina.

**[Decisão do dono] Quem aprova mudança visual.** Proposta: qualquer revisor do PR, desde que as capturas novas estejam
na descrição; mudança em tela de marca (tema do cliente, widget) pede o dono.

## Critérios de pronto da frente

- Job `e2e` no CI com os cenários 1 a 7 verdes, abaixo de 12 minutos, e obrigatório na fila de merge.
- Taxa de falha intermitente abaixo de 2 % nas últimas 50 execuções da `main` (teste que só passa no retry conta como
  intermitente e vira issue).
- Visual com as telas listadas, referências no repositório e o fluxo de atualização documentado e usado ao menos uma
  vez.
- Smoke externo rodando depois de cada deploy, com aviso por push no vermelho.
- Este documento atualizado com o que mudou na implantação e um runbook curto de "teste vermelho: o que fazer".

## Fora do escopo

- Pagamento e Stripe (F4), exportação e expurgo de dados, App da Comunidade.
- Ao vivo de verdade (SSE com jogo rolando), Cosmos AI, Shopping, Gamificação e Comunidades: entram depois, como
  cenários próprios, quando cada frente estabilizar.
- Testes de carga (continuam no `tests/load`, k6).
- Acessibilidade automatizada (axe) e Lighthouse: bons candidatos para uma onda seguinte, fora do mínimo para vender.
- Escrever em produção: nenhum teste cria conta, chave ou widget no ambiente de produção.

## Riscos

- **Tempo de CI.** Build do Next mais seed mais navegador pode passar de 12 minutos. Mitigação: reaproveitar o build do
  turbo, rodar os cenários em paralelo (`workers` por arquivo, cada um com a própria organização) e, se preciso, dividir
  em dois jobs (fluxos e visual).
- **Flakiness.** Esperas por tempo, dado que muda com a hora e ordem entre testes. Mitigação: só esperas por estado
  (`expect(...).toBeVisible()`, nunca `waitForTimeout`), seletor por papel e texto acessível (`getByRole`), relógio
  congelado, um tenant por teste, `retries: 1` só no CI e teste intermitente vira issue na hora.
- **Custo de manutenção das capturas.** Toda mudança de layout pede atualizar referências. Mitigação: poucas telas, bem
  escolhidas; capturas de região (`locator.screenshot`) em vez da página inteira quando a página é longa; fluxo de
  atualização em um clique.
- **Dependência da F3.** Os cenários 2, 3 e 6 dependem da pilha #1297, #1299 e #1301. Mitigação: a infraestrutura e os
  cenários 1, 5 (parte de chave e módulo) e 7 não dependem dela e podem começar antes.
- **Segredo em relatório.** Trace e captura podem mostrar a chave na tela. Mitigação: chaves só do banco descartável,
  `mask` sobre o texto da chave nas capturas e artefato só em falha.

## Ordem de implantação

| Onda | Entrega | Depende de | Estimativa |
| --- | --- | --- | --- |
| 0 | Infraestrutura: pacote `tests/e2e`, Playwright, job `e2e` no CI, SMTP falso, seed, login de teste | decisões do dono sobre login e sobre quando o job roda | 3 a 4 dias |
| 1 | Cenários 1 (login e idioma), 5 (API) e 7 (páginas públicas) | onda 0 | 2 a 3 dias |
| 2 | Cenários 2 (cadastro), 3 (console) e 6 (painel da equipe) | onda 0 e a F3 na `main` | 4 a 6 dias |
| 3 | Cenário 4 (widget no ar) | ondas 0 e 2 | 1 a 2 dias |
| 4 | Cenário 8 (visual) | ondas 1 a 3 | 2 a 3 dias |
| 5 | Cenário 9 (smoke em produção) | onda 0; independe das outras | 1 dia |

Total: 13 a 19 dias de trabalho, sem contar a espera da F3 e a revisão dos PRs. As ondas 1 e 5 podem correr em paralelo
com a 2.

O épico e as issues de cada onda estão no GitHub (épico "QA de ponta a ponta e visual antes de vender").
