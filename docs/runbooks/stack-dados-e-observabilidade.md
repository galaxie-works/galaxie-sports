# Dados e observabilidade

A stack é três projetos do Compose na mesma rede ([transição](stack-em-tres-projetos.md)). O deploy automático só conhece o
`compose.yml` de apps. Este runbook é para os outros dois, sempre em `/docker/galaxie-sports`, que tem os três arquivos e
um `.env` só.

```bash
docker compose ls                                  # os três projetos
docker compose -f compose.dados.yml ps             # postgres, valkey, s3, s3-init, backup
docker compose -f compose.obs.yml ps               # prometheus, grafana, node-exporter
```

`docker compose` sem `-f` fala só com os apps: `docker compose exec postgres` não acha o serviço.

## Observabilidade

Mudou `infra/observability` ou o `compose.obs.yml`? O deploy automático não publica. Dispare à mão:

```bash
gh workflow run deploy.yml -f project=obs
gh workflow run deploy.yml -f project=obs -f sha=<sha> -f force=1   # um SHA específico
```

É o mesmo roteiro (`deploy-gh.sh --project obs`), com o plano e a volta por serviço, sem banco, candidato, pós-deploy, smoke e
notas de versão. Grava `TAG_PROMETHEUS` e `TAG_GRAFANA` e registra o SHA em `DEPLOY_SHA_OBS`. Enquanto ninguém dispara, os
dois seguem na versão que estão, inclusive com alertas novos fora do ar.

Só mudou um valor no `.env` (canais de alerta, por exemplo):

```bash
docker compose -f compose.obs.yml up -d --no-deps grafana
```

## Dados

Quando aplicar: mudança em `compose.dados.yml`, em `infra/backup` (imagem nova do `backup`) ou upgrade de imagem de
terceiros. **Nada disso sai sozinho num merge.** Quem mexe traz o arquivo da `main` e aplica um serviço por vez, sempre com a
validação antes:

```bash
scp infra/vps-telemetry/compose.dados.yml root@145.223.94.149:/docker/galaxie-sports/compose.dados.yml.new
```

Na VPS:

```bash
cd /docker/galaxie-sports
cp compose.dados.yml compose.dados.yml.bak-$(date +%F)
docker compose -f compose.dados.yml.new config -q && mv compose.dados.yml.new compose.dados.yml
docker compose -f compose.dados.yml up -d --no-deps --wait backup     # o que mudou; nunca sem nome de serviço
```

Imagem nova do `backup`: o workflow **Dados — imagem do backup** (`.github/workflows/dados-backup.yml`, só por disparo
manual: `gh workflow run dados-backup.yml -f sha=<commit>`; `sync=1`, o padrão, roda o `s3-sync.sh` em seguida) calcula a
tag com `infra/ops/image-hash.sh backup`, grava `TAG_BACKUP=in-<hash>` no `.env` (cópia em `.env.bak-dados-<data>`), baixa a
imagem com o token do próprio job (login temporário, como no deploy; a VPS não guarda credencial) e recria só o `backup`
(`--no-deps`). À mão: a mesma sequência com o login temporário de `docs/runbooks/bootstrap-vps.md`. O `deploy.yml` não
troca esta imagem: uma mudança em `infra/backup` só chega à VPS por aqui.

Risco por serviço:

| Serviço | Recriar causa |
| --- | --- |
| `backup` | Nada para o usuário |
| `s3` | Logos e fotos sem resposta por segundos |
| `valkey` | Cache e rate limit fora por segundos |
| `postgres` | API, demo e jobs falham até ele voltar. Faça um backup antes e veja a página de manutenção abaixo |

### Bucket privado das tarefas (#587)

O `s3-init` cria, além do bucket de assets, o privado das tarefas (`S3_TASKS_BUCKET`, padrão `galaxie-sports-tasks`):
sem política (sem leitura anônima), fora do Traefik. É idempotente: rodar de novo só reaplica as políticas, e o RustFS
não reinicia. Aplicar, uma vez, depois do merge (o deploy automático já leva `S3_TASKS_BUCKET` ao `ingestor` e ao
`worker`, com o padrão; o `.env` só precisa da linha se o nome for outro). Traga o arquivo da `main` com o `scp` do começo
desta seção e, na VPS:

```bash
cd /docker/galaxie-sports
cp compose.dados.yml compose.dados.yml.bak-$(date +%F)
docker compose -f compose.dados.yml.new config -q && mv compose.dados.yml.new compose.dados.yml
docker compose -f compose.dados.yml up -d s3-init                    # cria o bucket; sai sozinho
docker compose -f compose.dados.yml logs s3-init | tail -3           # "bucket galaxie-sports-tasks pronto (privado…)"
docker compose -f compose.dados.yml up -d --no-deps --wait backup    # o backup passa a ver S3_TASKS_BUCKET
```

Conferir (critério da issue): um objeto em `tasks/` do bucket privado não sai sem chave, e o de assets segue sem
listagem.

```bash
S3_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker compose -f compose.dados.yml ps -q s3))
docker compose -f compose.dados.yml exec -T backup sh -c 'echo ok | AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" aws --endpoint-url "$S3_ENDPOINT" s3 cp - "s3://$S3_TASKS_BUCKET/tasks/teste-587/ok.txt"'
curl -s -o /dev/null -w '%{http_code}\n' "http://$S3_IP:9000/galaxie-sports-tasks/tasks/teste-587/ok.txt"    # 403
curl -s -o /dev/null -w '%{http_code}\n' "http://$S3_IP:9000/galaxie-sports-tasks/"                         # 403
curl -s -o /dev/null -w '%{http_code}\n' "https://$ASSETS_DOMAIN/galaxie-sports-assets/"                    # 403/404 (sem listagem)
docker compose -f compose.dados.yml exec -T backup sh -c 'AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" aws --endpoint-url "$S3_ENDPOINT" s3 rm "s3://$S3_TASKS_BUCKET/tasks/teste-587/ok.txt"'
```

Depois, o que ficou em `tasks/` do bucket de assets vai para o privado (cópia conferida por tamanho e ETag, depois apaga do
público; idempotente). Da máquina de dev, prévia primeiro:

```bash
ssh root@145.223.94.149 'cd /docker/galaxie-sports && bash -s -- --plan' < infra/ops/mover-tasks-para-bucket-privado.sh
ssh root@145.223.94.149 'cd /docker/galaxie-sports && bash -s' < infra/ops/mover-tasks-para-bucket-privado.sh
```

Saída `3`: há tarefa viva (`pending`/`running`) com o pacote no bucket de assets; a cópia foi feita, a remoção não.
Espere ela terminar e rode de novo (ou `--forcar`). Saída `4`: a mesma chave já existe no privado com outro conteúdo
(tamanho ou ETag); nada foi sobrescrito, resolva à mão.

**Backup do bucket das tarefas.** Na produção não há bucket remoto: a cópia fora da VPS é a do NAS. Ligue
`BACKUP_S3_SYNC_TASKS_BUCKET=true` no `.env` da VPS (é cópia, nada é apagado) e recrie o `backup`
(`docker compose -f compose.dados.yml up -d --no-deps --wait backup`): a partida já espelha o bucket em
`s3/tasks-bucket/` do volume. Depois, no NAS, acrescente `tasks-bucket` a `NAS_S3_PREFIXES` da stack
`galaxie-sports-backup-nas` (`infra/nas-backup/compose.yml`): ele puxa `s3/tasks-bucket/` como qualquer prefixo.

**Upgrade do Postgres** (#201), restauração do banco e outra manutenção longa: force a página de manutenção antes e tire
depois ([README da stack › Página de manutenção](../../infra/vps-telemetry/README.md)):

```bash
ssh root@145.223.94.149 'cd /docker/galaxie-sports && bash -s -- up' < infra/vps-telemetry/maintenance.sh
ssh root@145.223.94.149 'cd /docker/galaxie-sports && bash -s -- down' < infra/vps-telemetry/maintenance.sh
```

## Rede e volumes

Criados uma vez, fora dos projetos. `docker compose down` em qualquer um dos três não os apaga, e **`down -v` também não**
apaga os externos. Numa VPS nova, o [bootstrap](bootstrap-vps.md) cria tudo.
