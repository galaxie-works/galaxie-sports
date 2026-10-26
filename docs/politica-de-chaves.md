# Política de chaves de API (proposta)

Ainda não há clientes, então a política pode ser definida do zero. Cada seção compara o que o código faz
**hoje** (com `arquivo:linha`) com a **proposta** e lista **o que muda no código**. Os pontos marcados com
**Decisão** precisam de uma escolha do dono; a recomendação vem junto. Nada aqui foi implementado ainda.

## 1. Tipos de chave

**Hoje**

- Secreta: `gs_<live|test>_<prefixo 12 hex>_<segredo 43>` (`apps/api/src/auth/keys.ts:8`), guardada como
  scrypt. Vale em qualquer rota do plano, inclusive SSE com `?key=` (`apps/api/src/realtime/sse.ts:145`).
- O ambiente (`live`/`test`) é só rótulo: a autenticação lê o prefixo, mas não compara com `api_key.env`
  (`apps/api/src/auth/authenticator.ts:105`). Uma chave de teste tem o mesmo dado, limite e contagem de uso de
  uma de produção.
- Publicável: `gs_pk_live_<segredo 43>` (`packages/db/src/widgets.ts:120`), guardada como sha256. Só `GET` em
  `/v1/*` com módulo, nunca `/v1/account`, SSE nem rotas internas (`apps/api/src/auth/publishable.ts:159`). Só das
  origens cadastradas (`publishable.ts:97`), opcionalmente presa a um widget, que limita os módulos.
- Administrativa: `gs_admin_...`, hash `sha256$` em `ADMIN_KEY_HASHES`; não é chave de cliente.

**Proposta**

| Tipo | Prefixo | Onde | Escopo |
|---|---|---|---|
| Secreta de produção | `gs_live_` | Só no backend do cliente | Módulos do plano ∩ escopos da chave |
| Secreta de teste | `gs_test_` | Desenvolvimento e homologação | Igual, com limite próprio menor (ver §4) |
| Publicável de produção | `gs_pk_live_` | Navegador, só nas origens cadastradas | Leitura `/v1`, módulos do widget |
| Publicável de teste | `gs_pk_test_` | Navegador em `http://localhost`/`127.0.0.1` | Igual; recusa origem de produção |

- O ambiente passa a valer: prefixo diferente do `env` gravado → 401.
- **Decisão 1 — o que a chave de teste muda.** Recomendo: mesmo dado da produção (não há sandbox de dados
  esportivos), limite fixo baixo (60 req/min por rota), uso contado à parte e fora de qualquer cobrança.
  Alternativa: manter o rótulo cosmético de hoje (mais simples, mas o cliente não ganha nada separando).
- **Decisão 2 — publicável de teste.** Recomendo criar `gs_pk_test_` só para `localhost`, para a produção
  nunca precisar listar `http://localhost` nas origens.

**O que muda no código**

- `authenticator.ts`: recusar quando `parsed.env !== record.env`; aplicar o limite de teste.
- `packages/db/src/widgets.ts`: prefixo `gs_pk_test_`, coluna `env` em `ops.publishable_key` e regra de
  origem por ambiente.
- `usage`: rota prefixada pelo ambiente (ou coluna `env`) no contador.

## 2. Emissão

**Hoje**

- Secreta, emitida pela operação:
  - onboarding `POST /internal/admin/tenants` (`apps/api/src/admin/routes.ts:122`);
  - nova chave `POST /internal/admin/tenants/{id}/keys` (`routes.ts:177`);
  - CLI `pnpm --filter @galaxie/api tenant:create` (`apps/api/src/cli/tenant-create.ts:112`; padrão `test`).
- O cliente não emite secretas, só rotaciona a que usa (`apps/api/src/routes/v1/account.ts:66`).
- Publicável: o próprio cliente cria no painel do cliente da demo
  (`apps/demo/src/app/[locale]/(app)/cliente/actions.ts:95`), com origens obrigatórias. Não há teto.

**Proposta**

- Secretas: a operação emite a primeira chave de cada ambiente no onboarding. O cliente gerencia as demais
  no painel (criar, rotacionar, revogar), dentro do teto.
- Publicáveis: continuam no painel do cliente.
- **Decisão 3 — teto de chaves ativas.** Recomendo, por tenant, 5 secretas por ambiente e 20 publicáveis,
  contando as que estão em período de graça. Hoje o teto é 20 secretas no total e só na rotação
  (`apps/api/src/admin/tenants.ts:234`).

**O que muda no código**

- Rota `POST /v1/account/keys` (emitir) e `POST /v1/account/keys/{id}/revoke` com o teto, mais a tela no
  painel.
- Teto aplicado também na emissão administrativa e em `createPublishableKey`.

## 3. Rotação, expiração, revogação e trial

**Hoje**

- Rotação:
  - a chave nova herda rótulo, escopos, ambiente e validade;
  - a antiga vale por `graceSeconds` (padrão 24 h, máximo 7 dias; `tenants.ts:228`,
    `packages/contracts/src/account.ts:49`);
  - uma chave já rotacionada não rotaciona de novo (409).
- Expiração:
  - opcional, só na emissão administrativa (`routes.ts:53`, sem máximo);
  - publicável não expira.
- Revogação:
  - admin `.../revoke` (`routes.ts:208`) e painel para a publicável;
  - vale em até 60 s (cache do autenticador, `authenticator.ts:96`), inclusive em SSE aberto.
- Trial: não existe como plano; é uma chave com `expiresAt`.

**Proposta**

- Rotação: mantém a regra de hoje.
- Expiração:
  - secreta de produção sem validade por padrão, como é comum em APIs B2B;
  - aviso no painel e por e-mail para chave sem uso há 90 dias;
  - máximo de 1 ano quando a validade é pedida;
  - publicável sem validade (está pública por definição; vale a lista de origens).
- **Decisão 4 — trial.** Recomendo um plano `trial` em `config/plans.yaml`: chave `test` e `live` com
  validade de 30 dias, cota diária baixa, sem SSE nem webhooks. O fim do trial vale para todas as chaves
  do tenant.
- Revogação: o cliente revoga as próprias chaves no painel; a operação revoga qualquer uma. Fica como hoje
  (≤ 60 s).

**O que muda no código**

- `NewKey` com máximo de 1 ano.
- Plano `trial` e expiração por tenant (`tenant.trial_ends_at`).
- Job de aviso de chave parada (usa `last_used_at`).

## 4. Limites e cota

**Hoje**

- Secreta: `rate_limit_per_minute` do plano, por **tenant × rota**, janela fixa no Valkey
  (`apps/api/src/server.ts:253`). Planos: 120, 300, 600 e 3000 (`config/plans.yaml:22`).
- Publicável: 60/min por **chave × IP**, nunca acima do limite do tenant (`server.ts:255`).
- Ao estourar: 429 `RATE_LIMITED` com `retry-after` e `x-ratelimit-*`.
- Tentativas de autenticação fora do cache: 60/min por IP e por prefixo, antes do banco e do scrypt.
- Cota diária: só informativa, exibida no uso (`packages/db/src/schema/api.ts:63`). Nada é bloqueado.

**Proposta**

- Rate limit: mantém tenant × rota para a secreta e chave × IP para a publicável. Teste com limite fixo
  (§1).
- **Decisão 5 — cota diária.** Recomendo aplicar: aviso ao passar de 80% (header `x-galaxie-quota-remaining`
  e e-mail) e 429 `QUOTA_EXCEEDED` ao passar de 110% até a virada do dia UTC. `enterprise` segue sem cota.
  Alternativa: manter informativa e cobrar excedente (exige faturamento).

**O que muda no código**

- Checagem da cota no hook de autenticação. O total do dia já está no Valkey (`usage:<dia>:<tenant>`);
  basta somá-lo com cache curto.
- Código de erro `QUOTA_EXCEEDED` no contrato e nas docs.

## 5. Logs e vazamento

**Hoje**

- Nunca se loga a chave:
  - o serializer de requisição não inclui headers (`server.ts:125`);
  - `?key=` é mascarado (`sse.ts:127`);
  - suporte usa o prefixo;
  - `last_used_at` é atualizado a cada 5 min.
- O gitleaks no CI (`.github/workflows/ci.yml:130`) protege só o repositório. Não há detecção de chave de
  cliente vazada.

**Proposta**

- Log de auditoria por chave: emissão, rotação e revogação, com quem fez e quando. Nunca o segredo.
- **Decisão 6 — alerta de vazamento.** Recomendo cadastrar os prefixos `gs_live_`/`gs_test_` no programa de
  parceiros do secret scanning do GitHub. A chave encontrada em repositório público é revogada
  automaticamente e o cliente é avisado por e-mail. A publicável fica fora (é pública por definição).
- Alerta interno de uso anômalo: uma chave usada de muitos IPs novos de uma vez, ou picos de 401 num prefixo.

**O que muda no código**

- Tabela `api.api_key_event` (auditoria).
- Endpoint público de recebimento do secret scanning, com verificação da assinatura do GitHub.
- Métrica de 401/429 por prefixo no Prometheus.

## 6. Migração do estado atual

Sem clientes, a recomendação é **revogar todas as chaves existentes e reemitir**. Isso também resolve o
item C18 (o ambiente das chaves criadas antes da migration 0007 não está no banco, e todas ficaram `live`).

1. Revogar as secretas e as publicáveis (no Postgres da stack):

   ```bash
   psql "$DATABASE_URL" -c "update api.api_key set revoked_at = now() where revoked_at is null;" \
     -c "update ops.publishable_key set revoked_at = now() where revoked_at is null;"
   ```

2. Reemitir a chave de cada tenant, de dentro da rede da stack (o Caddy devolve 404 para `/internal/*`) e de
   um IP em `ADMIN_IP_ALLOWLIST`:

   ```bash
   curl -X POST "http://api:8080/internal/admin/tenants/<slug>/keys" \
     -H "x-galaxie-admin-key: $GALAXIE_ADMIN_KEY" -H 'content-type: application/json' \
     -d '{"label":"principal","env":"live"}'
   ```

   Não use `tenant:create` para tenants que já existem: ele reaplica os valores do modelo do plano.

3. Trocar `GALAXIE_DEMO_KEY` na stack pela chave nova da demo e fazer redeploy da demo.
4. Recriar as chaves publicáveis no painel do cliente.

Revogar vale em até 60 s.
