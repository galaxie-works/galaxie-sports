# Migrations: expandir e contrair

Regra para toda migration em `packages/db/drizzle/`. Issue #549 (épico "Deploy por unidade", fase 4).

## Por que

A troca de versão no deploy é **lado a lado**, e o candidato aplica a migration **antes** da troca
(`infra/vps-telemetry/deploy-gh.sh` › 5b):

```text
migrate (schema novo)  ──►  versão antiga ainda no ar  ──►  troca  ──►  versão nova no ar
                            └─ alguns segundos sobre o schema novo ─┘
```

Nesse intervalo a versão antiga, que não conhece a migration, roda sobre o schema novo. Se a migration tirou ou
mudou algo que ela usa, a versão antiga quebra ao vivo. O mesmo vale para a volta: voltar o código depois de uma
migration só funciona se a versão anterior ainda serve ao schema.

A saída é dividir toda mudança destrutiva em duas: **expandir** primeiro (o schema passa a servir às duas versões) e
**contrair** num deploy seguinte, quando nenhum código no ar usa mais o que vai embora.

## A regra

| Expandir: em qualquer PR | Contrair: só em PR próprio, com o rótulo `contrair` |
|---|---|
| `CREATE TABLE` | `DROP TABLE`, `DROP SCHEMA`, `DROP TYPE`, `DROP VIEW` |
| `ADD COLUMN` opcional (`NULL`) ou com `DEFAULT` | `DROP COLUMN` |
| `CREATE INDEX` (em tabela grande, `-- galaxie:concurrently`, ver abaixo) | `DROP INDEX` (mesmo o trocado por outro), `DROP CONSTRAINT` |
| tabela ou coluna nova que o código novo lê e o antigo ignora | `RENAME` de tabela, coluna, constraint, índice ou valor de enum |
| `ALTER COLUMN … SET DEFAULT`, `DROP DEFAULT`, `DROP NOT NULL` | `ALTER COLUMN … TYPE`, `SET NOT NULL` |
| `ADD VALUE` em enum | `ADD COLUMN … NOT NULL` sem `DEFAULT`, `TRUNCATE` |

O PR `contrair` só é aberto **depois do deploy que parou de usar** o que sai: o código que lia a coluna já foi
trocado, o deploy dele está no ar e estável. Ele leva a migration (e, no máximo, a limpeza do schema em
`src/schema`), nada de código de produto.

## Receitas

**Remover coluna ou tabela.**
1. PR A: o código para de ler e escrever (sem migration).
2. Deploy.
3. PR B, rótulo `contrair`: `DROP COLUMN` / `DROP TABLE`.

**Renomear coluna.** Nunca `RENAME`: a antiga quebra no ato.
1. PR A: `ADD COLUMN novo`; o código escreve nas duas e lê da nova (com `COALESCE(novo, antigo)` enquanto há linha sem
   preencher); backfill em lotes.
2. Deploy. Confira que não sobrou linha sem a coluna nova.
3. PR B: o código só usa a nova. Deploy.
4. PR C, rótulo `contrair`: `DROP COLUMN antigo`.

**Mudar o tipo.** Mesma receita do rename: coluna nova com o tipo certo, escrita dupla, backfill, troca de leitura,
`DROP COLUMN` no fim. `ALTER COLUMN … TYPE` reescreve a tabela com lock e quebra a antiga.

**Tornar obrigatória (`NOT NULL`).**
1. PR A: `ADD COLUMN … DEFAULT x NOT NULL` serve (a antiga insere sem a coluna e o default preenche); numa coluna que
   já existe, o código passa a sempre preencher e o backfill cobre as linhas antigas.
2. Deploy. Confira que não há `NULL`.
3. PR B, rótulo `contrair`: `SET NOT NULL`.

**Trocar um índice.** `CREATE INDEX` do novo no PR A; o `DROP INDEX` do antigo no PR `contrair` seguinte. A versão
antiga ainda pode depender do índice (num índice único, é o alvo do `ON CONFLICT` do código velho). Por isso o
`DROP INDEX` conta sempre, até o `DROP INDEX CONCURRENTLY IF EXISTS` de um índice substituído.

**Índice novo em tabela grande.** Migration só de `CREATE [UNIQUE] INDEX IF NOT EXISTS`, começando por
`-- galaxie:concurrently` (`packages/db/src/concurrent-indexes.ts`): o migrate cria o índice com `CONCURRENTLY`, sem
travar a escrita. O mesmo check do CI confere que o arquivo marcado só tem isso.

## O check do CI

Passo "Migration destrutiva sem o rótulo contrair" (`.github/workflows/ci.yml`, job `checks`):

1. Migrations novas = os `.sql` que o PR **acrescenta** em `packages/db/drizzle/` sobre a base (1º pai do commit
   testado).
2. `packages/db/src/destructive-migrations.ts` lê cada uma e lista as declarações da coluna "Contrair" da tabela
   acima, com arquivo, linha e trecho. Comentários (`--`, `/* */`), texto entre aspas simples e nomes entre aspas
   duplas não contam: uma coluna chamada `"drop"` é só uma coluna.
3. **PR**: com declaração destrutiva e sem o rótulo `contrair`, o passo falha com a mensagem da regra. Com o rótulo,
   lista o que achou e passa.
4. **Fila de merge e push na main**: só avisa. O PR já passou pelo check, e o rótulo não existe na fila.

Para pôr o rótulo num PR que já falhou: `gh pr edit <n> --add-label contrair` e reexecute o job `checks` (o rótulo é
lido da API na hora, não do evento original). Colocar o rótulo sozinho não dispara o CI de novo.

### Decisões e limites

- **`DROP INDEX` conta**, mesmo `CONCURRENTLY IF EXISTS` de índice substituído (ver "Trocar um índice").
- **`DROP DEFAULT`, `DROP NOT NULL`, `DROP IDENTITY` e `DROP EXPRESSION` não contam**: só afrouxam a coluna.
- **`ADD COLUMN … NOT NULL` sem `DEFAULT` conta**: o `INSERT` da versão antiga, que não conhece a coluna, falha.
  Com `DEFAULT` (menos `DEFAULT NULL`, que não preenche nada), `GENERATED` ou `serial` não conta; `ADD` sem a palavra `COLUMN` vale igual.
- **`DROP TRIGGER`/`DROP POLICY` seguido de `CREATE`** (padrão de reaplicar um objeto) também conta; prefira
  `CREATE OR REPLACE` quando existir.
- O check é de **texto**: não sabe se a coluna ainda é usada pelo código. Quem abre o PR `contrair` atesta que não é.
- O que ele **não pega**, e a revisão tem que olhar: `ADD CONSTRAINT` (FK, `UNIQUE`, `CHECK` novos podem rejeitar o
  `INSERT` da versão antiga), `UPDATE`/`DELETE` de dados, e `CREATE INDEX` sem `CONCURRENTLY` em tabela grande.

## Rollback

O deploy automático só volta o código (`restore_previous` em `deploy-gh.sh`) quando **nenhuma migration nova foi
aplicada**. Com migration nova ele recusa e imprime o rollback manual.

- Migration de **expandir** é compatível com a versão anterior, então voltar a imagem à mão é seguro.
- Migration `contrair` aplicada: **voltar o código é proibido**. A versão anterior ainda usa o que a migration tirou
  e quebra. O caminho é corrigir para frente (um novo PR, também com o schema como está) ou, se não houver outro, o
  dump de antes do migrate (`pre-migrate-dump.sh`, com a API e o ingestor parados), que perde as gravações feitas
  depois dele.

Por isso o `contrair` espera o deploy anterior estar estável: depois dele, o código antigo já não precisa voltar.

## Checklist do PR com migration

- [ ] A migration só expande? Então segue sem rótulo.
- [ ] Contrai? PR próprio, rótulo `contrair`, e o deploy que parou de usar já está no ar.
- [ ] Coluna nova obrigatória tem `DEFAULT`; índice em tabela grande é `-- galaxie:concurrently`.
- [ ] `pnpm db:generate` rodado e `drizzle/` commitada (o CI confere drift e a ordem do journal).
- [ ] Número conferido contra os PRs abertos (comando no [CONTRIBUTING](../../CONTRIBUTING.md), regra 11) e sem encaixe no meio da pilha de outra frente; quem entra depois renumera contra a `main`.
