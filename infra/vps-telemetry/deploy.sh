#!/usr/bin/env bash
# Publica a main na VPS com o mesmo roteiro de sempre — e termina com o smoke test, para nada que
# funciona local ficar quebrado em silêncio na produção.
#
#   infra/vps-telemetry/deploy.sh                 # constrói api/ingestor/demo do origin/main e publica
#   infra/vps-telemetry/deploy.sh <sha>           # um commit específico
#   SKIP_BUILD=1 infra/vps-telemetry/deploy.sh    # reaproveita imagens já construídas para o SHA
#   SKIP_CI_CHECK=1 infra/vps-telemetry/deploy.sh # publica sem conferir o CI do SHA (emergência)
#
# Passos:
#   1. CI do SHA (check-runs do GitHub Actions, via gh): vermelho → para antes de tudo; ainda rodando → espera até
#      CI_WAIT_MIN minutos (padrão 20), depois do build
#   2. worktree temporária no SHA → docker build de api, ingestor e demo (tag = SHA); backup, prometheus e grafana
#      levam no rótulo o hash git da própria pasta: a VPS já tem a imagem com esse hash → só ganha a tag do SHA;
#      senão é construída aqui e vai junto
#   3. trava na VPS ($DIR/.deploy.lock): um deploy por vez, de qualquer máquina, até o fim do script
#   4. docker save | ssh docker load
#   5. compose.yml do SHA e IMAGE_TAG no .env, validados antes de trocar (com backup dos dois)
#   6. docker compose up -d (ingestor continua com a escala atual; PULL_POLICY=missing: nada vem do registry)
#      → o migrate tem de sair com 0. Falha aqui → volta compose.yml/.env anteriores, sobe de novo e sai com 1
#   7. pós-deploy idempotente: seed da base semântica, nomes curados de estádios e importância
#   8. limpa o cache de respostas da API (senão a versão anterior segue servida por até 24 h)
#   9. smoke test (infra/vps-telemetry/smoke.mjs); falha → código de saída 1
#  10. notas de versão: tag deploy-AAAA-MM-DD.N e release no GitHub com os PRs desde o deploy anterior
# Falha depois do passo 6 deixa a versão nova no ar e imprime o comando para voltar à anterior.
set -euo pipefail

VPS="${VPS:-root@145.223.94.149}"
DIR="${VPS_DIR:-/docker/galaxie-sports}"
REG="ghcr.io/galaxie-works/galaxie-sports"
ROOT="$(git rev-parse --show-toplevel)"
LOCK="$DIR/.deploy.lock"
CI_WAIT_MIN="${CI_WAIT_MIN:-20}"
TREE_LABEL="works.galaxie.context-tree"
# comandos do compose na VPS: as imagens chegam por docker load; o registry nunca é consultado
CD="cd $DIR && export PULL_POLICY=missing"

# conexão morta (queda do SSH no meio do envio das imagens) vira erro em ~2 min, em vez de travar o deploy
ssh() { command ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=4 "$@"; }

git -C "$ROOT" fetch -q origin
SHA="$(git -C "$ROOT" rev-parse "${1:-origin/main}")"
echo "deploy ${SHA:0:7}"

# ── saída: libera a trava, remove a worktree e, se parou com a versão nova no ar, diz como voltar ──────────────
STAGE=start # start → up (compose.yml/.env trocados, stack na versão nova) → finished; restored = já tratado
WT=""
OLD=""
SCALE=""
LOCKED=""
LOCK_ID="$(hostname 2>/dev/null || echo dev)-$$-$(date +%s)"

rollback_help() {
  local o="${OLD:0:7}"
  echo "      voltar para ${o}: ssh $VPS '$CD && cp compose.yml.bak-$o compose.yml && cp .env.bak-$o .env && docker compose up -d --scale ingestor=${SCALE:-1}'"
  echo "      conferir: ssh $VPS 'cd $DIR && docker compose ps -a && docker compose logs --tail 50 migrate api'"
}

on_exit() {
  local code=$?
  if [ "$code" -ne 0 ] && [ "$STAGE" = up ]; then
    echo "FAIL  deploy parou no meio (código $code): a ${SHA:0:7} está no ar, sem o resto do roteiro"
    rollback_help
  fi
  if [ -n "$LOCKED" ]; then
    ssh -o ConnectTimeout=20 "$VPS" \
      "if [ \"\$(cut -d' ' -f1 $LOCK/owner 2>/dev/null)\" = '$LOCK_ID' ]; then rm -rf $LOCK; fi" ||
      echo "WARN  trava da VPS não liberada; libere com: ssh $VPS 'rm -rf $LOCK'"
  fi
  if [ -n "$WT" ]; then git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true; fi
}
trap on_exit EXIT

# ── CI do SHA ───────────────────────────────────────────────────────────────────────────────────────────────
# check-runs do GitHub Actions no commit → "pass", "pending <n>", "fail <nomes>" ou "erro" (gh sem acesso)
ci_state() {
  local runs
  runs="$(cd "$ROOT" && gh api --paginate "repos/{owner}/{repo}/commits/$SHA/check-runs?per_page=100" \
    --jq '.check_runs[] | select(.app.slug == "github-actions") | [.status, (.conclusion // ""), .name] | @tsv' \
    2>/dev/null)" || {
    echo erro
    return 0
  }
  printf '%s\n' "$runs" | awk -F'\t' '
    NF < 3 { next }
    { total++ }
    $1 != "completed" { pending++; next }
    $2 != "success" && $2 != "skipped" && $2 != "neutral" { bad = bad (bad ? ", " : "") $3 " (" $2 ")" }
    END {
      if (bad) print "fail " bad
      else if (pending || !total) print "pending " pending + 0
      else print "pass"
    }'
}

# $1 = minutos de espera pelo que ainda roda; 0 = só barra o CI vermelho
ci_gate() {
  local wait_min="$1" deadline state
  if [ -n "${SKIP_CI_CHECK:-}" ]; then
    [ "$wait_min" = 0 ] || echo "WARN  CI: conferência pulada (SKIP_CI_CHECK)"
    return 0
  fi
  deadline=$(($(date +%s) + wait_min * 60))
  while :; do
    state="$(ci_state)"
    case "$state" in
      pass)
        echo "CI ok em ${SHA:0:7}"
        return 0
        ;;
      fail*)
        echo "FAIL  CI vermelho em ${SHA:0:7}: ${state#fail }"
        exit 1
        ;;
      erro)
        echo "FAIL  CI: não deu para ler os checks de ${SHA:0:7} no GitHub (gh instalado e autenticado?);" \
          "SKIP_CI_CHECK=1 publica sem conferir"
        exit 1
        ;;
    esac
    [ "$wait_min" != 0 ] || return 0
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "FAIL  CI ainda rodando em ${SHA:0:7} (${state#pending } check(s) pendentes) depois de $wait_min min;" \
        "rode de novo quando terminar"
      exit 1
    fi
    sleep 30
  done
}
ci_gate 0

# ── build ───────────────────────────────────────────────────────────────────────────────────────────────────
WT="$(mktemp -d)/galaxie-deploy"
git -C "$ROOT" worktree add -q --detach "$WT" "$SHA"

if [ -z "${SKIP_BUILD:-}" ]; then
  for spec in api:apps/api ingestor:services/ingestor demo:apps/demo; do
    name="${spec%%:*}"
    echo "build $name"
    docker build -q -f "$WT/${spec#*:}/Dockerfile" -t "$REG-$name:$SHA" "$WT" >/dev/null
  done
fi

# backup, prometheus e grafana: contexto do build é a própria pasta, cujo hash git vai no rótulo da imagem
IMAGES=("$REG-api:$SHA" "$REG-ingestor:$SHA" "$REG-demo:$SHA")
RETAG="true"
for spec in backup:infra/backup prometheus:infra/observability/prometheus grafana:infra/observability/grafana; do
  name="${spec%%:*}"
  ctx="${spec#*:}"
  tree="$(git -C "$WT" rev-parse "HEAD:$ctx")"
  have="$(ssh "$VPS" "docker images -q --filter label=$TREE_LABEL=$tree $REG-$name | head -n 1")"
  if [ -n "$have" ]; then
    RETAG="$RETAG && docker tag $have $REG-$name:$SHA"
    continue
  fi
  if [ -z "${SKIP_BUILD:-}" ] || ! docker image inspect "$REG-$name:$SHA" >/dev/null 2>&1; then
    echo "build $name (a VPS não tem imagem desta versão da pasta)"
    docker build -q --label "$TREE_LABEL=$tree" -t "$REG-$name:$SHA" "$WT/$ctx" >/dev/null
  fi
  IMAGES+=("$REG-$name:$SHA")
done

ci_gate "$CI_WAIT_MIN"

# ── trava na VPS ────────────────────────────────────────────────────────────────────────────────────────────
# Dois deploys (de máquinas diferentes) leriam o mesmo IMAGE_TAG anterior, disputariam compose.yml.new, o .env e o
# compose up, e calculariam a mesma tag da release. mkdir é atômico; o dono fica em owner e a trava sai no fim
# (trap EXIT, que também roda quando o deploy-safe.sh mata o deploy pelo teto de tempo).
lock="$(ssh "$VPS" "if mkdir $LOCK 2>/dev/null; then echo '$LOCK_ID ${SHA:0:7} $(date -u +%FT%TZ)' > $LOCK/owner && echo ok; \
  else cat $LOCK/owner 2>/dev/null || echo '(sem dono)'; fi")"
if [ "$lock" != ok ]; then
  echo "FAIL  outro deploy em andamento na VPS: $lock"
  echo "      espere ele terminar. Se ele morreu: confira ssh $VPS 'cd $DIR && docker compose ps -a' e libere com ssh $VPS 'rm -rf $LOCK'"
  exit 1
fi
LOCKED=1

OLD="$(ssh "$VPS" "grep -E '^IMAGE_TAG=' $DIR/.env | cut -d= -f2")"
echo "na VPS: ${OLD:0:7} → ${SHA:0:7}"

echo "enviando imagens"
docker save "${IMAGES[@]}" | gzip -1 | ssh "$VPS" 'gunzip | docker load' >/dev/null
ssh "$VPS" "$RETAG"

# compose.yml e .env novos validados juntos antes de trocar: config inválido para aqui, com a stack intocada
scp -q "$WT/infra/vps-telemetry/compose.yml" "$VPS:$DIR/compose.yml.new"
SCALE="$(ssh "$VPS" "cd $DIR && docker compose ps -q ingestor | wc -l")"
ssh "$VPS" "$CD && (umask 077 && sed 's/^IMAGE_TAG=.*/IMAGE_TAG=$SHA/' .env > .env.check) \
  && { docker compose -f compose.yml.new --env-file .env.check config -q; ok=\$?; rm -f .env.check; [ \$ok = 0 ]; } \
  && cp compose.yml compose.yml.bak-${OLD:0:7} && cp .env .env.bak-${OLD:0:7} \
  && mv compose.yml.new compose.yml && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=$SHA/' .env"

# Volta compose.yml e .env do deploy anterior e sobe de novo com as imagens antigas, que continuam na VPS. Só tenta
# quando há para onde voltar: SHA anterior diferente (redeploy do mesmo SHA sobrescreveu as imagens), backups no
# lugar e as seis imagens antigas presentes. Migration já aplicada fica: elas são compatíveis com a versão no ar
# (CONTRIBUTING.md) e o migrate antigo não tem o que aplicar. Nunca sai com sucesso.
restore_previous() {
  local o="${OLD:0:7}"
  STAGE=restored
  echo "FAIL  deploy da ${SHA:0:7}: $1"
  if [ -n "$OLD" ] && [ "$OLD" != "$SHA" ] && ssh "$VPS" "$CD && test -f compose.yml.bak-$o && test -f .env.bak-$o \
    && for s in api ingestor demo backup prometheus grafana; do docker image inspect $REG-\$s:$OLD >/dev/null || exit 1; done \
    && cp compose.yml.bak-$o compose.yml && cp .env.bak-$o .env \
    && docker compose up -d --scale ingestor=$SCALE --quiet-pull"; then
    echo "FAIL  deploy desfeito: compose.yml e .env de ${o} de volta e a stack subiu de novo nela; investigue antes de repetir"
    ssh "$VPS" "cd $DIR && docker compose ps -a --format '{{.Service}}: {{.Status}}'" || true
  else
    echo "FAIL  sem restauração automática (redeploy do mesmo SHA, backup/imagem antiga faltando ou o up de volta falhou):"
    echo "      a stack pode estar com contêineres das duas versões"
    rollback_help
  fi
  exit 1
}

# mantém a escala atual do ingestor (0 enquanto a ingestão roda em outro ambiente)
STAGE=up
echo "subindo a stack"
if ! out="$(ssh "$VPS" "$CD && docker compose up -d --scale ingestor=$SCALE --quiet-pull 2>&1")"; then
  printf '%s\n' "$out" | tail -n 20
  restore_previous "docker compose up falhou"
fi
ssh "$VPS" "cd $DIR && docker compose logs migrate 2>&1 | tail -1"
migrate="$(ssh "$VPS" "cd $DIR && docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' \$(docker compose ps -aq migrate)")" ||
  migrate="não encontrado"
[ "$migrate" = "exited 0" ] || restore_previous "migrate não terminou com sucesso ($migrate)"

echo "pós-deploy (idempotente, sem chamadas ao fornecedor)"
ssh "$VPS" "$CD && \
  docker compose run --rm --no-deps -w /srv/services/ingestor ingestor \
    node node_modules/@galaxie/knowledge/dist/cli/seed-semantic.js --dir /srv/data/knowledge >/dev/null && \
  docker compose run --rm --no-deps ingestor node dist/cli/derive-names.js >/dev/null && \
  docker compose run --rm --no-deps ingestor node dist/cli/events-importance.js --esporte football --proximos-dias 7 >/dev/null && \
  echo ok"

# cache de respostas da API (até 24 h, last-known-good): o que a versão anterior calculou não pode
# continuar sendo servido — só as chaves de resposta e de tag; rate limit e o resto ficam. Falha do scan ou do del
# derruba o deploy (sh -e no contêiner), senão o cache antigo seguiria no ar sem aviso.
echo "limpando o cache de respostas da API"
ssh "$VPS" "cd $DIR && docker compose exec -T valkey sh -ec '
  for p in \"gs:cache:*\" \"gs:tag:*\"; do
    keys=\$(valkey-cli --scan --pattern \"\$p\")
    [ -z \"\$keys\" ] || printf \"%s\\n\" \"\$keys\" | xargs -n 200 valkey-cli del >/dev/null
  done'"

# conta do provedor de IA com crédito? (chamada mínima, ~20 tokens) — só avisa, não derruba o deploy
echo "conta da IA"
ssh "$VPS" "cd $DIR && docker compose exec -T agents node -e '
  const p = (process.env.AI_PROVIDER || \"openai\").toLowerCase();
  const gem = p === \"gemini\";
  const key = gem ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
  if (!key || (p !== \"openai\" && !gem)) { console.log(\"WARN  IA: provedor \" + p + \" sem chave configurada\"); process.exit(0); }
  const model = process.env.AI_MODEL_LIGHT || (gem ? \"gemini-3.5-flash-lite\" : \"gpt-6-luna\");
  const req = gem
    ? [\"https://generativelanguage.googleapis.com/v1beta/models/\" + model + \":generateContent\", { method: \"POST\",
        headers: { \"x-goog-api-key\": key, \"content-type\": \"application/json\" },
        body: JSON.stringify({ contents: [{ parts: [{ text: \"ok\" }] }], generationConfig: { maxOutputTokens: 1 } }) }]
    : [\"https://api.openai.com/v1/responses\", { method: \"POST\",
        headers: { authorization: \"Bearer \" + key, \"content-type\": \"application/json\" },
        body: JSON.stringify({ model, input: \"ok\", max_output_tokens: 16 }) }];
  fetch(req[0], req[1])
    .then(async (r) => { const j = await r.json().catch(() => ({}));
      console.log(r.ok ? \"PASS  IA: conta com crédito (\" + p + \")\" : \"WARN  IA: \" + r.status + \" \" + (j.error?.status || j.error?.code || j.error?.type || \"\") + \" — agentes no texto determinístico\"); })
    .catch((e) => console.log(\"WARN  IA: sem conexão com o provedor (\" + e.message + \")\"));'"

echo "smoke test"
ssh "$VPS" "cd $DIR && docker compose exec -T demo node -" < "$WT/infra/vps-telemetry/smoke.mjs"
STAGE=finished

# notas de versão: tag deploy-AAAA-MM-DD.N no commit publicado e release no GitHub com os PRs desde o deploy
# anterior (infra/vps-telemetry/release-notes.mjs) — só depois do smoke ok; falha aqui não desfaz o deploy
echo "notas de versão"
(cd "$ROOT" && node "$WT/infra/vps-telemetry/release-notes.mjs" --to "$SHA") || echo "WARN  release: não publicada"
