#!/usr/bin/env bash
# Teste do migrate-dev.sh com docker e pnpm falsos (no CI: docker.yml › valida stack): recusa URL que não é a do dev,
# --plan não roda nada nem mostra a senha, a imagem e o comando são os do migrate da produção, --pnpm migra pelo
# checkout, e localhost vira host.docker.internal dentro do contêiner.
#
#   bash infra/ops/migrate-dev.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/infra/ops/migrate-dev.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

check() {
  if [ "$2" = "$3" ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: '$2' ≠ '$3'"
    fail=1
  fi
}
contains() {
  if printf '%s' "$2" | grep -qF -- "$3"; then
    echo "ok    $1"
  else
    echo "FAIL  $1: '$3' não aparece em: $2"
    fail=1
  fi
}

# docker e pnpm falsos: registram os argumentos (e a DATABASE_URL vista) e saem em 0
mkdir -p "$TMP/bin"
for fake in docker pnpm; do
  cat > "$TMP/bin/$fake" <<EOF
#!/usr/bin/env bash
echo "$fake \$*" >> "$TMP/calls"
echo "env DATABASE_URL=\${DATABASE_URL:-} DB_ROLES=\${DB_ROLES:-}" >> "$TMP/calls"
EOF
  chmod +x "$TMP/bin/$fake"
done
export PATH="$TMP/bin:$PATH"
calls() { cat "$TMP/calls" 2>/dev/null || true; }
reset() { rm -f "$TMP/calls"; }

DEV='postgres://galaxie:segredo@192.168.1.34:5433/galaxie_sports'
PROD='postgres://galaxie:segredo@145.223.94.149:5432/galaxie_sports'
unset DATABASE_URL GALAXIE_ENV IMAGE_PREFIX DEV_HOSTS

# 1. URL que não é a do dev: aviso em letras grandes e nada roda
reset
set +e
out="$(DATABASE_URL="$PROD" bash "$SCRIPT" 2>&1)"
code=$?
set -e
check "produção: sai 1" "$code" 1
contains "produção: avisa" "$out" "ATENÇÃO: DATABASE_URL NÃO É A DO DEV"
contains "produção: diz o host" "$out" "host lido: 145.223.94.149"
contains "produção: não mostra a senha" "$(printf '%s' "$out" | grep -c segredo)" "0"
check "produção: docker não roda" "$(calls)" ""

# 2. --forcar segue mesmo assim
reset
DATABASE_URL="$PROD" bash "$SCRIPT" --forcar >/dev/null 2>&1
contains "--forcar: roda o docker" "$(calls)" "docker run --rm --pull always -e DATABASE_URL=$PROD -e DB_ROLES=off"

# 3. --plan: mostra o comando sem a senha e não roda nada
reset
out="$(DATABASE_URL="$DEV" bash "$SCRIPT" --plan 2>/dev/null)"
check "--plan: o comando do migrate da produção, na tag main" "$out" \
  "plano: docker run --rm --pull always -e DATABASE_URL=*** -e DB_ROLES=off ghcr.io/galaxie-works/galaxie-sports-api:main node node_modules/@galaxie/db/dist/migrate-cli.js"
check "--plan: docker não roda" "$(calls)" ""

# 4. DATABASE_URL do .env (GALAXIE_ENV), com aspas, e a imagem publicada
reset
printf 'OUTRA=x\nDATABASE_URL="%s"\n' "$DEV" > "$TMP/env"
GALAXIE_ENV="$TMP/env" bash "$SCRIPT" >/dev/null 2>&1
check "imagem: docker run com a URL do .env" "$(calls | head -n1)" \
  "docker run --rm --pull always -e DATABASE_URL=$DEV -e DB_ROLES=off ghcr.io/galaxie-works/galaxie-sports-api:main node node_modules/@galaxie/db/dist/migrate-cli.js"

# 5. --tag e IMAGE_PREFIX
reset
DATABASE_URL="$DEV" IMAGE_PREFIX=registro.local/gs bash "$SCRIPT" --tag in-abc1234 >/dev/null 2>&1
contains "--tag: outra tag e prefixo" "$(calls)" " registro.local/gs-api:in-abc1234 node "

# 6. localhost vira host.docker.internal só dentro do contêiner
reset
DATABASE_URL='postgres://galaxie:galaxie@localhost:5433/galaxie_sports' bash "$SCRIPT" >/dev/null 2>&1
contains "localhost: host.docker.internal no docker run" "$(calls)" \
  "-e DATABASE_URL=postgres://galaxie:galaxie@host.docker.internal:5433/galaxie_sports"

# 7. --pnpm: build do pacote e db:migrate com a URL no ambiente, sem docker
reset
out="$(DATABASE_URL="$DEV" bash "$SCRIPT" --pnpm 2>&1 >/dev/null)"
check "--pnpm: build e migrate, nesta ordem" "$(calls | grep '^pnpm' | tr '\n' ';')" \
  "pnpm --filter @galaxie/db build;pnpm --filter @galaxie/db db:migrate;"
contains "--pnpm: DATABASE_URL e DB_ROLES=off no ambiente" "$(calls)" "env DATABASE_URL=$DEV DB_ROLES=off"
contains "--pnpm: avisa que são as migrations do checkout" "$out" "migrations DESTE checkout"
check "--pnpm: docker não roda" "$(calls | grep -c '^docker')" 0

# 8. sem URL nenhuma: erro de uso
reset
set +e
GALAXIE_ENV="$TMP/nao-existe" bash "$SCRIPT" >/dev/null 2>&1
code=$?
set -e
check "sem DATABASE_URL: sai 2" "$code" 2

[ "$fail" = 0 ] && echo "PASS  migrate-dev.sh"
exit "$fail"
