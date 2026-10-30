# infra/backup

Imagem `galaxie-sports-backup`: dump diário do Postgres, validação, retenção, cópia opcional para S3 e os scripts de
restauração. Roda como o serviço `backup` da stack da VPS ([`infra/vps-telemetry/compose.yml`](../vps-telemetry/compose.yml)).
A cópia para o NAS (camada 2 do 3-2-1) fica em [`infra/nas-backup`](../nas-backup); o verificador e o ensaio mensal, em
[docs/runbooks/exercicio-dr.md](../../docs/runbooks/exercicio-dr.md).

| Script | O que faz |
|---|---|
| `backup.sh` | Um backup agora (o `entrypoint.sh` agenda um por dia às `BACKUP_TIME` UTC e um na partida) |
| `backup-check.sh` | Healthcheck: _unhealthy_ se o último sucesso tiver mais de 26 h |
| `restore.sh` | Lista, ensaia (`--verify`) ou restaura (`--yes`) um dump |
| `restore-drill.sh` | Ensaio de restauração completo, com conferência |
| `e2e-test.sh` · `local-test.sh` | Ciclo backup → perda → ensaio → restore → conferência (o primeiro roda no CI) |

## Backups

- `pg_dump --format=custom --compress=zstd:5` do banco inteiro (o schema `raw` é o ativo mais caro de reconstruir),
  validado com `pg_restore --list`, com `.sha256` ao lado. Ficam os `BACKUP_KEEP_DAILY` (7) dumps mais recentes no volume
  `backups`, contados por quantidade: com o backup parado, nada some.
- Com `BACKUP_S3_BUCKET` definido, cada dump também vai para o bucket remoto (`BACKUP_S3_PREFIX/`). Configure no bucket
  uma regra de ciclo de vida de 30 dias. Use um bucket fora da VPS: o RustFS da stack não serve como cópia externa.
- Cada execução vira uma linha `pg-backup` em `ops.job_run`, que alimenta as métricas e o alerta `BackupStale`.
- Backup avulso: `docker compose exec backup backup.sh`.

## Restore (testado)

O restore real é feito num banco novo, conferido (contagens de `raw`, `ops`, `core` e migrations) e só então trocado
pelo nome. O banco anterior fica como `<db>_pre_restore_<data>` para rollback.

1. **Ensaio** (não toca no banco real; faça mensalmente):
   ```bash
   docker compose exec backup restore.sh --list
   docker compose exec backup restore.sh --verify latest
   ```
2. **Restauração real**, na pasta da stack na VPS:
   1. `docker compose stop api demo ingestor agents webhooks` (evita escrita entre o dump e a troca).
   2. `docker compose exec backup restore.sh --yes latest` (ou `--yes galaxie_sports_<data>.dump`, ou
      `--yes s3://<bucket>/postgres/<arquivo>.dump` para baixar da cópia remota). Com os papéis por serviço ligados, a
      restauração precisa do dono do banco: veja "Depois de restaurar um dump" no
      [README da VPS](../vps-telemetry/README.md).
   3. `docker compose run --rm migrate` (o dump vai sem GRANTs; o migrate refaz os papéis), depois
      `docker compose start api demo ingestor agents webhooks`; confira `https://$API_DOMAIN/health/db` e o painel.
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
`BACKUP_S3_ENDPOINT` com `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (ver o cabeçalho de `backup.sh`).
