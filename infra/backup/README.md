# infra/backup

Imagem `galaxie-sports-backup`: dump diário do Postgres, validação, retenção, cópia opcional para S3 e os scripts de
restauração. Roda como o serviço `backup` da stack da VPS ([`infra/vps-telemetry/compose.yml`](../vps-telemetry/compose.yml)).
A cópia para o NAS (camada 2 do 3-2-1) fica em [`infra/nas-backup`](../nas-backup); o verificador e o ensaio mensal, em
[docs/runbooks/exercicio-dr.md](../../docs/runbooks/exercicio-dr.md).

| Script | O que faz |
|---|---|
| `backup.sh` | Um backup agora (o `entrypoint.sh` agenda um por dia às `BACKUP_TIME` UTC e um na partida) |
| `s3-sync.sh` | Cópia opcional dos prefixos do bucket de assets (RustFS) para o volume e o bucket remoto |
| `backup-check.sh` | Healthcheck: _unhealthy_ se o último sucesso tiver mais de 26 h |
| `restore.sh` | Lista, ensaia (`--verify`) ou restaura (`--yes`) um dump |
| `restore-drill.sh` | Ensaio de restauração completo, com conferência |
| `e2e-test.sh` · `local-test.sh` | Ciclo backup → perda → ensaio → restore → conferência (o primeiro roda no CI) |

## Backups

- `pg_dump --format=custom --compress=zstd:5` do banco inteiro (o schema `raw` é o ativo mais caro de reconstruir), menos
  os dados de `BACKUP_EXCLUDE_TABLE_DATA`: o que veio da API do YouTube vai só com a estrutura, porque a política manda
  apagar em 30 dias e os dumps guardam por meses (decisão de 04/11/2026). O dump antes do migrate
  (`infra/vps-telemetry/pre-migrate-dump.sh`) exclui as mesmas tabelas. Depois de restaurar, a coleta (`related-run`)
  preenche essas tabelas de novo, gastando cota. Validado com `pg_restore --list`, com `.sha256` ao lado. Ficam os `BACKUP_KEEP_DAILY` (7) dumps mais recentes no volume
  `backups`, contados por quantidade: com o backup parado, nada some.
- Com `BACKUP_S3_BUCKET` definido, cada dump também vai para o bucket remoto (`BACKUP_S3_PREFIX/`). O bucket remoto guarda tudo: sem regra de ciclo de vida, nem para os dumps (decisão de 02/11/2026); a rotação é só a local, por quantidade (BACKUP_KEEP_DAILY), e a do NAS.
  Use um bucket fora da VPS: o RustFS da stack não serve como cópia externa.
- Cada execução vira uma linha `pg-backup` em `ops.job_run`, que alimenta as métricas e o alerta `BackupStale`.
- Backup avulso: `docker compose -f compose.dados.yml exec backup backup.sh`.

## Assets do S3 (RustFS)

O dump não leva o conteúdo do bucket `galaxie-sports-assets` (escudos e variantes, mídia, logos enviados no painel). O que
não se refaz a partir do pacote do acervo nem da CDN de mídia entra por `BACKUP_S3_SYNC_PREFIXES` (prefixos de primeiro
ou segundo nível, separados por espaço ou vírgula; vazio = nada muda). Qual prefixo vale a cópia, com tamanhos e o que
cada um é: [docs/runbooks/exercicio-dr.md › Assets do S3](../../docs/runbooks/exercicio-dr.md#assets-do-s3).

Depois de cada dump (e na partida, se o recibo estiver velho), `s3-sync.sh`:

1. espelha cada prefixo do RustFS (`S3_ENDPOINT`, com as chaves `S3_ACCESS_KEY`/`S3_SECRET_KEY`) em
   `/backups/s3/<prefixo>/`, no volume `backups`, de onde o NAS puxa (`NAS_S3_PREFIXES`; ver
   [`infra/nas-backup`](../nas-backup)). O volume passa a ter o tamanho dos prefixos a mais;
2. com `BACKUP_S3_BUCKET`, copia dali para `s3://$BACKUP_S3_BUCKET/$BACKUP_S3_SYNC_DEST_PREFIX/<prefixo>/` (padrão
   `assets/`). `aws s3 sync` só envia o que mudou;
3. grava o recibo `/backups/.s3_last_sync`, que o `backup-check.sh` confere (mesmo limite de `BACKUP_MAX_AGE_H`), e a
   linha `s3-sync` em `ops.job_run`.

Um prefixo sem nenhum objeto (nome errado, ou ainda vazio) falha o sync em vez de passar em silêncio: `aws s3 sync` de um
prefixo inexistente termina com sucesso sem copiar nada, e o recibo daria o backup por feito. Ponha na lista só prefixos que
já têm objetos.

Nada é apagado por padrão (`BACKUP_S3_SYNC_DELETE=false`): o objeto que sumiu do RustFS por engano continua na cópia, e um
RustFS vazio não esvazia o backup. Os objetos de logo têm o hash no nome, então não são reescritos. Falha do sync não
derruba o backup do banco (o dump já está guardado): ela vira erro do job `s3-sync`, o recibo envelhece e o verificador
dispara `BackupCheckFailed`.

**Retenção do remoto.** O bucket remoto guarda tudo: sem regra de ciclo de vida, nem para os dumps (decisão de 02/11/2026); a rotação é só a local, por quantidade (BACKUP_KEEP_DAILY), e a do NAS. Os assets ficam num prefixo irmão dos dumps (`assets/`, não
`postgres/s3/…`), e o `s3-sync.sh` só apaga com `BACKUP_S3_SYNC_DELETE=true`
(padrão `false`: nada some do espelho nem do remoto).

Limites: o `aws s3 sync` lista os dois lados a cada execução e o contêiner tem `mem_limit: 256m`. Para algumas dezenas de
milhares de objetos, sem problema; para centenas de milhares (a mídia `api-sports/`), meça antes e suba o limite.

### Bucket das tarefas

Os pacotes do acervo e os relatórios das tarefas da fila (`tasks/<id>/`) moram no bucket privado `S3_TASKS_BUCKET`
(padrão `galaxie-sports-tasks`, sem leitura anônima; #587), não no de assets. Com `BACKUP_S3_SYNC_TASKS_BUCKET=true`
(padrão `false`), o `s3-sync.sh` copia esse bucket inteiro no mesmo passo e com o mesmo recibo:

1. RustFS → `/backups/s3/tasks-bucket/` no volume, ao lado dos prefixos do bucket de assets. O NAS puxa como mais um
   prefixo: basta acrescentar `tasks-bucket` a `NAS_S3_PREFIXES` (`infra/nas-backup/compose.yml`). Por isso
   `tasks-bucket` não pode ser prefixo de `BACKUP_S3_SYNC_PREFIXES` (o script recusa);
2. com `BACKUP_S3_BUCKET`, dali → `s3://$BACKUP_S3_BUCKET/$BACKUP_S3_SYNC_TASKS_DEST_PREFIX/` (padrão `tasks/`, irmão de
   `assets/` e `postgres/`; o script recusa um destino igual a um dos dois).

Bucket vazio é normal (nenhuma tarefa com arquivo ainda) e não falha; bucket que não existe falha. `BACKUP_S3_SYNC_DELETE`
vale para ele também. Na produção não há bucket remoto (`BACKUP_S3_BUCKET` vazio): a cópia fora da VPS é a do NAS, com
`tasks-bucket` em `NAS_S3_PREFIXES`. O `env.example` já vem com `BACKUP_S3_SYNC_TASKS_BUCKET=true` (é cópia: nada é
apagado). O `tasks` saiu da lista de prefixos do bucket de assets: depois da migração
(`infra/ops/mover-tasks-para-bucket-privado.sh`) não sobra nada lá.

## Restore (testado)

O restore real é feito num banco novo, conferido (contagens de `raw`, `ops`, `core` e migrations) e só então trocado
pelo nome. O banco anterior fica como `<db>_pre_restore_<data>` para rollback.

1. **Ensaio** (não toca no banco real; faça mensalmente):
   ```bash
   docker compose -f compose.dados.yml exec backup restore.sh --list
   docker compose -f compose.dados.yml exec backup restore.sh --verify latest
   ```
2. **Restauração real**, na pasta da stack na VPS:
   1. `docker compose stop api site console live ingestor agents webhooks` (evita escrita entre o dump e a troca).
   2. `docker compose -f compose.dados.yml exec backup restore.sh --yes latest` (ou `--yes galaxie_sports_<data>.dump`, ou
      `--yes s3://<bucket>/postgres/<arquivo>.dump` para baixar da cópia remota). Com os papéis por serviço ligados, a
      restauração precisa do dono do banco: veja "Depois de restaurar um dump" no
      [README da VPS](../vps-telemetry/README.md).
   3. `docker compose run --rm migrate` (o dump vai sem GRANTs; o migrate refaz os papéis), depois
      `docker compose start api site console live ingestor agents webhooks`; confira `https://$API_DOMAIN/health/db` e o painel.
3. **Rollback** (se o restaurado não servir), no `postgres`:
   ```sql
   ALTER DATABASE galaxie_sports RENAME TO galaxie_sports_descartado;
   ALTER DATABASE galaxie_sports_pre_restore_<data> WITH ALLOW_CONNECTIONS true;
   ALTER DATABASE galaxie_sports_pre_restore_<data> RENAME TO galaxie_sports;
   ```
   Quando estiver tudo certo, apague o banco `_pre_restore_` antigo (`DROP DATABASE ... WITH (FORCE)`).
4. **VPS nova ou desastre**: suba a stack, copie o dump para o volume (`docker cp arquivo.dump <contêiner-backup>:/backups/`)
   ou use o caminho `s3://...`, e siga o passo 2.

Variáveis: `BACKUP_DIR`, `BACKUP_KEEP_DAILY`, `BACKUP_COMPRESS`, `BACKUP_TIME`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX`,
`BACKUP_S3_ENDPOINT` com `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (ver o cabeçalho de `backup.sh`); dos assets:
`BACKUP_S3_SYNC_PREFIXES`, `BACKUP_S3_SYNC_DEST_PREFIX`, `BACKUP_S3_SYNC_DELETE`, `BACKUP_S3_SYNC_DIR`; do bucket das
tarefas: `BACKUP_S3_SYNC_TASKS_BUCKET`, `BACKUP_S3_SYNC_TASKS_DEST_PREFIX`, `BACKUP_S3_SYNC_TASKS_DIR`, `S3_TASKS_BUCKET`
(cabeçalho de `s3-sync.sh`).
