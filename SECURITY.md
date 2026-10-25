# Política de segurança

Este documento resume como reportar vulnerabilidades e quais controles protegem a API Galaxie Sports. A visão geral de
compliance (licenciamento de dados, IA, LGPD) está em [docs/11](docs/11-seguranca-licenciamento-e-compliance.md).

## Como reportar uma vulnerabilidade

- **Não abra issue pública.** Use o [aviso privado de segurança do GitHub](https://github.com/galaxie-works/galaxie-sports/security/advisories/new)
  deste repositório.
- Descreva o impacto, os passos para reproduzir e a versão/commit afetado. Não inclua dados pessoais nem chaves reais —
  se uma chave vazou, diga só o prefixo (`gs_live_<prefixo>`).
- Prazos-alvo: confirmação em até **2 dias úteis**, avaliação inicial em até **5 dias úteis**, correção de falhas
  críticas/altas em até **14 dias** (ou mitigação documentada).
- Teste apenas contra o seu ambiente local (`pnpm infra:up`). Não faça testes de carga, varreduras ou força bruta contra
  ambientes de staging/produção sem autorização por escrito.

## Versões suportadas

O projeto é entregue continuamente a partir da `main`. Correções de segurança entram na `main` e no próximo deploy;
não há manutenção de versões antigas.

## Controles

| Área | Controle | Onde |
|---|---|---|
| Chaves de tenant | Segredo de 256 bits; só o hash scrypt com sal fica no banco; exibida uma vez; rotação com graça; revogação; escopos | `apps/api/src/auth`, [docs/05 §1.1–1.2](docs/05-api-publica.md#11-implementação-schema-api) |
| Rotas administrativas | `/internal/admin/*`: bloqueadas no proxy público, chave administrativa + allowlist de IP (fora → 404), `no-store`, sem CORS | `apps/api/src/admin`, `infra/caddy/Caddyfile` |
| Headers | nosniff, `X-Frame-Options: DENY`, CSP restritiva, `no-referrer`, COOP/CORP, HSTS (`HSTS_MAX_AGE`) | `apps/api/src/security/headers.ts` |
| CORS | Lista explícita (`CORS_ORIGINS`), sem credenciais, nunca em `/internal/*` | `apps/api/src/security/cors.ts` |
| Entrada | Zod em params/query/corpo de todas as rotas; corpo ≤ 64 KiB; query do espelho limitada; auditoria automática de rotas | `apps/api/src/security/security.test.ts` |
| Abuso | Rate limit por tenant × rota (Valkey); cache negativo de chaves inválidas (sem recalcular scrypt); rate limit por IP na borda | `apps/api/src/server.ts`, `auth/authenticator.ts` |
| Logs | Sem headers de chave (API e Caddy) e com IP mascarado | `apps/api/src/observability.ts`, `infra/caddy/Caddyfile` |
| Segredos no Git | gitleaks no CI (histórico completo) + `.gitignore` de `.env*` | `.github/workflows/ci.yml`, `.gitleaks.toml` |
| Dependências | Dependabot (npm, Actions, Docker, Compose) + `pnpm audit --prod` informativo | `.github/dependabot.yml` |
| Backups / DR | Dump diário, cópia remota, restore testado no CI e exercício de DR documentado | [infra/portainer/README.md](infra/portainer/README.md#backups), [docs/runbooks/exercicio-dr.md](docs/runbooks/exercicio-dr.md) |

## Chaves de API

Revisão do esquema de hash (issue #84):

- **Formato**: `gs_<live|test>_<prefixo 12 hex>_<segredo 43 base64url>`. O prefixo (48 bits) é público e só localiza a
  linha; o segredo tem 256 bits de entropia (`crypto.randomBytes`).
- **Armazenamento**: `scrypt$N$r$p$sal$hash` com N=2¹⁴, r=8, p=1, sal de 16 bytes e saída de 32 bytes (`node:crypto`).
  Para um segredo de 256 bits aleatórios, um hash rápido já seria resistente a força bruta; o scrypt é defesa em
  profundidade caso um dump do banco vaze junto com segredos de baixa qualidade de outra origem. A doc antiga citava
  argon2 — o scrypt nativo evita dependência nativa e tem garantias equivalentes neste uso.
- **Verificação**: comparação em tempo constante (`timingSafeEqual`). Resultado positivo fica em cache por 60 s (por
  instância, indexado pelo sha256 da chave completa — a chave em claro não fica em memória como índice); resultado
  negativo com prefixo existente também (evita que repetir a mesma chave errada custe um scrypt por requisição).
- **Chaves aleatórias** (o prefixo é público): numa chave fora do cache, a ordem é limite por IP → banco → revogada,
  expirada ou tenant suspenso (ainda sem scrypt) → limite por prefixo → scrypt. Prefixo inexistente, revogado ou
  expirado fica em cache negativo por prefixo (60 s). Os limites (`AUTH_ATTEMPTS_PER_MINUTE`, padrão 60 por IP — IPv6
  agrupado por /64 — e por prefixo, no Valkey) respondem 429 `RATE_LIMITED` e só contam tentativas que custam
  banco/scrypt. Com o Valkey fora, a contagem segue em memória, por instância (não libera tudo).
- **Chave legítima sob ataque ao prefixo**: um segredo já verificado não passa pelos limites. Na instância, o registro
  dispensa o scrypt e tem TTL deslizante (1 h renovada a cada uso; o registro da chave continua relido a cada 60 s).
  Entre instâncias, o sha256 da chave completa verificada fica no Valkey (`auth:ok:*`, 24 h renovadas a cada uso):
  instância nova (deploy, restart, scale-out) também não aplica o limite a ela. Esse registro **não** dispensa o
  scrypt — escrever no Valkey não dá acesso.
- **Sem oráculo de status**: o motivo do 401 (revogada, expirada, tenant suspenso) só vai para quem já provou ter o
  segredo; para quem só tem o prefixo, a resposta é o `INVALID_KEY` genérico.
- **IP real**: o limite por IP depende de `TRUST_PROXY` correto atrás de proxy. Vazio atrás do Caddy, todo cliente tem
  o IP do Caddy (um balde só para todos); `true` confia no 1º endereço do `X-Forwarded-For`, que o cliente forja —
  use os IPs/CIDRs do proxy (a stack Portainer usa `uniquelocal` por padrão; a vps-telemetry, o gateway fixo). O
  proxy da frente, por sua vez, não pode confiar no `X-Forwarded-For` que recebe: o Caddy da stack não tem
  `trusted_proxies` e sobrescreve o cabeçalho com o IP do cliente (confiar em `private_ranges` deixava forjá-lo, porque
  um cliente IPv6 chega ao Caddy pelo docker-proxy com o IP do gateway, que é privado). Com CDN na frente, confie só
  nos ranges dela; confira os endereços com `docker network inspect`.
- **Consequência do cache**: revogação, suspensão e mudança de plano valem em até 60 s — também nos streams SSE já
  abertos, que revalidam a chave a cada heartbeat com contexto de no máximo 60 s − heartbeat.
- **Chaves administrativas** (`gs_admin_...`): também 256 bits; guardadas no ambiente como `sha256$...` — hash rápido de
  propósito, para que chaves inválidas em massa não custem CPU numa rota interna. Várias podem coexistir em
  `ADMIN_KEY_HASHES` (rotação sem janela).
- **Nunca** registre a chave completa em logs, tickets ou commits. Para suporte, use o prefixo.

## Rotação de segredos

| Segredo | Como rotacionar |
|---|---|
| Chave de tenant | Cliente: `POST /v1/account/keys/rotate` (`graceSeconds`, padrão 24 h). Operação: `POST /internal/admin/tenants/{id}/keys/{keyId}/rotate`. Vazamento: `graceSeconds: 0` (revoga na hora; efetivo em ≤ 60 s) |
| Chave administrativa | `pnpm --filter @galaxie/api admin:key` → acrescente o novo hash em `ADMIN_KEY_HASHES` (mantendo o antigo), redeploy, troque a chave nos clientes internos, remova o hash antigo, redeploy |
| `APISPORTS_KEY` | Gere uma nova no painel do fornecedor, atualize o secret store/stack, redeploy de API e ingestor, revogue a antiga |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Nova chave no console do provedor → secret store → redeploy dos serviços de IA → revogue a antiga |
| `POSTGRES_PASSWORD` | `ALTER ROLE galaxie PASSWORD '...'` → atualize `DATABASE_URL`/stack → redeploy (API, ingestor, backup, migrate) |
| `S3_*` / `BACKUP_S3_*` | Crie credencial nova no storage, atualize a stack, redeploy, remova a antiga |
| `METRICS_TOKEN` | Atualize na stack (API e Prometheus leem a mesma variável) e redeploy |
| `WEBHOOK_SIGNING_SECRET` | KEK dos segredos dos webhooks (ver [Webhooks](#webhooks)): `WEBHOOK_SIGNING_SECRET=<nova>,<antiga>` no worker e na CLI → `pnpm --filter @galaxie/api webhook seal-secrets` (recifra com a nova) → remova a antiga. Os segredos `whsec_...` dos clientes não mudam |

Rotacione imediatamente qualquer segredo que apareça num alerta do gitleaks, num log ou fora do secret store — remover o
commit **não** basta.

## Webhooks

Notas para a implementação dos webhooks (docs/05 §5, issue #35):

- Assinatura `HMAC-SHA256(segredo, "<timestamp>.<corpo>")` em `x-galaxie-signature: t=<unix>,v1=<hex>`; o cliente
  rejeita `t` com mais de 5 min de diferença (replay) e compara em tempo constante.
- **Um segredo por endpoint**, gerado pelo servidor (32 bytes), exibido uma vez; guardado cifrado (não hash — o
  servidor precisa dele para assinar) em AES-256-GCM, com a chave de cifra fora do banco: `WEBHOOK_SIGNING_SECRET`
  é a KEK (≥ 32 caracteres, ex.: `openssl rand -base64 32`; chave derivada por HKDF-SHA256). Formato gravado
  `enc:v1:<kid>:<iv>:<cifrado>:<tag>`, com o id do endpoint como dado autenticado (AAD: o cifrado copiado para outro
  endpoint não abre) e tag de 16 bytes exigida (o Node aceitaria tag truncada); só o worker decifra, ao assinar.
  - **Sem KEK**: `webhook create` é recusado (nunca grava texto puro); o worker registra um aviso ao subir e as
    entregas de segredos cifrados falham como tentativa com erro `WebhookSecretError` (retentativas → DLQ;
    `webhook replay` depois de corrigir). KEK errada ou ausente da lista tem o mesmo efeito.
  - **Legado** (endpoints cadastrados antes da cifra, `whsec_...` em texto puro): o worker continua lendo e
    assinando como antes, com ou sem KEK. Migração no deploy: defina a KEK no ambiente do worker e da CLI,
    publique a versão nova e rode `pnpm --filter @galaxie/api webhook seal-secrets` (idempotente; troca cada
    linha só se o valor não mudou, com o worker no ar; linha que não abre é listada no fim, sem abortar as demais). O
    segredo do cliente continua o mesmo — mas ele já esteve em texto puro e segue nos dumps do banco até o fim da
    retenção dos backups (`BACKUP_RETENTION_DAYS`, padrão 30 dias). **Recomendado**: recriar os endpoints legados
    (segredo novo para o cliente) e, quando todos estiverem cifrados, ligar `WEBHOOK_REJECT_PLAINTEXT_SECRETS=true`
    no worker: segredo em texto puro passa a falhar a entrega em vez de assinar.
  - **Rotação da KEK**: várias KEKs separadas por vírgula (a primeira cifra, todas decifram) + `seal-secrets`.
- Rotação com sobreposição: durante a janela, enviar duas assinaturas (`v1=<novo>,v1=<antigo>`).
- URLs de destino só `https://`, sem IPs privados/loopback/link-local (SSRF): IP literal nessas faixas é recusado no
  cadastro (loopback só para desenvolvimento) e, na entrega, o `lookup` do socket recusa qualquer resolução para
  rede privada, link-local (metadata `169.254.169.254`), CGNAT, multicast, reservada ou de documentação (TEST-NET),
  incluindo os formatos IPv6 que embutem IPv4 (`::/96`, `::ffff:0:0:0/96`, NAT64, 6to4) — a checagem é no endereço
  usado na conexão, sem janela para DNS rebinding. `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` desliga o bloqueio (só
  desenvolvimento). O IP resolvido não vai para o `last_error`. Timeout curto, sem seguir redirects, corpo de
  resposta descartado.
- Endpoint desativado ou tenant suspenso: entregas já enfileiradas não são enviadas (vão para a DLQ com o motivo).
- Nunca incluir dados pessoais no payload (a API não os possui; ver docs/11 §3).

## Backups e recuperação

Procedimento, ensaio mensal e rollback: [infra/portainer/README.md](infra/portainer/README.md#restore-testado). Registro
do último exercício de DR, com tempos e conferência: [docs/runbooks/exercicio-dr.md](docs/runbooks/exercicio-dr.md).
