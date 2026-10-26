# Política de chaves de API

**Decidida em 2026-10-26**, com base na prática de mercado (Stripe, Twilio, GitHub). Antes ela era uma proposta
(#356). Cada seção diz a regra, por que ela é assim e onde está no código.

Status: as 6 decisões estão no ar. Ficam de fora o programa de parceiros do secret scanning e o alerta de uso
anômalo (§5).

## As 6 decisões

| # | Decisão | Por quê |
|---|---|---|
| 1 | Chave de teste: mesmo dado da produção, limite fixo de 60 req/min por rota e uso contado à parte | Não existe sandbox de dados esportivos; o que o cliente precisa é separar o tráfego de desenvolvimento, como o modo teste da Stripe |
| 2 | Publicável de teste `gs_pk_test_`, aceita só em `localhost`/`127.0.0.1`/`[::1]` | A chave de produção nunca precisa listar `localhost`, que qualquer um roda na própria máquina |
| 3 | Teto por tenant: 5 secretas por ambiente e 20 publicáveis, contando as em período de graça | Basta para rotação e um serviço por chave; um teto baixo limita o estrago de uma conta comprometida |
| 4 | Plano `trial` de 30 dias, cota baixa, sem SSE nem webhooks | Avaliação com prazo e custo previsíveis; o fim do trial vale para todas as chaves do tenant |
| 5 | Cota diária aplicada: aviso a partir de 80% e 429 `QUOTA_EXCEEDED` a partir de 110%; `enterprise` sem cota | Cota só exibida não protege a infraestrutura nem o contrato; a folga de 10% evita cortar no limite exato |
| 6 | Formato de chave com checksum e padrão cadastrado no secret scanning do GitHub | O checksum permite achar chave vazada sem falso positivo, como nos tokens do GitHub |

## 1. Tipos de chave

| Tipo | Formato | Onde | Escopo |
|---|---|---|---|
| Secreta de produção | `gs_live_<prefixo 12 hex>_<segredo 43>_<crc32 8 hex>` | Só no backend do cliente | Módulos do plano ∩ escopos da chave |
| Secreta de teste | `gs_test_..._<crc32>` | Desenvolvimento e homologação | Igual, com 60 req/min por rota e uso à parte |
| Publicável de produção | `gs_pk_live_<segredo 43>` | Navegador, nas origens cadastradas (sem `localhost`) | Leitura `/v1`, módulos do widget |
| Publicável de teste | `gs_pk_test_<segredo 43>` | Navegador em `localhost`, `127.0.0.1` ou `[::1]` | Igual |

- **O ambiente vale.** Uma chave cujo prefixo diverge do ambiente gravado responde 401
  (`apps/api/src/auth/authenticator.ts`; `verifyPublishableKey` em `packages/db/src/widgets.ts`).
- **Checksum.** O CRC32 de `gs_<env>_<prefixo>_<segredo>` (`apps/api/src/auth/keys.ts`) recusa erro de digitação e
  chave inventada sem consultar o banco.
  - Trocar `gs_test_` por `gs_live_` no texto também invalida a chave.
  - O formato antigo (sem checksum) é lido só para as chaves emitidas antes (`api_key.key_format = 1`), até a migração.
- **Chave secreta de teste:**
  - balde de rate limit próprio (`test:<tenant>:<rota>`), com 60 por minuto, sem consumir o da produção;
  - uso gravado como `test:<rota>` (`apps/api/src/server.ts`), separado do de produção e fora da cota.
- **Publicável de teste:**
  - criada com `env: 'test'` (`ops.publishable_key.env`);
  - a criação recusa origens fora de `localhost`;
  - a publicável de produção recusa `localhost` na criação (`originsOutsideEnv`).

## 2. Emissão e teto

- **Secreta:** a operação emite.
  - Onboarding: `POST /internal/admin/tenants`.
  - Chave nova: `POST /internal/admin/tenants/{id}/keys`.
  - CLI: `pnpm --filter @galaxie/api tenant:create`.
- **O cliente:** rotaciona a chave em uso (`POST /v1/account/keys/rotate`).
- **Publicável:** o cliente cria no painel do cliente da demo (**Chaves publicáveis**), escolhendo produção ou teste.
- **Teto de secretas:** 5 válidas por tenant e ambiente, contando as que estão em período de graça
  (`MAX_SECRET_KEYS_PER_ENV`, `apps/api/src/admin/tenants.ts`).
  - Vale na emissão administrativa, no `tenant:create` e na rotação. Na rotação com `graceSeconds: 0`, a antiga
    sai na hora e não conta.
  - Acima do teto: 409 `CONFLICT`.
- **Teto de publicáveis:** 20 ativas por tenant (`MAX_PUBLISHABLE_KEYS_PER_TENANT`). Acima: erro na criação.

## 3. Rotação, expiração, revogação e trial

- **Rotação:**
  - a chave nova herda rótulo, escopos, ambiente e validade;
  - a antiga vale por `graceSeconds` (padrão 24 h, máximo 7 dias);
  - cada chave só é rotacionada uma vez (409).
- **Expiração:**
  - a secreta não tem validade por padrão; pode ser definida na emissão;
  - a publicável não expira.
- **Revogação:** pela operação (`.../keys/{keyId}/revoke`) ou pelo painel (publicável). Vale em até 60 s, inclusive em
  stream SSE aberto.
- **Trial:** plano `trial` em `config/plans.yaml` (`trialDays: 30`, só `core_data`, 60 req/min, cota de 5000/dia).
  - O onboarding grava `api.tenant.trial_ends_at`. Depois do prazo, nenhuma chave do tenant autentica (401, secreta ou
    publicável).
  - Trocar o plano (`PATCH /internal/admin/tenants/{id}` com `plan`) tira o prazo; voltar para `trial` dá 30 dias de
    novo.
  - Sem tempo real (`PLANS_WITHOUT_REALTIME`): `/v1/stream` responde 403 `MODULE_NOT_IN_PLAN`, o cadastro de webhook é
    recusado e o worker não enfileira entregas do tenant.

## 4. Limites e cota

- **Rate limit:**
  - secreta: `rate_limit_per_minute` do plano, por tenant × rota;
  - secreta de teste: 60 por rota, em balde próprio;
  - publicável: 60 por chave × IP;
  - ao estourar: 429 `RATE_LIMITED` com `retry-after` e `x-ratelimit-*`.
- **Tentativas de autenticação fora do cache:** 60 por minuto por IP e por prefixo (`AUTH_ATTEMPTS_PER_MINUTE`).
- **Cota diária** (`api.tenant.daily_request_quota`; `QuotaGuard` em `apps/api/src/usage/quota.ts`):
  - toda resposta de chave de produção com cota traz `x-galaxie-quota-limit` e `x-galaxie-quota-remaining`;
  - a partir de 80%, `x-galaxie-quota-warning: <uso>%` e um evento no log (`quota.warning`, uma vez por tenant e dia);
  - acima de 110%: 429 `QUOTA_EXCEEDED` com `retry-after` até a virada do dia UTC, e evento `quota.exceeded`; a
    requisição recusada não conta;
  - só o uso de produção conta: a chave de teste fica fora, e a publicável conta como produção;
  - `enterprise` não tem cota (`dailyRequestQuota: null`);
  - o total vem dos contadores de uso no Valkey, relidos a cada 5 s por instância. O corte é aproximado, e a folga de
    10% cobre isso. Com o Valkey fora, a cota não bloqueia (fail-open, como o rate limit);
  - a API não envia e-mail: o aviso por e-mail fica com quem consome os logs.

## 5. Logs e vazamento

- **Nunca se loga a chave.** O serializer de requisição não inclui headers, `?key=` é mascarado e o suporte usa o
  prefixo.
- **Auditoria** (`api.api_key_event`): emissão, rotação, revogação e migração, de chave secreta ou publicável.
  - Cada evento grava quem fez (`admin`, `tenant`, `cli:<comando>`, `panel:<id do usuário>`, `widget`), quando e o
    prefixo, nunca o segredo.
  - O evento é gravado na mesma transação da mudança.
  - Consulta: `GET /internal/admin/tenants/{id}/key-events?limit=`.
- **No repositório:** o gitleaks do CI tem uma regra própria para o formato com checksum (`.gitleaks.toml`, regra
  `galaxie-api-key`).
- **Secret scanning do GitHub** é configuração da organização, não código. Cadastre o padrão customizado assim:
  1. GitHub → organização → **Settings** → **Code security** → **Global settings** → **Custom patterns** → **New
     pattern**. É preciso ter o GitHub Advanced Security, ou o Secret Protection, habilitado na organização.
  2. Nome: `Galaxie Sports API key`. Formato do segredo (regex):
     `gs_(live|test)_[0-9a-f]{12}_[A-Za-z0-9_-]{43}_[0-9a-f]{8}` (o mesmo de `API_KEY_SCAN_PATTERN` em
     `apps/api/src/auth/keys.ts`).
  3. Antes do segredo: `\A|[^0-9A-Za-z_-]`. Depois: `\z|[^0-9A-Za-z_-]`.
  4. Em **Test string**, cole uma chave gerada em desenvolvimento (`tenant:create --env test`) e confira que ela é
     encontrada inteira. Depois salve e publique o padrão (**Publish pattern**).
  5. Habilite **Push protection** para o padrão: um push com a chave é bloqueado antes de entrar no repositório.
  6. Alerta encontrado: revogue a chave pelo prefixo (`POST /internal/admin/tenants/{id}/keys/{keyId}/revoke`) e
     avise o cliente.
- **Fora daqui:** o programa de parceiros do secret scanning, que avisa de chaves em qualquer repositório público, e o
  alerta de uso anômalo. Os dois precisam de um endpoint público e de um volume que ainda não existe.

## 6. Migração do estado atual

As chaves emitidas antes desta política têm o formato antigo. Para as anteriores à 0007, o ambiente gravado pode estar
errado (C18). A decisão é revogar e reemitir com `pnpm --filter @galaxie/api keys:migrate` (`--plan` primeiro).
Passo a passo, o que quebra e a ordem segura: [`docs/runbooks/migracao-de-chaves.md`](runbooks/migracao-de-chaves.md).
