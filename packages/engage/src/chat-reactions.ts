/**
 * Reações do Chat ao vivo (#967), sem banco nem HTTP: o conjunto fixo, quem reage e o limite por pessoa.
 *
 * Em jogo grande a reação vira contador ("12 mil 🔥") em vez de mensagem: participação para quem não quer escrever,
 * sem custo de moderação (não é texto). Por isso `13_17` também reage; `under13` continua fora de todo recurso social
 * (D1 da base). O cliente escolhe quais das seis aparecem nas salas dele.
 */

export const CHAT_REACTIONS = ['fire', 'clap', 'shock', 'laugh', 'angry', 'ball'] as const;
export type ChatReaction = (typeof CHAT_REACTIONS)[number];

export const REACTION_EMOJI: Record<ChatReaction, string> = {
  fire: '🔥',
  clap: '👏',
  shock: '😱',
  laugh: '😂',
  angry: '😡',
  ball: '⚽',
};

export const isChatReaction = (v: string): v is ChatReaction =>
  (CHAT_REACTIONS as readonly string[]).includes(v);

/** Reações por pessoa por segundo na sala (acima disso, as extras são descartadas sem erro para o widget). */
export const REACTIONS_PER_SECOND = 5;

/** Faixa que reage: qualquer uma com token, menos `under13`. */
export const canReact = (ageBand: string): boolean => ageBand === '13_17' || ageBand === '18plus';

/** O cliente ligou esta reação? (`null` = as seis). */
export const reactionEnabled = (enabled: readonly string[] | null | undefined, r: ChatReaction): boolean =>
  !enabled || enabled.includes(r);

/** Contagem do lote: o que entrou neste segundo e o total do jogo, por reação (só as que têm contagem). */
export interface ReactionTally {
  delta: Partial<Record<ChatReaction, number>>;
  total: Partial<Record<ChatReaction, number>>;
}

/** Só as reações ligadas pelo cliente (o contador é do jogo; o filtro é por cliente, na entrega). */
export function filterTally(t: ReactionTally, enabled: readonly string[] | null | undefined): ReactionTally {
  const keep = (o: Partial<Record<ChatReaction, number>>) =>
    Object.fromEntries(
      Object.entries(o).filter(([k]) => reactionEnabled(enabled, k as ChatReaction)),
    ) as Partial<Record<ChatReaction, number>>;
  return { delta: keep(t.delta), total: keep(t.total) };
}

/** "12 mil", "1,2 mi" (pt), "12 mil", "1,2 M" (es), "12K", "1.2M" (en): o contador como o widget mostra. */
export function compactCount(n: number, locale = 'pt-BR'): string {
  const l = locale.slice(0, 2).toLowerCase();
  const lang = l === 'es' ? 'es' : l === 'en' ? 'en' : 'pt-BR';
  // espaço comum no lugar do sem quebra do Intl (o widget decide a quebra)
  return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 })
    .format(n)
    .replace(/\s/g, ' ');
}
