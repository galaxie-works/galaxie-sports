# Operação a partir da máquina de dev

Scripts que rodam da máquina de desenvolvimento (Windows, Git Bash) contra a VPS de produção e o NAS de dev.
Nenhum guarda segredo: as senhas e chaves são lidas do `.env` do checkout principal (`GALAXIE_ENV`, padrão
`/g/galaxie-sports/.env`) na hora de rodar.

| Script | Para quê |
| --- | --- |
| `merge-train.sh <pr>…` | Atualiza cada PR com a main, espera o CI estabilizar, recusa PR com thread P1 do Codex sem resolver (`CODEX_GATE=off` desliga) e faz squash merge; relata o que ficou de fora e por quê. |
| `deploy-safe.sh <rótulo>` | Um deploy por vez (trava em `$GALAXIE_OPS_STATE`, padrão `~/.galaxie-ops`), com teto de 80 min (`DEPLOY_TIMEOUT`): travou = falha avisada, não espera infinita. Sobe e fecha o Docker Desktop e religa o espelho de assets. O `deploy.sh` confere o CI do commit, trava também na VPS (contra deploy de outra máquina) e publica a release com as notas no fim. |
| `sync/sync-preview.sh` | Prévia NAS → produção: exporta do NAS, monta `sync_*` na produção, reaponta ids e mostra as contagens por tabela. Não aplica nada. |
| `sync/sync-round.sh` | Aplica a rodada NAS → produção, com dump `pre-sync-*` antes. Só depois da prévia revisada. |

Uso típico, do checkout principal na `main`:

```bash
infra/ops/merge-train.sh 301 302 && infra/ops/deploy-safe.sh r302
```

## Regras da sincronização NAS → produção

- A produção mais recente sempre ganha: o NAS só atualiza linha com `updated_at` mais novo e sem perder campo preenchido.
- Placar e status de jogo encerrado da produção nunca são trocados pelos do NAS.
- `core.standing` não é sincronizada: a produção recalcula a classificação.
- Dump `pre-sync-*` antes de aplicar e prévia (`sync-preview.sh`) revisada antes da rodada.
