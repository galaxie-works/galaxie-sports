import { describe, expect, it } from 'vitest';

import {
  SHOP_DESTINATION_RULES_VERSION,
  evaluateShopDestination,
  parseShopDestinationAnswers,
  shopDestinationConfirmed,
  shopVisibleForAgeBand,
  type ShopDestinationAnswers,
  type ShopDestinationStore,
} from './shop-destination.js';

const no: ShopDestinationAnswers = {
  ownSite: true,
  mobileApp: false,
  smartTv: false,
  under13: false,
  rewardsArea: false,
};
const stores: ShopDestinationStore[] = [
  { id: 'amazon_br', network: 'amazon', clientPaths: ['client_code'] },
  { id: 'awin_br', network: 'awin', clientPaths: ['client_code', 'subnetwork'], qrAllowed: true },
  { id: 'meli_br', network: 'mercado_livre', clientPaths: ['client_code'] },
];
const byId = (r: ReturnType<typeof evaluateShopDestination>) =>
  Object.fromEntries(r.stores.map((s) => [s.storeId, s]));

describe('checagem de destino (#927)', () => {
  it('site próprio declarado: todas as lojas com os caminhos da Galaxie', () => {
    const r = evaluateShopDestination(no, stores);
    expect(r.version).toBe(SHOP_DESTINATION_RULES_VERSION);
    expect(r.stores.every((s) => s.allowed && !s.qrOnly)).toBe(true);
    expect(byId(r).awin_br!.paths).toEqual(['client_code', 'subnetwork']);
    expect(r.openExternal).toBe(true);
    expect(r.blockWebView).toBe(false);
    expect(evaluateShopDestination({ ...no, mobileApp: true }, stores).blockWebView).toBe(true);
    expect(r.exposePurchaseEvents).toBe(false);
  });

  it('sem site declarado na conta: só lojas com sub-rede', () => {
    const r = byId(evaluateShopDestination({ ...no, ownSite: false }, stores));
    expect(r.amazon_br).toMatchObject({ allowed: false, blocked: 'no_path' });
    expect(r.meli_br).toMatchObject({ allowed: false, blocked: 'no_path' });
    expect(r.awin_br).toMatchObject({ allowed: true, paths: ['subnetwork'] });
  });

  it('smart TV: Amazon bloqueada; no máximo QR, só em loja que permite', () => {
    const r = byId(evaluateShopDestination({ ...no, smartTv: true }, stores));
    expect(r.amazon_br).toMatchObject({ allowed: false, blocked: 'tv_amazon' });
    expect(r.meli_br).toMatchObject({ allowed: false, blocked: 'tv_no_qr' });
    expect(r.awin_br).toMatchObject({ allowed: true, qrOnly: true });
  });

  it('público infantil: Amazon bloqueada; em comunidade ou sala vale "não" sozinho', () => {
    const kids = byId(evaluateShopDestination({ ...no, under13: true }, stores));
    // decisão de 12/11: público infantil desliga o Shopping inteiro
    for (const st of Object.values(kids)) expect(st).toMatchObject({ allowed: false, blocked: 'children' });
    const room = evaluateShopDestination({ ...no, under13: true }, stores, { engagementBlock: true });
    expect(room.answers.under13).toBe(false);
    expect(byId(room).amazon_br!.allowed).toBe(true);
  });

  it('área com pontos: aviso ligado, nenhum evento de compra exposto', () => {
    const r = evaluateShopDestination({ ...no, rewardsArea: true }, stores);
    expect(r.rewardsWarning).toBe(true);
    expect(r.exposePurchaseEvents).toBe(false);
  });

  it('respostas incompletas não ligam o widget', () => {
    expect(parseShopDestinationAnswers({ ownSite: true })).toBeNull();
    expect(parseShopDestinationAnswers({ ...no, smartTv: 'sim' })).toBeNull();
    expect(parseShopDestinationAnswers(null)).toBeNull();
    expect(parseShopDestinationAnswers({ ...no, extra: 1 })).toEqual(no);
  });

  it('confirmação de versão antiga força nova confirmação', () => {
    expect(shopDestinationConfirmed(SHOP_DESTINATION_RULES_VERSION)).toBe(true);
    expect(shopDestinationConfirmed(SHOP_DESTINATION_RULES_VERSION - 1)).toBe(false);
    expect(shopDestinationConfirmed(null)).toBe(false);
  });

  it('a matriz inteira: Amazon nunca sai liberada em TV nem para criança', () => {
    const bools = [true, false];
    for (const ownSite of bools)
      for (const mobileApp of bools)
        for (const smartTv of bools)
          for (const under13 of bools)
            for (const rewardsArea of bools) {
              const r = byId(
                evaluateShopDestination({ ownSite, mobileApp, smartTv, under13, rewardsArea }, stores),
              );
              if (smartTv || under13) expect(r.amazon_br!.allowed).toBe(false);
              if (!ownSite) for (const s of Object.values(r)) expect(s.paths).not.toContain('client_code');
            }
  });

  it('em comunidade ou sala, a pergunta do público infantil pode faltar', () => {
    const { under13: _skip, ...rest } = no;
    expect(parseShopDestinationAnswers(rest)).toBeNull();
    expect(parseShopDestinationAnswers(rest, { engagementBlock: true })).toEqual({ ...no, under13: false });
  });

  it('Amazon com outro nome de rede continua bloqueada na TV e para criança', () => {
    const odd: ShopDestinationStore[] = [
      { id: 'amz_us', network: 'amazon_us', clientPaths: ['client_code'], qrAllowed: true },
      { id: 'amz_cap', network: 'Amazon', clientPaths: ['client_code'] },
    ];
    for (const s of evaluateShopDestination({ ...no, smartTv: true }, odd).stores)
      expect(s.allowed).toBe(false);
    for (const s of evaluateShopDestination({ ...no, under13: true }, odd).stores)
      expect(s.allowed).toBe(false);
  });

  it('confirmação de versão maior (rollback) não vale', () => {
    expect(shopDestinationConfirmed(SHOP_DESTINATION_RULES_VERSION + 1)).toBe(false);
  });

  it('Perfil menor de 13 não vê o Shopping; de 13 a 17 vê', () => {
    expect(shopVisibleForAgeBand('under13')).toBe(false);
    expect(shopVisibleForAgeBand('13_17')).toBe(true);
    expect(shopVisibleForAgeBand(null)).toBe(true);
  });
});
