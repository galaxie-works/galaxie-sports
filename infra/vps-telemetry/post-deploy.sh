#!/usr/bin/env bash
# Passos pós-deploy, rodados NA VPS dentro de /docker/galaxie-sports, com a stack nova já no ar. Os dois roteiros de
# deploy mandam este arquivo pelo ssh (o do GitHub Actions, deploy-gh.sh, e o da máquina de dev, deploy.sh):
#
#   ssh <vps> 'cd /docker/galaxie-sports && bash -s -- all' < infra/vps-telemetry/post-deploy.sh
#
#   all    seed da base semântica, nomes curados de estádios e importância (idempotentes, sem chamada ao fornecedor),
#          limpeza do cache de respostas da API e checagem da conta da IA
#   cache  só a limpeza do cache (depois de voltar para a versão anterior)
#
# Falha no seed ou na limpeza do cache sai com ≠ 0 (o deploy para); a checagem da IA só avisa.
# O script chega pelo stdin (bash -s): todo comando que não precisa de entrada lê de /dev/null, senão o docker compose
# consumiria o resto do script.
set -euo pipefail
export PULL_POLICY=missing # nada vem do registry aqui

step="${1:-all}"

seed() {
  echo "pós-deploy (idempotente, sem chamadas ao fornecedor)"
  docker compose run --rm --no-deps -w /srv/services/ingestor ingestor \
    node node_modules/@galaxie/knowledge/dist/cli/seed-semantic.js --dir /srv/data/knowledge </dev/null >/dev/null
  docker compose run --rm --no-deps ingestor node dist/cli/derive-names.js </dev/null >/dev/null
  docker compose run --rm --no-deps ingestor node dist/cli/events-importance.js --esporte football --proximos-dias 7 </dev/null >/dev/null
  echo ok
}

# cache de respostas da API (até 24 h, last-known-good): o que a versão anterior calculou não pode continuar sendo
# servido — só as chaves de resposta e de tag; rate limit e o resto ficam. Falha do scan ou do del derruba o deploy
# (sh -e no contêiner), senão o cache antigo seguiria no ar sem aviso.
cache() {
  echo "limpando o cache de respostas da API"
  docker compose exec -T valkey sh -ec '
    for p in "gs:cache:*" "gs:tag:*"; do
      keys=$(valkey-cli --scan --pattern "$p")
      [ -z "$keys" ] || printf "%s\n" "$keys" | xargs -n 200 valkey-cli del >/dev/null
    done' </dev/null
}

# conta do provedor de IA com crédito? (chamada mínima, ~20 tokens) — só avisa, não derruba o deploy.
# Com AI_STATUS=off no env do contêiner, não chama o provedor (o scheduler também respeita o painel).
ai() {
  echo "conta da IA"
  docker compose exec -T agents node - <<'JS' || echo "WARN  IA: checagem não rodou (contêiner agents fora do ar?)"
if ((process.env.AI_STATUS || '').trim().toLowerCase() === 'off') {
  console.log('WARN  IA: desligada (AI_STATUS=off), sem checar o crédito');
  process.exit(0);
}
const p = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const gem = p === 'gemini';
const key = gem ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;
if (!key || (p !== 'openai' && !gem)) {
  console.log('WARN  IA: provedor ' + p + ' sem chave configurada');
  process.exit(0);
}
const model = process.env.AI_MODEL_LIGHT || (gem ? 'gemini-3.5-flash-lite' : 'gpt-6-luna');
const req = gem
  ? ['https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', { method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 1 } }) }]
  : ['https://api.openai.com/v1/responses', { method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: 'ok', max_output_tokens: 16 }) }];
fetch(req[0], req[1])
  .then(async (r) => {
    const j = await r.json().catch(() => ({}));
    console.log(r.ok ? 'PASS  IA: conta com crédito (' + p + ')'
      : 'WARN  IA: ' + r.status + ' ' + (j.error?.status || j.error?.code || j.error?.type || '') + ' — agentes no texto determinístico');
  })
  .catch((e) => console.log('WARN  IA: sem conexão com o provedor (' + e.message + ')'));
JS
}

case "$step" in
  all)
    seed
    cache
    ai
    ;;
  cache) cache ;;
  *)
    echo "uso: post-deploy.sh all|cache" >&2
    exit 2
    ;;
esac
