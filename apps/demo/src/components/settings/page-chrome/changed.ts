/**
 * Filtro "Todos / Alterados no painel (N)" (#1072): quais linhas têm o valor vindo do painel (`ops.runtime_setting`),
 * sobrescrevendo o `.env` e o padrão do código. Puro: o servidor, o navegador e os testes usam o mesmo.
 */

export type ChangedMode = 'all' | 'changed';

/** O mínimo de uma linha de ajuste para o filtro (`OpsSetting` serve). */
export interface ChangedSource {
  key: string;
  source: 'db' | 'env' | 'default';
}

/** A linha foi alterada no painel (o valor dela vem do banco). */
export const isChangedInPanel = (s: ChangedSource) => s.source === 'db';

/** Quantas linhas da página foram alteradas no painel; `keys` limita às linhas que a página mostra. */
export function countChanged(settings: readonly ChangedSource[], keys?: readonly string[]): number {
  const only = keys ? new Set(keys) : null;
  return settings.filter((s) => (!only || only.has(s.key)) && isChangedInPanel(s)).length;
}

/** Modo que vale: sem nenhuma alterada, o filtro volta para "Todos" (e fica desabilitado). */
export const effectiveMode = (mode: ChangedMode, count: number): ChangedMode => (count > 0 ? mode : 'all');

/** A linha aparece no modo atual. */
export const showSetting = (s: ChangedSource, mode: ChangedMode) => mode === 'all' || isChangedInPanel(s);

/** Lê `?alterados=1` (o filtro fica na URL para o link levar o mesmo recorte). */
export const parseChangedMode = (value: string | string[] | undefined | null): ChangedMode =>
  value === '1' ? 'changed' : 'all';
