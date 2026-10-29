# Operação a partir da máquina de dev

> **Plano B.** O caminho normal de merge e deploy roda no GitHub: imagens no GHCR, deploy por SSH pelo Actions
> (`.github/workflows/deploy.yml`), portão do Codex como check obrigatório e trem de merge no Actions
> (`.github/workflows/merge-train.yml`). Passo a passo e transição: [docs/runbooks/deploy-pelo-github.md](../../docs/runbooks/deploy-pelo-github.md).
> Os scripts abaixo seguem valendo quando o Actions, o GHCR ou o SSH do runner estiverem fora. O `deploy.sh` usa a mesma
> trava na VPS que o deploy do Actions; antes de usar, desligue o automático com `gh variable delete DEPLOY_AUTO`.

Scripts que rodam da máquina de desenvolvimento (Windows, Git Bash) contra a VPS de produção e o NAS de dev.
Nenhum guarda segredo: as senhas e chaves são lidas do `.env` do checkout principal (`GALAXIE_ENV`, padrão
`/g/galaxie-sports/.env`) na hora de rodar.

| Script | Para quê |
| --- | --- |
| `merge-train.sh <pr>…` | Atualiza cada PR com a main, espera o CI estabilizar (execução cancelada de um check que tem outra verde no mesmo commit não conta como falha; teste em `merge-train.test.sh`), recusa PR com thread P1 do Codex sem resolver (`CODEX_GATE=off` desliga) e faz squash merge; relata o que ficou de fora e por quê. Também roda no Actions (`merge-train.yml`). |
| `codex-gate.sh <pr>` | A regra do P1 do Codex como check (`Codex sem P1 aberto`, em `codex-gate.yml`): espera o review terminar e falha com thread P1 sem resolver; review travado ou de commit anterior só gera aviso (teste em `codex-gate.test.sh`). Roda também à mão. |
| `alerta-issue.sh` | Alerta do Grafana vira issue com o rótulo `alerta` e fecha quando resolve (`alerta-grafana.yml`, que o Grafana dispara). Lê o alerta em `ALERTA_PAYLOAD`. |
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
