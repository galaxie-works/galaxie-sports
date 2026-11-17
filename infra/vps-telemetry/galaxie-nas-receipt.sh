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
