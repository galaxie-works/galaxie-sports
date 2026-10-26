# Merge e deploy pelo GitHub

Build, merge e deploy rodam no GitHub (Actions e GHCR), sem Docker Desktop na máquina de dev. Os scripts antigos
(`infra/ops/merge-train.sh`, `infra/ops/deploy-safe.sh` → `infra/vps-telemetry/deploy.sh`) ficam como **plano B**.

## Como fica

```text
PR ──► CI + Imagens + Codex (checks obrigatórios)
        │
        ▼
merge (fila nativa do GitHub, ou trem de merge no Actions)
        │  push na main
        ▼
CI + Imagens no SHA ──► imagens <sha>, main, staging no GHCR (só reconstrói o que mudou)
        │  os dois verdes (workflow_run)
        ▼
Deploy (deploy.yml): trava na VPS → pull do GHCR → up → migrate → pós-deploy → smoke
        │                                   └─ falhou sem migration nova → volta para o SHA anterior
        ▼
notas de versão (tag deploy-AAAA-MM-DD.N)
```

| Peça | Arquivo | O que faz |
| --- | --- | --- |
| Imagens | `.github/workflows/docker.yml` | Em PR, na fila (`merge_group`) e no push na main. Publica `api`, `ingestor`, `demo`, `backup`, `prometheus` e `grafana` na fila (tag `<sha>`) e no push (`<sha>`, `main`, `staging`). Cada imagem tem o hash da sua entrada (tag `in-<hash>`): entrada igual à de uma imagem já publicada → só ganha as tags novas, sem build. Cache de camadas do GHA (a fila lê o da main e não grava). |
| CI | `.github/workflows/ci.yml` | O de sempre, agora também em `merge_group`. |
| Portão do Codex | `.github/workflows/codex-gate.yml` + `infra/ops/codex-gate.sh` | Check `Codex sem P1 aberto`: falha com thread do Codex com "P1 Badge" sem resolver (a regra do `codex_p1()` do trem). Pronto na hora quando o review terminado é do commit atual do PR. Senão espera até 10 min de PR aberto e 3 min depois do último commit, e espera também o review que estiver rodando (👀). Sem review do commit atual no fim da espera, o Codex não vai revisar sozinho (só revisa ao abrir, ao sair de rascunho ou com `@codex review`): confere as threads que existem e avisa; com `CODEX_REQUIRE_CURRENT=1`, falha. |
| Deploy | `.github/workflows/deploy.yml` + `infra/vps-telemetry/deploy-gh.sh` | Dispara quando CI e Imagens terminam verdes na ponta da main (com `DEPLOY_AUTO=on`) ou à mão. Um por vez (`concurrency`); com vários merges seguidos, sai um deploy só, do último commit. |
| Pós-deploy | `infra/vps-telemetry/post-deploy.sh` | Seed, nomes, importância, cache e conta da IA; o mesmo nos dois roteiros. |
| Trem de merge | `.github/workflows/merge-train.yml` | O `merge-train.sh` rodando no Actions, enquanto não houver fila nativa. |

### O deploy pelo Actions

1. Confere no GHCR as imagens do SHA (antes de tocar a VPS).
2. Pega a trava da VPS (`/docker/galaxie-sports/.deploy.lock`). É a mesma do `deploy.sh`, então Actions e plano B
   nunca rodam juntos.
3. Se o SHA já está no ar, termina sem fazer nada (`force=1` publica de novo).
4. Faz login no GHCR na VPS com o token do próprio job, num `DOCKER_CONFIG` temporário. O token vai pelo stdin e o
   diretório sai no fim; o token expira com o job. A VPS não guarda credencial do GitHub.
5. Valida o `compose.yml` do SHA e o `.env` com `IMAGE_TAG`/`IMAGE_PREFIX` novos. O `docker compose pull` baixa só os
   serviços com imagem nossa; postgres, valkey e rustfs ficam na imagem que já está na VPS. Depois faz backup dos dois
   arquivos e troca.
6. `up -d` com a escala atual do ingestor, `migrate` com saída 0, pós-deploy e smoke test (o "N ok · avisos · falhas").
7. Se o up, o migrate, o pós-deploy ou o smoke falham, volta para o SHA anterior quando é garantidamente o estado de
   antes: nenhuma migration nova, backups e imagens antigas na VPS. Depois limpa o cache de novo. Com migration nova,
   imprime o rollback manual, porque o código antigo pode não aguentar o schema novo. O job fica vermelho nos dois
   casos.
8. lineup-render: baixa a imagem da versão do Playwright quando a pasta mudou (nunca falha o deploy).
9. Religa o espelho de assets.
10. Publica as notas de versão (`release-notes.mjs`).

Comandos:

```bash
gh workflow run deploy.yml                              # o commit mais novo da main
gh workflow run deploy.yml -f sha=<sha> -f force=1      # um SHA específico (também serve para voltar versão)
gh run watch $(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

## Repositório público: o que não vaza

- Nenhum segredo nos workflows nem nos logs. A chave SSH e o `known_hosts` ficam no ambiente `producao` (o GitHub
  mascara os valores no log). O token do GHCR é o do job e chega à VPS pelo stdin.
- O smoke test imprime só nome, nível e detalhe de cada checagem. A checagem do painel de Operação confere que nenhum
  segredo aparece na resposta, e não imprime o valor.
- As imagens não levam `.env`: o `.dockerignore` exclui `**/.env*` (só fica o `.env.example`), e os segredos entram
  pelo `.env` da VPS em tempo de execução. Para conferir uma imagem:
  `docker run --rm --entrypoint sh <imagem> -c 'find / -name ".env*" -not -path "/proc/*" 2>/dev/null'` (só pode
  aparecer `.env.example`).
- `pull_request` de fork não recebe secret. O `deploy.yml` só age em `workflow_run` de push na main do próprio
  repositório, e os secrets ficam num ambiente restrito à `main`.

## A fila de merge nativa e a conta do repositório

**A fila de merge do GitHub só existe em repositório de organização.** Hoje o `galaxie-works` é conta pessoal (User).
Os workflows já aceitam `merge_group` e o portão do Codex já funciona na fila, então ela pode ser ligada assim que o
repositório estiver numa organização. Até lá, há duas saídas:

| Caminho | Como | Prós | Contras |
| --- | --- | --- | --- |
| **A. Organização + fila nativa** | Criar uma organização (plano Free) e transferir o repositório | Fila com lotes: vários PRs testados juntos, CI uma vez por lote; nada roda fora do GitHub | Pacotes do GHCR passam a `ghcr.io/<org>/…` (nota abaixo; o deploy grava o `IMAGE_PREFIX` novo no `.env` da VPS); reinstalar o Codex e o Dependabot na organização; URLs antigas redirecionam |
| **B. Trem de merge no Actions** | `merge-train.yml` com um token fino em `MERGE_TRAIN_TOKEN` | Nada muda de conta; mesma regra de hoje, sem a máquina de dev | Continua sequencial (CI completo por PR); um token pessoal guardado como secret |

Os dois combinam com o deploy automático: o merge vira push na main, e o deploy vem depois.

> Na troca para organização, os nomes `ghcr.io/galaxie-works/…` nos workflows e no `deploy-gh.sh` precisam virar o da
> organização (há uma ocorrência por arquivo, em `IMAGE`/`REG`); o `env.example` e o `.env` da VPS também. Fazer
> isso num PR próprio, junto da transferência.

## Proteção da main

Checks obrigatórios (nomes exatos dos jobs; app do GitHub Actions, id 15368):

- `checks (Postgres 17, Valkey 8)` e `checks (Postgres 18, Valkey 9)`
- `Segredos (gitleaks)`
- `build api`, `build ingestor`, `build demo`, `build backup`, `build prometheus`, `build grafana`, `build caddy`,
  `build lineup-render`
- `valida stack, alertas e scripts`
- `backup e restore ponta a ponta (Postgres 17)` e `backup e restore ponta a ponta (Postgres 18)`
- `Codex sem P1 aberto`

A auditoria de dependências fica de fora (é informativa).

**Caminho B (conta pessoal, trem de merge)**, por API:

```bash
gh api -X PUT repos/galaxie-works/galaxie-sports/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "checks (Postgres 17, Valkey 8)", "app_id": 15368 },
      { "context": "checks (Postgres 18, Valkey 9)", "app_id": 15368 },
      { "context": "Segredos (gitleaks)", "app_id": 15368 },
      { "context": "build api", "app_id": 15368 },
      { "context": "build ingestor", "app_id": 15368 },
      { "context": "build demo", "app_id": 15368 },
      { "context": "build backup", "app_id": 15368 },
      { "context": "build prometheus", "app_id": 15368 },
      { "context": "build grafana", "app_id": 15368 },
      { "context": "build caddy", "app_id": 15368 },
      { "context": "build lineup-render", "app_id": 15368 },
      { "context": "valida stack, alertas e scripts", "app_id": 15368 },
      { "context": "backup e restore ponta a ponta (Postgres 17)", "app_id": 15368 },
      { "context": "backup e restore ponta a ponta (Postgres 18)", "app_id": 15368 },
      { "context": "Codex sem P1 aberto", "app_id": 15368 }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

- `strict: true` (branch atualizada com a main) é o que o trem já garante com o `update-branch`.
- `enforce_admins: false` deixa o dono passar por cima numa emergência (plano B).
- Para desfazer: `gh api -X DELETE repos/galaxie-works/galaxie-sports/branches/main/protection`.

**Caminho A (organização)**, em Settings → Rules → Rulesets → New branch ruleset, alvo `main`:

- Require a pull request before merging (0 aprovações).
- Require status checks to pass, com a lista acima. Sem "Require branches to be up to date": a fila já testa contra a
  main.
- Require merge queue:
  - Merge method: Squash.
  - Build concurrency: 5.
  - Group size: mínimo 1, máximo 5; wait time: 2 min.
  - "Only merge non-failing pull requests".
  - Status check timeout: 60 min.
- Block force pushes; Restrict deletions.

Com a fila ligada, o merge vira `gh pr merge <n> --squash` (entra na fila; com check pendente, `--auto`).

## Configurações a ligar (passo a passo)

Cada item precisa do OK do dono. Estado em 2026-10-26:

- Feitos com o OK do Wagner:
  - passos 2 a 4: chave `gha-deploy-galaxie-sports` com `restrict` no `authorized_keys` da VPS, impressão digital do
    host conferida, ambiente `producao` restrito à `main`, secrets gravados;
  - passo 5: pacotes mantidos privados.
- Escolhido o caminho B (trem no Actions); o token é do dono.
- Faltam os passos 1, 6, 7, 8 e 9.

1. **Mergear este PR.** Nada muda no deploy: sem `DEPLOY_AUTO=on` o deploy automático não roda, e o
   `deploy-safe.sh` continua valendo (agora com o `post-deploy.sh`). As imagens passam a sair também com as tags `main`
   e `in-<hash>`.
2. **Chave SSH só do deploy** (na máquina de dev; a privada não passa por chat nem por log):

   ```bash
   ssh-keygen -t ed25519 -N '' -C gha-deploy-galaxie-sports -f ~/.ssh/galaxie_gha_deploy
   # na VPS, uma linha nova no authorized_keys do root, com "restrict" (sem túnel, sem pty, sem agent forwarding):
   { printf 'restrict '; cat ~/.ssh/galaxie_gha_deploy.pub; } | ssh root@145.223.94.149 'cat >> ~/.ssh/authorized_keys'
   ssh -i ~/.ssh/galaxie_gha_deploy root@145.223.94.149 'cd /docker/galaxie-sports && docker compose ps -q | wc -l'
   ```

3. **known_hosts da VPS**: conferir que a impressão digital do `ssh-keyscan` bate com a que a própria VPS mostra:

   ```bash
   ssh-keyscan -t ed25519 145.223.94.149 2>/dev/null > /tmp/vps_known_hosts
   ssh-keygen -lf /tmp/vps_known_hosts
   ssh root@145.223.94.149 'ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub'   # o mesmo SHA256:…
   ```

4. **Ambiente `producao` e os secrets** (o ambiente nasce no primeiro uso; aqui ele é restrito à `main`):

   ```bash
   gh api -X PUT repos/galaxie-works/galaxie-sports/environments/producao \
     -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/galaxie-works/galaxie-sports/environments/producao/deployment-branch-policies -f name=main
   gh secret set VPS_SSH_KEY --env producao < ~/.ssh/galaxie_gha_deploy
   gh secret set VPS_KNOWN_HOSTS --env producao < /tmp/vps_known_hosts
   ```

5. **Pacotes do GHCR.** Os pacotes seguem privados. O deploy lê com o token do job, e o repositório já tem acesso
   porque é ele quem publica. Conferir em github.com → Packages → `galaxie-sports-api` → Package settings → "Manage
   Actions access": o repositório `galaxie-sports` precisa aparecer (o mesmo vale para os outros seis pacotes).
6. **Primeiro deploy à mão**, com o plano B parado (nenhum `deploy-safe.sh` rodando):

   ```bash
   gh workflow run deploy.yml -f force=1    # publica de novo o SHA atual: exercita pull, up, smoke e release
   ```

   Conferir no resumo do job: `PASS … no ar`, o smoke ("N ok · … · 0 falha(s)") e a release. Uma falha aqui volta
   sozinha para o SHA anterior (ou imprime o rollback manual).
7. **Ligar o deploy automático**: `gh variable set DEPLOY_AUTO --body on`. Desligar (volta ao plano B):
   `gh variable delete DEPLOY_AUTO`.
8. **Merge**: escolher o caminho A ou B (seção acima).
   - Caminho B: criar o token fino (Settings → Developer settings → Fine-grained tokens), só deste repositório, com
     Contents e Pull requests em escrita e Checks e Actions em leitura, e validade de 90 dias. Depois:
     `gh secret set MERGE_TRAIN_TOKEN`. Uso: `gh workflow run merge-train.yml -f prs="301 302"`.
   - Caminho A: transferência e ruleset com fila.
9. **Proteção da main** (seção acima), depois que o `Codex sem P1 aberto` já tiver rodado em algum PR. O GitHub só
   oferece na lista os checks que já viu.
10. **Aposentar a máquina de dev** no fluxo normal: o `deploy-safe.sh` fica para emergência, e o Docker Desktop só
    abre no plano B.

## Plano B (contingência)

Use quando o Actions, o GHCR ou o SSH do runner estiverem fora, ou quando o deploy pelo Actions falhar de um jeito que
não dá para corrigir na hora.

1. `gh variable delete DEPLOY_AUTO`, para nenhum deploy automático disputar a trava.
2. Da máquina de dev, no checkout principal na `main`:

   ```bash
   infra/ops/merge-train.sh 301 302 && infra/ops/deploy-safe.sh r302
   ```

   O `deploy.sh` constrói local, envia por `docker save | ssh` e usa a mesma trava e o mesmo `post-deploy.sh`. Com a
   VPS presa num deploy morto do Actions, a trava com mais de 90 min é tomada sozinha; antes disso:
   `ssh root@145.223.94.149 'cat /docker/galaxie-sports/.deploy.lock/owner'` diz de quem é, e
   `rm -rf /docker/galaxie-sports/.deploy.lock` libera.
3. Voltando o Actions: `gh variable set DEPLOY_AUTO --body on`.

A credencial temporária do GHCR fica em `/docker/galaxie-sports/.ghcr-<run>` e sai no fim de cada deploy (o token já
expirou com o job). Se sobrar um diretório desses de um job morto, pode apagar.

## Tempos esperados

- **Deploy**: hoje são ~40 min, com build local e envio de ~1 GB pela rede de casa. Pelo Actions, o pull de camadas
  novas na VPS leva poucos minutos, e o roteiro inteiro, ~10 min.
- **Imagens**: um PR que não mexe na entrada das imagens (docs, infra fora das pastas delas) só reaproveita.
- **Merge**:
  - Com a fila nativa, os PRs são testados em lote.
  - Com o trem, continua um CI por PR, mas sem a máquina de dev, e o deploy não espera o trem acabar.
