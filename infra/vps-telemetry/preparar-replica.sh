#!/usr/bin/env bash
# Prepara o Postgres de produção para a réplica física no NAS (docs/runbooks/replica-no-nas.md, épico #1304). Por quê:
# o pg_dump na VPS (diário e antes de cada migrate) é o que mais dispara o corte de CPU do provedor; com a réplica no NAS
# os dumps saem de lá. Roda na VPS, na pasta da stack (/docker/galaxie-sports), por SSH, idempotente (rodar de novo só
# confere e completa o que falta):
#
#   ssh $VPS "cd /docker/galaxie-sports && bash -s -- --tunnel-key 'ssh-ed25519 AAAA… galaxie-nas-tunnel'" < infra/vps-telemetry/preparar-replica.sh
#   ssh $VPS "cd /docker/galaxie-sports && bash -s -- --status" < infra/vps-telemetry/preparar-replica.sh
#
# O que faz (sem parar o Postgres e sem recriar nenhum serviço que já existe):
#   1. recusa rodar com deploy em curso (.deploy.lock ou .env.next): o deploy troca o .env por cima do que for gravado;
#   2. confere os parâmetros que exigem restart e já são os certos no padrão do Postgres 17 (wal_level=replica,
#      max_wal_senders=10, max_replication_slots=10): se não forem, para e diz o que acrescentar ao compose.dados.yml;
#   3. aplica com ALTER SYSTEM + reload (parâmetros de contexto sighup, sem restart; ficam no postgresql.auto.conf do
#      volume pgdata, então sobrevivem a recriar o contêiner) o que vem do .env: wal_keep_size
#      (REPLICA_WAL_KEEP_SIZE, padrão 512MB: WAL que fica mesmo sem slot, o bastante para uma queda curta do link; a
#      retenção longa é do slot, com teto) e
#      max_slot_wal_keep_size (REPLICA_MAX_SLOT_WAL_KEEP_SIZE, padrão 4GB: teto do slot nas_replica; com o NAS fora por
#      muito tempo o slot é invalidado em vez de encher o disco da VPS, e a réplica se refaz com pg_basebackup).
#      Divergência do padrão do repo (que passa -c no comando do compose): -c exigiria recriar o postgres (API e ao vivo
#      fora por segundos); ALTER SYSTEM faz o mesmo sem parar nada e o .env segue como fonte. Se um dia esses -c entrarem
#      no compose, a linha de comando ganha do auto.conf: mantenha os valores iguais;
#   4. papel `replicador` (REPLICATION, LOGIN) com a senha REPLICATOR_PASSWORD do .env (gerada aqui se faltar, como o
#      ensure-secrets.sh: openssl rand -hex 32, nunca impressa; a senha vai para o Postgres pela stdin, não na linha de
#      comando). Rodar de novo reaplica a senha do .env;
#   5. pg_hba.conf: `host replication replicador <REPLICA_HBA_CIDR> scram-sha-256` (padrão 172.30.50.250/32: o IP fixo
#      do serviço replica-proxy na rede da stack; o túnel chega por ele, e o Postgres vê esse IP, não 127.0.0.1) + reload;
#   6. sobe o serviço replica-proxy do compose.dados.yml (socat em 127.0.0.1:5432 da VPS → postgres:5432), o alvo do
#      permitopen do túnel. Precisa do compose.dados.yml da main na pasta (scp; o deploy automático não o traz);
#   7. instala /usr/local/bin/galaxie-nas-receipt (cópia de infra/vps-telemetry/galaxie-nas-receipt.sh, embutida abaixo)
#      e troca o comando forçado da chave `galaxie-nas-receipt` no authorized_keys para ele: a mesma chave passa a
#      gravar também o recibo .nas_last_dump e a ler o pedido de dump do deploy. --receipt-key acrescenta a chave se a
#      linha ainda não existir. Backups do authorized_keys: só os 3 mais novos ficam;
#   8. com --tunnel-key, grava a chave `galaxie-nas-tunnel` com command="/bin/false",restrict,port-forwarding,
#      permitopen="127.0.0.1:5432": só encaminha porta para o proxy, sem shell nem outro destino.
# --status não muda nada: mostra parâmetros, pg_stat_replication, slots, LSN atual (para medir o WAL/dia, #1305),
# recibos e chaves. Saída: 0 = pronto (ou status impresso); 1 = algo faltou (a mensagem diz o quê).
set -euo pipefail

ENV_FILE=.env
CF=compose.dados.yml
AUTH_KEYS="${AUTHORIZED_KEYS:-/root/.ssh/authorized_keys}"
RECEIPT_BIN="${RECEIPT_BIN:-/usr/local/bin/galaxie-nas-receipt}"
STATUS=""
TUNNEL_KEY=""
RECEIPT_KEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --status) STATUS=1; shift ;;
    --tunnel-key) TUNNEL_KEY="${2:?--tunnel-key precisa da chave pública}"; shift 2 ;;
    --receipt-key) RECEIPT_KEY="${2:?--receipt-key precisa da chave pública}"; shift 2 ;;
    *) echo "uso: preparar-replica.sh [--status] [--tunnel-key '<ssh-ed25519 AAAA…>'] [--receipt-key '<ssh-ed25519 AAAA…>']" >&2; exit 1 ;;
  esac
done

fail() { echo "FAIL  $*"; exit 1; }
ok() { echo "ok    $*"; }
[ -f "$CF" ] || fail "sem $CF na pasta atual: rode na pasta da stack (/docker/galaxie-sports), depois da transição para três projetos"
[ -f "$ENV_FILE" ] || fail "sem $ENV_FILE na pasta atual"
DADOS=(docker compose -f "$CF")
# SQL pela stdin (nunca na linha de comando: a senha do papel passa por aqui); -t -A: só o valor
sql() { printf '%s\n' "$1" | "${DADOS[@]}" exec -T postgres sh -c 'psql -X -q -t -A -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; }
# valor de uma chave do .env (última linha vence, como no docker compose); vazio quando falta
env_of() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r"'; }
WAL_KEEP="${REPLICA_WAL_KEEP_SIZE:-$(env_of REPLICA_WAL_KEEP_SIZE)}"
SLOT_KEEP="${REPLICA_MAX_SLOT_WAL_KEEP_SIZE:-$(env_of REPLICA_MAX_SLOT_WAL_KEEP_SIZE)}"
HBA_CIDR="${REPLICA_HBA_CIDR:-$(env_of REPLICA_HBA_CIDR)}"
PROXY_BIND="${REPLICA_PROXY_BIND:-$(env_of REPLICA_PROXY_BIND)}"
: "${WAL_KEEP:=512MB}" "${SLOT_KEEP:=4GB}" "${HBA_CIDR:=172.30.50.250/32}" "${PROXY_BIND:=127.0.0.1:5432}"
BACKUPS_DIR="${NAS_BACKUPS_DIR:-/var/lib/docker/volumes/galaxie-sports_backups/_data}"

[ -n "$("${DADOS[@]}" ps -q postgres </dev/null 2>/dev/null)" ] || fail "o serviço postgres do projeto dados não está no ar"

# ── --status ────────────────────────────────────────────────────────────────────────────────────────
if [ -n "$STATUS" ]; then
  echo "parâmetros:"
  sql "select '  ' || name || ' = ' || setting || coalesce(' ' || unit, '') || ' (' || context || ')' from pg_settings
       where name in ('wal_level','max_wal_senders','max_replication_slots','wal_keep_size','max_slot_wal_keep_size','wal_compression') order by name"
  echo "pg_stat_replication (quem está replicando agora):"
  sql "select '  ' || coalesce(application_name,'?') || ' de ' || coalesce(client_addr::text,'?') || ': ' || state || ', sent ' || sent_lsn || ', replay ' || coalesce(replay_lsn::text,'?') ||
       ', atraso ' || coalesce(replay_lag::text,'n/d') from pg_stat_replication" | grep . || echo "  (nenhuma conexão de replicação)"
  echo "pg_replication_slots:"
  sql "select '  ' || slot_name || ': active=' || active || ', wal_status=' || coalesce(wal_status,'?') || ', WAL retido ' ||
       coalesce(pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)),'?') || ', folga até o teto ' || coalesce(pg_size_pretty(safe_wal_size),'sem teto')
       from pg_replication_slots" | grep . || echo "  (nenhum slot)"
  echo "LSN atual (anote e compare em 24 h com pg_wal_lsn_diff para medir o WAL/dia, #1305): $(sql "select pg_current_wal_lsn()")"
  for r in .nas_last_pull .nas_last_dump; do
    if [ -f "$BACKUPS_DIR/$r" ]; then
      echo "recibo $r: há $((($(date +%s) - $(stat -c %Y "$BACKUPS_DIR/$r")) / 60)) min$( [ "$r" = .nas_last_dump ] && printf ' (%s)' "$(tr -d '\n' <"$BACKUPS_DIR/$r")")"
    else
      echo "recibo $r: não existe"
    fi
  done
  echo "replica-proxy: $("${DADOS[@]}" ps --format '{{.Status}}' replica-proxy </dev/null 2>/dev/null | grep . || echo 'não está no ar')"
  echo "chaves do NAS no $AUTH_KEYS: $(grep -oE 'galaxie-nas-[a-z]+$' "$AUTH_KEYS" 2>/dev/null | paste -sd ' ' || echo nenhuma)"
  exit 0
fi

# ── 1. nenhum deploy em curso ───────────────────────────────────────────────────────────────────────
if [ -d .deploy.lock ] || [ -e .env.next ]; then
  fail "deploy em curso (.deploy.lock ou .env.next presente): ele troca o .env por cima do que for gravado aqui. Espere terminar e rode de novo"
fi

# ── 2. parâmetros que exigem restart ────────────────────────────────────────────────────────────────
wal_level=$(sql "show wal_level")
senders=$(sql "show max_wal_senders")
slots=$(sql "show max_replication_slots")
case "$wal_level" in replica | logical) ok "wal_level=$wal_level" ;; *) fail "wal_level=$wal_level: acrescente '-c wal_level=replica' ao comando do postgres em $CF e recrie o serviço numa janela (API e ao vivo caem por segundos)" ;; esac
[ "$senders" -ge 2 ] 2>/dev/null || fail "max_wal_senders=$senders: acrescente '-c max_wal_senders=10' ao comando do postgres em $CF e recrie o serviço numa janela"
[ "$slots" -ge 1 ] 2>/dev/null || fail "max_replication_slots=$slots: acrescente '-c max_replication_slots=10' ao comando do postgres em $CF e recrie o serviço numa janela"
ok "max_wal_senders=$senders, max_replication_slots=$slots"

# ── 3. retenção de WAL (sighup: ALTER SYSTEM + reload) ──────────────────────────────────────────────
for pair in "wal_keep_size=$WAL_KEEP" "max_slot_wal_keep_size=$SLOT_KEEP"; do
  name="${pair%%=*}"
  want="${pair#*=}"
  [[ "$want" =~ ^[0-9]+(kB|MB|GB|TB)?$|^-1$ ]] || fail "$name='$want' inválido (ex.: 2GB)"
  cur=$(sql "select current_setting('$name')")
  want_mb=$(sql "select pg_size_bytes('$want') / 1048576") || fail "o Postgres não entendeu '$want' para $name"
  cur_mb=$(sql "select pg_size_bytes(current_setting('$name')) / 1048576" 2>/dev/null || echo -1)
  if [ "$want" = -1 ] && [ "$cur" = -1 ]; then ok "$name=-1 (sem limite)"; continue; fi
  if [ "$cur_mb" = "$want_mb" ]; then
    ok "$name=$cur (já era)"
  else
    sql "alter system set $name = '$want'" >/dev/null
    ok "$name: $cur → $want (ALTER SYSTEM; vale no reload abaixo)"
  fi
done

# ── 4. papel replicador ─────────────────────────────────────────────────────────────────────────────
pw=$(env_of REPLICATOR_PASSWORD)
if [ -z "$pw" ] || [[ "$pw" == troque-por* ]]; then
  command -v openssl >/dev/null || fail "openssl não está instalado; não deu para gerar REPLICATOR_PASSWORD"
  pw=$(openssl rand -hex 32)
  [[ "$pw" =~ ^[0-9a-f]{64}$ ]] || fail "openssl não gerou uma senha válida"
  umask 077
  tmp=$(mktemp "$ENV_FILE.replica.XXXXXX")
  grep -v '^REPLICATOR_PASSWORD=' "$ENV_FILE" >"$tmp" || [ $? -eq 1 ]
  printf 'REPLICATOR_PASSWORD=%s\n' "$pw" >>"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
  umask 022
  ok "REPLICATOR_PASSWORD gerada e gravada no $ENV_FILE (copie para a stack nas-replica no Portainer: grep ^REPLICATOR_PASSWORD= $ENV_FILE)"
else
  ok "REPLICATOR_PASSWORD já está no $ENV_FILE"
fi
[[ "$pw" =~ ^[A-Za-z0-9]+$ ]] || fail "REPLICATOR_PASSWORD só pode ter letras e números (vai para o .pgpass do NAS sem escape); gere com openssl rand -hex 32"
if [ "$(sql "select count(*) from pg_roles where rolname = 'replicador'")" = 0 ]; then
  sql "create role replicador with replication login password '$pw'" >/dev/null
  ok "papel replicador criado (REPLICATION, LOGIN)"
else
  sql "alter role replicador with replication login password '$pw'" >/dev/null
  ok "papel replicador: senha do $ENV_FILE reaplicada"
fi

# ── 5. pg_hba.conf ──────────────────────────────────────────────────────────────────────────────────
[[ "$HBA_CIDR" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+$ ]] || fail "REPLICA_HBA_CIDR='$HBA_CIDR' inválido"
hba_line="host replication replicador $HBA_CIDR scram-sha-256"
hba_out=$("${DADOS[@]}" exec -T -e LINE="$hba_line" postgres sh -c '
  f="$PGDATA/pg_hba.conf"
  if grep -qxF "$LINE" "$f"; then echo "ja"; else printf "# replica do NAS (preparar-replica.sh)\n%s\n" "$LINE" >> "$f"; echo "add"; fi' </dev/null)
case "$hba_out" in
  *add*) ok "pg_hba.conf: + $hba_line" ;;
  *) ok "pg_hba.conf já libera replication para replicador em $HBA_CIDR" ;;
esac
[ "$(sql "select pg_reload_conf()")" = t ] || fail "pg_reload_conf() não respondeu true"
ok "configuração recarregada (pg_reload_conf)"

# ── 6. replica-proxy ────────────────────────────────────────────────────────────────────────────────
grep -q '^  replica-proxy:' "$CF" || fail "o $CF da pasta não tem o serviço replica-proxy: traga o da main (scp infra/vps-telemetry/compose.dados.yml …:$PWD/compose.dados.yml.new; docker compose -f compose.dados.yml.new config -q && mv compose.dados.yml.new compose.dados.yml) e rode de novo"
"${DADOS[@]}" config -q </dev/null || fail "$CF inválido com o $ENV_FILE atual"
"${DADOS[@]}" up -d --no-deps replica-proxy </dev/null >/dev/null 2>&1 || fail "não deu para subir o replica-proxy (porta $PROXY_BIND ocupada na VPS? ss -ltnp | grep ${PROXY_BIND##*:})"
ok "replica-proxy no ar em $PROXY_BIND (só loopback da VPS; o túnel do NAS chega aqui)"

# ── 7. comando forçado do recibo ────────────────────────────────────────────────────────────────────
umask 022
cat >"$RECEIPT_BIN.tmp" <<'RECEIPT'
#!/bin/sh
# Comando forçado da chave `galaxie-nas-receipt` no authorized_keys da VPS (instalado em /usr/local/bin/galaxie-nas-receipt
# pelo preparar-replica.sh, que também troca a linha da chave). Por quê: a chave de recibo do NAS só podia rodar
# `touch .nas_last_pull`; com os dumps feitos no NAS a partir da réplica (docs/runbooks/replica-no-nas.md), o NAS precisa
# deixar um segundo recibo, com quando e quanto dumpou, e ler o pedido de dump que o deploy deixa; o comando forçado é o
# único lugar onde a VPS decide o que essa chave pode fazer. Ela continua sem shell, sem outros comandos e só mexe nestes
# arquivos do volume de backups:
#   (sem comando) ou "pull"            toca .nas_last_pull (nas-pull.sh: dumps e/ou assets copiados, como antes)
#   "dump <quando> <bytes> <arquivo>"  grava .nas_last_dump com essa linha (dump.sh da stack nas-replica) e apaga o
#                                      pedido atendido (.nas_dump_request); é o que o deploy com DUMP_MODE=nas
#                                      (nas-dump-check.sh) e o backup-check.sh conferem
#   "pedido"                           imprime o pedido de dump pendente (.nas_dump_request, "<quando> <rótulo>", que o
#                                      nas-dump-check.sh grava com NAS_DUMP_REQUEST=1), ou nada; o dumper do NAS
#                                      consulta a cada minuto (dump.sh --pedido)
# Os campos são validados (data ISO em UTC, inteiro, nome de arquivo simples); qualquer outra coisa é recusada.
# Responde "recibo <comando> ok": o NAS confere a resposta para saber que a VPS gravou mesmo.
set -eu
DIR="${BACKUPS_DIR:-/var/lib/docker/volumes/galaxie-sports_backups/_data}"
[ -d "$DIR" ] || { echo "recibo: volume de backups não encontrado em $DIR" >&2; exit 1; }

# set -f: a quebra em palavras é o parse do comando, sem expandir * nem ? do que o cliente mandar
set -f
# shellcheck disable=SC2086 # a quebra em palavras é o parse do comando
set -- ${SSH_ORIGINAL_COMMAND:-pull}
case "$1" in
  pull)
    [ $# -eq 1 ] || { echo "recibo: pull não leva argumentos" >&2; exit 1; }
    touch "$DIR/.nas_last_pull"
    echo "recibo pull ok"
    ;;
  dump)
    [ $# -eq 4 ] || { echo "recibo: use dump <quando> <bytes> <arquivo>" >&2; exit 1; }
    printf '%s' "$2" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' || { echo "recibo: data inválida" >&2; exit 1; }
    printf '%s' "$3" | grep -Eq '^[0-9]{1,15}$' || { echo "recibo: bytes inválidos" >&2; exit 1; }
    printf '%s' "$4" | grep -Eq '^[A-Za-z0-9._-]{1,200}$' || { echo "recibo: nome de arquivo inválido" >&2; exit 1; }
    # gravação atômica: quem lê nunca vê o arquivo pela metade
    printf '%s %s %s\n' "$2" "$3" "$4" >"$DIR/.nas_last_dump.tmp"
    mv "$DIR/.nas_last_dump.tmp" "$DIR/.nas_last_dump"
    rm -f "$DIR/.nas_dump_request"
    echo "recibo dump ok"
    ;;
  pedido)
    [ $# -eq 1 ] || { echo "recibo: pedido não leva argumentos" >&2; exit 1; }
    if [ -f "$DIR/.nas_dump_request" ]; then
      # só os dois campos, validados: o NAS não executa nada que venha daqui além do rótulo do dump
      read -r quando rotulo <"$DIR/.nas_dump_request" || true
      if printf '%s' "${quando:-}" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' &&
        printf '%s' "${rotulo:-}" | grep -Eq '^[A-Za-z0-9._-]{1,100}$'; then
        printf 'pedido %s %s\n' "$quando" "$rotulo"
      fi
    fi
    echo "recibo pedido ok"
    ;;
  *)
    echo "recibo: comando desconhecido" >&2
    exit 1
    ;;
esac
RECEIPT
chmod 755 "$RECEIPT_BIN.tmp"
mv "$RECEIPT_BIN.tmp" "$RECEIPT_BIN"
ok "$RECEIPT_BIN instalado"

[ -f "$AUTH_KEYS" ] || fail "sem $AUTH_KEYS"
cp "$AUTH_KEYS" "$AUTH_KEYS.bak-$(date -u +%Y%m%dT%H%M%SZ)"
# só os 3 backups mais novos (o nome leva a data)
ls -1 "$AUTH_KEYS".bak-* 2>/dev/null | sort | head -n -3 | while read -r old; do rm -f "$old"; done
# a chave (tipo + base64) de uma linha do authorized_keys ou de uma chave pública passada
key_of() { printf '%s\n' "$1" | grep -oE '(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]+' | head -n 1; }
set_line() { # set_line <comentário> <linha nova>: troca a linha com esse comentário, ou acrescenta
  local comment="$1" line="$2" tmp
  tmp=$(mktemp)
  grep -vE " $comment\$" "$AUTH_KEYS" >"$tmp" || [ $? -eq 1 ]
  printf '%s\n' "$line" >>"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$AUTH_KEYS"
}
receipt_key=$(key_of "$(grep -E ' galaxie-nas-receipt$' "$AUTH_KEYS" || true)")
if [ -z "$receipt_key" ] && [ -n "$RECEIPT_KEY" ]; then receipt_key=$(key_of "$RECEIPT_KEY"); fi
if [ -n "$receipt_key" ]; then
  set_line galaxie-nas-receipt "command=\"$RECEIPT_BIN\",restrict $receipt_key galaxie-nas-receipt"
  ok "chave galaxie-nas-receipt com command=\"$RECEIPT_BIN\",restrict (pull e dump)"
else
  echo "WARN  sem a chave galaxie-nas-receipt no $AUTH_KEYS: passe --receipt-key '<ssh-ed25519 AAAA…>' (a pública de NAS_BACKUP_PATH/ssh/receipt_ed25519.pub do NAS)"
fi

# ── 8. chave do túnel ───────────────────────────────────────────────────────────────────────────────
if [ -n "$TUNNEL_KEY" ]; then
  tunnel_key=$(key_of "$TUNNEL_KEY")
  [ -n "$tunnel_key" ] || fail "--tunnel-key não é uma chave pública ssh (esperado 'ssh-ed25519 AAAA…')"
  set_line galaxie-nas-tunnel "command=\"/bin/false\",restrict,port-forwarding,permitopen=\"$PROXY_BIND\" $tunnel_key galaxie-nas-tunnel"
  ok "chave galaxie-nas-tunnel gravada: só encaminha porta para $PROXY_BIND (sem shell, sem outros destinos)"
elif grep -qE ' galaxie-nas-tunnel$' "$AUTH_KEYS"; then
  ok "chave galaxie-nas-tunnel já está no $AUTH_KEYS"
else
  echo "WARN  sem a chave galaxie-nas-tunnel: gere no NAS (ssh-keygen -t ed25519 -N '' -f NAS_REPLICA_PATH/ssh/tunnel_ed25519 -C galaxie-nas-tunnel) e rode de novo com --tunnel-key '<conteúdo do .pub>'"
fi

echo "PASS  produção pronta para a réplica do NAS. Próximos passos (docs/runbooks/replica-no-nas.md): a stack nas-replica no Portainer do NAS com REPLICATOR_PASSWORD (grep ^REPLICATOR_PASSWORD= $ENV_FILE) e DUMP_PGPASSWORD (a senha de DB_URL_BACKUP); depois --status aqui para ver o pg_stat_replication"
