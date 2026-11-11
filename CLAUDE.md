# Galaxie Sports — instruções para agentes

Leia o [CONTRIBUTING.md](CONTRIBUTING.md) antes de mexer no código: stack, comandos, regras de banco, idioma, neutralidade e PRs valem para pessoas e agentes. O resumo abaixo são as regras que mais custaram quando ignoradas.

## Branches, PRs e merge

- **Pilha curta:** no máximo 3 PRs empilhados (branch criado a partir de outro ainda aberto). Precisa de mais? Mergeie a base antes.
- **Pilha entra com merge commit:** `gh pr merge N --merge`, de baixo para cima. Squash só para PR sozinho; squash numa pilha faz cada filho conflitar no `_journal.json` e esperar outro CI.
- **Não apague o branch pai antes dos filhos:** primeiro `gh pr edit <filho> --base main`, confira a base, e só então apague o branch. `--delete-branch` no pai fecha os filhos.
- **Sem merge entre frentes:** não traga o branch de outra frente para o seu. Precisa do código dela? Espere entrar na `main` e traga a `main`.

## Migrations (`packages/db/drizzle`)

- Antes de `pnpm db:generate`, liste os números usados nos PRs abertos (comando no CONTRIBUTING, regra 11) e use o próximo livre.
- Colidiu com outra frente? Quem entra depois renumera contra a `main`, com `when` maior que o da última migration da `main`. Nunca encaixe um número no meio da pilha de outra frente.
- Só expandir; contrair vai em PR próprio com o rótulo `contrair` ([docs/runbooks/migrations.md](docs/runbooks/migrations.md)).
