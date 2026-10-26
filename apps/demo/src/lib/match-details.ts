/**
 * Abas do bloco "Detalhes da partida" na página do jogo. A aba ativa fica na URL para dar para compartilhar
 * (`?detalhes=escalacao&escalacao=campo`); aba sem dado não aparece.
 */

/** Abas do bloco, na ordem: minuto a minuto, estatísticas, escalação. */
export const DETAIL_TABS = ['minuto', 'estatisticas', 'escalacao'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/** Sub-abas da escalação: titulares, reservas, campo. */
export const LINEUP_TABS = ['titulares', 'reservas', 'campo'] as const;
export type LineupTab = (typeof LINEUP_TABS)[number];

/** Parâmetros da URL de cada nível de abas. */
export const DETAIL_PARAM = 'detalhes';
export const LINEUP_PARAM = 'escalacao';

/**
 * Aba ativa: a pedida na URL, se existir e tiver dado; senão a primeira disponível (na ordem de `all`);
 * nenhuma disponível → `null`.
 */
export function activeTab<T extends string>(
  requested: unknown,
  all: readonly T[],
  available: ReadonlySet<T>,
): T | null {
  const list = all.filter((tab) => available.has(tab));
  return typeof requested === 'string' && list.includes(requested as T)
    ? (requested as T)
    : (list[0] ?? null);
}

/**
 * Atributos extras do painel de uma aba. Com uma aba só a barra de abas não aparece e o painel ficaria
 * como `tabpanel` sem aba que o nomeie: vira uma região com o nome da aba. Com mais de uma, nada muda.
 */
export function panelSemantics(
  available: ReadonlySet<string>,
  label: string,
): { role?: 'region'; 'aria-label'?: string } {
  return available.size === 1 ? { role: 'region', 'aria-label': label } : {};
}
