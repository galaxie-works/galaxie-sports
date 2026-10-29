# Recriar a VPS de produção do zero

Para o caso "VPS perdida" sem o snapshot do provedor ([exercicio-dr.md › Cenários](exercicio-dr.md)), ou para mudar
de VPS. O estado de 29/10/2026 foi lido por SSH (só leitura) e está descrito aqui; o que é segredo fica no cofre de
senhas do Wagner, nunca neste repositório. Meta: a API de volta em até 2 h.

## O que precisa estar à mão antes

| Item | Onde está |
|---|---|
| `.env` da stack (`/docker/galaxie-sports/.env`): senhas do Postgres e do S3, `BETTER_AUTH_SECRET`, `METRICS_TOKEN`, `STREAM_TOKEN_SECRET`, `APISPORTS_KEY`, chaves de IA, SMTP, `GALAXIE_DEMO_KEY`, `DB_URL_*` | cofre de senhas (o modelo é [`infra/vps-telemetry/env.example`](../../infra/vps-telemetry/env.example)) |
| `ACME_EMAIL` do Traefik | cofre de senhas ([`infra/traefik/env.example`](../../infra/traefik/env.example)) |
| Dump mais recente do Postgres (`.dump.age` + `.sha256`) e a chave privada de recuperação do age | NAS (`/volume1/Docker/galaxie-sports-backups`) e cofre ([exercicio-dr.md › Dumps cifrados](exercicio-dr.md)) |
| Acesso ao DNS (registros A dos três domínios) | painel da Hostinger |
| Admin do repositório no GitHub (secrets do ambiente `producao`) | conta do Wagner |
| Chaves públicas SSH: máquina de dev, deploy do Actions, NAS (pull e recibo) | `~/.ssh` da máquina de dev, secret `VPS_SSH_KEY` (a pública correspondente), NAS (`/volume1/Docker/galaxie-sports-backups/ssh`) |

## 1. Máquina

- Ubuntu 24.04 LTS, 2 vCPU, 8 GB de RAM, 100 GB de disco (a de 29/10 usa 43 GB; sem swap).
- Fuso `Etc/UTC` e NTP ligado (`timedatectl`): os crons do scheduler e o dia da cota são em UTC.
- `unattended-upgrades` ligado (padrão da imagem).

## 2. SSH

`/root/.ssh/authorized_keys` com quatro chaves, nesta forma:

```text
ssh-ed25519 AAAA… <máquina de dev>
restrict ssh-ed25519 AAAA… gha-deploy-galaxie-sports
command="/usr/bin/rrsync -ro /var/lib/docker/volumes/galaxie-sports_backups/_data",restrict ssh-ed25519 AAAA… galaxie-nas-pull
command="touch /var/lib/docker/volumes/galaxie-sports_backups/_data/.nas_last_pull",restrict ssh-ed25519 AAAA… galaxie-nas-receipt
```

As duas do NAS estão descritas em [exercicio-dr.md › Cópia no NAS](exercicio-dr.md) (o `rrsync` vem do pacote
`rsync`). Login só por chave: `PasswordAuthentication no` num arquivo de `/etc/ssh/sshd_config.d/` que seja lido
**antes** do `50-cloud-init.conf` (o sshd fica com o primeiro valor que lê; ex.: `00-galaxie.conf`), e confira com
`sshd -T | grep passwordauthentication`.

> Em 29/10/2026 a VPS atual responde `passwordauthentication yes` (o `50-cloud-init.conf` ganha do `60-…` que dizia
> `no`). Corrigir lá também, com o OK do Wagner e com uma segunda sessão SSH aberta durante a troca:
> `printf 'PasswordAuthentication no\n' > /etc/ssh/sshd_config.d/00-galaxie.conf && sshd -t && systemctl reload ssh`.

## 3. Docker

Docker Engine e o plugin compose do repositório oficial da Docker (em 29/10: `docker-ce 29.6.1`, compose `v5.3.0`).

`/etc/docker/daemon.json`:

```json
{"live-restore":true,"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"},"default-address-pools":[{"base":"172.17.0.0/12","size":24},{"base":"192.168.0.0/16","size":24}]}
```

Limpeza (crons em `/etc/cron.d`):

```text
# docker-image-prune: imagens sem contêiner com mais de 24 h, num horário sorteado entre 00:00 e 06:00 UTC
0 0 * * * root sleep $(shuf -i 0-21600 -n 1) && docker image prune -af --filter "until=24h" > /dev/null 2>&1
# docker-builder-prune
35 0 * * 5 root docker builder prune -f > /dev/null 2>&1
```

O prune diário também apaga as imagens da versão anterior algumas horas depois de um deploy (a volta para ela passa a
precisar do GHCR). Fora isso, nada de `docker system prune`, `volume prune` ou `network prune`
([README da stack › Regras da VPS](../../infra/vps-telemetry/README.md)).

## 4. Firewall

`ufw` ligado, só entrada (as regras de 29/10, IPv4 e IPv6):

```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'Traefik ACME'
ufw allow 443/tcp comment 'Traefik HTTPS WSS'
# da stack galaxie-remote (fora deste repositório): TURN/STUN
ufw allow 3478/tcp comment 'TURN TCP'
ufw allow 3478/udp comment 'STUN TURN UDP'
ufw allow 49160:49200/udp comment 'TURN relay'
ufw enable
```

O Docker não publica porta nenhuma da stack do Galaxie Sports (o Traefik está na rede do host e chega aos contêineres
pelo gateway da rede de cada stack), então o `ufw` não é contornado pelo Docker aqui.

## 5. DNS

Registros A de `DEMO_DOMAIN`, `API_DOMAIN` e `ASSETS_DOMAIN` para o IP novo, **antes** do Traefik: o desafio HTTP-01 do
Let's Encrypt precisa do domínio apontando para a VPS. Com TTL baixo (300) a troca leva minutos.

## 6. Traefik

```bash
mkdir -p /docker/traefik && cd /docker/traefik
# docker-compose.yml = infra/traefik/compose.yml do repositório; .env com ACME_EMAIL (chmod 600)
docker compose config -q && docker compose up -d
```

Detalhes, access log e compressão: [infra/traefik/README.md](../../infra/traefik/README.md). Os certificados saem na
primeira requisição de cada host.

## 7. Stack do Galaxie Sports

```bash
mkdir -p /docker/galaxie-sports && cd /docker/galaxie-sports
# compose.yml = infra/vps-telemetry/compose.yml do commit no ar (a tag deploy-* mais recente);
# .env do cofre (chmod 600), com IMAGE_TAG=<sha desse commit> e PULL_POLICY=missing
docker compose config -q
```

As imagens do GHCR são privadas. Login temporário com um token pessoal só de `read:packages`, num `DOCKER_CONFIG` que
sai no fim (a VPS não guarda credencial do GitHub):

```bash
export DOCKER_CONFIG=$(mktemp -d)
docker login ghcr.io -u <usuário> --password-stdin    # cola o token e Ctrl-D
docker compose pull
rm -rf "$DOCKER_CONFIG"; unset DOCKER_CONFIG
```

Banco antes da aplicação (o migrate roda no `up`; restaurar primeiro evita migrar um banco vazio à toa):

```bash
docker compose up -d postgres valkey s3 s3-init
# do NAS para a VPS: o .dump.age mais recente e o .sha256 dele (scp para /root/restore/)
set -a; . ./.env; set +a
# o restore.sh confere o .sha256 do .dump.age e decifra com a chave em BACKUP_AGE_IDENTITY (o conteúdo da chave de
# recuperação, do cofre; só nesta execução). Avulso e sem dependências: o serviço backup depende do migrate, e o
# papel do DB_URL_BACKUP ainda não existe; a restauração real roda com o dono do banco
docker compose run --rm --no-deps -v /root/restore:/restore:ro \
  -e BACKUP_AGE_IDENTITY="$(cat /root/restore/galaxie-backup-recuperacao.key)" \
  -e DB_URL_BACKUP="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@postgres:5432/$POSTGRES_DB" \
  backup sh -ec 'cp /restore/*.dump.age /restore/*.dump.age.sha256 /backups/ && restore.sh --yes "$(basename /restore/*.dump.age)"'
shred -u /root/restore/galaxie-backup-recuperacao.key
docker compose up -d
docker compose ps        # migrate e s3-init: Exited (0); o resto: Up/healthy
```

A chave de recuperação vai para `/root/restore/` só para esse comando e sai com o `shred`. O `restore.sh` restaura num
banco novo, confere e troca pelo nome; o banco vazio da subida fica como `<db>_pre_restore_<data>` (apague depois).
O `up -d` roda o migrate sobre o banco restaurado, que também recria os GRANTs dos papéis
([README da stack › Depois de restaurar um dump](../../infra/vps-telemetry/README.md)).

**Assets (S3)**: o volume `s3data` não tem backup próprio. Logos, bandeiras e fotos voltam pelo espelho
(`docker compose exec -T ingestor node dist/cli/mirror-assets.js --descobrir-raw --concorrencia 4`, sem cota da
api-sports); os logos enviados à mão em Ajustes → Grades e ofertas e os do acervo precisam ser enviados de novo.

**Página de manutenção, observabilidade e backup** sobem com o `up -d`. O primeiro backup sai na partida
(`BACKUP_ON_START`).

## 8. GitHub e NAS

- Ambiente `producao` do repositório: `VPS_KNOWN_HOSTS` com a chave de host nova (`ssh-keyscan -t ed25519 <ip>`,
  conferida com a impressão digital mostrada no console do provedor); `VPS_SSH_KEY` igual. IP novo: variável
  `VPS_SSH_TARGET` (`root@<ip>`).
- NAS: `ssh/known_hosts` com a chave de host nova e, com IP novo, `VPS_HOST` da stack `galaxie-sports-backup-nas`
  ([exercicio-dr.md › Cópia no NAS](exercicio-dr.md)).
- Monitor externo e alertas por push: nada muda se os domínios forem os mesmos.
- Rodar o workflow Deploy com `sha=<o mesmo SHA>` e `force=1` para conferir o caminho do Actions (smoke incluído).

## 9. Conferir

[README da stack › Verificação](../../infra/vps-telemetry/README.md) (de fora da VPS: certificado, `/metrics` e
`/internal` fechados, demo, assets) e o smoke do deploy. Registrar o tempo total no
[registro dos exercícios](exercicio-dr.md).

## Outras stacks da VPS

Em 29/10/2026 a VPS também roda `galaxie-remote` (sinalização em `/remote` e coturn) e `openobserve-pwch`, em
`/docker`, com routers próprios no mesmo Traefik. Elas não estão neste repositório e têm a recuperação delas.
