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
Deploy (deploy.yml): trava na VPS → pull do GHCR → plano (quem mudou) → migrate → troca só da lista → pós-deploy → smoke → confere as versões
        │                                   └─ falhou um serviço → volta só ele; mais de um, sem migration nova → SHA anterior
        ▼
notas de versão (tag deploy-AAAA-MM-DD.N)
```

| Peça | Arquivo | O que faz |
| --- | --- | --- |
| Imagens | `.github/workflows/docker.yml` | Em PR, na fila (`merge_group`) e no push na main. Publica `api`, `ingestor`, `demo`, `backup`, `prometheus` e `grafana` na fila (tag `<sha>`) e no push (`<sha>`, `main`, `staging`). Cada imagem tem o hash da sua entrada (tag `in-<hash>`, calculada por `infra/ops/image-hash.sh`): entrada igual à de uma imagem já publicada → só ganha as tags novas, sem build. Cache de camadas do GHA (a fila lê o da main e não grava). |
| CI | `.github/workflows/ci.yml` | Em PR, build, typecheck e testes só dos pacotes afetados (`turbo --affected`); na fila (`merge_group`) e no push na main, tudo: o deploy só publica um SHA com o CI completo. |
| Portão do Codex | `.github/workflows/codex-gate.yml` + `infra/ops/codex-gate.sh` | Check `Codex sem P1 aberto`: falha com thread do Codex com "P1 Badge" sem resolver (a regra do `codex_p1()` do trem). Pronto na hora quando o review terminado é do commit atual do PR. Senão espera até 10 min de PR aberto e 3 min depois do último commit, e espera também o review que estiver rodando (👀). Sem review do commit atual no fim da espera, o Codex não vai revisar sozinho (só revisa ao abrir, ao sair de rascunho ou com `@codex review`): confere as threads que existem e avisa; com `CODEX_REQUIRE_CURRENT=1`, falha. Review que terminou sem revisar (resumo com `status: failed`, como no limite de uso do Codex) não espera: avisa e confere as threads. Review que continua rodando 10 min depois da espera (Codex travado ou sem cota), ou que roda num commit anterior ao atual (o resumo diz o commit), também: avisa e confere as threads. P1 aberto barra sempre, e o review que terminar depois dispara o check de novo. Teste em `infra/ops/codex-gate.test.sh`. |
| Deploy | `.github/workflows/deploy.yml` + `infra/vps-telemetry/deploy-gh.sh` e `deploy-plan.sh` | Dispara quando CI e Imagens terminam verdes na ponta da main (com `DEPLOY_AUTO=on`) ou à mão. Um por vez (`concurrency`); com vários merges seguidos, sai um deploy só, do último commit. Troca só os serviços cuja imagem ou configuração mudou. |
| Pós-deploy | `infra/vps-telemetry/post-deploy.sh` | Seed semântico (`--dir /srv/data/knowledge`, com o `GIT_SHA` do deploy; falha só avisa), nomes, importância, cache e conta da IA; o mesmo nos dois roteiros. |
| Trem de merge | `.github/workflows/merge-train.yml` | O `merge-train.sh` rodando no Actions, enquanto não houver fila nativa. |

### Imagens reaproveitadas

O hash é o `sha256` do `git ls-tree HEAD` da entrada da imagem (`infra/ops/image-hash.sh`, a mesma fórmula no
`docker.yml` e no deploy), e vai na tag `in-<hash>` e no rótulo `works.galaxie.context-tree`. Entrada igual à de uma
imagem publicada: ela só ganha as tags do commit, sem build (log `entrada <hash>: <imagem>` no passo "Entrada da imagem",
que também lista os caminhos).

As imagens de pasta única (`backup`, `prometheus`, `grafana`) usam o hash git da própria pasta. A entrada de
`api`, `ingestor` e `demo` sai do grafo do pnpm, em `infra/ops/image-inputs.mjs`:

- as pastas dos pacotes do workspace no fechamento de dependências do app, com as `devDependencies`, porque o
  `pnpm --filter "@galaxie/<app>..."` do Dockerfile as compila. O ingestor soma o fechamento de `@galaxie/ai-agents`, que
  o Dockerfile dele também constrói;
- o que o Dockerfile copia de fora do grafo: `config`, `data/knowledge` e `infra/healthcheck/selfheal.mjs` em `api` e
  `ingestor`; `config/broadcasters`, `config/broadcast-rights` e o mesmo `selfheal.mjs` na `demo`;
- os arquivos da raiz: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`,
  `.nvmrc` e `.dockerignore`.

| Mudou | Imagens que mudam |
| --- | --- |
| `apps/demo` ou `packages/widgets` | `demo` |
| `apps/api` | `api` |
| `services/ai-agents` | `ingestor` |
| `services/ingestor` | `ingestor` (a API não depende dele: os testes que cruzam os dois ficam em `tests/integration`, fora das imagens) |
| `config/` em geral, `data/knowledge` | `api` e `ingestor` |
| `config/broadcasters`, `config/broadcast-rights` | as três |
| `packages/db`, `pnpm-lock.yaml`, `infra/healthcheck/selfheal.mjs` | as três |

**Mudança em `config/` continua reconstruindo `api` e `ingestor`, de propósito:** o `config/` inteiro vai dentro dessas
duas imagens. Não é reconstrução à toa, é conteúdo novo na imagem.

Para saber o que um conjunto de caminhos muda, sem rodar o workflow:

```bash
node infra/ops/image-inputs.mjs --changed config/assets/denylist.yaml apps/demo/src/app/page.tsx
```

Dockerfile que passar a copiar algo novo de fora do grafo, ou a construir outro pacote, tem de entrar na lista do script:
o teste `infra/ops/image-inputs.test.mjs`, no job `stack` do `docker.yml`, compara a lista com os Dockerfiles e reprova
o que faltar.

### O deploy pelo Actions

0. **Gate**: o commit precisa estar na `main`, com o CI e as imagens dele verdes.
   - No **automático** (`workflow_run`), workflow ainda rodando só adia: quando ele terminar, dispara o deploy de novo.
     Um commit que já não é a ponta da `main` é pulado, porque o deploy do commit mais novo cobre os dois.
   - No **disparo manual**, o gate espera os workflows terminarem, até `ci_wait_min` minutos (padrão 30, no máximo
     60). Se não terminarem, ou terminarem sem sucesso, o job **falha** com o motivo (`skip_ci_check=1` pula essa
     conferência, só em emergência). O disparo manual nunca termina verde sem publicar.
   - Jogo ao vivo **não** segura o deploy: a espera por jogo de prioridade alta (28/10/2026) saiu em 02/11/2026, porque
     com merges em sequência cada commit novo reiniciava a espera e nada publicava.
1. Confere no GHCR as imagens do SHA, com as tags `<sha>` e `in-<hash>` (antes de tocar a VPS).
2. Pega a trava da VPS (`/docker/galaxie-sports/.deploy.lock`). É a mesma do `deploy.sh`, então Actions e plano B
   nunca rodam juntos.
3. SHA já no ar:
   - com `force=1`, publica de novo (pull, migrate, pós-deploy, smoke e notas de versão; contêiner com a imagem e a
     configuração certas não é recriado);
   - sem `force`, o automático só pula (o CI e as imagens disparam o deploy duas vezes no mesmo commit), e o disparo
     manual **falha** dizendo para usar `force=1`.
4. Faz login no GHCR na VPS com o token do próprio job, num `DOCKER_CONFIG` temporário. O token vai pelo stdin e o
   diretório sai no fim; o token expira com o job. A VPS não guarda credencial do GitHub.
5. Valida o `compose.yml` do SHA e o `.env` com as tags novas. O `docker compose pull` baixa só os serviços com imagem
   nossa; postgres, valkey e rustfs ficam na imagem que já está na VPS.
6. **Plano** (`deploy-plan.sh`): compara, serviço a serviço, o digest da imagem `in-<hash>` com o da imagem do contêiner
   no ar, e o hash da configuração do compose com o rótulo do contêiner. Só os diferentes trocam. O log (e o resumo do
   job) diz: `plano: api: troca (in-abc1234 → in-def5678) · ingestor: igual, fica · agents: troca (config mudou) · …`.
7. Migration nova: dump do banco. `migrate` com saída 0 **antes de qualquer troca**, só se a imagem ou a configuração
   dele mudou, se há migration nova ou com `force=1`. Com a API ou a demo na lista, o **smoke roda na versão nova antes
   da troca**, num candidato sem tráfego; reprovado, nada troca
   ([README da stack › Candidato e troca sem manutenção](../../infra/vps-telemetry/README.md)).
8. Backup do `compose.yml` e do `.env` (os mesmos `.bak-<sha>`) e troca dos dois. **Lista vazia** (docs, workflow,
   comentário no compose): termina aqui, verde e sem alarme, como `SKIP nada a publicar`, sem pós-deploy, sem smoke, sem
   notas de versão. Senão, troca só a lista, sempre com `--no-deps`, nesta ordem:
   - `live` (o ao vivo, #535), sozinho e antes do resto, cópia a cópia (`rolling-swap.sh`, #537): para cada cópia
     antiga, a líder primeiro, sobe uma nova, espera ela ficar healthy, para a antiga e espera outra cópia pegar a
     liderança. Só troca quando a imagem do ingestor (ou a configuração dele) muda;
   - `ingestor` e `agents`, por recriação simples (a escala atual do ingestor continua; escala 0 fica como está, e o
     `live` também). `live`, `ingestor`, `agents` e `worker` são da mesma tag: falhou um, voltam todos. Voltando para
     uma versão sem o `live`, ele sai depois de o ingestor dela subir;
   - `worker` (a fila de tarefas; mesma imagem e o mesmo grupo do ingestor, logo depois dele), lado a lado: o novo sobe
     e fica healthy, e o antigo **drena** (`rolling-swap.sh` espera o `/health` dizer `idle` ou 75 s): o lote em
     andamento fecha e a tarefa volta à fila, onde o novo a retoma do checkpoint
     ([tarefas › O worker](tarefas.md#o-worker));
   - `api`, `webhooks` e `demo` lado a lado, sem página de manutenção (`rolling-swap.sh`: o antigo só sai com o novo
     healthy). O worker dos webhooks fecha a entrega em andamento no SIGTERM, e o novo retoma pelo cursor;
   - o que não tem imagem nossa, quando mudou (a página de manutenção, por exemplo).
9. Pós-deploy (sem a limpeza do cache quando API, webhooks, live, ingestor e agents ficaram) e smoke test (o "N ok · avisos ·
   falhas", que também confere a versão da API e da demo). Por último, a **conferência**
   (`deploy-verify.sh`): para cada serviço trocado, o digest e o rótulo da imagem do contêiner, e o que o processo expõe.
   Serviço na versão errada é `FAIL  <serviço>: …` no resumo do job, e volta só ele.
   - O pós-deploy começa pelo **seed da base semântica** (`data/knowledge` → `semantic.*`, exigido pelo #362).
   - Roda com o `data/knowledge` da imagem nova, `--dir /srv/data/knowledge` e o SHA no `semantic.load_run`.
   - Roda em todo deploy, não só quando `data/knowledge` muda: é ele que liga os perfis aos participantes que a
     ingestão trouxe desde o último.
   - É idempotente, sem cota nem LLM, e a falha vira `WARN` sem derrubar o deploy. Para repetir à mão:
     `docker compose run --rm --no-deps ingestor node /srv/services/ingestor/node_modules/@galaxie/knowledge/dist/cli/seed-semantic.js --dir /srv/data/knowledge`.
10. Falha, do menor para o maior:
    - **Migrate**: nada foi trocado; a versão anterior segue no ar.
    - **Um serviço não troca**: volta só ele (e os da mesma tag), com a tag e a configuração anteriores. Os outros ficam
      na versão nova, o deploy segue até o smoke e o job fica vermelho, com `FAIL  deploy parcial …`. O `DEPLOY_SHA`
      fica o anterior, então o deploy seguinte, mesmo do mesmo SHA, compara e tenta de novo.
    - **Pós-deploy ou smoke vermelhos com um grupo trocado**: volta esse grupo.
    - **Mais de um serviço falhou, ou pós-deploy ou smoke com mais de um grupo trocado**: volta a stack inteira para o
      SHA anterior quando é garantidamente o estado de antes (nenhuma migration nova, backups na VPS; imagem que falta
      vem do GHCR). Depois roda o seed semântico com a base da versão anterior e limpa o cache de novo. Com migration
      nova, imprime o rollback manual, porque o código antigo pode não aguentar o schema novo.
11. lineup-render: baixa a imagem da versão do Playwright quando a pasta mudou (nunca falha o deploy).
12. Publica as notas de versão (`release-notes.mjs`), só quando publicou: a seção "Serviços publicados" (cada imagem com os
    serviços que a rodam, a tag anterior → nova e "trocada" ou "sem troca") e, no fim, um marcador `galaxie-versions` com as
    tags inteiras, de onde a release seguinte lê a tag anterior e o alerta `ProducaoAtrasada` lê a do ingestor.

### A versão que cada serviço roda

O que identifica a versão é o hash da entrada da imagem (`in-<hash>`), não o SHA: a imagem é reaproveitada entre commits,
então ela não pode conter o SHA. O `docker.yml` passa `IMAGE_HASH` como build-arg e a imagem guarda em `GALAXIE_IMAGE_HASH`.
Para saber qual SHA está no ar, veja o `DEPLOY_SHA` do `.env` ou as notas de versão.

| Serviço | Onde ler |
| --- | --- |
| `api` | `GET /version` (público) e `build_info` no `/metrics` |
| `demo` | `GET /api/version` (público) |
| `webhooks`, `worker` | `/version` e `/metrics` na 8080 da rede da stack, sem router |
| `live`, `ingestor`, `agents` | `/version` e `/metrics` na 9464 da rede da stack, sem router |
| `backup`, `prometheus`, `grafana` | rótulo `works.galaxie.context-tree` da imagem |

O formato é `{ service, image_hash, started_at, node }`, e cada processo escreve o mesmo numa linha de log na partida. O
Prometheus raspa `api`, `webhooks`, `ingestor`, `agents`, `worker` e cada cópia do `live` (pelo DNS do Docker), e o painel **SLOs** do Grafana tem a tabela "Versão no ar por
serviço". A demo não é raspada: não tem `/metrics`.

```bash
curl -s https://api.sports.galaxie.works/version
cd /docker/galaxie-sports && docker compose exec -T ingestor node -e "fetch('http://127.0.0.1:9464/version').then(r=>r.text()).then(console.log)"
```

### As tags no `.env` da VPS

Uma variável por imagem, sempre o `in-<hash>` da entrada dela no SHA publicado:

| Variável | Serviços |
| --- | --- |
| `TAG_API` | `api`, `webhooks`, `migrate`, `api-candidate` |
| `TAG_DEMO` | `demo`, `demo-candidate` |
| `TAG_INGESTOR` | `live`, `ingestor`, `agents`, `worker` |
| `TAG_BACKUP` | `backup` (projeto `dados`; só por runbook) |
| `TAG_PROMETHEUS` | `prometheus` (projeto `obs`) |
| `TAG_GRAFANA` | `grafana` (projeto `obs`) |

`DEPLOY_SHA` (e `DEPLOY_SHA_OBS`, no deploy de obs) é só o registro do SHA publicado (notas de versão, volta de versão). **Não pode entrar no env de nenhum
serviço:** env novo recria o contêiner e desfaz o ganho. Duas leituras úteis na VPS:

```bash
grep -E '^(TAG_|DEPLOY_SHA=)' /docker/galaxie-sports/.env
# a imagem de cada contêiner (o digest é o que o plano compara, não a tag)
cd /docker/galaxie-sports && docker compose ps -a --format '{{.Service}}: {{.Image}}'
```

Para saber a tag de uma imagem em um SHA, no checkout dele: `bash infra/ops/image-hash.sh demo`.

Um contêiner pode seguir com uma tag antiga no `docker compose ps`, diferente da do `.env`, com o mesmo digest (entrada
mudou, imagem saiu igual; ou contêiner que passou pela transição de `IMAGE_TAG`). É normal, e o plano o dá por igual.
Um `docker compose up -d` à mão, sem nome de serviço, recriaria esse contêiner: prefira nomear o serviço.

### Voltar um serviço só

O `.env.bak-<sha7>` e o `compose.yml.bak-<sha7>` são os do deploy anterior ao `<sha7>`. Para voltar a demo, sem tocar nos
outros:

```bash
cd /docker/galaxie-sports
grep '^TAG_DEMO=' .env.bak-<sha7>                                  # a tag anterior
sed -i 's|^TAG_DEMO=.*|TAG_DEMO=in-<hash anterior>|' .env
PULL_POLICY=missing docker compose up -d --no-deps demo
```

`api`, `webhooks`, `demo` e `worker` também voltam sem manutenção (o worker drenando), da máquina de dev, depois de
editar o `.env`:
`ssh root@145.223.94.149 'cd /docker/galaxie-sports && bash -s -- demo' < infra/vps-telemetry/rolling-swap.sh`. Os outros
sobem com `docker compose up -d --no-deps <serviço>` (`ingestor` com `--scale ingestor=<escala atual>`). Imagem que a poda
já tirou da VPS (ficam a no ar e as 3 anteriores de cada imagem) precisa de `docker login ghcr.io` antes. O deploy seguinte
compara de novo: se o SHA dele ainda pedir a imagem nova, ele troca.

### Voltar para um SHA antigo

`gh workflow run deploy.yml -f sha=<sha> -f force=1` continua valendo para um SHA anterior aos três projetos (a tag `<sha>`
existe para todo commit). O compose dele tem o Postgres e os outros dados, e subir isso daria dois Postgres no mesmo volume:
o deploy publica as **imagens** do SHA com o `compose.yml` de apps deste checkout, e o smoke do SHA. Um SHA anterior ao
`/health` do worker deixa os webhooks como estão (com `WARN`).

### Dados e observabilidade

O deploy automático só conhece o `compose.yml` de apps. `gh workflow run deploy.yml -f project=obs` publica Prometheus e
Grafana. Dados, só por runbook: [Dados e observabilidade](stack-dados-e-observabilidade.md). VPS ainda num projeto só: o deploy
recusa ([transição](stack-em-tres-projetos.md)).

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
- `build api`, `build ingestor`, `build demo`, `build backup`, `build prometheus`, `build grafana`,
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
- **Imagens**: um PR que não mexe na entrada de uma imagem só reaproveita essa imagem (ver
  [Imagens reaproveitadas](#imagens-reaproveitadas)).
- **Merge**:
  - Com a fila nativa, os PRs são testados em lote.
  - Com o trem, continua um CI por PR, mas sem a máquina de dev, e o deploy não espera o trem acabar.
