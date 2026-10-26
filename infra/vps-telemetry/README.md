# Staging na VPS "telemetry" (Traefik)

Stack em [`compose.yml`](compose.yml), derivada de [`infra/portainer/stack.yml`](../portainer/stack.yml) para uma VPS que
**já tem Traefik v3 em produção** (`network_mode: host`, provider Docker com `exposedByDefault=false`,
entrypoints `web`/`websecure`, certresolver `letsencrypt` por HTTP-01).

| Diferença para a stack do Portainer | Por quê |
|---|---|
| Sem Caddy; labels do Traefik na `api`, na `demo` e no `s3` | o Traefik da VPS faz TLS e roteamento |
| `/metrics` e `/internal` fora do router da API | mesmo bloqueio que o Caddy fazia |
| Sem `build:`; `pull_policy: always` com imagens do GHCR | não compilar o monorepo na VPS (2 vCPU compartilhadas) |
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

O workflow [`docker.yml`](../../.github/workflows/docker.yml) publica no push para a `main`
`ghcr.io/galaxie-works/galaxie-sports-<imagem>:<sha>` e `:staging` para `api`, `ingestor`, `demo`, `backup`,
`prometheus` e `grafana` (o `caddy` não é publicado). Use o **SHA do commit** em `IMAGE_TAG`.
Com pacotes privados, a VPS precisa de `docker login ghcr.io` com um token só `read:packages`.

**Sem credencial do GitHub na VPS** (alternativa): construir as imagens no commit mergeado em outra máquina, com os
mesmos nomes/tags, enviar com `docker save … | gzip | ssh root@<vps> 'gunzip | docker load'` e usar
`PULL_POLICY=missing` no `.env`.

**`lineup-render`** (navegador headless do perfil `render`, [`infra/lineup-render`](../lineup-render/Dockerfile)): a
imagem oficial do Playwright com o pacote npm já instalado (sem `npx` na partida). A tag é a **versão do Playwright**
(`…-lineup-render:1.64.0`), não o SHA, e o serviço usa `pull_policy: missing`. O `deploy.sh` a constrói **na VPS**
quando a pasta muda (a base tem ~2 GB e a VPS já a tem; vai só a pasta), no fim do deploy, depois do smoke, em até
`LR_BUILD_MIN` minutos (padrão 15) e só se couber no teto. Falha ali não para o deploy: o `WARN` diz se o perfil
`render` segue com a imagem anterior ou se **não sobe** (sem imagem anterior; a VPS não tem credencial do GHCR) e traz
o comando para construir à mão. O `docker.yml` também a publica no GHCR quando a pasta muda. Subir a versão é mudar
juntos o `FROM` do Dockerfile (tag e digest), o `package.json`/`package-lock.json` da pasta, o `playwright-core` do
`services/ai-agents` e a tag no `compose.yml` (o CI confere com `infra/lineup-render/versions.mjs`; o Dependabot ignora
o `playwright-core`). Reconstruir a mesma tag deixa a imagem anterior órfã (`<none>`); não há limpeza automática (e
`docker system prune` é proibido aqui): remova com `docker image rm <id>`. Fallback, sem a imagem própria: no
`compose.yml`, `image: mcr.microsoft.com/playwright:v1.64.0-noble` com `command: ['npx', '-y', 'playwright@1.64.0',
'run-server', '--port', '3000', '--host', '0.0.0.0']` e `working_dir: /home/pwuser`, o resto igual.

## Atualizar (rotina: toda publicação passa por aqui)

```bash
infra/vps-telemetry/deploy.sh          # da máquina de desenvolvimento: constrói, envia, sobe, pós-deploy e smoke test
```

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

## Logs e a chave do SSE (`?key=`)

O `EventSource` não manda header, então o `/v1/stream` aceita a chave em `?key=`. Na VPS a borda é o Traefik (v3,
configurado por argumentos fora deste repositório; não há Caddy aqui), com **access log desligado** (sem
`--accesslog`), e a API redige `?key=` nos próprios logs. Hoje a chave na query não vai para log: na verificação de
2026-10-25 houve 0 ocorrências de `key=` em 7 dias de logs do Traefik e da API.

Se o access log do Traefik for ligado, ele precisa descartar o `RequestPath`, que leva a query:

```text
--accesslog=true --accesslog.format=json --accesslog.fields.defaultmode=keep
--accesslog.fields.names.RequestPath=drop --accesslog.fields.headers.defaultmode=drop
```

Para manter o caminho no log, as alternativas são exigir a chave só no header `x-galaxie-key` no SSE ou reescrever a
URL num middleware antes do log.

## Backups, ensaio e alertas

Política (RPO 24 h, RTO 2 h; 7 dumps na VPS, 14 diários + 8 semanais + 12 mensais no NAS, snapshot diário do
provedor), o que o NAS deve fazer e o ensaio mensal de restauração:
[docs/runbooks/exercicio-dr.md](../../docs/runbooks/exercicio-dr.md). Na VPS:

- `docker compose exec backup backup-check.sh`: verificação avulsa (último dump e, com `BACKUP_NAS_RECEIPT=true`, o
  recibo do NAS).
- `docker compose exec backup restore-drill.sh`: ensaio avulso. Restaura num banco `galaxie_sports_drill_<data>`, nunca
  no de produção, e precisa de 2x o tamanho do banco livre no disco.
- Resultado dos dois em `ops.job_run` (jobs `backup-check` e `pg-restore-drill`) e nas métricas `galaxie_job_*`.
- O serviço `node-exporter` mede o disco onde o Docker guarda os volumes (alerta acima de 85%). Ele monta o volume
  `promdata` só para leitura, sem bind mount do host nem porta publicada.

### Alertas por e-mail

As regras ficam no Prometheus (`infra/observability/prometheus/alerts.yml`). O Grafana lê os alertas disparando e manda
o e-mail. Para ligar, o dono põe no `.env` da VPS (a senha nunca vai para o repositório):

```dotenv
ALERT_EMAIL_TO=voce@exemplo.com          # vários: separados por ;
ALERT_EMAIL_FROM=alertas@exemplo.com     # remetente aceito pelo SMTP
ALERT_SMTP_HOST=smtp.exemplo.com:587     # host:porta; STARTTLS quando o servidor oferece
ALERT_SMTP_USER=alertas@exemplo.com
ALERT_SMTP_PASSWORD=<senha de app do SMTP>
```

Depois, `docker compose up -d grafana`. O log do Grafana diz `alertas por e-mail ligados`. Para testar, use Alerting →
Contact points → `email-operacao` → Test. Sem `ALERT_EMAIL_TO` ou `ALERT_SMTP_HOST`, os alertas continuam visíveis em
Alerting → Alert rules (regra "Alerta do Prometheus") e no `/alerts` do Prometheus (túnel SSH), sem notificação.

## Pendências

- O dono configura o SMTP dos alertas (acima) e, no NAS, a rotação e o recibo da cópia
  ([docs/runbooks/exercicio-dr.md](../../docs/runbooks/exercicio-dr.md)); depois, `BACKUP_NAS_RECEIPT=true`.
- Cabeçalhos de cache/CDN para os assets.
