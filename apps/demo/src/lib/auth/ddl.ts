/**
 * DDL idempotente que não espera trava quando não há nada a fazer. `create index if not exists` pede a trava da
 * tabela antes de ver que o índice existe e espera os inserts em andamento (os do contêiner anterior, no deploy):
 * com o lock_timeout curto do pool (perfil `api`), o setup da demo caía a cada subida.
 */
export const indexIfMissing = (name: string, on: string) =>
  `do $$ begin if to_regclass('${name}') is null then create index ${name} on ${on}; end if; end $$;`;
