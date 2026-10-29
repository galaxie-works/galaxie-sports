# Staging na VPS "telemetry" (Traefik)

Stack em [`compose.yml`](compose.yml), derivada de [`infra/portainer/stack.yml`](../portainer/stack.yml) para uma VPS que
**já tem Traefik v3 em produção** (`network_mode: host`, provider Docker com `exposedByDefault=false`,
entrypoints `web`/`websecure`, certresolver `letsencrypt` por HTTP-01).

| Diferença para a stack do Portainer | Por quê |
|---|---|
| Sem Caddy; labels do Traefik na `api`, na `demo` e no `s3` | o Traefik da VPS faz TLS e roteamento |
| `/metrics` e `/internal` fora do router da API | mesmo bloqueio que o Caddy fazia |
| Sem `build:`; imagens do GHCR (o deploy baixa as do SHA; `PULL_POLICY=missing` no resto do tempo) | não compilar o monorepo na VPS (2 vCPU compartilhadas) |
| Sub-rede fixa `172.30.50.0/24` e `TRUST_PROXY=172.30.50.1` | o Traefik chega aos contêineres pelo gateway da rede |
| `mem_limit` por serviço (S3 1g, Grafana 512m: com 256m os dois chegam ao limite) | a VPS hospeda outras stacks |
| Serviço `demo` com login próprio (convites, papéis, prazo e atividade) | o app de demonstração (metadados em negociação) |
| Assets públicos: `GET/HEAD` do bucket via Traefik, bucket com leitura anônima só de objetos | logos, bandeiras e fotos na demo e na API |
| Grafana sem rota pública | acesso por túnel SSH |
| Serviço `agents`: imagem do ingestor com `SCHEDULER_PROFILE=agents` (resumo, cenário, Onde Assistir) e teto diário de tokens | IA ligada mesmo com o ingestor parado, com custo previsível |
| Serviço `maintenance` (Caddy fixo) com routers de prioridade 1 nos hosts da demo e da API | 503 de manutenção em vez do 404 do Traefik enquanto demo ou API são recriadas |

Domínios (registro A → IP da VPS): `DEMO_DOMAIN` (demo), `API_DOMAIN` (API pública) e `ASSETS_DOMAIN` (assets).
**O DNS precisa resolver antes de subir**, senão o desafio HTTP-01 do Let's Encrypt falha.

## Regras da VPS

- Não tocar nas outras stacks em `/docker/` (nada de editar, parar, `down` ou `pull` nelas).
- Proibido: `docker system prune`, `docker volume prune`, `docker network prune`, mexer no `ufw`, publicar portas.
- Segredos só no `.env` da VPS (`chmod 600`), gerados lá com `openssl rand -hex 32`; nunca impressos.
- **Uma chave, um ingestor**: com o ingestor da VPS no ar, nenhum outro ambiente roda jobs com a mesma
  `APISPORTS_KEY` (a cota diária é por conta e por API).

## Imagens

O workflow [`docker.yml`](../../.github/workflows/docker.yml) publica no GHCR `api`, `ingestor`, `demo`, `backup`,
`prometheus` e `grafana` (o `caddy` não é publicado):

- na fila de merge (`merge_group`) com a tag `<sha>` do commit que vai virar a `main`;
- no push para a `main` com `<sha>`, `main` e `staging`.

Imagem cuja entrada não mudou (o hash vai na tag `in-<hash>` e no rótulo `works.galaxie.context-tree`) não é
reconstruída: ganha as tags novas. Use o **SHA do commit** em `IMAGE_TAG`. Os pacotes são privados: o deploy pelo
Actions faz `docker login` na VPS com o token do próprio job, num `DOCKER_CONFIG` temporário que sai no fim. A VPS não
guarda credencial do GitHub, por isso o `.env` dela fica com `PULL_POLICY=missing`: o `deploy-gh.sh` baixa as imagens
antes do `up`, e nada vem do registry fora do deploy.

**Plano B, sem GHCR**: o `deploy.sh` constrói as imagens na máquina de dev, com os mesmos nomes e tags, e envia com
`docker save … | gzip | ssh root@<vps> 'gunzip | docker load'`.

**`lineup-render`** (navegador headless do perfil `render`, [`infra/lineup-render`](../lineup-render/Dockerfile)): a
imagem oficial do Playwright com o pacote npm já instalado (sem `npx` na partida). A tag é a **versão do Playwright**
(`…-lineup-render:1.64.0`), não o SHA, e o serviço usa `pull_policy: missing`. O `deploy.sh` a constrói **na VPS**
quando a pasta muda (a base tem ~2 GB e a VPS já a tem; vai só a pasta), no fim do deploy, depois do smoke, em até
`LR_BUILD_MIN` minutos (padrão 15) e só se couber no teto. Falha ali não para o deploy: o `WARN` diz se o perfil
`render` segue com a imagem anterior ou se **não sobe** (sem imagem anterior; a VPS não tem credencial do GHCR) e traz
o comando para construir à mão. O `docker.yml` também a publica no GHCR quando a pasta muda, e o deploy pelo Actions
(`deploy-gh.sh`) baixa essa imagem na VPS, no fim do deploy, quando a VPS ainda não tem esta versão da pasta. Subir a versão é mudar
juntos o `FROM` do Dockerfile (tag e digest), o `package.json`/`package-lock.json` da pasta, o `playwright-core` do
`services/ai-agents` e a tag no `compose.yml` (o CI confere com `infra/lineup-render/versions.mjs`; o Dependabot ignora
o `playwright-core`). Reconstruir a mesma tag deixa a imagem anterior órfã (`<none>`); não há limpeza automática (e
`docker system prune` é proibido aqui): remova com `docker image rm <id>`. Fallback, sem a imagem própria: no
`compose.yml`, `image: mcr.microsoft.com/playwright:v1.64.0-noble` com `command: ['npx', '-y', 'playwright@1.64.0',
'run-server', '--port', '3000', '--host', '0.0.0.0']` e `working_dir: /home/pwuser`, o resto igual.

## Atualizar (rotina: toda publicação passa por aqui)

O deploy normal roda no GitHub Actions ([`deploy.yml`](../../.github/workflows/deploy.yml) +
[`deploy-gh.sh`](deploy-gh.sh)). Ele sai sozinho quando o CI e as imagens terminam verdes na ponta da `main` (com a
variável `DEPLOY_AUTO=on`) e também pode ser disparado à mão. O roteiro é o mesmo de baixo, com `docker compose pull` do
GHCR no lugar do build local, e com uma diferença: **smoke test com falha também volta para o SHA anterior**, nas mesmas
condições do `up` e do `migrate`. Configuração, transição e plano B:
[docs/runbooks/deploy-pelo-github.md](../../docs/runbooks/deploy-pelo-github.md).

```bash
gh workflow run deploy.yml                          # o commit mais novo da main (espera o CI dele, até 30 min)
gh workflow run deploy.yml -f sha=<sha> -f force=1  # um SHA específico, mesmo já no ar
```

**Plano B**, da máquina de desenvolvimento (constrói, envia, sobe, pós-deploy e smoke test):

```bash
infra/vps-telemetry/deploy.sh
```

Os passos pós-deploy estão em [`post-deploy.sh`](post-deploy.sh), que os dois roteiros rodam na VPS: seed da base
semântica com `--dir /srv/data/knowledge` e o SHA (falha só avisa), nomes, importância, cache de respostas e conta da
IA.

O script confere o CI do commit (padrão `origin/main`) no GitHub (`gh`, execuções do GitHub Actions do SHA: vermelho
ou cancelado para tudo; ainda rodando espera até `CI_WAIT_MIN` minutos, padrão 20). Um SHA antigo ou intermediário
(execução cancelada porque outro commit entrou na fila) pede `SKIP_CI_CHECK=1`, que também é a saída de emergência.
Constrói `api`, `ingestor` e `demo` e, quando a pasta delas mudou, `backup`, `prometheus` e `grafana` (o hash git da
pasta vai no rótulo da imagem; igual ao de uma imagem da VPS, ela só ganha a tag nova). Se já se passaram
`PRELOCK_MAX_MIN` minutos antes de tocar a VPS, para ali: o resto precisa caber no teto do `deploy-safe.sh`
(`DEPLOY_TIMEOUT`, padrão 80 min; o limite padrão é o teto menos 30 min, 50 min com o teto padrão). Com a **trava na VPS** (`.deploy.lock`: um deploy por vez, de qualquer máquina; quem chega com outro
em andamento sai com `FAIL` e o comando para liberar; trava com mais de `LOCK_STALE_MIN` minutos, padrão teto + 10 (90 com o teto padrão), é de
deploy morto e é tomada com `WARN`), envia por `docker save | ssh docker load`, valida e troca `compose.yml` e
`IMAGE_TAG` (com backup dos dois), sobe a stack mantendo a escala do ingestor (`PULL_POLICY=missing`) e confere o
`migrate` (saída 0). Se o `up` ou o `migrate` falha, volta `compose.yml` e `.env` anteriores e sobe a stack de novo na
versão anterior só quando é garantidamente o estado de antes: nenhuma migration nova aplicada (contagem de
`drizzle.__drizzle_migrations` igual antes e depois), imagens antigas ainda na VPS e não é redeploy do mesmo SHA. Senão,
ou se a conexão caiu no meio, imprime o rollback manual. Sai com 1 nos dois casos. Depois roda os
passos pós-deploy idempotentes (seed da base semântica, nomes curados de estádios, importância) e limpa o cache de
respostas (falha também derruba o deploy; a partir daqui a versão nova fica no ar e o script imprime como voltar). Depois executa o
**smoke test** (`smoke.mjs`), que confere cada funcionalidade entregue **com dados**, não só o status 200: glossário, cores
e campanha do time, o time numa temporada passada (`?season=2025`), stakes e tags do torcedor, minuto a minuto, resumo da IA, conteúdo relacionado, emissoras, a busca global, o resumo da home Explorar, a
rota do painel de Operação (protegida e sem valor de credencial) e a proteção do login. `FAIL` (código, imagem ou config quebrados) sai com 1; `WARN` (dado incompleto: sync, cota, IA)
aparece no relatório. Para rodar só o smoke test:

```bash
ssh root@145.223.94.149 'cd /docker/galaxie-sports && docker compose exec -T demo node -' < infra/vps-telemetry/smoke.mjs
```

### Jogo ao vivo segura o deploy

Antes de tocar a VPS, o job de deploy consulta (só leitura) os jogos em `starting`, `live` ou `break` de competição com
`live_priority = high` e início nas últimas 6 h ([`live-hold.sh`](live-hold.sh)). Com algum no ar, espera, consultando a
cada 2 min, até 3 h; o log e o resumo do Actions dizem quais jogos seguraram e por quanto tempo. Passado o teto, publica
com aviso. Hotfix: disparo manual com `force=1` publica na hora. No automático, se outro commit entra na `main` durante a
espera, este deploy sai e o do commit novo (que já espera na fila) cobre os dois. Consulta com falha não segura nada.
Desligar: variável do repositório `DEPLOY_LIVE_HOLD=off`.

### Candidato e troca sem manutenção (`DEPLOY_CANDIDATE=on`)

Variável do repositório; vazia, o roteiro é o de cima. Ligada:

1. **Candidato** ([`candidate.sh`](candidate.sh)): depois do pull e do dump, a API e a demo da versão nova sobem ao lado
   das que estão no ar (`api-candidate` e `demo-candidate`, perfil `candidate` do compose: mesmo env e limites, **sem
   router no Traefik**, a API com o prefixo `gs-candidate:` no Valkey para cache, rate limit, uso e relay do SSE não se
   misturarem com os da versão no ar). Com migration nova, o migrate roda antes do candidato (numa transação; a versão
   no ar segue sobre o schema novo até a troca). O smoke roda no candidato com `SMOKE_PHASE=candidate`. `FAIL` = sem
   troca: a versão anterior segue no ar e o deploy sai com 1 (com migration aplicada, ele avisa e mostra o dump).
2. **Troca da API e da demo sem página de manutenção** ([`rolling-swap.sh`](rolling-swap.sh)): o contêiner novo sobe ao
   lado do antigo (`--scale 2 --no-recreate`), o antigo só para com o novo healthy (o Traefik só balanceia contêiner
   healthy), e o `gsports-retry` (ligado em `EDGE_MIDDLEWARES`, [infra/traefik](../traefik/README.md)) manda a conexão
   recusada pelo antigo no SIGTERM para o novo. O CI testa com o Traefik de verdade e tráfego a cada 50 ms (zero
   respostas fora de 200) e com uma versão que nunca fica healthy (a troca recusa e a anterior segue). O resto da stack
   (ingestor, agents, backup, observabilidade) sobe como antes; o smoke de depois do pós-deploy continua valendo.
3. A volta automática baixa do GHCR a imagem da versão anterior se o prune diário da VPS já a tiver apagado, e o deploy
   guarda só os 10 backups mais novos de `compose.yml` e `.env`.

Ligar (com o OK do Wagner; sem staging, o primeiro deploy com ela é o teste), depois de `EDGE_MIDDLEWARES` ter o
`gsports-retry`:

```bash
gh variable set DEPLOY_CANDIDATE --body on
```

Acompanhar o primeiro deploy no log do Actions: `candidato healthy`, o resultado do smoke do candidato, `ok  api trocado
sem manutenção` e `ok  demo trocado sem manutenção`. Voltar: `gh variable delete DEPLOY_CANDIDATE` (o próximo deploy já
sai pelo roteiro de antes). Candidato esquecido no ar (job morto no meio):
`docker compose --profile candidate rm -sf api-candidate demo-candidate`.

Os pacotes leem `config/` e `data/knowledge` a partir de si mesmos e **silenciam** quando não acham (lista vazia), então
um diretório fora da imagem não dá erro, só some a funcionalidade. Por isso as imagens levam `config/` inteiro (e a API a
base semântica), com `RULES_CONFIG_DIR`, `WTW_CONFIG_DIR`, `GEO_CONFIG_DIR`, `KNOWLEDGE_DIR` e `MEDIA_DENYLIST_PATH`, e o
CI confere os caminhos dentro das imagens de `api` e `ingestor` em todo PR.

## Página de manutenção

Quando um deploy ou um reinício recria a `demo` ou a `api`, o Traefik fica alguns segundos sem backend para o router
delas e responderia **404** numa página válida. O serviço `maintenance` cobre esse intervalo sem tocar na stack do
Traefik, só com labels da nossa stack:

- **Routers de prioridade 1** (`gsports-demo-maintenance` e `gsports-api-maintenance`) com as mesmas regras de host dos
  routers da demo e da API (a da API também sem `/metrics` e `/internal`), `websecure` e o certresolver `letsencrypt`.
  A prioridade padrão do Traefik é o tamanho da regra, então o router de verdade sempre ganha; o de manutenção só
  responde quando o outro some: contêiner parado, recriado ou ainda sem healthcheck `healthy` (o provider Docker do
  Traefik ignora contêiner `starting`/`unhealthy`).
- **Hosts da demo**: `503` com `Retry-After: 30` e `Cache-Control: no-store`, página HTML no tema escuro da demo (pt-BR
  com uma linha em inglês e outra em espanhol), sem nenhum recurso externo. Ela pergunta pela mesma URL a cada 10 s e
  recarrega quando a resposta deixa de ser 503 (sem JavaScript, `meta refresh` de 20 s). O link da página de status
  está escondido até a URL ser decidida (TODO no HTML).
- **Host da API**: `503` em `application/problem+json`, no formato dos erros da API, com `Retry-After: 30`:
  `{"type":"https://docs.galaxie.sports/errors/maintenance","title":"Em manutenção","status":503,"code":"MAINTENANCE",…,"retry_after":30}`.
- Qualquer caminho e qualquer método, inclusive `/health`, recebem o 503: monitores externos enxergam a manutenção.

**Não é recriado pelos deploys.** Imagem upstream fixa (`caddy:2.11.7-alpine`, `pull_policy: missing`), sem
`IMAGE_TAG`, e a config inteira (Caddyfile, HTML e JSON) inline no `compose.yml` (`configs:` com `content:`, porque a
VPS só recebe esse arquivo). O hash do serviço não muda de um deploy para o outro, então o `docker compose up -d
--scale ingestor=N` do `deploy.sh` deixa o contêiner como está, e ele segue respondendo enquanto demo e API sobem. O
`deploy.sh` só baixa a imagem antes de trocar o `compose.yml`, se ela ainda não estiver na VPS.

**Editou a página, o JSON ou o Caddyfile?** O compose não recria um serviço quando só muda o conteúdo de uma config
inline. Atualize o rótulo `works.galaxie.maintenance-rev` do serviço; o CI confere que ele bate com o conteúdo e, se
não bate, diz o valor certo:

```bash
docker compose -f infra/vps-telemetry/compose.yml --env-file infra/vps-telemetry/env.example config --format json \
  | node infra/vps-telemetry/maintenance-rev.mjs
```

Com o rótulo novo, o próximo deploy recria só o `maintenance` (cerca de 1 s, normalmente com demo e API no ar).

**Conferir.** O smoke test confere, pela rede da stack, que o contêiner está no ar e responde os dois 503
(`http://maintenance:8080` e `:8081`). Os routers do Traefik se conferem de fora, numa janela combinada:

```bash
ssh root@145.223.94.149 'cd /docker/galaxie-sports && docker compose stop demo'
curl -sS -D - -o /dev/null https://$DEMO_DOMAIN/competicoes/brasileirao-serie-a   # 503, Retry-After: 30, text/html
ssh root@145.223.94.149 'cd /docker/galaxie-sports && docker compose start demo'
curl -sS -o /dev/null -w '%{http_code}\n' https://$DEMO_DOMAIN/                     # de volta: 307 → /login
```

**Forçar a manutenção** (migração demorada, restauração do banco): `MAINTENANCE_PRIORITY=10000` no `.env` e
`docker compose up -d maintenance` (recria só ele; os routers passam a ganhar dos de verdade nos dois hosts). Para
voltar: `MAINTENANCE_PRIORITY=1` (ou apagar a linha) e `docker compose up -d maintenance`. Enquanto forçada, ninguém
alcança a demo nem a API pelo Traefik (nem admin), um deploy mantém a manutenção (o valor fica no `.env`) e o smoke
test continua passando, porque fala com os contêineres pela rede interna. Alternativa pontual, para um serviço só:
`docker compose stop demo` (ou `api`) também cai na página, até o `start`.

## Painel de Operação (flags sem editar o `.env`)

Ajustes → Operação, na demo (só admin), mostra e altera as flags da operação: agenda dos jobs, ao vivo
(`LIVE_FEATURED` e afins), IA e orçamento, Onde Assistir, conteúdo relacionado e planos da api-sports. O `.env` vira o
**padrão de fábrica**: o painel grava em `ops.runtime_setting` (com histórico em `ops.runtime_setting_log`) e vale a
precedência **banco > env > padrão do código** (registro em `packages/runtime-config`).

- Os schedulers (`ingestor` e `agents`) releem a cada 30 s (`SCHEDULER_REFRESH_SECONDS`): reprogramam as agendas
  mudadas e entregam o env efetivo a cada job, que lê os valores no começo da execução. O ao vivo relê `LIVE_*` a cada
  minuto. Nada disso reinicia contêiner; só `LIVE_POLL_INTERVAL_SECONDS` (lido pela API) espera a API reiniciar.
- Cada contêiner relata o próprio env em `ops.runtime_env` (segredos só como "configurado"), que também é o sinal de
  vida mostrado no painel. "Rodar agora" entra em `ops.job_request` e o scheduler do perfil executa.
- Para voltar tudo ao `.env`: "Voltar ao padrão" em cada flag, ou `delete from ops.runtime_setting;` no banco.

## Deploy (primeira vez)

VPS nova do zero (SSH, Docker, firewall, Traefik e a ordem de restauração do banco): [docs/runbooks/bootstrap-vps.md](../../docs/runbooks/bootstrap-vps.md).

```bash
mkdir -p /docker/galaxie-sports && cd /docker/galaxie-sports
# compose.yml deste diretório, no commit mergeado; .env a partir de env.example (chmod 600)
docker network inspect $(docker network ls -q) --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}}{{end}}'  # 172.30.50.0/24 livre?
docker compose pull
docker compose up -d
docker compose ps        # migrate e s3-init: Exited (0); demais: Up/healthy
```

### Dados iniciais (sem gastar cota de novo)

O banco local já tem o bootstrap (raw + core). Em vez de refazer as chamadas:

1. **Banco**: `pg_dump -Fc` do Postgres local → copiar para a VPS → com a stack no ar mas **ingestor parado**
   (`docker compose stop ingestor`), `pg_restore --clean --if-exists --no-owner` dentro do contêiner `postgres`.
2. **Assets**: sincronizar o bucket local com o da VPS (`aws s3 sync` por túnel SSH até o `s3` da stack).
3. Subir o ingestor de novo (`docker compose start ingestor`) e **parar qualquer ingestor local**.

### Tenant da demo

```bash
docker compose exec api node dist/cli/tenant-create.js --slug demo --name Demo --plan enterprise --daily-quota none --label demo-vps
# copiar a chave exibida para GALAXIE_DEMO_KEY no .env (sem colar em chat/log) e recriar só a demo:
docker compose up -d demo
```

### Login da demo

O acesso é controlado pelo próprio app (Better Auth, tabelas no schema `demo_auth` do mesmo Postgres):

- `BETTER_AUTH_SECRET`: `openssl rand -hex 32`, gerado na VPS.
- Login sem senha: a pessoa informa o e-mail em `/login` e digita o código de 6 dígitos que chega por
  e-mail (vale 10 min, até 5 tentativas; novo pedido só depois de 1 min). E-mail sem convite recebe a
  mesma resposta, sem código. A sessão dura 30 dias e se renova com o uso.
- `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_NAME`: na primeira subida, sem nenhum admin, o app cria esse usuário e
  manda o convite (link para a tela de login).
- `SMTP_*`: remetente dos convites e dos códigos de acesso. Sem SMTP, o convite fica criado e o painel
  (`/ajustes/usuarios`) mostra o link para o admin copiar, mas ninguém consegue entrar: em produção o
  código nunca vai para o log (em desenvolvimento, sim).
- Convidados têm prazo de acesso; depois dele o login é bloqueado. Admin não expira.

## Verificação (de fora da VPS)

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/health        # 200, certificado válido (sem -k)
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/metrics       # 404
curl -sS -o /dev/null -w '%{http_code}\n' https://$API_DOMAIN/internal/x    # 404
curl -sS -o /dev/null -w '%{http_code}\n' https://$DEMO_DOMAIN/             # 307 → /login (sem sessão)
curl -sS -o /dev/null -w '%{http_code}\n' https://$ASSETS_DOMAIN/$S3_BUCKET/api-sports/flags/br.svg   # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://$ASSETS_DOMAIN/$S3_BUCKET/                          # 403/404 (sem listagem)
```

- Backup inicial: `docker compose exec backup ls -la /backups`.
- Grafana: `ssh -L 3000:<IP do contêiner grafana>:3000 root@<vps>` e abrir `http://localhost:3000`.
- As outras stacks continuam respondendo como antes.

## Reverso

- Parar e remover: `cd /docker/galaxie-sports && docker compose down` (**sem `-v`**: os dados ficam).
- Apagar os dados (Postgres, S3, backups) só com pedido explícito: `docker compose down -v`.
- Remover os registros DNS. Nada disto toca nas outras stacks.

## Logs, o token do SSE (`?token=`) e a chave obsoleta (`?key=`)

O `EventSource` não manda header. Desde 28/10/2026 o navegador abre o `/v1/stream` com um token de 5 minutos
(`?token=`), que o backend do cliente pede em `POST /v1/stream/token` (docs/05 §5.1). A chave em `?key=` ainda é
aceita até 27/12/2026, com os headers `Deprecation` e `Sunset` e um aviso por tenant por dia no log da API
(`sse.query_key_deprecated`: `docker compose logs api | grep query_key_deprecated` mostra quem falta trocar). Defina
`STREAM_TOKEN_SECRET` (`openssl rand -hex 32`) no `.env` para o token valer entre instâncias e sobreviver a um deploy;
sem ele, cada processo da API sorteia o seu. Na VPS a borda é o Traefik (v3; não há Caddy aqui), versionado em
[`infra/traefik`](../traefik/README.md), e a API redige `?key=` e `?token=` nos próprios logs. Na verificação de
2026-10-25 houve 0 ocorrências de `key=` em 7 dias de logs do Traefik e da API, que até ali rodava sem access log.

O access log do Traefik ([`infra/traefik/compose.yml`](../traefik/compose.yml), aplicado à mão com o OK do Wagner)
descarta o `RequestPath`, que leva a query (chave ou token), e os headers:

```text
--accesslog=true --accesslog.format=json --accesslog.fields.defaultmode=keep
--accesslog.fields.names.RequestPath=drop --accesslog.fields.headers.defaultmode=drop
```

Para manter o caminho no log, as alternativas são exigir a chave só no header `x-galaxie-key` no SSE ou reescrever a
URL num middleware antes do log.

## Papéis do banco

O `POSTGRES_USER` é o dono do banco. É o superusuário que a imagem do Postgres cria, e só o `migrate` deveria usá-lo.
Cada serviço entra com um papel próprio, sem superusuário e sem DDL, com GRANT por schema. A matriz e o levantamento do
que cada serviço lê e escreve estão em `packages/db/src/roles.ts`.

| papel | lê | escreve |
| --- | --- | --- |
| `galaxie_api` | todos os schemas da aplicação e `demo_auth.cache_feed_cursor` (o `/metrics`) | `api`, `enrich`, `ops` |
| `galaxie_demo` | todos, menos `raw` | `ops`, `semantic`, `enrich`, `api` e `core.asset`; é dono do `demo_auth` |
| `galaxie_ingestor` | todos | `raw`, `core`, `ops`, `semantic`, `enrich`, `multisport`, `equestrian` |
| `galaxie_agents` | todos | `enrich`, `semantic`, `ops`, `core.asset` e `api.tenant_channel_list` |
| `galaxie_backup` | tudo (`pg_read_all_data`) | `ops.job_run`; tem `CREATEDB` para o banco do ensaio |

- **Como o `migrate` aplica:** com `DB_ROLES=on`, a cada deploy ele cria os papéis que faltam, revoga e concede a matriz
  inteira numa transação e grava os default privileges. Assim, tabela nova já sai com o GRANT. Também dá LOGIN a
  cada papel com a senha da URL do serviço.
- **Quem continua com o dono:** a sincronização NAS → produção (`infra/ops/sync`, usa `session_replication_role`) e a
  restauração real.

### Troca sem downtime (precisa do OK do Wagner)

Um serviço por vez. Cada passo é um `up -d` de um serviço só, e o resto continua no ar.

1. **Backup e senhas.** Antes de tudo, `cp .env .env.bak-pre-papeis`. Depois gere uma senha por papel:
   `for s in API DEMO INGESTOR AGENTS BACKUP; do echo "$s $(openssl rand -hex 32)"; done`.
2. **Papéis sem trocar ninguém.** No `.env`, ponha `DB_ROLES=on` e rode:
   `docker compose run --rm --no-deps migrate </dev/null`.
   - O log tem de dizer `Papéis do banco aplicados: galaxie_api, …`.
   - Nenhum serviço muda: as URLs ainda não existem.
   - Na mesma execução, o `demo_auth` e as tabelas dele passam a ser do `galaxie_demo`. A demo, ainda com o dono,
     continua funcionando (o superusuário pode tudo).
3. **Agents primeiro, o serviço de menor impacto.** Acrescente
   `DB_URL_AGENTS=postgres://galaxie_agents:<senha>@postgres:5432/galaxie_sports` ao `.env`, depois rode
   `docker compose run --rm --no-deps migrate </dev/null` (dá o LOGIN) e `docker compose up -d --no-deps agents`.
   Acompanhe `docker compose logs -f agents` por um ciclo de jobs (10 min).
   - Erro `permission denied for …` (código 42501): volte (passo 7) e anote a tabela, que falta na matriz.
4. **Ingestor, depois a API e por último a demo.** Para cada um, repita o passo 3 com `DB_URL_INGESTOR`, `DB_URL_API` e
   `DB_URL_DEMO` e o `up -d --no-deps` do serviço.
   - Ingestor: espere um `live-run` e o `normalize`.
   - API: rode `curl -s https://api.sports.galaxie.works/health/db` e confira o `/metrics` pelo Prometheus.
   - Demo: entre no painel, aprove um item na revisão e confira Ajustes → Sistema. Na subida, a demo roda as migrações
     do Better Auth no `demo_auth`, como dona.
5. **Backup.** Acrescente `DB_URL_BACKUP=…`, rode o `migrate` e depois `docker compose up -d --no-deps backup`. Para
   conferir, rode `docker compose exec backup sh -c '. /usr/local/lib/galaxie-backup/lib.sh; psql -Atc "select current_user"'`
   (tem de dar `galaxie_backup`), depois `docker compose exec backup backup.sh` e
   `docker compose exec backup restore-drill.sh`.
6. **Smoke.** `docker compose exec -T demo node - < smoke.mjs` (ou o próximo deploy).
7. **Reverso, a qualquer momento.** Tire a `DB_URL_<SERVIÇO>` do `.env` e rode `docker compose up -d --no-deps <serviço>`:
   ele volta para o dono. `DB_ROLES=off` só para de reaplicar; os papéis continuam no banco, inofensivos sem as URLs.

### Depois de restaurar um dump

O dump vai sem GRANTs (`--no-privileges`). Depois de `restore.sh --yes`, rode `docker compose run --rm migrate` para
os papéis voltarem a valer.

A restauração real precisa do dono:
`docker compose exec -e DB_URL_BACKUP="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB" backup restore.sh --yes <dump>`.
Com as variáveis do `.env` carregadas no shell: `set -a; . ./.env; set +a`.

## Backups, ensaio e alertas

Política (RPO 24 h, RTO 2 h; 7 dumps na VPS, 14 diários + 8 semanais + 12 mensais no NAS, snapshot diário do
provedor), a cópia diária do NAS (stack `galaxie-sports-backup-nas`) e o ensaio mensal de restauração:
[docs/runbooks/exercicio-dr.md](../../docs/runbooks/exercicio-dr.md). Na VPS:

- `docker compose exec backup backup-check.sh`: verificação avulsa (último dump e, com `BACKUP_NAS_RECEIPT=true`, o
  padrão, o recibo `.nas_last_pull` que o NAS deixa depois de copiar e conferir).
- `docker compose exec backup restore-drill.sh`: ensaio avulso. Restaura num banco `galaxie_sports_drill_<data>`, nunca
  no de produção, e precisa de 2x o tamanho do banco livre no disco.
- Resultado dos dois em `ops.job_run` (jobs `backup-check` e `pg-restore-drill`) e nas métricas `galaxie_job_*`.
- O serviço `node-exporter` mede o disco onde o Docker guarda os volumes (alerta acima de 85%). Ele monta o volume
  `promdata` só para leitura, sem bind mount do host nem porta publicada.
- **Dump antes do migrate:** quando o journal do SHA novo tem mais migrations que o banco, o deploy (`deploy-gh.sh` e
  `deploy.sh`) roda `pre-migrate-dump.sh` antes de trocar o compose. O dump sai de um contêiner avulso do serviço
  `backup` para o volume dele, em `/backups/pre-migrate/<db>_pre-migrate_<data>_<antigo>-<novo>.dump` (fora da
  rotação dos diários), com o `.sha256` ao lado, conferido com `pg_restore --list`, guardando os 3 mais novos
  (`PRE_MIGRATE_KEEP`). Com `BACKUP_AGE_RECIPIENTS`, sai cifrado como os diários (`.dump.age`, conferido com a chave
  do ensaio) e nada em claro fica no volume. Sem espaço (menos da metade do tamanho do banco livre) ou com o `pg_dump` falhando, o deploy
  para sem ter tocado em nada; `SKIP_PRE_MIGRATE_DUMP=1` publica sem ele. Migration nova não tem rollback automático:
  voltar é parar API e ingestor, `docker compose exec backup restore.sh --yes pre-migrate/<arquivo>` (o deploy que
  falhou imprime o comando) e subir a versão anterior.
- O dump de partida do serviço `backup` (`BACKUP_ON_START`) espera o `migrate` terminar: o `pg_dump` segura as
  tabelas e o `migrate`, com `lock_timeout` curto, desistiria.

## Freios: banco, Valkey e processos Node

Uma consulta presa, o Valkey cheio ou um job vazando memória não podem derrubar a API e o ao vivo.

### Tempos limite

| Onde | Tempo | Por quê |
| --- | --- | --- |
| Pool da API (`profile: 'api'`) | `statement_timeout` 10 s, `lock_timeout` 3 s, `idle_in_transaction_session_timeout` 15 s | Abaixo do timeout de 30 s da requisição: a consulta presa solta a conexão e o pool de 10 não fica todo esperando trava. |
| Pools da demo | Builder e change feed como a API; login/painel com `statement_timeout` 30 s | O painel de Operação agrega `ops.job_run` e `ops.llm_usage` (página de admin, fora do caminho da API). |
| Jobs e CLIs (`profile: 'job'`, o padrão) | 10 min, 60 s, 10 min | Normalização e sync têm consultas de minutos; o teto pega só o que travou, bem abaixo do tempo limite dos jobs (15 a 120 min). |
| Migrate (`profile: 'migrate'`) | sem `statement_timeout`; `lock_timeout` 5 s, até 5 tentativas com 10 s entre elas | Índice novo em tabela grande demora. Na fila de um `ACCESS EXCLUSIVE`, a migration faria a API inteira esperar atrás dela; o drizzle aplica tudo numa transação, então desistir não deixa nada pela metade. |
| Postgres (servidor) | `idle_in_transaction_session_timeout` 30 min; log de consulta acima de 5 s e de espera por trava | Rede de segurança para o `psql` à mão; os da aplicação vêm por pool. |
| Valkey (ioredis da API) | `commandTimeout` 1 s (`REDIS_COMMAND_TIMEOUT_MS`) | Cache, rate limit e cota já falham abertos; sem o teto, um Valkey lento segurava a requisição. A conexão do `SUBSCRIBE` do SSE fica sem teto (espera o Valkey voltar). |
| api-sports | prioridade LIVE 30 s (`APISPORTS_LIVE_TIMEOUT_MS`); as outras 180 s | O ao vivo repete a cada poucos segundos: esperar 3 min por uma chamada segurava o tick inteiro. |
| YouTube Data API | 20 s | O `related-run` (a cada 3 min) não fica pendurado. |
| Download do F1DB | 5 min | O zip tem dezenas de MB. |
| S3 (ingestor e upload da demo) | conexão 5 s, 30 s sem dado no socket | Sem isso o SDK esperava para sempre; o espelho de assets ficava preso até o teto de 90 min do job. |

Escape para uma CLI pesada rodada à mão: `-e DB_STATEMENT_TIMEOUT_MS=0` (também `DB_LOCK_TIMEOUT_MS` e
`DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`; 0 = sem teto).

### Conexões

Cada sessão aparece em `pg_stat_activity` com o nome do pool (`galaxie-api`, `galaxie-scheduler`,
`galaxie-job:<job>`, `galaxie-demo-*`, `galaxie-migrate`):

```sql
select application_name, state, count(*) from pg_stat_activity where datname is not null group by 1, 2 order by 3 desc;
```

Soma no pico (`max_connections` = 100, 3 reservadas ao superusuário):

| Pool | Antes | Depois |
| --- | --- | --- |
| API | 10 | 10 |
| Demo (login 5, Builder 3, change feed 2) | 10 | 10 |
| Ingestor: scheduler | 2 | 2 |
| Ingestor: jobs (pool + trava de cada um) | sem teto de jobs, 10 + 1 cada (~5 juntos no pico: ~55) | ao vivo 3 × (4 + 1) + `SCHEDULER_MAX_JOBS` 2 × (4 + 1) = 25 |
| Agents: scheduler | 2 | 2 |
| Agents: jobs | sem teto, 4 + 1 cada (~5 juntos: ~25) | `AGENTS_MAX_JOBS` 3 × (4 + 1) = 15 |
| Backup, migrate, dump antes do migrate | 2 | 3 |
| **Total** | **~106: passava do limite** | **67, com ~30 de folga para CLI à mão e `psql`** |

O pool padrão de jobs e CLIs caiu de 10 para 4 (`DB_POOL_MAX` em `packages/db/src/client.ts`).

### Memória dos jobs

Cada job do scheduler é um processo Node filho com heap fixo (`--max-old-space-size` do job ou
`SCHEDULER_JOB_HEAP_MB`, e geração nova de 3 × 8 MB). Sem os flags, o V8 dimensiona pela máquina, e a geração nova
sozinha pode chegar a ~190 MB por processo. Um job que vaza memória morre sozinho com `heap out of memory` (código
134 em `ops.job_run`), em vez de o kernel matar o maior processo do contêiner. A conta, com ~64 MB por processo além do
heap (geração nova e o próprio Node):

| Contêiner | Processos no pior caso | Soma |
| --- | --- | --- |
| `ingestor` (1152m) | scheduler 64 + ao vivo (`live-run` 128, `live-reconcile` 64, `events-clock` 64, nunca esperam vaga) + `SCHEDULER_MAX_JOBS` 2 × 160, + 6 × 64 | 1024 MB (128 de folga) |
| `agents` (768m) | scheduler 64 + `AGENTS_MAX_JOBS` 3 × 128, + 4 × 64 | 704 MB (64 de folga) |
| `api` e `demo` (512m) | heap 320 + geração nova 3 × 16 + ~50 | ~420 MB |

Com as vagas ocupadas, o job espera na fila (log `teto de jobs simultâneos atingido; job na fila`) e o cron seguinte do
mesmo job pula. Job que morrer por heap: suba o `heapMb` dele em `services/ingestor/src/scheduler/schedule.ts` e refaça
a conta. A CLI rodada à mão (`docker compose run ... node dist/cli/x.js`) fica no padrão do V8.

### Valkey

`maxmemory` 160 MB num contêiner de 256 MB: a folga cobre o fork da reescrita do AOF e a fragmentação. Cheio, despeja
pela LRU só chave com TTL (`volatile-lru`). Todas têm TTL: cache de respostas e índices de tag, marcas de purge, rate
limit, chaves verificadas, contadores de uso (4 dias; o hash leva a época e o persister consolida em
`api.usage_daily`, então um despejo não soma errado), leases e cursor do SSE e travas. A exceção é `gs:purge-seq`, um
contador de poucos bytes que não pode sumir (o cache depende de ele só crescer): sem TTL, nunca é despejado. Valkey
cheio só de chaves sem TTL recusaria gravações, e cache e rate limit seguem pelo caminho de falha aberta.

### Alertas: push no celular e resumo por e-mail

As regras ficam no Prometheus (`infra/observability/prometheus/alerts.yml` e, as dos SLOs, `slo.yml`). O Grafana lê os alertas disparando: o
crítico (os 5 sinais graves) sai na hora como push pelo ntfy; o resto entra no resumo diário por e-mail, às 08:00 de
Brasília. Passo a passo, teste e o monitor externo: `docs/runbooks/alertas-e-monitoramento.md`. No `.env` da VPS (o
tópico e a senha nunca vão para o repositório):

```dotenv
ALERT_NTFY_URL=https://ntfy.sh/<tópico secreto>   # push; o nome do tópico é a senha
ALERT_EMAIL_TO=voce@exemplo.com          # vários: separados por ;
ALERT_EMAIL_FROM=alertas@exemplo.com     # remetente aceito pelo SMTP
ALERT_SMTP_HOST=smtp.exemplo.com:587     # host:porta; STARTTLS quando o servidor oferece
ALERT_SMTP_USER=alertas@exemplo.com
ALERT_SMTP_PASSWORD=<senha de app do SMTP>
```

Depois, `docker compose up -d grafana`. O log do Grafana diz `alertas por push ligados` e `alertas por e-mail ligados`.
Para testar, use Alerting → Contact points → `push-imediato` (ou `email-operacao`) → Test. Sem canal nenhum, os alertas
continuam visíveis em Alerting → Alert rules (regra "Alerta do Prometheus") e no `/alerts` do Prometheus (túnel SSH).

## Pendências

- O dono configura o tópico do ntfy e o SMTP dos alertas (acima) e o monitor externo (runbook de alertas).
- Cabeçalhos de cache/CDN para os assets.
