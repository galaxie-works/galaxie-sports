#!/bin/sh
# Espelho produção → DEV (#551): o dump diário mais recente que o NAS guardou (infra/nas-backup/nas-pull.sh) vira o
# banco de DEV, sem sessões, sem chaves e com usuários fictícios; os prefixos públicos do bucket de assets (escudos,
# logos) vão para o RustFS do dev. Nunca toca a produção: lê a cópia do NAS e escreve só no Postgres e no RustFS do dev.
# Roda no serviço `espelho` da stack galaxie-sports-dev do NAS (infra/nas-dev/compose.yml: postgres:17-alpine com age e
# aws-cli), pelo crond, a partir da cópia do script e da SQL na pasta do dev (como o nas-pull.sh):
#   mirror-prod-to-dev.sh --plan                 # prévia: restaura e anonimiza num banco temporário, imprime as
#                                                # contagens por tabela (dev de hoje × cópia) e a conferência, apaga o
#                                                # temporário; não aplica nada
#   mirror-prod-to-dev.sh                        # aplica: dump do dev antes, troca pelo nome, assets, recibo
#   mirror-prod-to-dev.sh --dump <arquivo>       # um dump específico de daily/ (nome ou caminho), em vez do mais recente
# A cada execução:
#   1. escolhe o dump mais recente de $ESPELHO_BACKUPS_DIR/daily/ (o nome leva o horário UTC), confere o .sha256 e, se
#      for .dump.age, decifra com a chave privada do ensaio (BACKUP_AGE_IDENTITY, a mesma do backup da VPS) numa cópia
#      apagada ao sair;
#   2. restaura num banco temporário (<PGDATABASE>_espelho) do Postgres do dev;
#   3. anonimiza lá (mirror-prod-to-dev.sql: demo_auth esvaziado menos "user", usuários fictícios, chaves e webhooks
#      fora, sobrescritas do painel e pedidos pendentes da produção fora, e-mails de autoria trocados);
#   4. preserva o que é do dev: contas de teste (e-mail com ESPELHO_TEST_EMAIL_SUFFIX) e as chaves/tenants do dev;
#   5. confere: nenhuma sessão, código, chave ou sobrescrita da produção sobrou; usuário real nenhum;
#   6. com --plan, imprime as contagens (dev × cópia) e para aqui. Sem --plan: dump do dev de hoje em
#      $ESPELHO_DIR/dev-dumps/ (os ESPELHO_KEEP_DEV_DUMPS mais recentes ficam), troca pelo nome (o dev anterior fica
#      como <PGDATABASE>_pre_espelho, sem conexões, para rollback; o anterior a ele só é apagado com a troca feita),
#      esvazia o Valkey do dev (cache de respostas do banco anterior), copia os prefixos
#      públicos (ESPELHO_S3_PREFIXES, do que o nas-pull.sh guardou em s3/<prefixo>/) para o bucket do dev e deixa o
#      recibo em $ESPELHO_DIR/last_run.txt (a prévia escreve last_plan.txt).
# Variáveis: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (o Postgres do dev), BACKUP_AGE_IDENTITY, ESPELHO_BACKUPS_DIR
#            (/backups: a pasta do nas-pull.sh, só leitura), ESPELHO_DIR (/data: script, recibo, dumps do dev),
#            ESPELHO_SQL (a SQL ao lado do script), ESPELHO_TEST_EMAIL_SUFFIX (@galaxie.test), ESPELHO_KEEP_DEV_DUMPS (3),
#            ESPELHO_S3_PREFIXES (vazio = só o banco; `tasks-bucket` é recusado: bucket privado, uploads de cliente),
#            ESPELHO_S3_DELETE (false), S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY (o RustFS do dev),
#            RESTORE_JOBS (2), DUMP_PREFIX (galaxie_sports_), ESPELHO_VALKEY_HOST (valkey; off = não esvazia o cache),
#            ESPELHO_VALKEY_PORT (6379).
# Runbook: docs/runbooks/ambiente-de-dev.md › Espelho semanal produção → dev. Teste: mirror-prod-to-dev.test.sh.
set -eu

: "${ESPELHO_BACKUPS_DIR:=/backups}"
: "${ESPELHO_DIR:=/data}"
: "${ESPELHO_SQL:=$(dirname "$0")/mirror-prod-to-dev.sql}"
: "${DUMP_PREFIX:=galaxie_sports_}"
: "${PGDATABASE:?defina PGDATABASE (o banco de dev)}"
: "${ESPELHO_TEST_EMAIL_SUFFIX:=@galaxie.test}"
: "${ESPELHO_KEEP_DEV_DUMPS:=3}"
[ "$ESPELHO_KEEP_DEV_DUMPS" -ge 1 ] 2>/dev/null || ESPELHO_KEEP_DEV_DUMPS=1
: "${ESPELHO_S3_PREFIXES:=}"
: "${ESPELHO_S3_DELETE:=false}"
: "${RESTORE_JOBS:=2}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

usage() {
  echo "uso: mirror-prod-to-dev.sh [--plan] [--dump <arquivo>]"
  echo "(detalhes no cabeçalho do script; docs/runbooks/ambiente-de-dev.md)"
}
plan=false
dump_arg=""
while [ $# -gt 0 ]; do
  case "$1" in
  --plan) plan=true ;;
  --dump)
    dump_arg="${2:?--dump precisa do nome ou caminho do dump}"
    shift
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "opção desconhecida: $1 (use --plan, --dump <arquivo>)" >&2
    exit 2
    ;;
  esac
  shift
done

log() {
  level="$1"
  shift
  msg=$(printf '%s' "$*" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"level":"%s","time":"%s","service":"espelho","db":"%s","msg":"%s"}\n' "$level" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PGDATABASE" "$msg"
}

work="${PGDATABASE}_espelho"
previous="${PGDATABASE}_pre_espelho"
work_created=false
plain_tmp=""
id_tmp=""
admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }
drop_work() {
  [ "$work_created" = true ] || return 0
  admin -c "drop database if exists \"$work\" with (force)" >/dev/null 2>&1 || true
  work_created=false
}
cleanup() {
  [ -z "$plain_tmp" ] || rm -f "$plain_tmp"
  [ -z "$id_tmp" ] || rm -f "$id_tmp"
  rm -f "$ESPELHO_DIR"/tmp/.espelho-"$$".* 2>/dev/null || true
}
trap cleanup EXIT
fail() {
  log error "$*"
  receipt=last_run.txt
  [ "$plan" = true ] && receipt=last_plan.txt
  printf '%s erro: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >"$ESPELHO_DIR/$receipt"
  drop_work
  exit 1
}

mkdir -p "$ESPELHO_DIR/tmp" "$ESPELHO_DIR/dev-dumps"
# Uma execução por vez (o crond pode disparar de novo durante uma restauração lenta; alguém pode rodar à mão).
exec 9>"$ESPELHO_DIR/.lock"
flock -n 9 || { log warn "outro espelho em andamento; saindo"; exit 0; }
# sobra em claro de uma execução morta no meio (contêiner derrubado): com a trava, qualquer .espelho-* aqui é de outra
rm -f "$ESPELHO_DIR"/tmp/.espelho-* 2>/dev/null || true

[ -f "$ESPELHO_SQL" ] || fail "sem a SQL de anonimização em $ESPELHO_SQL (copie infra/ops/mirror-prod-to-dev.sql para a pasta)"

# ── prefixos do S3: tudo conferido antes de mexer no banco ───────────────────────────────────────────────────────
s3_list=$(printf '%s\n' "$ESPELHO_S3_PREFIXES" | tr ', \t' '\n\n\n' | sed '/^$/d')
for p in $s3_list; do
  case "$p" in
  tasks-bucket | tasks-bucket/*) fail "o prefixo $p é o bucket privado das tarefas (pacotes e uploads de cliente): nunca vai para o dev" ;;
  *..* | /* | */) fail "prefixo inválido em ESPELHO_S3_PREFIXES: $p" ;;
  esac
  printf '%s' "$p" | grep -q '^[A-Za-z0-9._-]\{1,\}\(/[A-Za-z0-9._-]\{1,\}\)*$' || fail "prefixo inválido em ESPELHO_S3_PREFIXES: $p"
  [ -n "$(find "$ESPELHO_BACKUPS_DIR/s3/$p" -type f 2>/dev/null | head -n 1)" ] ||
    fail "o prefixo $p não tem objeto nenhum em $ESPELHO_BACKUPS_DIR/s3/$p (está em NAS_S3_PREFIXES da stack backup-nas?)"
done
if [ -n "$s3_list" ]; then
  [ -n "${S3_ENDPOINT:-}" ] && [ -n "${S3_BUCKET:-}" ] && [ -n "${S3_ACCESS_KEY:-}" ] && [ -n "${S3_SECRET_KEY:-}" ] ||
    fail "ESPELHO_S3_PREFIXES precisa de S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY e S3_SECRET_KEY (o RustFS do dev)"
fi

# ── 1. o dump: o mais recente de daily/, conferido e, se cifrado, decifrado com a chave do ensaio ──────────────────
dumps_in() { ls -1 "$1"/"${DUMP_PREFIX}"*.dump "$1"/"${DUMP_PREFIX}"*.dump.age 2>/dev/null | sort; }
if [ -n "$dump_arg" ]; then
  case "$dump_arg" in
  /*) file="$dump_arg" ;;
  *) file="$ESPELHO_BACKUPS_DIR/daily/$dump_arg" ;;
  esac
else
  file=$(dumps_in "$ESPELHO_BACKUPS_DIR/daily" | tail -n 1)
fi
[ -n "$file" ] && [ -f "$file" ] || fail "nenhum dump em $ESPELHO_BACKUPS_DIR/daily (o nas-pull.sh já rodou?)"
[ -f "$file.sha256" ] || fail "sem $file.sha256 para conferir o dump"
# como no nas-pull.sh (o busybox e o GNU divergem nas opções do -c): compara o hash à mão
expected=$(awk '{print $1}' "$file.sha256")
actual=$(sha256sum "$file" | awk '{print $1}')
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "sha256 não confere: $(basename "$file") (esperado ${expected:-vazio}, obtido $actual)"
started=$(date -u +%s)
stamp=$(date -u +%Y%m%dT%H%M%SZ)
modo=espelho
[ "$plan" = true ] && modo="prévia do espelho"
log info "$modo a partir de $(basename "$file")"

plain="$file"
case "$file" in
*.age)
  [ -n "${BACKUP_AGE_IDENTITY:-}" ] || fail "dump cifrado sem BACKUP_AGE_IDENTITY (a chave privada do ensaio, a mesma do backup da VPS)"
  plain_tmp="$ESPELHO_DIR/tmp/.espelho-$$.dump"
  id_tmp=$(umask 077 && mktemp "$ESPELHO_DIR/tmp/.espelho-$$.XXXXXX")
  printf '%s\n' "$BACKUP_AGE_IDENTITY" >"$id_tmp"
  age -d -i "$id_tmp" -o "$plain_tmp" "$file" || fail "não deu para decifrar $(basename "$file") com a chave do ensaio"
  rm -f "$id_tmp"
  plain="$plain_tmp"
  ;;
esac
pg_restore --list "$plain" >/dev/null || fail "$(basename "$file") não é legível pelo pg_restore"

# ── 2. restaura no banco temporário ─────────────────────────────────────────────────────────────────────────────
dev_exists=false
[ "$(admin -At -c "select 1 from pg_database where datname = '$PGDATABASE'")" = 1 ] && dev_exists=true
[ "$dev_exists" = true ] || log warn "o banco $PGDATABASE ainda não existe no dev: o espelho o cria, sem nada do dev para preservar"
admin -c "drop database if exists \"$work\" with (force)" || fail "não deu para apagar um $work anterior"
admin -c "create database \"$work\"" || fail "não deu para criar $work"
work_created=true
log info "restaurando em $work ($RESTORE_JOBS jobs)"
pg_restore --no-owner --no-privileges --exit-on-error --jobs="$RESTORE_JOBS" -d "$work" "$plain" || fail "pg_restore falhou em $work"
[ -z "$plain_tmp" ] || rm -f "$plain_tmp"

# ── 3. anonimiza ─────────────────────────────────────────────────────────────────────────────────────────────────
psql -X -q -v ON_ERROR_STOP=1 -d "$work" -v suffix="$ESPELHO_TEST_EMAIL_SUFFIX" -f "$ESPELHO_SQL" || fail "a anonimização (mirror-prod-to-dev.sql) falhou"
log info "cópia anonimizada"

# ── 4. preserva o que é do dev ───────────────────────────────────────────────────────────────────────────────────
suffix_sql=$(printf '%s' "$ESPELHO_TEST_EMAIL_SUFFIX" | sed "s/'/''/g")
# Colunas que a tabela tem nos dois bancos (a versão do schema pode diferir entre o dump e o dev), entre aspas e
# separadas por vírgula; vazio quando a tabela não existe num dos lados.
colunas_comuns() {
  q="select column_name from information_schema.columns where table_schema = '$1' and table_name = '$2' order by 1"
  b="$ESPELHO_DIR/tmp/.espelho-$$.cols"
  psql -X -At -d "$work" -c "$q" >"$b" 2>/dev/null || return 0
  psql -X -At -d "$PGDATABASE" -c "$q" 2>/dev/null | grep -Fx -f "$b" | sed 's/.*/"&"/' | tr '\n' ',' | sed 's/,$//'
  rm -f "$b"
}
# preserva <schema> <tabela> <where no dev> <filtro na cópia> [sql antes do insert, sobre espelho_tmp.<tabela>]
preserva() {
  s="$1"
  t="$2"
  cols=$(colunas_comuns "$s" "$t")
  [ -n "$cols" ] || { log warn "sem $s.$t num dos bancos; nada a preservar"; return 0; }
  csv="$ESPELHO_DIR/tmp/.espelho-$$.$t.csv"
  psql -X -q -v ON_ERROR_STOP=1 -d "$PGDATABASE" -c "\\copy (select $cols from $s.\"$t\" where $3) to '$csv' csv" ||
    fail "não deu para ler $s.$t do dev"
  n=$(wc -l <"$csv" | tr -d ' ')
  psql -X -q -v ON_ERROR_STOP=1 -d "$work" \
    -c "create table espelho_tmp.\"$t\" as select $cols from $s.\"$t\" where false" \
    -c "\\copy espelho_tmp.\"$t\" ($cols) from '$csv' csv" \
    -c "${5:-select 1}" \
    -c "insert into $s.\"$t\" ($cols) select $cols from espelho_tmp.\"$t\" where $4 on conflict do nothing" ||
    fail "não deu para preservar $s.$t do dev na cópia"
  rm -f "$csv"
  log info "preservado do dev: $n linha(s) de $s.$t"
}
if [ "$dev_exists" = true ]; then
  # contas de teste: a do dev vale (uma homônima na produção sai antes)
  preserva demo_auth user "email like '%$suffix_sql'" "true" \
    "delete from demo_auth.\"user\" where email in (select email from espelho_tmp.\"user\")"
  preserva demo_auth account "\"userId\" in (select id from demo_auth.\"user\" where email like '%$suffix_sql')" \
    "\"userId\" in (select id from demo_auth.\"user\")"
  # tenants só do dev (id e slug livres na cópia); a operadora ligada a uma plataforma que a cópia não tem fica sem ela
  preserva api tenant "true" "id not in (select id from api.tenant) and slug not in (select slug from api.tenant)" \
    "do \$\$ begin
       if exists (select 1 from information_schema.columns where table_schema = 'espelho_tmp' and table_name = 'tenant' and column_name = 'operator_platform_id') then
         update espelho_tmp.tenant set operator_platform_id = null
          where operator_platform_id is not null and operator_platform_id not in (select id from enrich.platform);
       end if;
     end \$\$"
  # as chaves do dev (as da produção já saíram): só as de tenant que existe na cópia
  preserva api api_key "true" "tenant_id in (select id from api.tenant)"
  preserva ops publishable_key "true" "tenant_id in (select id from api.tenant)" \
    "do \$\$ begin
       if exists (select 1 from information_schema.columns where table_schema = 'espelho_tmp' and table_name = 'publishable_key' and column_name = 'widget_id') then
         update espelho_tmp.publishable_key set widget_id = null
          where widget_id is not null and widget_id not in (select id from ops.widget);
       end if;
     end \$\$"
fi

# ── 5. conferência: nada da produção que não possa estar no dev ─────────────────────────────────────────────────
# espelho:conferencia (o teste acha a consulta por este marcador)
conferencia=$(psql -X -At -F '=' -v ON_ERROR_STOP=1 -d "$work" -c "
  select 'sessoes_codigos_e_afins', coalesce(sum((xpath('/row/n/text()', query_to_xml(format('select count(*) as n from demo_auth.%I', tablename), false, true, '')))[1]::text::bigint), 0)
    from pg_tables where schemaname = 'demo_auth' and tablename not in ('user', 'account', 'cache_feed_cursor')
  union all select 'contas_de_login_reais', count(*) from demo_auth.account
    where \"userId\" not in (select id from demo_auth.\"user\" where email like '%$suffix_sql')
  union all select 'usuarios_reais', count(*) from demo_auth.\"user\"
    where email not like '%@exemplo.invalid' and email not like '%$suffix_sql'
  union all select 'chaves_api_da_producao', count(*) from api.api_key where prefix in (select prefix from espelho_tmp.prod_api_key)
  union all select 'chaves_publicaveis_da_producao', count(*) from ops.publishable_key where key_hash in (select key_hash from espelho_tmp.prod_publishable_key)
  union all select 'webhooks', count(*) from api.webhook_endpoint
  union all select 'sobrescritas_do_painel', count(*) from ops.runtime_setting
  union all select 'pedidos_pendentes', count(*) from ops.job_request where status in ('pending', 'running')
  union all select 'backfills_pendentes', count(*) from api.backfill_request where status = 'pending'
" 2>&1) || fail "a conferência não rodou: $conferencia"
[ -n "$conferencia" ] || fail "a conferência não devolveu nada (o dump tem o schema esperado?)"
sobras=$(printf '%s\n' "$conferencia" | awk -F= '$2 != 0 { print $1 "=" $2 }' | tr '\n' ' ')
[ -z "$sobras" ] || fail "sobrou coisa da produção na cópia: $sobras"
psql -X -q -v ON_ERROR_STOP=1 -d "$work" -c "drop schema espelho_tmp cascade" || fail "não deu para apagar o schema espelho_tmp"
resumo_conferencia=$(printf '%s\n' "$conferencia" | tr '\n' ' ' | sed 's/ $//')
log info "conferência OK: $resumo_conferencia"

# ── 6. contagens por tabela: dev de hoje × cópia ─────────────────────────────────────────────────────────────────
# espelho:contagens
contagens() {
  psql -X -At -F '=' -d "$1" -c "
    select n.nspname || '.' || c.relname,
           (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
     order by 1" 2>/dev/null || true
}
psql -X -q -d "$work" -c "analyze" >/dev/null 2>&1 || true
dev_counts="$ESPELHO_DIR/tmp/.espelho-$$.dev"
copy_counts="$ESPELHO_DIR/tmp/.espelho-$$.copia"
if [ "$dev_exists" = true ]; then contagens "$PGDATABASE" >"$dev_counts"; else : >"$dev_counts"; fi
contagens "$work" >"$copy_counts"
[ -s "$copy_counts" ] || fail "não deu para contar as tabelas da cópia"
tabela=$(awk -F= 'NR == FNR { dev[$1] = $2; next } { copia[$1] = $2 }
  END {
    for (t in dev) if (!(t in copia)) copia[t] = "-"
    for (t in copia) printf "%-52s %14s %14s\n", t, (t in dev ? dev[t] : "-"), copia[t]
  }' "$dev_counts" "$copy_counts" | sort)
n_tabelas=$(printf '%s\n' "$tabela" | wc -l | tr -d ' ')
printf '%-52s %14s %14s\n%s\n' tabela "dev (hoje)" "cópia" "$tabela"
eventos=$(sed -n 's/^core\.event=//p' "$copy_counts")
participantes=$(sed -n 's/^core\.participant=//p' "$copy_counts")
resumo="dump $(basename "$file"); $n_tabelas tabelas; core.event=${eventos:-?} core.participant=${participantes:-?}; conferência: $resumo_conferencia"
# O dev pode estar à frente da produção (migrations da main ainda não publicadas): a cópia traz o esquema da produção, e
# os workers e CLIs do dev na versão nova esperariam tabelas que ainda não existem. Aqui só se avisa: o migrate do dev
# (pnpm db:migrate na máquina de dev, ou o serviço migrate da stack) reaplica as que faltam, e elas são idempotentes.
mig_dev=$(sed -n 's/^drizzle\.__drizzle_migrations=//p' "$dev_counts")
mig_copia=$(sed -n 's/^drizzle\.__drizzle_migrations=//p' "$copy_counts")
if [ -n "$mig_dev" ] && [ -n "$mig_copia" ] && [ "$mig_copia" -lt "$mig_dev" ] 2>/dev/null; then
  aviso_mig="a cópia tem $((mig_dev - mig_copia)) migration(s) a menos que o dev"
  log warn "$aviso_mig: depois do espelho, rode pnpm db:migrate na máquina de dev (ou o serviço migrate da stack)"
  resumo="$resumo; AVISO: $aviso_mig (rode o migrate)"
fi

if [ "$plan" = true ]; then
  drop_work
  printf '%s prévia: %s; nada aplicado\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$resumo" >"$ESPELHO_DIR/last_plan.txt"
  log info "prévia concluída ($(($(date -u +%s) - started))s): $resumo; nada aplicado"
  exit 0
fi

# ── 7. aplica: dump do dev, troca pelo nome ──────────────────────────────────────────────────────────────────────
devdump=""
if [ "$dev_exists" = true ]; then
  devdump="$ESPELHO_DIR/dev-dumps/${PGDATABASE}_dev_${stamp}.dump"
  pg_dump --format=custom --compress="${BACKUP_COMPRESS:-zstd:5}" --no-owner --no-privileges -d "$PGDATABASE" --file="$devdump.partial" ||
    fail "o dump do dev antes da troca falhou (nada trocado)"
  mv "$devdump.partial" "$devdump"
  (cd "$ESPELHO_DIR/dev-dumps" && sha256sum "$(basename "$devdump")" >"$(basename "$devdump").sha256")
  ls -1 "$ESPELHO_DIR/dev-dumps/${PGDATABASE}_dev_"*.dump 2>/dev/null | sort | head -n "-$ESPELHO_KEEP_DEV_DUMPS" | while read -r old; do
    rm -f "$old" "$old.sha256"
  done
  log info "dump do dev antes da troca: $(basename "$devdump")"
  # o rollback anterior (<db>_pre_espelho) só sai depois da troca dar certo: até lá vira <db>_pre_espelho_old
  admin -c "drop database if exists \"${previous}_old\" with (force)" || fail "não deu para apagar o ${previous}_old"
  if [ "$(admin -At -c "select 1 from pg_database where datname = '$previous'")" = 1 ]; then
    admin -c "alter database \"$previous\" rename to \"${previous}_old\"" || fail "não deu para guardar o $previous anterior"
  fi
  # bloqueia conexões novas antes de derrubar as abertas (next dev, workers e CLIs reconectam no banco novo)
  admin -c "alter database \"$PGDATABASE\" with allow_connections false" || fail "não deu para fechar $PGDATABASE"
  admin -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PGDATABASE' and pid <> pg_backend_pid()" >/dev/null ||
    fail "não deu para encerrar as conexões de $PGDATABASE"
  admin -c "alter database \"$PGDATABASE\" rename to \"$previous\"" || {
    admin -c "alter database \"$PGDATABASE\" with allow_connections true" >/dev/null 2>&1 || true
    fail "não deu para renomear $PGDATABASE para $previous (dev intacto)"
  }
fi
admin -c "alter database \"$work\" rename to \"$PGDATABASE\"" || {
  [ "$dev_exists" = true ] && admin -c "alter database \"$previous\" rename to \"$PGDATABASE\"" -c "alter database \"$PGDATABASE\" with allow_connections true" >/dev/null 2>&1
  fail "não deu para renomear $work para $PGDATABASE (dev devolvido)"
}
work_created=false
admin -c "drop database if exists \"${previous}_old\" with (force)" || log warn "não deu para apagar o ${previous}_old (apague à mão)"
anterior=""
[ "$dev_exists" = true ] && anterior="; o dev anterior ficou em $previous (sem conexões)"
log info "$PGDATABASE agora é a cópia da produção$anterior"

# O cache de respostas da API do dev (Valkey) foi montado sobre o banco antigo, e o change feed da cópia não emite nada
# sobre a troca: sem isto, a API do dev serviria respostas velhas até o TTL. Dev: o Valkey inteiro pode ir (filas e
# contadores do dev recomeçam). Valkey fora do ar só avisa: o banco já está trocado.
if [ "${ESPELHO_VALKEY_HOST:-valkey}" != off ]; then
  if redis-cli -h "${ESPELHO_VALKEY_HOST:-valkey}" -p "${ESPELHO_VALKEY_PORT:-6379}" flushall >/dev/null 2>&1; then
    log info "Valkey do dev esvaziado (cache de respostas do banco anterior)"
  else
    log warn "não deu para esvaziar o Valkey do dev (${ESPELHO_VALKEY_HOST:-valkey}): a API do dev pode servir cache do banco anterior até o TTL"
  fi
fi

# ── 8. assets: os prefixos públicos que o nas-pull.sh guardou → bucket do dev ────────────────────────────────────
objetos=0
delete=""
[ "$ESPELHO_S3_DELETE" = true ] && delete="--delete"
for p in $s3_list; do
  # shellcheck disable=SC2086 # delete vazio some de propósito
  AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    aws --endpoint-url "$S3_ENDPOINT" s3 sync --only-show-errors $delete "$ESPELHO_BACKUPS_DIR/s3/$p/" "s3://$S3_BUCKET/$p/" ||
    fail "copiar o prefixo $p para o bucket do dev (banco já trocado)"
  objetos=$((objetos + $(find "$ESPELHO_BACKUPS_DIR/s3/$p" -type f | wc -l)))
done

duration=$(($(date -u +%s) - started))
resumo="$resumo${devdump:+; dev anterior em $previous e em $(basename "$devdump")}${s3_list:+; assets: $objetos objeto(s)}; ${duration}s"
printf '%s ok: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$resumo" >"$ESPELHO_DIR/last_run.txt"
log info "espelho concluído: $resumo"
