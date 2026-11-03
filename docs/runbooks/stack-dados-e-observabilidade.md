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

Imagem nova do `backup`: `bash infra/ops/image-hash.sh backup`, num checkout do SHA, dá a tag. Grave `TAG_BACKUP=in-<hash>`
no `.env` e baixe com login temporário antes de subir (`docs/runbooks/bootstrap-vps.md` tem o `DOCKER_CONFIG` temporário).

Risco por serviço:

| Serviço | Recriar causa |
| --- | --- |
| `backup` | Nada para o usuário |
| `s3` | Logos e fotos sem resposta por segundos |
| `valkey` | Cache e rate limit fora por segundos |
| `postgres` | API, demo e jobs falham até ele voltar. Faça um backup antes e veja a página de manutenção abaixo |

**Upgrade do Postgres** (#201), restauração do banco e outra manutenção longa: force a página de manutenção antes e tire
depois ([README da stack › Página de manutenção](../../infra/vps-telemetry/README.md)):

```bash
ssh root@145.223.94.149 'cd /docker/galaxie-sports && bash -s -- up' < infra/vps-telemetry/maintenance.sh
ssh root@145.223.94.149 'cd /docker/galaxie-sports && bash -s -- down' < infra/vps-telemetry/maintenance.sh
```

## Rede e volumes

Criados uma vez, fora dos projetos. `docker compose down` em qualquer um dos três não os apaga, e **`down -v` também não**
apaga os externos. Numa VPS nova, o [bootstrap](bootstrap-vps.md) cria tudo.
