#!/usr/bin/env bash
# Gera, no .env da VPS, os segredos internos que ainda estão vazios. Roda na VPS, no diretório da stack, antes de o
# deploy montar o .env.next (deploy-gh.sh e deploy.sh):
#
#   ssh "$VPS" "cd $DIR && bash -s" < infra/vps-telemetry/ensure-secrets.sh
#   bash ensure-secrets.sh [arquivo]     # direto na VPS (padrão: ./.env)
#
# Só para segredos que nenhum terceiro conhece: a Galaxie assina e confere sozinha. Chave de fornecedor (Stripe,
# api-sports, provedores de IA) e segredo combinado com cliente (assinatura dos webhooks) continuam à mão.
#
# Regras:
#   - gera só quando a chave falta, está vazia ou ainda tem o valor de exemplo do env.example ("troque-por…"); valor que
#     já existe nunca muda, porque trocar desloga todo mundo (tokens do torcedor, do stream e sessões do painel)
#   - openssl rand -hex 32 (64 caracteres), gravado com umask 077 e chmod 600; o valor nunca vai para a saída, só o nome
#   - grava num arquivo temporário e troca com mv, para o .env nunca ficar pela metade
set -euo pipefail

ENV_FILE="${1:-.env}"

# segredos internos: quem assina e quem confere é a própria stack
KEYS=(
  FAN_TOKEN_SECRET    # token do torcedor (gft_, #937): api
  STREAM_TOKEN_SECRET # token do stream ao vivo: api
  BETTER_AUTH_SECRET  # sessões do painel: demo, site e console
)
# o Prometheus (projeto obs) lê o mesmo token só quando o obs sobe de novo: gerar aqui deixaria a coleta caída até lá.
# Só avisa; troque à mão e suba o obs junto (deploy-gh.sh --project obs)
WARN_KEYS=(METRICS_TOKEN)

[ -f "$ENV_FILE" ] || {
  echo "FAIL  $ENV_FILE não existe; nada foi gerado"
  exit 1
}
command -v openssl >/dev/null || {
  echo "FAIL  openssl não está instalado; nada foi gerado"
  exit 1
}

# valor atual da chave (última linha vence, como no docker compose); vazio quando falta
current() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
needs() {
  local v
  v="$(current "$1")"
  v="${v%\"}"
  v="${v#\"}"
  [ -z "$v" ] || [[ "$v" == troque-por* ]]
}

for k in "${WARN_KEYS[@]}"; do
  needs "$k" && echo "WARN  $k vazio ou com o valor de exemplo: gere com openssl rand -hex 32 e suba o obs junto"
done

missing=()
for k in "${KEYS[@]}"; do
  needs "$k" && missing+=("$k")
done
if [ ${#missing[@]} -eq 0 ]; then
  echo "segredos internos: todos definidos"
  exit 0
fi

umask 077
tmp="$(mktemp "$ENV_FILE.segredos.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
# tira as linhas das chaves que vão ser geradas (vazias ou de exemplo) e põe a nova no fim
pattern="^($(IFS='|'; echo "${missing[*]}"))="
grep -vE "$pattern" "$ENV_FILE" > "$tmp" || true
for k in "${missing[@]}"; do
  printf '%s=%s\n' "$k" "$(openssl rand -hex 32)" >> "$tmp"
done
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT
echo "segredos internos gerados no $ENV_FILE: ${missing[*]}"
