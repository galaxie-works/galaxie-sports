#!/usr/bin/env bash
# Publica a main na VPS com o mesmo roteiro de sempre — e termina com o smoke test, para nada que
# funciona local ficar quebrado em silêncio na produção.
#
#   infra/vps-telemetry/deploy.sh                 # constrói api/ingestor/demo do origin/main e publica
#   infra/vps-telemetry/deploy.sh <sha>           # um commit específico
#   SKIP_BUILD=1 infra/vps-telemetry/deploy.sh    # reaproveita imagens já construídas para o SHA
#
# Passos:
#   1. worktree temporária no SHA → docker build de api, ingestor e demo (tag = SHA)
#   2. docker save | ssh docker load; backup/prometheus/grafana: retag da versão anterior
#   3. compose.yml do SHA na VPS (com backup do anterior) e IMAGE_TAG no .env (com backup)
#   4. docker compose up -d (ingestor continua com a escala atual) → migrations
#   5. pós-deploy idempotente: seed da base semântica, nomes curados de estádios e importância
#   6. limpa o cache de respostas da API (senão a versão anterior segue servida por até 24 h)
#   7. smoke test (infra/vps-telemetry/smoke.mjs); falha → código de saída 1
set -euo pipefail

VPS="${VPS:-root@145.223.94.149}"
DIR="${VPS_DIR:-/docker/galaxie-sports}"
REG="ghcr.io/galaxie-works/galaxie-sports"
ROOT="$(git rev-parse --show-toplevel)"

git -C "$ROOT" fetch -q origin
SHA="$(git -C "$ROOT" rev-parse "${1:-origin/main}")"
OLD="$(ssh "$VPS" "grep -E '^IMAGE_TAG=' $DIR/.env | cut -d= -f2")"
echo "deploy ${SHA:0:7} (antes: ${OLD:0:7})"

WT="$(mktemp -d)/galaxie-deploy"
git -C "$ROOT" worktree add -q --detach "$WT" "$SHA"
trap 'git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true' EXIT

if [ -z "${SKIP_BUILD:-}" ]; then
  for spec in api:apps/api ingestor:services/ingestor demo:apps/demo; do
    name="${spec%%:*}"
    echo "build $name"
    docker build -q -f "$WT/${spec#*:}/Dockerfile" -t "$REG-$name:$SHA" "$WT" >/dev/null
  done
fi

echo "enviando imagens"
docker save "$REG-api:$SHA" "$REG-ingestor:$SHA" "$REG-demo:$SHA" | gzip -1 | ssh "$VPS" 'gunzip | docker load' >/dev/null
ssh "$VPS" "for s in backup prometheus grafana; do docker tag $REG-\$s:$OLD $REG-\$s:$SHA; done"

scp -q "$WT/infra/vps-telemetry/compose.yml" "$VPS:$DIR/compose.yml.new"
ssh "$VPS" "cd $DIR && cp compose.yml compose.yml.bak-${OLD:0:7} && cp .env .env.bak-${OLD:0:7} \
  && mv compose.yml.new compose.yml && sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=$SHA/' .env \
  && docker compose config -q"

# mantém a escala atual do ingestor (0 enquanto a ingestão roda em outro ambiente)
SCALE="$(ssh "$VPS" "cd $DIR && docker compose ps -q ingestor | wc -l")"
ssh "$VPS" "cd $DIR && docker compose up -d --scale ingestor=$SCALE --quiet-pull 2>&1 | grep -iE 'error' || true"
ssh "$VPS" "cd $DIR && docker compose logs migrate 2>&1 | tail -1"

echo "pós-deploy (idempotente, sem chamadas ao fornecedor)"
ssh "$VPS" "cd $DIR && \
  docker compose run --rm --no-deps -w /srv/services/ingestor ingestor \
    node node_modules/@galaxie/knowledge/dist/cli/seed-semantic.js --dir /srv/data/knowledge >/dev/null && \
  docker compose run --rm --no-deps ingestor node dist/cli/derive-names.js >/dev/null && \
  docker compose run --rm --no-deps ingestor node dist/cli/events-importance.js --esporte football --proximos-dias 7 >/dev/null && \
  echo ok"

# cache de respostas da API (até 24 h, last-known-good): o que a versão anterior calculou não pode
# continuar sendo servido — só as chaves de resposta e de tag; rate limit e o resto ficam
echo "limpando o cache de respostas da API"
ssh "$VPS" "cd $DIR && for p in 'gs:cache:*' 'gs:tag:*'; do \
  docker compose exec -T valkey sh -c \"valkey-cli --scan --pattern '\$p' | xargs -r -n 200 valkey-cli del >/dev/null\"; done"

# conta do provedor de IA com crédito? (chamada mínima, ~20 tokens) — só avisa, não derruba o deploy
echo "conta da IA"
ssh "$VPS" "cd $DIR && docker compose exec -T agents node -e '
  if (process.env.AI_PROVIDER !== \"openai\" || !process.env.OPENAI_API_KEY) { console.log(\"WARN  IA: provedor sem chave OpenAI configurada\"); process.exit(0); }
  fetch(\"https://api.openai.com/v1/responses\", { method: \"POST\",
    headers: { authorization: \"Bearer \" + process.env.OPENAI_API_KEY, \"content-type\": \"application/json\" },
    body: JSON.stringify({ model: process.env.AI_MODEL_LIGHT || \"gpt-6-luna\", input: \"ok\", max_output_tokens: 16 }) })
    .then(async (r) => { const j = await r.json().catch(() => ({}));
      console.log(r.ok ? \"PASS  IA: conta com crédito\" : \"WARN  IA: \" + r.status + \" \" + (j.error?.code || j.error?.type || \"\") + \" — agentes no texto determinístico\"); })
    .catch((e) => console.log(\"WARN  IA: sem conexão com o provedor (\" + e.message + \")\"));'"

echo "smoke test"
ssh "$VPS" "cd $DIR && docker compose exec -T demo node -" < "$WT/infra/vps-telemetry/smoke.mjs"
