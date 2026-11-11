# @galaxie/engage

Regras do engajamento do torcedor (#1017) sem HTTP nem banco, iguais na API, no worker e no console.

- `roles.ts` (#1019): cargos da equipe do cliente (Dono, Admin, Moderador sênior, Moderador, Voluntário), a matriz
  `ACTIONS` (ação → cargo mínimo) e `can(actor, action, target)` / `check(...)` com o motivo da recusa (outro tenant,
  cargo, escopo, duração). `canAssign` diz quem pode dar ou tirar cada cargo. A equipe da Galaxie
  (`{ kind: 'galaxie_staff' }`) passa por cima de tudo. Ação nova entra em `ACTIONS` com nome `area.verbo`.

- `country-policy.ts` (#954): a Ficha por país (idade, entidade, moeda, retenção, gamificação e campanhas com prêmio),
  as fichas iniciais, `validatePolicy` / `policyChangeIssues` (nunca abaixo de 13; escrever abaixo de 18 só com
  confirmação), `hardenPolicy` (o cliente só endurece) e `resolvePolicy` (país do torcedor, LATAM, país principal).

Vêm depois, na mesma biblioteca: configuração efetiva e Regras fixas. O token do torcedor (#937) mora em `apps/api`.

## Depende de

Nada.

## Usado por

`apps/demo` (Cliente → Usuários e cargos; Ajustes → Conformidade → Ficha por país) e, nas próximas ondas, `apps/api` (rotas do engajamento).
