/**
 * Checagem de destino do Shopping no Builder (#927, épico #909): antes de ligar o widget, o cliente responde uma
 * lista curta e o Builder libera só as lojas e os caminhos que os termos de cada programa permitem naquele destino.
 * Esta é a matriz única de regras (o critério do aceite: "um único arquivo de configuração, testado"). Mudou uma
 * regra, sobe `SHOP_DESTINATION_RULES_VERSION`: a confirmação gravada com a versão anterior deixa de valer e o
 * cliente afetado confirma de novo.
 *
 * | Pergunta                                   | Resposta | Efeito                                                   |
 * | ------------------------------------------ | -------- | -------------------------------------------------------- |
 * | Site seu, declarado na sua conta de afiliado? | não    | só lojas com repasse por sub-rede                         |
 * | App de celular?                            | sim      | link abre fora do app; WebView bloqueado                  |
 * | Smart TV ou set-top box?                   | sim      | Amazon bloqueada; no máximo QR code, só em loja que permite |
 * | Público infantil (menos de 13)?            | sim      | Amazon bloqueada (dentro de comunidade ou sala, automático) |
 * | Área com pontos, bolão ou prêmios?         | sim      | aviso: compra nunca dá ponto; nenhum evento de compra exposto |
 */

/** Versão das regras abaixo. Subiu, toda confirmação gravada com versão menor precisa ser refeita. */
export const SHOP_DESTINATION_RULES_VERSION = 1;

export const SHOP_DESTINATION_QUESTIONS = [
  'ownSite',
  'mobileApp',
  'smartTv',
  'under13',
  'rewardsArea',
] as const;
export type ShopDestinationQuestion = (typeof SHOP_DESTINATION_QUESTIONS)[number];

export type ShopDestinationAnswers = Record<ShopDestinationQuestion, boolean>;

/** Onde o widget vai ficar: dentro de comunidade ou sala, a base já exclui menores de 13 (#937, #954). */
export interface ShopDestinationPlacement {
  /** O widget está num bloco de engajamento (comunidade, sala): `under13` vale "não" automaticamente. */
  engagementBlock?: boolean;
}

/** A loja como o Builder a vê: rede, caminhos liberados pela Galaxie (#916) e se o programa permite QR code. */
export interface ShopDestinationStore {
  id: string;
  network: string;
  clientPaths: readonly ('client_code' | 'subnetwork')[];
  /** O programa da loja permite QR code em TV (sem isso, nada de loja na TV). */
  qrAllowed?: boolean;
}

export type ShopStoreBlock = 'tv_amazon' | 'tv_no_qr' | 'children_amazon' | 'no_path';

export interface ShopDestinationStoreResult {
  storeId: string;
  allowed: boolean;
  /** Caminhos que sobram para esta loja neste destino. */
  paths: Array<'client_code' | 'subnetwork'>;
  /** Por que a loja ficou de fora (quando ficou). */
  blocked: ShopStoreBlock | null;
  /** TV: no máximo o QR code para a loja, sem botão nem link. */
  qrOnly: boolean;
}

export interface ShopDestinationResult {
  version: number;
  /** As respostas que valeram (com o automático da comunidade aplicado). */
  answers: ShopDestinationAnswers;
  /** App: o link abre fora (navegador do sistema ou app da loja); WebView é bloqueado. */
  openExternal: boolean;
  /** App de celular (resposta "sim"): o Builder bloqueia WebView e exige abrir no navegador do sistema ou app da loja. */
  blockWebView: boolean;
  /** Área com pontos, bolão ou prêmios: mostrar o aviso de que compra nunca dá ponto. */
  rewardsWarning: boolean;
  /** Eventos de compra e clique nunca são expostos ao cliente (sempre `false`; fica aqui para o Builder ler). */
  exposePurchaseEvents: false;
  stores: ShopDestinationStoreResult[];
}

/** Amazon em qualquer país e grafia (`amazon`, `amazon_us`, `Amazon`): as regras dela não podem escapar pelo nome. */
const isAmazon = (network: string) => network.trim().toLowerCase().startsWith('amazon');

/**
 * Respostas incompletas não ligam o widget: toda pergunta precisa de sim ou não. Num bloco de engajamento, a pergunta
 * do público infantil nem aparece (o Builder marca "não" sozinho).
 */
export function parseShopDestinationAnswers(
  raw: unknown,
  placement: ShopDestinationPlacement = {},
): ShopDestinationAnswers | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out = {} as ShopDestinationAnswers;
  for (const q of SHOP_DESTINATION_QUESTIONS) {
    if (q === 'under13' && placement.engagementBlock) {
      out[q] = false;
      continue;
    }
    if (typeof r[q] !== 'boolean') return null;
    out[q] = r[q];
  }
  return out;
}

/** Aplica a matriz às lojas que a Galaxie libera para o tenant. */
export function evaluateShopDestination(
  input: ShopDestinationAnswers,
  stores: readonly ShopDestinationStore[],
  placement: ShopDestinationPlacement = {},
): ShopDestinationResult {
  const answers: ShopDestinationAnswers = {
    ...input,
    // dentro de comunidade ou sala, a base já exclui under13: a resposta vale "não" sozinha
    under13: placement.engagementBlock ? false : input.under13,
  };
  const results = stores.map((s): ShopDestinationStoreResult => {
    // sem site declarado na conta de afiliado do cliente, o código dele não vale ali: só a sub-rede
    const paths = s.clientPaths.filter((p) => answers.ownSite || p === 'subnetwork');
    let blocked: ShopStoreBlock | null = null;
    if (answers.smartTv && isAmazon(s.network)) blocked = 'tv_amazon';
    else if (answers.smartTv && !s.qrAllowed) blocked = 'tv_no_qr';
    else if (answers.under13 && isAmazon(s.network)) blocked = 'children_amazon';
    else if (!paths.length) blocked = 'no_path';
    return {
      storeId: s.id,
      allowed: blocked === null,
      paths: blocked ? [] : paths,
      blocked,
      qrOnly: blocked === null && answers.smartTv,
    };
  });
  return {
    version: SHOP_DESTINATION_RULES_VERSION,
    answers,
    // regra do épico #909: o link sempre abre fora, em qualquer destino; o app ainda bloqueia WebView
    openExternal: true,
    blockWebView: answers.mobileApp,
    rewardsWarning: answers.rewardsArea,
    exposePurchaseEvents: false,
    stores: results,
  };
}

/** A confirmação gravada vale para as regras de hoje? Senão, o cliente confirma de novo antes de o widget voltar. */
export function shopDestinationConfirmed(confirmedVersion: number | null | undefined): boolean {
  // igual, não maior ou igual: a confirmação de uma versão que o código não tem (rollback) não vale
  return confirmedVersion === SHOP_DESTINATION_RULES_VERSION;
}

/**
 * Segunda revisão de produto (08/11): quando a plataforma informa a faixa do Perfil, o Shopping não aparece para
 * menor de 13, em qualquer superfície do cliente. De 13 a 17, aparece. Sem faixa informada, vale a checagem de
 * destino acima.
 */
export function shopVisibleForAgeBand(ageBand: string | null | undefined): boolean {
  return ageBand !== 'under13';
}
