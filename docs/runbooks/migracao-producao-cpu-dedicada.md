# Migrar a produção para uma máquina com CPU dedicada

Decisão de 17/11/2026: a produção sai da VPS atual (2 vCPU com CPU limitada por créditos: três cortes em quatro dias, com
o ao vivo parado por ~36 h) para uma VM com CPU dedicada na Oracle Cloud, numa região do Brasil, `VM.Standard.E5.Flex`
com 2 OCPU (4 vCPU) e 16 GB, Ubuntu 24.04 e boot de 200 GB. O estudo que escolheu o provedor e o plano em cinco fases
são da repo interna (têm custo); este runbook é a versão operacional, com os nomes que o repositório usa de fato.

Princípios, na ordem em que custam caro quando ignorados:

- **Nada de deploy durante a migração.** O deploy troca o `.env` da VPS por `mv` ([deploy-gh.sh](../../infra/vps-telemetry/deploy-gh.sh)) e
  perde gravação feita ao mesmo tempo; a trava `.deploy.lock` não protege uma cópia à mão. `gh variable delete DEPLOY_AUTO`
  antes de começar, `gh variable set DEPLOY_AUTO --body on` só no fim, com o deploy de teste verde.
- **A carga fica pausada pelo caminho de sempre**: `touch /root/carga-pausa`, esperar o log do `galaxie-carga.service`
  dizer "pausada", e `rm /root/carga-pausa` para voltar. Nunca `systemctl stop` (o lote em andamento não fecha).
- **Janela sem jogo ao vivo de prioridade alta** para o corte (a consulta do bloco "ao vivo" do
  [diagnostico.sh](../../infra/vps-telemetry/diagnostico.sh) lista o que está em andamento).
- **A VPS antiga fica contratada e intacta por pelo menos 14 dias** depois do corte. Produção intacta: nada é apagado lá
  até o encerramento.
- **Nenhum IP ou host da máquina nova entra neste repositório**, nem quando existir: vai para `vars`/secrets do ambiente
  `producao` do Actions, para o `.env` e para a stack do NAS no Portainer. O IP da VPS antiga também saiu dos workflows
  neste PR (`vars.VPS_SSH_TARGET` passou a ser obrigatória).

## O que roda hoje e precisa existir na máquina nova

| Peça | Hoje na VPS | Referência |
| --- | --- | --- |
| Borda | Traefik em `/docker/traefik` (`network_mode: host`, Let's Encrypt HTTP-01, certificados no volume `traefik_traefik-letsencrypt`) | [infra/traefik](../../infra/traefik/README.md) |
| Apps | projeto `galaxie-sports` (`compose.yml`): `api`, `webhooks`, `migrate`, `site`, `console`, `live` (2 cópias), `ingestor`, `worker`, `agents`, `maintenance`, candidatos, `lineup-render` | [stack em três projetos](stack-em-tres-projetos.md) |
| Dados | projeto `galaxie-sports-dados` (`compose.dados.yml`): `postgres` (**`postgres:17-alpine`**), `valkey`, `s3` (RustFS), `s3-init`, `backup` | [dados e observabilidade](stack-dados-e-observabilidade.md) |
| Observabilidade | projeto `galaxie-sports-obs` (`compose.obs.yml`): `prometheus`, `grafana`, `node-exporter` (já no compose; nada a instalar fora) | idem |
| Rede e volumes | `galaxie-sports_default` (172.30.50.0/24, gateway 172.30.50.1 = `TRUST_PROXY`); volumes `galaxie-sports_{pgdata,valkeydata,s3data,backups,promdata,grafanadata}`, externos aos três projetos | [bootstrap-vps.md §7](bootstrap-vps.md) |
| Carga histórica/renovação | `galaxie-carga.service` (systemd) e o arquivo `/root/carga-pausa`; **fora do repositório**: copiar a unit de `/etc/systemd/system/` e o script que ela chama | memória da operação |
| Deploy | GitHub Actions ([deploy.yml](../../.github/workflows/deploy.yml), [dados-backup.yml](../../.github/workflows/dados-backup.yml), [diagnostico.yml](../../.github/workflows/diagnostico.yml)) por SSH, ambiente `producao` | [deploy pelo GitHub](deploy-pelo-github.md) |
| Backup | `backup` faz o dump diário (`BACKUP_TIME`, 03:30 UTC) no volume `backups`; o NAS puxa pela stack `galaxie-sports-backup-nas` (Portainer) e toca o recibo `.nas_last_pull` | [exercício de DR](exercicio-dr.md) |
| SSH (`/root/.ssh/authorized_keys`) | máquina de dev; `gha-deploy-galaxie-sports` (`restrict`); `galaxie-nas-pull` (`rrsync -ro` no volume `backups`); `galaxie-nas-receipt` (`touch` do recibo); chave do diagnóstico (`restrict`, comando forçado `/docker/galaxie-sports/diagnostico.sh`) | [bootstrap-vps.md §2](bootstrap-vps.md) |
| Crons do host | poda de imagens e do builder (`/etc/cron.d`), coletor `infra/ops/vps-stats/collect.sh` em `/root/stats` | [bootstrap-vps.md §3](bootstrap-vps.md) |
| Outras stacks | `galaxie-remote` (sinalização em `/remote` e coturn: portas 3478 e 49160–49200/udp) e `openobserve-pwch`, no mesmo Traefik, **fora deste repositório** | [bootstrap-vps.md › Outras stacks](bootstrap-vps.md) |

Os hosts que o repositório documenta apontando para a VPS (os nomes de verdade estão no `.env`: `DEMO_DOMAIN`,
`API_DOMAIN`, `ASSETS_DOMAIN`):

| Host | Zona e DNS | O que é |
| --- | --- | --- |
| `DEMO_DOMAIN` (site, console, demo) | `galaxie.works`, DNS na Hostinger (hPanel), registro A direto | monitor "Site" da Better Stack |
| `API_DOMAIN` | `galaxie.works`, registro A direto | monitores `/health`, `/health/ready`, `/health/db` |
| `ASSETS_DOMAIN` | `galaxie.works`, registro A direto | bucket público de assets pelo Traefik |
| `api.galaxiesports.com` | `galaxiesports.com`, zona na Cloudflare (proxy ligado; Worker `api-edge-cache` em `/v1/*`) | API pelo domínio novo (#635, #1257) |
| `platform.galaxiesports.com` | `galaxiesports.com`, Cloudflare (`vars.DEMO_DOMAIN` do deploy.yml) | plataforma pelo domínio novo |
| `status.galaxie.works` | CNAME para a Better Stack | **não muda** |
| hosts de `galaxie-remote` e `openobserve-pwch` | conferir a zona inteira | decisão à parte (abaixo) |

Nenhuma URL muda nesta migração: só o IP por trás de cada nome. As rotas de futebol seguem congeladas pela revisão do
YouTube, e o corte de domínio (#635) é outro trabalho.

## O que o Wagner faz

1. **Conta e VM.** Conta da Galaxie Works LLC na Oracle Cloud (cartão, verificação, aceite de termos: só pessoa).
   Compartimento `producao`; VCN com uma sub-rede pública; VM `VM.Standard.E5.Flex` com 2 OCPU e 16 GB (baseline 100%,
   sem burst), imagem Ubuntu 24.04, boot volume de 200 GB; **IP público reservado** (o efêmero muda ao parar a VM, e a
   DNS, o `known_hosts` do Actions e o do NAS apontam para ele).
2. **Chave de acesso inicial.** Na criação da VM, a chave pública da operação (a mesma da máquina de dev) como chave do
   usuário `ubuntu`. Nada de senha.
3. **Security List** da sub-rede (regras de entrada): 22/tcp; 80 e 443/tcp (de todos no início; só das faixas da
   Cloudflare quando todos os hosts estiverem atrás do proxy, ver "Firewall"); 3478/tcp+udp e 49160–49200/udp **só se**
   o `galaxie-remote` for junto.
4. **Decisões que só ele toma** (cada uma com a recomendação da operação):
   - **Outras stacks da VPS** (`galaxie-remote`, `openobserve-pwch`): vão junto, ficam na VPS antiga até o fim, ou
     são desligadas? Recomendação: ficam na VPS antiga durante os 14 dias e têm plano próprio; o Traefik novo sobe só
     com a stack deste repositório.
   - **Usuário de deploy**: manter `root` por chave (`PermitRootLogin prohibit-password`), como hoje, para nenhum script,
     `authorized_keys` ou caminho (`/root/carga-pausa`, `/root/stats`) mudar; ou um usuário `deploy` no grupo `docker`,
     com os caminhos ajustados num PR à parte. Recomendação: `root` por chave agora, usuário próprio depois da migração.
   - **Cloudflare na frente de tudo**: hoje só `galaxiesports.com` passa pela Cloudflare; os hosts de `galaxie.works`
     apontam direto para a VPS. Fechar 80/443 às faixas da Cloudflare exige mover esses hosts para o proxy (zona de
     `galaxie.works` na Cloudflare ou a troca de domínio do #635). Recomendação: migrar com 80/443 abertos como hoje e
     fechar quando o #635 andar.
5. **Aprovar a janela do corte** e, 14 dias depois, com os critérios de encerramento cumpridos, **cancelar a VPS
   antiga** na Hostinger.

## O que a operação faz

Tudo o que segue. Quem executa é a sessão de operação, com o Agente Master avisado para não publicar nada da fila
durante as fases 2 a 4.

### Variáveis, secrets e chaves que mudam

| Onde | O quê | Quando |
| --- | --- | --- |
| Actions, ambiente `producao` | `vars.VPS_SSH_TARGET` = `usuario@host` novo (obrigatória: sem ela o deploy, o dados-backup e o diagnóstico falham no passo "Alvo SSH da produção") | fase 4 |
| Actions, ambiente `producao` | `secrets.VPS_KNOWN_HOSTS` = chave de host da máquina nova (como gerar: abaixo) | fase 4 |
| Actions, ambiente `producao` | `secrets.VPS_SSH_KEY` e `secrets.VPS_DIAG_SSH_KEY`: **não precisam mudar** se as chaves públicas correspondentes forem copiadas para o `authorized_keys` novo (com as mesmas restrições). Trocar só se o Wagner quiser rotacionar | fase 1 (pública) |
| Actions, variável | `DEPLOY_AUTO`: apagada antes, `on` no fim | fases 1 e 4 |
| NAS (Portainer, stack `galaxie-sports-backup-nas`) | `VPS_HOST` (e `VPS_PORT`, se a porta não for 22) e `NAS_BACKUP_PATH/ssh/known_hosts` | fase 4 |
| Máquina nova, `/root/.ssh/authorized_keys` | as cinco linhas de hoje (dev, deploy, pull, recibo, diagnóstico), copiadas com `restrict` e os `command=` iguais | fase 1 |
| Máquina nova, `.env` | o mesmo `.env` da VPS; nada muda nele pela migração (`TRUST_PROXY`, domínios, `CLOUDFLARE_*`, `BACKUP_*` seguem iguais) | fase 1 |
| Cloudflare e hPanel | IP dos registros A da tabela acima | fase 3 |

**`known_hosts` novo**, da máquina de dev, conferindo a impressão digital pelo console da Oracle (ou numa sessão SSH
já aberta) antes de gravar:

```bash
ssh-keyscan -t ed25519 <ip-novo> 2>/dev/null > /tmp/vps_known_hosts      # se VPS_SSH_TARGET usar um nome, inclua-o também
ssh-keygen -lf /tmp/vps_known_hosts
ssh ubuntu@<ip-novo> 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'   # o mesmo SHA256:…
gh secret set VPS_KNOWN_HOSTS --env producao < /tmp/vps_known_hosts
gh variable set VPS_SSH_TARGET --env producao --body 'root@<ip-novo>'
```

O arquivo pode trazer a linha da VPS antiga junto durante a volta atrás; depois do encerramento, só a nova.

## Fase 1: preparar a máquina (D-3)

Siga [bootstrap-vps.md](bootstrap-vps.md) (SSH, Docker, firewall, Traefik, stack), com estas diferenças:

1. **Sistema.** `timedatectl set-timezone Etc/UTC` (os crons e o dia da cota são em UTC), `unattended-upgrades`
   ligado. `root` por chave: copiar o `authorized_keys` da VPS para `/root/.ssh/`, com as cinco linhas e as restrições
   de hoje (o caminho do `rrsync` e do recibo é o do volume `backups`, que é o mesmo), e
   `printf 'PermitRootLogin prohibit-password\nPasswordAuthentication no\n' > /etc/ssh/sshd_config.d/00-galaxie.conf`,
   num arquivo lido **antes** do `50-cloud-init.conf`; `sshd -t && systemctl reload ssh`; conferir com
   `sshd -T | grep -E 'permitrootlogin|passwordauthentication'`. O pacote `rsync` traz o `rrsync`.
2. **Firewall em duas camadas.** A Security List da VCN (Wagner) e o `ufw` na VM (regras do §4 do bootstrap, sem as de
   TURN se o `galaxie-remote` não vier). As imagens Ubuntu da Oracle trazem regras `iptables` próprias além da Security
   List: confira `iptables -S INPUT` depois do `ufw enable` e tire o que rejeitar 80 e 443. Deixe pronta, sem aplicar, a
   regra que fecha 80/443 às faixas da Cloudflare (`https://www.cloudflare.com/ips-v4` e `ips-v6`), para quando todos
   os hosts estiverem atrás do proxy. O 22 fica aberto só com chave (a faixa dos runners do GitHub é larga demais para
   listar; o NAS sai por IP dinâmico).
3. **Docker.** Engine e plugin compose do repositório da Docker, `daemon.json`, crons de poda (§3 do bootstrap). Rede e
   volumes externos: `docker network create --subnet 172.30.50.0/24 --gateway 172.30.50.1 galaxie-sports_default` e os
   seis volumes. `docker login ghcr.io` **temporário** (token pessoal só de `read:packages`, num `DOCKER_CONFIG` que
   sai no fim, como no §7 do bootstrap): a máquina não guarda credencial do GitHub.
4. **Arquivos da VPS para a máquina nova** (`scp` entre as duas, pela máquina de dev ou direto):
   - `/docker/galaxie-sports/{.env,compose.yml,compose.dados.yml,compose.obs.yml,diagnostico.sh}` (`.env` com `chmod 600`;
     os compose são os do SHA no ar, `DEPLOY_SHA` do `.env`);
   - `/docker/traefik/{docker-compose.yml,.env}` e o conteúdo do volume `traefik_traefik-letsencrypt` (`acme.json`,
     `chmod 600`): com ele, os certificados valem no primeiro segundo depois da troca de DNS, e a renovação por HTTP-01
     passa a acontecer na máquina nova quando a DNS apontar para lá. Sem copiá-lo, cada host pede certificado novo no
     corte (limite de 5 por semana por conjunto de domínios);
   - **Certificado de origem da Cloudflare:** opcional e só para os hosts que passam pelo proxy. O Traefik deste
     repositório usa Let's Encrypt, que funciona com o modo "Full" da Cloudflare; "Full (strict)" com certificado de
     origem exige um provedor de arquivo no Traefik (mudança em `infra/traefik`, fora deste PR). Se o Wagner quiser,
     guardar o par no cofre e abrir a issue;
   - `/etc/systemd/system/galaxie-carga.service` e o script dela, **desligada** (`systemctl disable --now`);
   - `/etc/cron.d/*` da poda e do coletor de stats; `infra/ops/vps-stats/collect.sh`.
5. **Subir sem os serviços que escrevem.** Traefik primeiro (`docker compose up -d` em `/docker/traefik`). Depois, em
   `/docker/galaxie-sports`: `docker compose -f compose.dados.yml config -q`, `docker compose config -q`,
   `docker compose -f compose.obs.yml config -q`; `docker compose pull` (apps) e `docker compose -f compose.dados.yml pull`.
   **Não suba o `postgres` ainda** (o volume `pgdata` fica vazio para a réplica). Suba `valkey`, `s3` e `s3-init`
   (criam os buckets e as políticas) e `prometheus`, `grafana`, `node-exporter`. Nada de `api`, `ingestor`, `live`,
   `worker`, `agents` nem `webhooks` até o corte: o `.env` tem a chave da api-sports e as de IA, e um ingestor a mais
   gastaria cota e escreveria num banco que ainda não é o de produção.

## Fase 2: réplica física do Postgres (D-2 a D0)

Um `pg_dump` seguido de `pg_restore` com a CPU da origem limitada levaria horas de janela. O caminho é a **replicação
física em streaming**, do contêiner `postgres:17-alpine` da VPS para um contêiner da mesma imagem na máquina nova (a
versão major tem de ser a mesma: `postgres --version` nos dois lados antes de começar; a imagem é fixa no
`compose.dados.yml`, então basta não trocá-la no meio).

### Na VPS (origem)

```bash
cd /docker/galaxie-sports
P="docker compose -f compose.dados.yml exec -T postgres"
$P psql -U "$POSTGRES_USER" -d postgres -Atc "show wal_level; show max_wal_senders; show max_replication_slots"
# esperado: replica (padrão do 17), 10, 10. Se wal_level for minimal, acrescentar -c wal_level=replica ao command do
# compose.dados.yml e recriar o postgres numa janela (é a única mudança que reinicia o banco)
$P psql -U "$POSTGRES_USER" -d postgres -c "create role replicador with replication login password '<senha do cofre>'"
$P psql -U "$POSTGRES_USER" -d postgres -c "select pg_create_physical_replication_slot('maquina_nova')"
```

`pg_hba.conf` fica no volume `pgdata`. A imagem oficial só aceita `replication` de `127.0.0.1`; a conexão da réplica
chega pelo túnel SSH, ou seja, do gateway da rede da stack (`172.30.50.1`, o host). Acrescentar **uma** linha, para esse
IP e esse papel, e recarregar:

```bash
$P sh -c 'echo "host replication replicador 172.30.50.1/32 scram-sha-256" >> /var/lib/postgresql/data/pg_hba.conf'
$P psql -U "$POSTGRES_USER" -d postgres -c "select pg_reload_conf()"
```

O Postgres **nunca** é exposto na internet: a réplica entra por um túnel SSH (a chave da máquina nova vai para o
`authorized_keys` da VPS, numa linha própria, que sai no encerramento). WireGuard entre as duas também serve; o túnel
SSH é o que não exige instalar nada.

### Na máquina nova (réplica)

O túnel tem de ser alcançável de dentro do contêiner `postgres` novo, então ele escuta no gateway da rede da stack
(`172.30.50.1`), não em `127.0.0.1`. Fica de pé num `tmux`/`systemd-run` até o corte:

```bash
PG_IP=$(ssh root@<vps-antiga> "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \$(cd /docker/galaxie-sports && docker compose -f compose.dados.yml ps -q postgres)")
ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -L 172.30.50.1:15432:$PG_IP:5432 root@<vps-antiga> &
ufw allow from 172.30.50.0/24 to any port 15432 proto tcp comment 'tunel replica (temporario)'
```

Cópia base direto no volume `pgdata` (vazio), com a mesma imagem, em horário de baixa e **conferindo o `st` do
`vmstat 5` na VPS antes**: a CPU da origem é o gargalo. `--max-rate` segura a origem; sem ele, 30 GB a 200 Mbps levam
~20 min; com a origem limitada, conte algumas horas. `-R` grava `standby.signal` e o `primary_conninfo` (com a senha)
em `postgresql.auto.conf`, dentro do volume:

```bash
cd /docker/galaxie-sports
docker run --rm --network host -v galaxie-sports_pgdata:/var/lib/postgresql/data \
  -e PGPASSWORD='<senha do replicador>' postgres:17-alpine \
  pg_basebackup -h 172.30.50.1 -p 15432 -U replicador -D /var/lib/postgresql/data \
  -X stream -R -P -c fast -S maquina_nova --max-rate=40M
docker compose -f compose.dados.yml up -d postgres          # sobe como standby e começa a acompanhar
docker compose -f compose.dados.yml logs -f postgres         # "started streaming WAL from primary"
```

### Acompanhar até o corte

Na VPS, uma linha com `state = streaming` e atraso perto de zero; na máquina nova, `pg_is_in_recovery()` verdadeiro e o
replay andando:

```bash
# VPS
$P psql -U "$POSTGRES_USER" -d postgres -Atc "select client_addr, state, sent_lsn, replay_lsn, replay_lag from pg_stat_replication"
# máquina nova
docker compose -f compose.dados.yml exec -T postgres psql -U "$POSTGRES_USER" -d postgres -Atc \
  "select pg_is_in_recovery(), pg_last_wal_replay_lsn(), now() - pg_last_xact_replay_timestamp()"
```

Deixar a réplica acompanhando até o dia do corte: a janela fica curta porque só falta o que foi escrito nos últimos
segundos. O slot `maquina_nova` segura WAL na origem enquanto a réplica estiver fora; se a cópia for abandonada, apague
o slot (`select pg_drop_replication_slot('maquina_nova')`), senão o disco da VPS enche.

### RustFS, Valkey, Prometheus e Grafana

- **RustFS** (bucket público `S3_BUCKET` e o privado `S3_TASKS_BUCKET`): o `s3-init` novo já criou os buckets e as
  políticas. Copiar os objetos com `rclone sync` (ou `mc mirror`) da máquina nova, com um segundo túnel para o RustFS
  da VPS (`-L 127.0.0.1:19000:<ip do s3 na VPS>:9000`) e as credenciais do próprio `.env` (as mesmas nos dois lados,
  só no ambiente do processo, nunca em arquivo de configuração):

  ```bash
  set -a; . ./.env; set +a
  S3_NEW=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(docker compose -f compose.dados.yml ps -q s3)")
  for b in "$S3_BUCKET" "$S3_TASKS_BUCKET"; do
    docker run --rm --network host \
      -e RCLONE_CONFIG_SRC_TYPE=s3 -e RCLONE_CONFIG_SRC_PROVIDER=Other -e RCLONE_CONFIG_SRC_ENDPOINT=http://127.0.0.1:19000 \
      -e RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$S3_ACCESS_KEY" -e RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
      -e RCLONE_CONFIG_DST_TYPE=s3 -e RCLONE_CONFIG_DST_PROVIDER=Other -e RCLONE_CONFIG_DST_ENDPOINT="http://$S3_NEW:9000" \
      -e RCLONE_CONFIG_DST_ACCESS_KEY_ID="$S3_ACCESS_KEY" -e RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
      rclone/rclone sync "src:$b" "dst:$b" --checksum --transfers 8 --stats 1m
  done
  ```

  Uma vez agora (a maior parte: escudos, bandeiras, fotos) e outra no corte, só com a diferença. Nada é apagado na origem.
- **Valkey**: é cache, limite por minuto e pub/sub. Sobe **vazio** no corte (volume `valkeydata` novo); o cache se
  refaz e os limites recomeçam. Antes do corte, confirmar com o dono do código que nenhuma fila que não pode se perder
  vive no Valkey (as tarefas ficam no Postgres, no `worker`); se houver, `REPLICAOF` temporário pelo mesmo túnel.
- **Prometheus e Grafana**: recomeçar do zero é o mais simples (painéis e alertas vêm da imagem; o `grafanadata` só guarda
  estado). Para manter os 35 dias de histórico dos SLOs, copiar o volume `promdata` no corte com o Prometheus antigo
  parado (`docker run --rm -v galaxie-sports_promdata:/v alpine tar c -C /v . | ssh root@<ip-novo> 'docker run --rm -i -v galaxie-sports_promdata:/v alpine tar x -C /v'`).

## Fase 3: o corte (janela de ~10 a 15 min sem escrita)

Pré-condições, no dia: `DEPLOY_AUTO` apagada e nenhum deploy rodando (`gh run list --workflow deploy.yml --limit 3`;
`.deploy.lock` ausente na VPS); fila de merge parada; réplica com `replay_lag` perto de zero; `rclone sync` da véspera
feito; um dump recente no NAS (`docker compose -f compose.dados.yml exec -T backup backup.sh` na VPS e um ciclo do
`nas-pull`, `last_run.txt` com "ok"); ninguém usando o painel (Ajustes) durante a janela.

Cada passo diz onde roda. `V` = VPS antiga, `N` = máquina nova.

1. **[V] Pausar a carga:** `touch /root/carga-pausa`; `journalctl -u galaxie-carga -f` até "pausada".
2. **[V] Parar quem escreve** (API, site e console seguem só lendo):
   `docker compose stop live ingestor worker agents webhooks && docker compose -f compose.dados.yml stop backup`.
3. **[V] Nenhuma sessão escrevendo e atraso zero:**

   ```bash
   $P psql -U "$POSTGRES_USER" -d postgres -Atc "select count(*) from pg_stat_activity where backend_type='client backend' and state='active' and query !~* '^select'"
   $P psql -U "$POSTGRES_USER" -d postgres -Atc "select pg_current_wal_lsn(), replay_lsn, replay_lag from pg_stat_replication"
   ```

   `pg_current_wal_lsn()` igual ao `replay_lsn` da réplica. Se não igualar em um minuto, pare também `api site console`
   na VPS e repita.
4. **[N] `rclone sync` final** dos dois buckets (o comando da fase 2; só a diferença).
5. **[V] Página de manutenção na VPS antiga**, para a origem antiga nunca mais receber escrita e quem ainda resolver o
   IP antigo ver o aviso: `bash -s -- up < infra/vps-telemetry/maintenance.sh` (da máquina de dev, por `ssh`). Em
   seguida `docker compose stop api site console`.
6. **[N] Promover a réplica:**

   ```bash
   docker compose -f compose.dados.yml exec -T postgres psql -U "$POSTGRES_USER" -d postgres -Atc "select pg_promote()"
   docker compose -f compose.dados.yml exec -T postgres psql -U "$POSTGRES_USER" -d postgres -Atc "select pg_is_in_recovery()"   # f
   docker compose -f compose.dados.yml exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "alter system reset primary_conninfo" -c "alter system reset primary_slot_name" -c "select pg_reload_conf()"
   ```

   Anote o horário: é o ponto a partir do qual a VPS antiga está defasada.
7. **[N] Subir tudo:** `docker compose -f compose.dados.yml up -d` (backup incluído: com `BACKUP_ON_START=true`, ele
   faz um dump se o último tiver mais de 20 h) e `docker compose up -d` (o `migrate` roda e não acha migration nova;
   `live`, `ingestor`, `worker`, `agents`, `webhooks`, `api`, `site`, `console` sobem). `docker compose ps`: `migrate`
   e `s3-init` em `Exited (0)`, o resto `Up`/`healthy`.
8. **[N] Conferir antes da DNS**, pela própria máquina (o Traefik responde pelo nome com o certificado copiado):

   ```bash
   set -a; . ./.env; set +a
   curl -sS --resolve "$API_DOMAIN:443:<ip-novo>" "https://$API_DOMAIN/health/db"      # {"status":"ok"...}
   curl -sS --resolve "$API_DOMAIN:443:<ip-novo>" "https://$API_DOMAIN/version"        # image_hash = TAG_API do .env
   docker compose exec -T site node - < infra/vps-telemetry/smoke.mjs                   # da máquina de dev, por ssh
   bash infra/ops/conferir-pos-corte.sh --resolve <ip-novo>                             # abaixo
   ```

9. **Trocar a DNS**, ao mesmo tempo:
   - Cloudflare, zona `galaxiesports.com`: o IP dos registros A com proxy (`api`, `platform` e qualquer outro que
     aponte para a VPS; conferir a zona inteira). Com o proxy ligado, vale em segundos, sem TTL.
   - Hostinger, hPanel › Domínios › `galaxie.works` › DNS: os registros A de `DEMO_DOMAIN`, `API_DOMAIN` e `ASSETS_DOMAIN`
     (TTL baixado para 300 na véspera). `status` (CNAME) não muda. A operação tem autorização para editar esses registros;
     guardar o valor anterior de cada um na issue da migração.
   - Esperar `dig +short $API_DOMAIN @1.1.1.1` devolver o IP novo e os monitores da Better Stack voltarem ao verde.
10. **[N] Religar a carga quando a máquina estiver calma** (dia seguinte): `systemctl enable --now galaxie-carga` e
    `rm /root/carga-pausa`. Com 4 vCPU dedicados, as `cpus:` dos contêineres de processamento no `compose.yml` (0,4 +
    0,2 + 0,4) e o `mem_limit` do `postgres` (2,5 GB em 8) ficam apertados para a máquina: medir uma semana com o
    `vps-stats` e ajustar em PR próprio, não durante a migração.
11. **Um jogo ao vivo de verdade:** no primeiro jogo depois do corte, acompanhar `galaxie_live_events` e
    `galaxie_live_event_max_staleness_seconds` no Grafana e a consulta dos jogos em andamento do `diagnostico.sh`. Sem
    `LiveEventStale`, o corte está feito.

## Fase 4: SSH do Actions e do NAS

1. **Actions** (ambiente `producao`): `VPS_SSH_TARGET` e `VPS_KNOWN_HOSTS` como em "Variáveis, secrets e chaves"
   acima. Depois um deploy de teste do SHA que já está no ar, que exercita pull, trava, troca, smoke e notas:

   ```bash
   gh workflow run deploy.yml -f force=1
   gh run watch                                        # "PASS … no ar", smoke "N ok · 0 falha(s)"
   gh workflow run diagnostico.yml -f alerta="BackupStale"   # só leitura: prova a chave do diagnóstico e o known_hosts
   gh variable set DEPLOY_AUTO --body on
   ```

   Avise o Agente Master: a fila volta a andar.
2. **NAS**, só pela API ou pela interface do Portainer (nunca SSH com Docker no NAS):
   - em `NAS_BACKUP_PATH/ssh/known_hosts`, substituir a linha da VPS pela da máquina nova (o mesmo `ssh-keyscan`
     conferido acima; `StrictHostKeyChecking=yes` recusa host desconhecido);
   - na stack `galaxie-sports-backup-nas`, editar as variáveis de ambiente: `VPS_HOST` = IP (ou nome) novo; `VPS_PORT`
     só se a porta não for 22 (`VPS_USER` segue `root`); "Update the stack" com re-pull desligado;
   - o contêiner reinicia e, com `NAS_PULL_ON_START=true`, roda um ciclo na hora: `last_run.txt` termina em "ok" e, na
     máquina nova, `ls -la --time-style=full-iso /var/lib/docker/volumes/galaxie-sports_backups/_data/.nas_last_pull` tem
     a data de agora. Falhou em "listar os dumps": `known_hosts` ou `authorized_keys` (a linha `galaxie-nas-pull` com o
     `rrsync -ro` no caminho do volume).
3. **Backup e alertas.** `BackupStale` lê `ops.job_run` (replicado com o banco) e não dispara por causa da migração;
   `BackupCheckFailed` dispara se o recibo do NAS passar de 26 h, por isso o ciclo do item 2 é no mesmo dia. Conferir no
   dia seguinte: dump das 03:30 UTC em `/backups/` da máquina nova, `backup-check.sh` sem falha
   (`docker compose -f compose.dados.yml logs backup | tail`), recibo tocado, e um `restore.sh --verify latest` a partir
   da máquina nova (`docker compose -f compose.dados.yml exec -T backup restore.sh --verify latest`).

## Conferência depois do corte

[`infra/ops/conferir-pos-corte.sh`](../../infra/ops/conferir-pos-corte.sh), só leitura e idempotente, roda na máquina
nova em `/docker/galaxie-sports` (ou por `ssh "$VPS" 'cd /docker/galaxie-sports && bash -s' < infra/ops/conferir-pos-corte.sh`)
e lê o que precisa do `.env` da pasta (`API_DOMAIN`, `TAG_API`) ou dos argumentos; nenhuma credencial no script:

| Checagem | PASS | FAIL |
| --- | --- | --- |
| `GET /health/db` | 200 | outro status ou sem resposta |
| `GET /version` | `image_hash` igual a `TAG_API` do `.env` (WARN se diferente) | sem `image_hash` |
| Postgres | `pg_is_in_recovery()` falso (promovido) e `pg_stat_replication` vazio (WARN com linhas: só a réplica reversa da volta atrás deve aparecer) | ainda em recovery |
| Ao vivo | jogo em andamento atualizado nos últimos `--live-min` (10) min; SKIP sem jogo em andamento | jogo em andamento parado |
| Último dump | arquivo em `/backups/` com até `--dump-max-h` (26) h, tamanho > 0 e `.sha256` ao lado | sem dump ou velho |
| Recibo do NAS | `.nas_last_pull` com até `--receipt-max-h` (26) h | ausente ou velho (até o primeiro `nas-pull` contra a máquina nova) |

Sai com 1 se houver FAIL. Repetir no dia seguinte ao corte e no fechamento dos 14 dias.

## Volta atrás, por fase

| Até onde chegou | O que mudou | Como voltar |
| --- | --- | --- |
| Fase 1 e 2 (réplica acompanhando) | Nada na VPS além do papel `replicador`, da linha no `pg_hba.conf`, do slot e da chave da máquina nova no `authorized_keys` | Nada a desfazer para a produção. Para abandonar: parar o `postgres` novo, `pg_drop_replication_slot('maquina_nova')` na VPS |
| Corte, passos 1 a 5 (antes de promover) | Carga pausada e escritores parados na VPS; a DNS ainda aponta para lá | `[V] docker compose start live ingestor worker agents webhooks api site console`, `docker compose -f compose.dados.yml start backup`, `maintenance.sh down`, `rm /root/carga-pausa`. Minutos |
| Corte, passos 6 a 8 (promovida, DNS ainda antiga) | A réplica é primária e os serviços novos já escrevem nela; a VPS está em manutenção e intacta no ponto do passo 6 | `[N] docker compose stop` (apps) e `-f compose.dados.yml stop`; na VPS, a linha acima. O que o ingestor novo gravou nesses minutos se perde e volta na sincronização seguinte (é dado do fornecedor); por isso ninguém usa o painel na janela. A réplica nova fica inválida: refazer o `pg_basebackup` para tentar de novo |
| Depois da DNS, até 48 h | Tudo na máquina nova; Actions e NAS apontando para ela | **Logo após o corte, montar a réplica reversa:** a VPS vira standby da máquina nova (mesmo roteiro da fase 2 ao contrário: papel e `pg_hba` na nova, túnel da VPS para a nova, `pg_basebackup` por cima do `pgdata` antigo, depois de um dump dele). Volta: parar os escritores na nova, atraso zero, `pg_promote()` na VPS, DNS de volta (valores guardados na issue), `VPS_SSH_TARGET`/`VPS_KNOWN_HOSTS` e `VPS_HOST`/`known_hosts` do NAS de volta. Sem a réplica reversa, a volta é restaurar o último dump na VPS (`restore.sh --yes`), com perda de até 24 h: só em desastre |
| Depois de 48 h estáveis | — | Não se volta: a máquina nova é a produção. Problema novo é incidente normal ([on-call](on-call.md)) |

## Encerramento (D+14)

Critérios, todos cumpridos, antes de o Wagner cancelar a VPS antiga:

- 14 dias sem incidente ligado à máquina; `st` do `vmstat` em zero e nenhum alerta de CPU; um jogo de prioridade alta
  acompanhado sem `LiveEventStale`.
- Dois ciclos semanais do NAS conferidos (`weekly/` com dump novo, `last_run.txt` em "ok") e um
  `restore.sh --verify latest` feito a partir da máquina nova, registrado em [exercicio-dr.md](exercicio-dr.md).
- Deploy automático rodando pelo Actions há pelo menos uma semana (`gh run list --workflow deploy.yml`).

Então:

1. Desfazer a réplica reversa (se montada): `pg_drop_replication_slot` na nova, parar o `postgres` da VPS.
2. Tirar da máquina nova a linha temporária da VPS no `authorized_keys` e a regra `ufw` do túnel; tirar da VPS a chave
   da máquina nova; `VPS_KNOWN_HOSTS` só com a linha nova.
3. Na VPS antiga, apagar o `.env` e os volumes antes de cancelar (`docker compose down` nos três projetos, `docker
   volume rm` dos seis volumes e do Traefik): o disco da Hostinger deixa de existir com a conta, mas o `.env` tem todos os
   segredos. Trocar `POSTGRES_PASSWORD`, `S3_SECRET_KEY` e `BETTER_AUTH_SECRET`? Só se houver suspeita de cópia; a troca
   tem runbook próprio ([migração de chaves](migracao-de-chaves.md)).
4. Wagner cancela a VPS no hPanel. Registrar a data e o tempo total do corte na issue da migração e no
   [registro dos exercícios](exercicio-dr.md#registro-dos-exercícios).
5. Atualizar este runbook com o que divergiu do plano, e [bootstrap-vps.md](bootstrap-vps.md) com o que a Oracle fez
   diferente (iptables da imagem, usuário inicial, Security List).

## Dúvidas que só a máquina real responde

- O `wal_level` e o `max_wal_senders` efetivos do contêiner de produção (padrões do 17 servem; conferir antes de criar o
  slot).
- O IP de onde a conexão do túnel chega ao Postgres (esperado `172.30.50.1`; `select client_addr from pg_stat_activity`
  numa conexão de teste decide a linha do `pg_hba.conf`).
- Se as regras `iptables` da imagem Ubuntu da Oracle bloqueiam 80/443 depois do `ufw enable`.
- O que o Valkey guarda que não pode se perder no corte (hoje: cache, limites e pub/sub).
- O volume real de saída por mês (Cloudflare mais a cópia do NAS), para conferir a franquia do provedor.
- Se `galaxie-remote` e `openobserve-pwch` vão junto (decisão do Wagner): mudam as portas do firewall e o Traefik.
