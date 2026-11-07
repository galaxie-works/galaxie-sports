#!/usr/bin/env bash
# Teste do sugestao-issue.sh com um gh falso: confere título, rótulo (criado só quando falta), corpo (mascarados,
# anexos, menção neutralizada) e a recusa de payload inválido. Precisa do jq.
#
#   bash infra/ops/sugestao-issue.test.sh
set -u
cd "$(dirname "$0")" || exit 1
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# gh falso: grava cada chamada; `api repos/.../labels/X` existe só se X estiver em FAKE_LABELS; o corpo da issue é
# copiado para $tmp/body.md
cat >"$tmp/gh" <<'GH'
#!/usr/bin/env bash
echo "$*" >>"$FAKE_LOG"
case "$1" in
  api)
    label="${2##*/labels/}"
    case " $FAKE_LABELS " in *" $label "*) exit 0 ;; esac
    exit 1
    ;;
  label) exit 0 ;;
  issue)
    while [ $# -gt 0 ]; do
      case "$1" in --body-file) cp "$2" "$FAKE_BODY"; shift 2 ;; *) shift ;; esac
    done
    echo "https://github.com/x/y/issues/1"
    ;;
  *) echo "gh falso: chamada inesperada $*" >&2; exit 1 ;;
esac
GH
chmod +x "$tmp/gh"
export PATH="$tmp:$PATH" GH_REPO=x/y FAKE_LOG="$tmp/log" FAKE_BODY="$tmp/body.md"

fail=0
check() { # check <descrição> <comando…>
  if "${@:2}"; then echo "ok   $1"; else echo "FALHOU $1"; fail=1; fi
}

payload='{"v":1,"subject":"bug","snippet":"O placar do jogo ficou travado em 1 x 0 depois do","message":"O placar do jogo ficou travado em 1 x 0 depois do gol. @fulano viu também | tabela","email":"wag***@*******.works","tenant":"Port*****","role":"client","page":"/eventos/123","locale":"pt-BR","user_agent":"Mozilla/5.0","viewport":"1440x900","version":"abc123","sent_at":"2026-11-07T01:00:00Z","attachments":[{"url":"https://assets.exemplo/b/feedback/2026-11/a.png","name":"print.png","type":"image/png","bytes":10},{"url":"javascript:alert(1)","name":"x","type":"image/png","bytes":1}]}'

: >"$FAKE_LOG"
FAKE_LABELS="" SUGESTAO_PAYLOAD="$payload" bash sugestao-issue.sh >/dev/null
check 'cria o rótulo que falta' grep -q '^label create Reportar um problema' "$FAKE_LOG"
check 'título = assunto + 50 caracteres' grep -qF -- '--title Reportar um problema: O placar do jogo ficou travado em 1 x 0 depois do' "$FAKE_LOG"
check 'issue com o rótulo do assunto' grep -qF -- '--label Reportar um problema' "$FAKE_LOG"
check 'e-mail mascarado no corpo' grep -qF '`wag***@*******.works`' "$FAKE_BODY"
check 'tenant mascarado no corpo' grep -qF '`Port*****`' "$FAKE_BODY"
check 'imagem anexada' grep -qF '![print.png](https://assets.exemplo/b/feedback/2026-11/a.png)' "$FAKE_BODY"
check 'URL que não é http(s) fica de fora' bash -c "! grep -q javascript '$FAKE_BODY'"
check 'menção neutralizada' bash -c "! grep -q '@fulano' '$FAKE_BODY'"
check 'hora de Brasília' grep -qF '06/11/2026 22:00 (Brasília)' "$FAKE_BODY"

: >"$FAKE_LOG"
FAKE_LABELS="Sugerir%20um%20recurso" SUGESTAO_PAYLOAD="$(jq -c '.subject = "feature" | .tenant = null | .attachments = []' <<<"$payload")" \
  bash sugestao-issue.sh >/dev/null
check 'rótulo existente não é recriado' bash -c "! grep -q '^label create' '$FAKE_LOG'"
check 'sem tenant vira travessão' grep -qF '| Tenant | — |' "$FAKE_BODY"
check 'sem anexos, sem a seção' bash -c "! grep -q 'Anexos' '$FAKE_BODY'"

: >"$FAKE_LOG"
check 'assunto desconhecido é recusado' bash -c \
  "! SUGESTAO_PAYLOAD='$(jq -c '.subject = "hack"' <<<"$payload")' FAKE_LABELS= bash sugestao-issue.sh >/dev/null 2>&1"
check 'nada aberto com payload recusado' bash -c "! grep -q '^issue' '$FAKE_LOG'"

exit $fail
