# Migração das chaves de API para o formato com checksum

Troca uma única vez as chaves secretas emitidas antes da política de chaves (`docs/politica-de-chaves.md`). Essas chaves
têm o formato antigo `gs_<live|test>_<prefixo>_<segredo>`, sem checksum. Para as anteriores à migration 0007, o banco
também não sabe o ambiente (item C18): todas ficaram gravadas como `live`.

Como ainda não há clientes, a decisão é **revogar e reemitir**. Cada chave legada válida é revogada, e uma nova é
emitida no formato `gs_<env>_<prefixo>_<segredo>_<crc32>` com o mesmo tenant, rótulo, escopos e validade.

## O que quebra antes da migração

Assim que a versão com a política entra no ar:

| Chave | Comportamento |
|---|---|
| `gs_live_` legada, gravada `live` | Continua funcionando até a migração |
| `gs_test_` legada, gravada `live` (C18) | **401 na hora**: o prefixo passou a valer |
| Publicável `gs_pk_live_` | Continua funcionando (não muda de formato) |
| Publicável de produção com `localhost` nas origens | Continua funcionando; só a criação de novas recusa `localhost` |

## Ordem segura

1. **Deploy** da versão com a política. A migration 0053 só adiciona colunas, com padrão.
2. **Plano** (não muda nada):

   ```bash
   pnpm --filter @galaxie/api keys:migrate --plan
   ```

   A lista mostra, para cada chave legada válida: tenant, prefixo, rótulo, ambiente gravado, ambiente da nova e último
   uso. Confira quais eram de teste (a coluna "gravada" pode dizer `live` para uma `gs_test_`).

3. **Migração**, informando os prefixos que eram de teste:

   ```bash
   pnpm --filter @galaxie/api keys:migrate --apply --test-prefixes <prefixo1>,<prefixo2>
   ```

   - As chaves novas aparecem **uma única vez** na saída. Guarde-as no cofre de segredos antes de fechar o terminal.
   - Cada troca roda numa transação: a antiga só é revogada se a nova foi criada.
   - Rodar de novo não faz nada, porque não sobra chave legada válida.
   - As antigas param de valer em até 60 s (cache do autenticador).

4. **Trocar `GALAXIE_DEMO_KEY`** na stack (Portainer ou `infra/vps-telemetry`) pela chave nova da demo e fazer
   redeploy da demo. Entre o passo 3 e este, a demo responde 401 ao buscar dados da API. Se a chave atual da demo
   começa com `gs_test_`, ela já para no passo 1: rode os passos 2 a 4 logo depois do deploy.
5. Repassar as chaves novas aos tenants internos ou de teste que existirem.

O comando roda onde houver `DATABASE_URL` da stack: no contêiner da API (`node dist/cli/keys-migrate.js`) ou numa
máquina com acesso ao Postgres.

## Conferência

- Rodar `pnpm --filter @galaxie/api keys:migrate --plan` de novo → "Nenhuma chave legada válida".
- Com a chave nova: `curl -H "x-galaxie-key: <chave>" https://<api>/v1/account` → 200, com `env` e `label` certos.
- Com uma chave antiga → 401.

## Volta

Não há volta para a chave antiga: ela foi revogada. Se uma chave nova sair com o ambiente errado, revogue-a e emita
outra pela operação:

```bash
curl -X POST http://api:8080/internal/admin/tenants/<slug>/keys \
  -H "x-galaxie-admin-key: $GALAXIE_ADMIN_KEY" -H 'content-type: application/json' \
  -d '{"label":"principal","env":"test"}'
```

Faça isso de dentro da rede da stack, de um IP em `ADMIN_IP_ALLOWLIST` (o Caddy devolve 404 para `/internal/*`).

## Depois da migração

Uma versão seguinte pode deixar de ler o formato legado (`parseApiKey` em `apps/api/src/auth/keys.ts`), porque
nenhuma chave de formato 1 válida sobra.
