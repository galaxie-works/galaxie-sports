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
  FAN_TOKEN_SECRET    # token do torcedor (gft_, #937): api, quando o #1061 entrar (antes disso nenhum serviço lê)
  STREAM_TOKEN_SECRET # token do stream ao vivo: api
  # painel (demo, site e console): sessões, e também os links dos anexos das sugestões e as referências u_/t_ das
  # issues. Só é gerado vazio ou com o valor de exemplo, que é público: aí trocar é o certo, mesmo invalidando isso tudo
  BETTER_AUTH_SECRET
  # cofre das chaves trocadas no painel (#1087/#1089): todos os serviços Node abrem com ela as chaves gravadas em
  # Ajustes → Credenciais. Gerada só quando falta; NUNCA troque nem apague: sem a mesma KEK, as chaves gravadas pelo
  # painel não abrem mais e precisam ser cadastradas de novo (rotação só pelo runbook docs/runbooks/chaves-no-painel.md)
  SETTINGS_KEK
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

# O compose também lê `export CHAVE=`, `CHAVE = valor` e `CHAVE: valor`; nessas formas o script não sabe trocar a linha sem risco de
# mudar um segredo em uso, então para e pede para deixar a linha como `CHAVE=valor`
for k in "${KEYS[@]}" "${WARN_KEYS[@]}"; do
  if grep -qE "^[[:space:]]*(export[[:space:]]+)?${k}[[:space:]]*[=:]" "$ENV_FILE" &&
    grep -E "^[[:space:]]*(export[[:space:]]+)?${k}[[:space:]]*[=:]" "$ENV_FILE" | grep -qvE "^$k="; then
    echo "FAIL  $k está no $ENV_FILE numa forma diferente de $k=valor (export, espaços ou dois-pontos); deixe como $k=valor. Nada foi gerado"
    exit 1
  fi
done

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

# Chave que vai ser gerada (a última linha está vazia ou de exemplo) mas que tem, em outra linha, um valor de verdade
# (ex.: o bloco do env.example colado embaixo, com SETTINGS_KEK= vazia): esse valor pode ser o segredo em uso, e gerar
# apagaria as duas linhas. Para e pede para deixar uma linha só. Linha repetida sem valor de verdade não atrapalha
real_elsewhere() {
  local v
  while IFS= read -r v; do
    v="${v%$'\r'}"
    v="${v%\"}"
    v="${v#\"}"
    [ -n "$v" ] && [[ "$v" != troque-por* ]] && return 0
  done < <(sed -n "s/^$1=//p" "$ENV_FILE")
  return 1
}
for k in "${KEYS[@]}"; do
  if needs "$k" && real_elsewhere "$k"; then
    echo "FAIL  $k aparece mais de uma vez no $ENV_FILE, e a última linha está vazia mas outra tem valor; deixe uma linha só (a do valor em uso). Nada foi gerado"
    exit 1
  fi
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
# grep sai 1 quando não sobra linha (normal) e 2 em erro de leitura ou escrita: aí para, sem trocar o .env
rc=0
grep -vE "$pattern" "$ENV_FILE" > "$tmp" || rc=$?
if [ "$rc" -gt 1 ]; then
  echo "FAIL  não deu para copiar o $ENV_FILE (grep saiu com $rc); nada foi gerado"
  exit 1
fi
for k in "${missing[@]}"; do
  # gerado antes, numa variável: falha do openssl dentro do printf passaria pelo set -e e gravaria a chave vazia
  v="$(openssl rand -hex 32)"
  [[ "$v" =~ ^[0-9a-f]{64}$ ]] || {
    echo "FAIL  openssl não gerou um segredo válido para $k; nada foi gerado"
    exit 1
  }
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
done
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT
echo "segredos internos gerados no $ENV_FILE: ${missing[*]}"
if [[ " ${missing[*]} " == *" SETTINGS_KEK "* ]]; then
  echo "WARN  SETTINGS_KEK nova: guarde uma cópia fora da VPS (cofre de senhas). Se ela for perdida ou trocada, as chaves"
  echo "      gravadas em Ajustes → Credenciais não abrem mais e precisam ser cadastradas de novo"
fi
