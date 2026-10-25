#!/usr/bin/env bash
# Publica a main na VPS com o mesmo roteiro de sempre — e termina com o smoke test, para nada que
# funciona local ficar quebrado em silêncio na produção.
#
#   infra/vps-telemetry/deploy.sh                 # constrói api/ingestor/demo do origin/main e publica
#   infra/vps-telemetry/deploy.sh <sha>           # um commit específico
#   SKIP_BUILD=1 infra/vps-telemetry/deploy.sh    # reaproveita imagens já construídas para o SHA
#   SKIP_CI_CHECK=1 infra/vps-telemetry/deploy.sh # publica sem conferir o CI do SHA (emergência, SHA antigo)
#
# Passos:
#   1. CI do SHA (execuções do GitHub Actions, via gh): vermelho ou cancelado → para antes de tudo; ainda rodando →
#      espera, depois do build, até CI_WAIT_MIN minutos (padrão 20)
#   2. worktree temporária no SHA → docker build de api, ingestor e demo (tag = SHA); backup, prometheus e grafana
#      levam no rótulo o hash git da própria pasta: a VPS já tem a imagem com esse hash → só ganha a tag do SHA;
#      senão é construída aqui e vai junto
#   3. trava na VPS ($DIR/.deploy.lock): um deploy por vez, de qualquer máquina, até o fim do script. Só é pedida
#      com menos de PRELOCK_MAX_MIN minutos (padrão 25) de script, para o resto caber no teto de 45 min do
#      deploy-safe.sh; trava com mais de LOCK_STALE_MIN minutos (padrão 60) é de deploy morto e é tomada, com WARN
#   4. docker save | ssh docker load
#   5. compose.yml do SHA e IMAGE_TAG no .env, validados antes de trocar (com backup dos dois)
#   6. docker compose up -d (ingestor continua com a escala atual; PULL_POLICY=missing: nada vem do registry)
#      → o migrate tem de sair com 0. Falha aqui sem migration nova aplicada → volta compose.yml/.env anteriores e
#      sobe de novo; com migration nova (ou sem como saber) → rollback manual. Sempre sai com 1
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
PRELOCK_MAX_MIN="${PRELOCK_MAX_MIN:-25}"
LOCK_STALE_MIN="${LOCK_STALE_MIN:-60}"
TREE_LABEL="works.galaxie.context-tree"
# comandos do compose na VPS: as imagens chegam por docker load; o registry nunca é consultado
CD="cd $DIR && export PULL_POLICY=missing"
# migrations aplicadas no banco (o migrator do drizzle registra cada uma em drizzle.__drizzle_migrations)
MIGRATIONS_SQL="cd $DIR && docker compose exec -T postgres sh -c 'psql -X -q -t -A -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -c \"select count(*) from drizzle.__drizzle_migrations\"'"

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
  echo "FAIL  voltar para ${o}: ssh $VPS '$CD && cp compose.yml.bak-$o compose.yml && cp .env.bak-$o .env && docker compose up -d --scale ingestor=${SCALE:-1}'"
  echo "FAIL  conferir: ssh $VPS 'cd $DIR && docker compose ps -a && docker compose logs --tail 50 migrate api'"
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
# sinal (o timeout do deploy-safe.sh manda TERM) vira código de saída ≠ 0; sem isso o trap EXIT vê $? = 0
trap 'exit 143' TERM
trap 'exit 130' INT
trap 'exit 129' HUP

# ── CI do SHA ───────────────────────────────────────────────────────────────────────────────────────────────
# Execuções do GitHub Actions no commit (enxergam também o que está na fila, antes de existir check-run)
# → "pass", "pending <n>", "fail <nomes>", "cancelled <nomes>" ou "erro" (gh sem acesso depois de 3 tentativas)
ci_state() {
  local runs try
  for try in 1 2 3; do
    if runs="$(cd "$ROOT" && gh api --paginate "repos/{owner}/{repo}/actions/runs?head_sha=$SHA&per_page=100" \
      --jq '.workflow_runs[] | [.status, (.conclusion // ""), .name] | @tsv' 2>/dev/null)"; then
      break
    fi
    [ "$try" = 3 ] || sleep 5
    runs="__erro__"
  done
  if [ "$runs" = "__erro__" ]; then
    echo erro
    return 0
  fi
  printf '%s\n' "$runs" | awk -F'\t' '
    NF < 3 { next }
    { total++ }
    $1 != "completed" { pending++; next }
    $2 == "cancelled" { cancelled = cancelled (cancelled ? ", " : "") $3; next }
    $2 != "success" && $2 != "skipped" && $2 != "neutral" { bad = bad (bad ? ", " : "") $3 " (" $2 ")" }
    END {
      if (bad) print "fail " bad
      else if (cancelled) print "cancelled " cancelled
      else if (pending || !total) print "pending " pending + 0
      else print "pass"
    }'
}

# $1 = minutos de espera pelo que ainda roda; 0 = só barra o CI vermelho ou cancelado
ci_gate() {
  local wait_min="$1" deadline state
  if [ -n "${SKIP_CI_CHECK:-}" ]; then
    [ "$wait_min" = 0 ] || echo "WARN  CI: conferência pulada (SKIP_CI_CHECK)"
    return 0
  fi
  deadline=$((SECONDS + wait_min * 60))
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
      cancelled*)
        echo "FAIL  CI cancelado em ${SHA:0:7} (${state#cancelled }): publique o origin/main atual, com o CI completo," \
          "ou SKIP_CI_CHECK=1 se este SHA precisa ir assim mesmo"
        exit 1
        ;;
      erro)
        echo "FAIL  CI: não deu para ler as execuções de ${SHA:0:7} no GitHub (gh instalado e autenticado?);" \
          "SKIP_CI_CHECK=1 publica sem conferir"
        exit 1
        ;;
    esac
    [ "$wait_min" != 0 ] || return 0
    if [ "$SECONDS" -ge "$deadline" ] || [ "$SECONDS" -ge $((PRELOCK_MAX_MIN * 60)) ]; then
      echo "FAIL  CI ainda rodando em ${SHA:0:7} (${state#pending } execução(ões) pendentes) com $((SECONDS / 60)) min" \
        "de deploy; rode de novo quando terminar"
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

# o que vem depois da trava (envio, up, pós-deploy, smoke) precisa caber no teto de 45 min do deploy-safe.sh: morrer
# pelo timeout no meio do compose up é pior do que não começar
if [ "$SECONDS" -ge $((PRELOCK_MAX_MIN * 60)) ]; then
  echo "FAIL  já são $((SECONDS / 60)) min de deploy antes de tocar a VPS (limite PRELOCK_MAX_MIN=$PRELOCK_MAX_MIN);" \
    "rode de novo (SKIP_BUILD=1 reaproveita as imagens)"
  exit 1
fi

# ── trava na VPS ────────────────────────────────────────────────────────────────────────────────────────────
# Dois deploys (de máquinas diferentes) leriam o mesmo IMAGE_TAG anterior, disputariam compose.yml.new, o .env e o
# compose up, e calculariam a mesma tag da release. mkdir é atômico; o dono fica em owner e a trava sai no fim
# (trap EXIT, que também roda quando o deploy-safe.sh mata o deploy pelo teto de tempo). Trava mais velha que
# LOCK_STALE_MIN é de um deploy que morreu sem liberar (máquina desligada, ssh perdido no fim): é tomada.
owner="$LOCK_ID ${SHA:0:7} $(date -u +%FT%TZ)"
lock="$(ssh "$VPS" "if mkdir $LOCK 2>/dev/null; then echo '$owner' > $LOCK/owner && echo ok; \
  elif [ -n \"\$(find $LOCK -maxdepth 0 -mmin +$LOCK_STALE_MIN 2>/dev/null)\" ]; then \
    old=\$(cat $LOCK/owner 2>/dev/null || echo '(sem dono)'); \
    rm -rf $LOCK && mkdir $LOCK && echo '$owner' > $LOCK/owner && echo \"tomada \$old\"; \
  else cat $LOCK/owner 2>/dev/null || echo '(sem dono)'; fi")"
case "$lock" in
  ok) ;;
  tomada*) echo "WARN  trava da VPS com mais de $LOCK_STALE_MIN min tomada (era: ${lock#tomada })" ;;
  *)
    echo "FAIL  outro deploy em andamento na VPS: ${lock:-(trava disputada agora)}"
    echo "FAIL  espere ele terminar. Se ele morreu: confira ssh $VPS 'cd $DIR && docker compose ps -a' e libere com ssh $VPS 'rm -rf $LOCK'"
    exit 1
    ;;
esac
LOCKED=1

OLD="$(ssh "$VPS" "grep -E '^IMAGE_TAG=' $DIR/.env | cut -d= -f2")"
echo "na VPS: ${OLD:0:7} → ${SHA:0:7}"

echo "enviando imagens"
docker save "${IMAGES[@]}" | gzip -1 | ssh "$VPS" 'gunzip | docker load' >/dev/null
ssh "$VPS" "$RETAG"

# compose.yml e .env novos validados juntos antes de trocar: config inválido para aqui, com a stack intocada
scp -q "$WT/infra/vps-telemetry/compose.yml" "$VPS:$DIR/compose.yml.new"
# escala atual do ingestor (0 enquanto a ingestão roda em outro ambiente); falha do ps não pode virar 0
SCALE="$(ssh "$VPS" "cd $DIR && ids=\$(docker compose ps -q ingestor) && { printf '%s\n' \"\$ids\" | grep -c . ; true; }")" ||
  SCALE=""
case "$SCALE" in
  '' | *[!0-9]*)
    echo "FAIL  não deu para ler a escala atual do ingestor (\"$SCALE\"); nada foi trocado na VPS"
    exit 1
    ;;
esac
ssh "$VPS" "$CD && (umask 077 && sed 's/^IMAGE_TAG=.*/IMAGE_TAG=$SHA/' .env > .env.check) \
  && { docker compose -f compose.yml.new --env-file .env.check config -q; ok=\$?; rm -f .env.check; [ \$ok = 0 ]; } \
  && cp compose.yml compose.yml.bak-${OLD:0:7} && cp .env .env.bak-${OLD:0:7} \
  && mv compose.yml.new compose.yml && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=$SHA/' .env"
# contagem de migrations antes do up: o rollback automático só vale se nenhuma nova foi aplicada (o código antigo
# não foi escrito para o schema novo); sem a contagem, rollback só manual
MIG_BEFORE="$(ssh "$VPS" "$MIGRATIONS_SQL" 2>/dev/null)" || MIG_BEFORE=""

# Volta compose.yml e .env do deploy anterior e sobe de novo com as imagens antigas, que continuam na VPS. Só tenta
# quando é garantidamente o estado de antes: nenhuma migration nova aplicada (contagem igual antes e depois), SHA
# anterior diferente (redeploy do mesmo SHA sobrescreveu as imagens), backups no lugar e as seis imagens antigas
# presentes. Senão, FAIL com o rollback manual. Nunca sai com sucesso.
restore_previous() {
  local o="${OLD:0:7}" why="" mig_after
  STAGE=restored
  echo "FAIL  deploy da ${SHA:0:7}: $1"
  mig_after="$(ssh "$VPS" "$MIGRATIONS_SQL" 2>/dev/null)" || mig_after=""
  if [ -z "$OLD" ] || [ "$OLD" = "$SHA" ]; then
    why="redeploy do mesmo SHA: não há versão anterior para onde voltar"
  elif ! [[ "$MIG_BEFORE" =~ ^[0-9]+$ && "$mig_after" =~ ^[0-9]+$ ]]; then
    why="não deu para contar as migrations aplicadas (antes: '${MIG_BEFORE}', depois: '${mig_after}')"
  elif [ "$mig_after" != "$MIG_BEFORE" ]; then
    why="$((mig_after - MIG_BEFORE)) migration(s) nova(s) aplicada(s): a ${o} pode não funcionar com o schema novo"
  elif ! ssh "$VPS" "$CD && test -f compose.yml.bak-$o && test -f .env.bak-$o \
    && for s in api ingestor demo backup prometheus grafana; do docker image inspect $REG-\$s:$OLD >/dev/null || exit 1; done \
    && cp compose.yml.bak-$o compose.yml && cp .env.bak-$o .env \
    && docker compose up -d --scale ingestor=$SCALE --quiet-pull"; then
    why="backup ou imagem antiga faltando, ou o up de volta na ${o} falhou"
  fi
  if [ -z "$why" ]; then
    echo "FAIL  deploy desfeito: compose.yml e .env de ${o} de volta e a stack subiu de novo nela; investigue antes de repetir"
    ssh "$VPS" "cd $DIR && docker compose ps -a --format '{{.Service}}: {{.Status}}'" || true
  else
    echo "FAIL  sem restauração automática ($why); a stack pode estar com contêineres das duas versões"
    rollback_help
  fi
  exit 1
}

STAGE=up
echo "subindo a stack"
if out="$(ssh "$VPS" "$CD && docker compose up -d --scale ingestor=$SCALE --quiet-pull 2>&1")"; then
  :
else
  rc=$?
  printf '%s\n' "$out" | tail -n 20
  # 255 = o ssh caiu: o up pode ter parado no meio ou terminado; sem saber o estado, nada de agir sozinho
  if [ "$rc" = 255 ]; then
    echo "FAIL  conexão com a VPS caiu durante o docker compose up; estado da stack desconhecido"
    exit 1
  fi
  restore_previous "docker compose up falhou"
fi
ssh "$VPS" "cd $DIR && docker compose logs migrate 2>&1 | tail -1"
if migrate="$(ssh "$VPS" "cd $DIR && docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' \$(docker compose ps -aq migrate)")"; then
  :
else
  rc=$?
  if [ "$rc" = 255 ]; then
    echo "FAIL  sem conexão com a VPS para conferir o migrate; a ${SHA:0:7} subiu, mas o deploy não foi conferido"
    exit 1
  fi
  migrate="contêiner não encontrado (código $rc)"
fi
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
