# Exercício de recuperação de desastre (DR)

Roteiro para provar, periodicamente, que um backup do Postgres vira um banco funcional — e registro dos exercícios
feitos. O procedimento operacional completo (agenda de dumps, cópia remota, restore real e rollback em staging) está em
[infra/portainer/README.md §Backups e §Restore](../../infra/portainer/README.md#backups); este documento é o **exercício**.

## Objetivos

| Métrica | Alvo | Observação |
|---|---|---|
| RPO (perda máxima de dados) | 24 h | Dump diário (`BACKUP_TIME`). O `raw` perdido pode ser rebuscado no fornecedor, mas custa cota |
| RTO (tempo até a API voltar) | 1 h | Do incidente declarado à API respondendo `/health/db` com o banco restaurado |
| Frequência do exercício | Mensal (ensaio `--verify`) e trimestral (exercício completo, abaixo) | O CI já roda o ciclo completo em banco descartável (`infra/backup/e2e-test.sh`) |

## Roteiro do exercício completo

Nunca use `restore.sh --yes` com `PGDATABASE` apontando para o banco real fora de um incidente: a restauração real
**substitui** o banco. O exercício restaura num banco descartável.

1. **Dump** (somente leitura no banco de origem) com a imagem de backup do repositório:
   ```bash
   docker build -t galaxie-sports-backup:dev infra/backup
   docker volume create galaxie-dr-drill
   TS=$(date -u +%Y%m%dT%H%M%SZ)
   docker run --rm --network galaxie-sports_default -v galaxie-dr-drill:/backups \
     -e PGHOST=postgres -e PGUSER=galaxie -e PGPASSWORD=galaxie -e PGDATABASE=galaxie_sports \
     galaxie-sports-backup:dev pg_dump -Fc --no-owner --no-privileges \
     -f /backups/galaxie_drill_$TS.dump galaxie_sports
   ```
   Em staging, use o dump mais recente do volume `backups` (ou da cópia S3) em vez de gerar um novo — o exercício deve
   provar que **o backup que existe** é restaurável.
2. **Ensaio** (restaura em `galaxie_drill_restore_check`, confere e apaga):
   ```bash
   docker run --rm --network galaxie-sports_default -v galaxie-dr-drill:/backups \
     -e PGHOST=postgres -e PGUSER=galaxie -e PGPASSWORD=galaxie -e PGDATABASE=galaxie_drill \
     galaxie-sports-backup:dev restore.sh --verify latest
   ```
3. **Restauração real num alvo descartável**: crie um `galaxie_drill` vazio (simula o banco perdido) e rode
   `restore.sh --yes latest` com `PGDATABASE=galaxie_drill`. O script restaura em `galaxie_drill_restoring`, confere e
   troca pelo nome, guardando o anterior como `galaxie_drill_pre_restore_<data>`.
4. **Conferência**: compare as contagens (`core.competition`, `core.season`, `core.standing`, `raw.api_response`,
   `drizzle.__drizzle_migrations`) entre origem e restaurado; aplique as migrations pendentes
   (`runMigrations`/`pnpm db:migrate` com `DATABASE_URL` do banco restaurado).
5. **Prova de vida da API**: suba a API apontando para o banco restaurado e rode o smoke de carga
   ([tests/load](../../tests/load/README.md)) — respostas 200 do catálogo e do autoatendimento.
6. **Limpeza**: `DROP DATABASE galaxie_drill WITH (FORCE)` (e `_pre_restore_*`), `docker volume rm galaxie-dr-drill`.
7. **Registro**: acrescente uma linha na tabela abaixo (data, origem, tamanho, tempos, divergências, ações).

## Registro dos exercícios

| Data (UTC) | Ambiente | Dump | Tempos | Conferência | Resultado / ações |
|---|---|---|---|---|---|
| 2026-10-21 | Local (Docker Desktop, Postgres 17, banco de dev com 67 MB) | `pg_dump -Fc` 8,6 MiB + `.sha256` | dump ≤ 5 s · ensaio `--verify` 5 s · restauração real com troca de nome 5 s · migrations pendentes (0007) < 1 s | `core.competition` 1249 = 1249 · `core.season` 8781 = 8781 · `core.standing` 220 = 220 · `raw.api_response` 522 = 522 · migrations 7 = 7 (+1 aplicada depois) | **OK.** API do branch subiu sobre o banco restaurado; tenant criado pela API administrativa e smoke k6 de 30 s por cenário com 0% de erro (números no PR da issue #85). Ações: nenhuma bloqueante; repetir em staging com o dump real do volume `backups` e a cópia S3 quando a stack estiver no ar |

## Cenários de desastre e resposta

| Cenário | Resposta |
|---|---|
| Banco corrompido / `DROP` acidental | Pare API e ingestor → `restore.sh --yes latest` → confira → suba os serviços. Perda: desde o último dump |
| VPS perdida | Nova VPS → stack do Portainer → copie o dump da cópia S3 (`restore.sh --yes s3://...`; baixa e confere o `.sha256` junto e para sem ele, salvo `--no-checksum`) → DNS. Segredos vêm do secret store, não do disco perdido |
| Valkey perdido | Sem restauração: cache e rate limit se reconstroem; contadores de uso do dia corrente voltam a partir do último consolidado em `api.usage_daily` (o flush usa `greatest`, nada regride) |
| Bucket de assets perdido | `assets:mirror` rebaixa da CDN de mídia (fora da cota); `core.asset` guarda as URLs de origem |
| Vazamento de segredo | [SECURITY.md §Rotação de segredos](../../SECURITY.md#rotação-de-segredos) |
