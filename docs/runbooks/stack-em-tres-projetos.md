# Transição da stack para três projetos

Passo único, feito uma vez na VPS: a stack sai de um projeto do Compose com 15 serviços para três na mesma rede. Depois
disso, um deploy de app não passa perto do banco. O dia a dia está em
[Dados e observabilidade](stack-dados-e-observabilidade.md).

| Projeto | Arquivo | Serviços | Quem aplica |
| --- | --- | --- | --- |
| `galaxie-sports` (apps) | `compose.yml` | `api`, `webhooks`, `migrate`, `demo`, `ingestor`, `agents`, `maintenance`, candidatos, `lineup-render` | deploy automático |
| `galaxie-sports-dados` | `compose.dados.yml` | `postgres`, `valkey`, `s3`, `s3-init`, `backup` | runbook |
| `galaxie-sports-obs` | `compose.obs.yml` | `prometheus`, `grafana`, `node-exporter` | `deploy.yml -f project=obs` |

## O que muda e o que não muda

- **Apps não são recriados.** O projeto deles continua sendo `galaxie-sports`, e a separação não muda o hash de
  configuração de nenhum serviço de apps. O teste no CI prova com `docker inspect .Created`.
- **Rede: é a mesma, `galaxie-sports_default`.** A issue pedia uma rede `galaxie-sports`, mas o Docker não renomeia rede e
  não aceita duas com a mesma sub-rede. Criar outra obrigaria a desconectar tudo, ou a trocar o `TRUST_PROXY`. A rede atual
  vira externa nos três arquivos, com a sub-rede `172.30.50.0/24` e o gateway `172.30.50.1` de sempre.
- **Volumes: os mesmos.** `galaxie-sports_pgdata`, `_valkeydata`, `_s3data`, `_backups`, `_promdata` e `_grafanadata`
  viram externos com o nome de sempre. O caminho do `nas-pull.sh` e o `authorized_keys` do NAS não mudam.
- **Dados e obs ganham contêiner novo.** O rótulo do projeto não muda em contêiner existente. O antigo para **antes** de o
  novo subir, porque dois Postgres no mesmo volume corrompem o banco, e fica parado para o reverso.

## O que esperar de indisponibilidade

Sem página de manutenção e sem recriar apps, mas não é zero: cada serviço de dados fica fora enquanto troca.

| Serviço | Efeito enquanto troca |
| --- | --- |
| `node-exporter`, `prometheus`, `grafana` | Buraco nas métricas. Alertas parados por segundos |
| `valkey` | Cache e rate limit indisponíveis por segundos; os dados voltam do AOF, no mesmo volume |
| `s3` | Logos e fotos sem resposta por segundos. O bucket já existe; o `s3-init` só confere |
| `postgres` | Leituras e gravações falham pelo tempo de parar e subir. O pool da API e os jobs reconectam |
| `backup` | Nada. O dump de partida só roda se o último tiver mais de 20 h |

O tempo do Postgres só se mede na hora: **não foi medido na VPS**. Escolha uma janela sem jogo de prioridade alta.

## Antes de começar

- Os PRs das issues #528, #529 e #531 já publicados, com `TAG_*` no `.env` da VPS. Sem elas, o `preparar` reprova.
- O PR da #532 mergeado com o deploy automático **desligado**. Se o deploy rodar com a VPS num projeto só, ele recusa e
  termina vermelho (`FAIL  a VPS ainda está num projeto só`), sem tocar em nada.

```bash
gh variable delete DEPLOY_AUTO
```

## Passo a passo

Da máquina de dev, num checkout da `main`:

```bash
VPS=root@145.223.94.149
D=/docker/galaxie-sports
scp infra/vps-telemetry/compose.dados.yml infra/vps-telemetry/compose.obs.yml "$VPS:$D/"
scp infra/vps-telemetry/compose.yml "$VPS:$D/compose.yml.new"
```

1. **Conferir sem trocar nada.** Valida os três arquivos com o `.env`, a rede com a sub-rede certa e os seis volumes:

   ```bash
   ssh "$VPS" "cd $D && bash -s -- preparar" < infra/vps-telemetry/migrar-para-tres-projetos.sh
   ```

2. **Um backup agora**, para ter um dump recente:

   ```bash
   ssh "$VPS" "cd $D && docker compose exec -T backup backup.sh"
   ```

3. **Aplicar.** Troca `node-exporter`, `prometheus`, `grafana`, `valkey`, `s3`, `s3-init`, `postgres` e `backup`, nessa
   ordem. Serviço já no projeto novo é pulado, então dá para rodar de novo depois de uma falha. Se um serviço não subir, o
   script tira o novo, religa o antigo e sai com 1:

   ```bash
   ssh "$VPS" "cd $D && bash -s -- aplicar" < infra/vps-telemetry/migrar-para-tres-projetos.sh
   ```

4. **Conferir.** Tem de terminar `PASS  três projetos, mesma rede, mesmos volumes`:

   ```bash
   ssh "$VPS" "cd $D && bash -s -- conferir" < infra/vps-telemetry/migrar-para-tres-projetos.sh
   ssh "$VPS" "docker compose ls"
   ssh "$VPS" "cd $D && docker compose exec -T demo node -" < infra/vps-telemetry/smoke.mjs
   ```

5. **Publicar e religar o deploy automático.** O primeiro deploy tem de sair sem recriar dados nem obs:

   ```bash
   gh workflow run deploy.yml
   gh variable set DEPLOY_AUTO --body on
   ```

6. **No dia seguinte**, com o backup diário e o recibo do NAS normais, apagar os contêineres antigos. **Depois disso não há
   mais reverso automático:**

   ```bash
   ssh "$VPS" "cd $D && bash -s -- limpar" < infra/vps-telemetry/migrar-para-tres-projetos.sh
   ```

## Reverso

Funciona até o `limpar`. Tira os contêineres novos, religa os antigos, volta o `compose.yml` de antes e renomeia
`compose.dados.yml` e `compose.obs.yml` para `.off`. Assim o deploy volta a recusar até a transição ser refeita:

```bash
ssh "$VPS" "cd $D && bash -s -- reverter" < infra/vps-telemetry/migrar-para-tres-projetos.sh
```

Para o projeto só voltar a receber deploy, é preciso também voltar a `main` para antes da #532. Para refazer a transição,
recomece do `scp`.

Depois do `limpar`, o caminho é à mão: parar `compose.dados.yml` e `compose.obs.yml` com `down` (sem `-v`) e subir o
`compose.yml.pre-tres-projetos`, que fica na pasta como registro.

## Voltar versão depois da transição

`gh workflow run deploy.yml -f sha=<sha> -f force=1` continua valendo para um SHA anterior aos três projetos. O compose dele
tem o Postgres: subi-lo daria dois no mesmo volume. Por isso o deploy publica as **imagens** do SHA (tag `<sha>`) com o
`compose.yml` de apps da `main`, e o log diz que os webhooks ficam como estão quando o SHA é anterior ao `/health` do worker.

## Como foi testado

- `infra/vps-telemetry/deploy-gh.test.sh`, no CI: transição, falha no meio, repetição, reverso e deploys depois dela,
  numa stack de brinquedo com imagens mínimas.
- Ensaio único em 02/11/2026, num Docker isolado, com os nomes reais, o `compose` anterior e o novo, e Postgres, Valkey,
  RustFS, aws-cli, node-exporter e Caddy de verdade; as imagens nossas eram de mentira. `aplicar`, repetir, `reverter`,
  `aplicar` de novo e `limpar` passaram; a linha gravada no Postgres e a chave no Valkey sobreviveram, e os contêineres de
  apps não mudaram. O `aplicar` levou cerca de 1 min. Um cliente na rede viu o Postgres fora em uma amostra só, mas com o
  banco quase vazio: o número não vale para a produção.
- **Não testado no NAS:** o SSH do NAS não tem Docker sem `sudo`, o Portainer não roda o script na pasta da stack, e a stack
  de dev de lá só tem Postgres, Valkey e S3.
- **Não testado na VPS:** o primeiro `aplicar` de verdade é o da transição.
