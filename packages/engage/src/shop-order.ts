/**
 * Ordem dos produtos do Shopping pelo contexto do jogo (#923, épico #909). Função pura: recebe os produtos de cada time
 * (já com a oferta da loja) e o que a API já sabe do jogo (status, clássico, fase, vencedor e os destaques da
 * escalação), e devolve o que mostrar, em ordem. Nenhuma chamada a mais à api-sports: quem chama passa o que já tem.
 *
 * Regras:
 * 1. Modo pelo status do jogo, com override nas opções do widget: antes, ao vivo, depois e campeão (depois de uma
 *    final, só para o vencedor);
 * 2. escalação saída: sobe a camisa do jogador destaque, se houver no catálogo;
 * 3. clássico: sobe o produto comemorativo;
 * 4. campeão: sobe o produto de campeão do vencedor. Produto de campeão nunca aparece para quem não venceu;
 * 5. sem estoque ou sem preço da loja (quando a loja informa preço), o produto some; time sem nada, também.
 * No mais, vale a ordem da curadoria (#914).
 */

export const SHOP_GAME_MODES = ['pre', 'live', 'post', 'champion'] as const;
export type ShopGameMode = (typeof SHOP_GAME_MODES)[number];
/** Opção do widget: automático pelo status ou um modo fixo. */
export type ShopModeOption = 'auto' | 'pre' | 'live' | 'post';

export interface ShopOrderProduct {
  id: string;
  /** Tipo do produto âncora (#914): `home_kit`, `commemorative`, `champion`… */
  productType: string;
  /** Ordem da curadoria. */
  position: number;
  /** Jogador da camisa (`core.person.id`), quando o produto é a camisa de alguém. */
  personId?: string | null;
  available: boolean;
  price: number | null;
  /** `curated`: link curado, sem preço por natureza; `live`: veio da loja. */
  source: 'curated' | 'live';
}

export interface ShopOrderTeam {
  /** `core.participant.id` do time. */
  teamId: string;
  products: readonly ShopOrderProduct[];
}

export interface ShopGameContext {
  /** Status do jogo (`EVENT_STATUSES` do contrato). */
  status: string;
  /** `competition_context` do jogo (`derby`, `final`…). */
  competitionContext?: readonly string[];
  /** O jogo é clássico (objeto `derby` do contrato); `derby` em `competitionContext` vale o mesmo. */
  derby?: boolean;
  /**
   * Campeão decidido neste jogo: só na partida que define o título (a volta de uma final em ida e volta, ou a final
   * única), com o vencedor do confronto. No jogo de ida, fica vazio mesmo que alguém tenha vencido.
   */
  titleWinnerId?: string | null;
  /** Destaques da escalação saída, por time (jogadores cujo produto sobe). Vazio ou ausente: sem escalação. */
  featured?: Readonly<Record<string, readonly string[]>>;
}

export interface ShopOrderOptions {
  mode?: ShopModeOption;
  /** Produtos por time (3 a 6 no widget). */
  perTeam?: number;
}

export interface ShopOrderResult {
  mode: ShopGameMode;
  teams: Array<{ teamId: string; products: ShopOrderProduct[] }>;
}

// jogo adiado, cancelado ou abandonado não tem pós-jogo: a vitrine fica a de antes
const PRE = new Set(['scheduled', 'starting', 'postponed', 'cancelled', 'abandoned']);
const LIVE = new Set(['live', 'break', 'suspended']);

/** Modo automático pelo status; `champion` só depois do jogo que decidiu o título. */
export function shopGameMode(ctx: ShopGameContext, option: ShopModeOption = 'auto'): ShopGameMode {
  const base: Exclude<ShopGameMode, 'champion'> =
    option !== 'auto' ? option : PRE.has(ctx.status) ? 'pre' : LIVE.has(ctx.status) ? 'live' : 'post';
  const final = ctx.competitionContext?.includes('final') ?? false;
  return base === 'post' && final && ctx.status === 'finished' && !!ctx.titleWinnerId ? 'champion' : base;
}

const isDerby = (ctx: ShopGameContext) => !!ctx.derby || (ctx.competitionContext?.includes('derby') ?? false);

/** Aparece para o torcedor: disponível e, se a loja informa preço, com preço. */
export function shopProductVisible(p: ShopOrderProduct): boolean {
  return p.available && (p.source === 'curated' || p.price !== null);
}

/** Peso de cada regra: quanto menor, mais alto na lista. A curadoria desempata. */
function rank(p: ShopOrderProduct, team: string, ctx: ShopGameContext, mode: ShopGameMode): number {
  if (mode === 'champion' && p.productType === 'champion' && ctx.titleWinnerId === team) return 0;
  const featured = ctx.featured?.[team] ?? [];
  if (p.personId && featured.includes(p.personId)) return 1;
  if (isDerby(ctx) && p.productType === 'commemorative') return 2;
  return 3;
}

export function orderShopProducts(
  teams: readonly ShopOrderTeam[],
  ctx: ShopGameContext,
  opts: ShopOrderOptions = {},
): ShopOrderResult {
  const mode = shopGameMode(ctx, opts.mode);
  // 3 a 6 por time; valor que não é número volta ao teto (o widget não pode sumir por uma opção estranha)
  const n = Number(opts.perTeam ?? 6);
  const perTeam = Number.isFinite(n) ? Math.min(6, Math.max(3, Math.floor(n))) : 6;
  const out: ShopOrderResult['teams'] = [];
  for (const t of teams) {
    const products = t.products
      .filter(shopProductVisible)
      // produto de campeão só para quem venceu, e só no modo campeão
      .filter((p) => p.productType !== 'champion' || (mode === 'champion' && ctx.titleWinnerId === t.teamId))
      .map((p) => ({ p, r: rank(p, t.teamId, ctx, mode) }))
      .sort((a, b) => a.r - b.r || a.p.position - b.p.position || a.p.id.localeCompare(b.p.id))
      .slice(0, perTeam)
      .map((x) => x.p);
    if (products.length) out.push({ teamId: t.teamId, products });
  }
  return { mode, teams: out };
}
